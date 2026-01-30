import type {
  ChangeEvent,
  Document,
  DocumentStore,
  IndexDefinition,
  IndexField,
  NormalizedIndex,
  StorageQuery,
} from '@pocket/core';
import { Subject, type Observable } from 'rxjs';
import { QueryTranslator } from './query-translator.js';
import type { SerializedDocument, SqlJsDatabase, SQLiteIndex } from './types.js';

/**
 * SQLite-backed document store implementation using sql.js (WASM).
 *
 * Each SQLiteDocumentStore manages a single SQLite table representing
 * a Pocket collection. Documents are stored with metadata columns
 * (_id, _rev, _deleted, _updatedAt, _vclock) and a JSON _data column
 * containing all user-defined fields.
 *
 * ## Table Schema
 *
 * ```sql
 * CREATE TABLE pocket_{collection} (
 *   _id TEXT PRIMARY KEY,
 *   _rev TEXT,
 *   _deleted INTEGER DEFAULT 0,
 *   _updatedAt INTEGER,
 *   _vclock TEXT,
 *   _data TEXT NOT NULL
 * );
 * ```
 *
 * ## Features
 *
 * - Full CRUD operations with change event emission
 * - Soft delete via _deleted flag
 * - SQL-based querying with json_extract for JSON fields
 * - Index support via SQLite CREATE INDEX on json_extract expressions
 * - RxJS Observable change stream
 *
 * @typeParam T - The document type stored in this collection
 * @internal
 */
export class SQLiteDocumentStore<T extends Document> implements DocumentStore<T> {
  readonly name: string;
  private readonly db: SqlJsDatabase;
  private readonly tableName: string;
  private readonly changes$ = new Subject<ChangeEvent<T>>();
  private readonly queryTranslator = new QueryTranslator();
  private sequenceCounter = 0;

  /**
   * Create a new SQLiteDocumentStore.
   *
   * @param db - The sql.js database instance
   * @param name - The collection/store name
   */
  constructor(db: SqlJsDatabase, name: string) {
    this.db = db;
    this.name = name;
    this.tableName = `"pocket_${name}"`;
  }

  /**
   * Retrieve a single document by its ID.
   *
   * @param id - The document ID to retrieve
   * @returns The document if found, or null if not found or soft-deleted
   */
  async get(id: string): Promise<T | null> {
    const stmt = this.db.prepare(
      `SELECT * FROM ${this.tableName} WHERE _id = ? AND _deleted = 0`
    );
    try {
      stmt.bind([id]);
      if (stmt.step()) {
        const row = stmt.getAsObject() as unknown as SerializedDocument;
        return this.deserialize(row);
      }
      return null;
    } finally {
      stmt.free();
    }
  }

  /**
   * Retrieve multiple documents by their IDs.
   *
   * Returns documents in the same order as the input IDs.
   * Missing or soft-deleted documents are represented as null.
   *
   * @param ids - Array of document IDs to retrieve
   * @returns Array of documents (or null) in the same order as input IDs
   */
  async getMany(ids: string[]): Promise<(T | null)[]> {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(', ');
    const stmt = this.db.prepare(
      `SELECT * FROM ${this.tableName} WHERE _id IN (${placeholders}) AND _deleted = 0`
    );
    try {
      stmt.bind(ids);
      const rowMap = new Map<string, T>();
      while (stmt.step()) {
        const row = stmt.getAsObject() as unknown as SerializedDocument;
        const doc = this.deserialize(row);
        rowMap.set(doc._id, doc);
      }
      return ids.map((id) => rowMap.get(id) ?? null);
    } finally {
      stmt.free();
    }
  }

  /**
   * Retrieve all non-deleted documents in the store.
   *
   * @returns Array of all documents
   */
  async getAll(): Promise<T[]> {
    const stmt = this.db.prepare(
      `SELECT * FROM ${this.tableName} WHERE _deleted = 0`
    );
    try {
      const results: T[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as unknown as SerializedDocument;
        results.push(this.deserialize(row));
      }
      return results;
    } finally {
      stmt.free();
    }
  }

  /**
   * Insert or update a document.
   *
   * If a document with the same _id already exists, it is replaced.
   * A change event is emitted ('insert' for new documents, 'update' for existing).
   *
   * @param doc - The document to store (must have an _id property)
   * @returns The stored document
   */
  async put(doc: T): Promise<T> {
    // Check if document exists to determine operation type
    const existing = this.getRaw(doc._id);
    const operation: ChangeEvent<T>['operation'] = existing ? 'update' : 'insert';

    const serialized = this.serialize(doc);
    this.db.run(
      `INSERT OR REPLACE INTO ${this.tableName} (_id, _rev, _deleted, _updatedAt, _vclock, _data) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        serialized._id,
        serialized._rev ?? null,
        serialized._deleted ?? 0,
        serialized._updatedAt ?? null,
        serialized._vclock ?? null,
        serialized._data,
      ]
    );

    // Emit change event
    this.emitChange(
      operation,
      doc._id,
      doc,
      existing ? this.deserialize(existing) : undefined
    );

    return doc;
  }

  /**
   * Insert or update multiple documents.
   *
   * Operations are performed within the current transaction context.
   * Change events are emitted for each document.
   *
   * @param docs - Array of documents to store
   * @returns Array of stored documents
   */
  async bulkPut(docs: T[]): Promise<T[]> {
    const results: T[] = [];
    for (const doc of docs) {
      const result = await this.put(doc);
      results.push(result);
    }
    return results;
  }

  /**
   * Soft-delete a document by setting _deleted = 1.
   *
   * The document is not physically removed from the table; instead its
   * _deleted flag is set to 1. This enables sync and conflict resolution
   * to detect deletions.
   *
   * If the document does not exist, this is a no-op.
   *
   * @param id - The ID of the document to delete
   */
  async delete(id: string): Promise<void> {
    const existing = this.getRaw(id);
    if (!existing) return;

    this.db.run(
      `UPDATE ${this.tableName} SET _deleted = 1, _updatedAt = ? WHERE _id = ?`,
      [Date.now(), id]
    );

    this.emitChange(
      'delete',
      id,
      null,
      this.deserialize(existing)
    );
  }

  /**
   * Soft-delete multiple documents by their IDs.
   *
   * @param ids - Array of document IDs to delete
   */
  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  /**
   * Execute a query against the document store.
   *
   * The query is translated from Pocket QuerySpec to SQL using the
   * QueryTranslator. Filters, sorts, skip, and limit are all handled
   * in SQL for optimal performance.
   *
   * @param query - The query specification
   * @returns Array of documents matching the query
   */
  async query(query: StorageQuery<T>): Promise<T[]> {
    const translation = this.queryTranslator.translate(query.spec);
    const { sql, params } = this.buildSelectQuery(translation);

    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const results: T[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as unknown as SerializedDocument;
        results.push(this.deserialize(row));
      }
      return results;
    } finally {
      stmt.free();
    }
  }

  /**
   * Count documents matching a query.
   *
   * If no query is provided, returns the total count of non-deleted documents.
   *
   * @param query - Optional query to filter documents before counting
   * @returns The count of matching documents
   */
  async count(query?: StorageQuery<T>): Promise<number> {
    if (!query?.spec.filter) {
      const result = this.db.exec(
        `SELECT COUNT(*) as count FROM ${this.tableName} WHERE _deleted = 0`
      );
      return (result[0]?.values[0]?.[0] as number) ?? 0;
    }

    const translation = this.queryTranslator.translate(query.spec);
    const { sql, params } = this.buildCountQuery(translation);

    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        return (row.count as number) ?? 0;
      }
      return 0;
    } finally {
      stmt.free();
    }
  }

  /**
   * Create an index on one or more document fields.
   *
   * For user-defined fields, the index is created using json_extract
   * expressions to index into the JSON _data column. Index metadata
   * is stored in the _pocket_indexes table.
   *
   * @param index - The index definition
   */
  async createIndex(index: IndexDefinition): Promise<void> {
    const normalized = this.normalizeIndex(index);
    const fields = normalized.fields.map((f) => f.field);

    // Store index metadata
    this.db.run(
      `INSERT OR REPLACE INTO _pocket_indexes (name, collection, fields, is_unique, sparse) VALUES (?, ?, ?, ?, ?)`,
      [
        normalized.name,
        this.name,
        JSON.stringify(fields),
        normalized.unique ? 1 : 0,
        normalized.sparse ? 1 : 0,
      ]
    );

    // Create the actual SQLite index using json_extract
    const indexColumns = fields
      .map((f) => {
        if (f.startsWith('_')) {
          return f;
        }
        return `json_extract(_data, '$.${f}')`;
      })
      .join(', ');

    const uniqueClause = normalized.unique ? 'UNIQUE' : '';

    this.db.run(
      `CREATE ${uniqueClause} INDEX IF NOT EXISTS "${normalized.name}" ON ${this.tableName} (${indexColumns})`
    );
  }

  /**
   * Drop an index by name.
   *
   * Removes both the SQLite index and its metadata.
   *
   * @param name - The index name to drop
   */
  async dropIndex(name: string): Promise<void> {
    this.db.run(`DROP INDEX IF EXISTS "${name}"`);
    this.db.run(
      `DELETE FROM _pocket_indexes WHERE name = ?`,
      [name]
    );
  }

  /**
   * Get all indexes defined on this store.
   *
   * @returns Array of normalized index definitions
   */
  async getIndexes(): Promise<NormalizedIndex[]> {
    const stmt = this.db.prepare(
      `SELECT * FROM _pocket_indexes WHERE collection = ?`
    );
    try {
      stmt.bind([this.name]);
      const indexes: NormalizedIndex[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as unknown as SQLiteIndex;
        const fields = JSON.parse(row.fields) as string[];
        indexes.push({
          name: row.name,
          fields: fields.map((f) => ({ field: f, direction: 'asc' as const })),
          unique: row.is_unique === 1,
          sparse: row.sparse === 1,
        });
      }
      return indexes;
    } finally {
      stmt.free();
    }
  }

  /**
   * Get an observable stream of change events.
   *
   * Emits events whenever documents are inserted, updated, or deleted.
   *
   * @returns Observable that emits change events
   */
  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  /**
   * Remove all documents from the store (hard delete).
   *
   * Emits 'delete' change events for each document.
   */
  async clear(): Promise<void> {
    // Fetch all docs to emit change events
    const docs = await this.getAll();
    this.db.run(`DELETE FROM ${this.tableName}`);

    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }

  /**
   * Destroy the store and release resources.
   *
   * Completes the change stream. After calling destroy(),
   * the store should not be used.
   */
  destroy(): void {
    this.changes$.complete();
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Get a raw serialized row by ID, including soft-deleted documents.
   */
  private getRaw(id: string): SerializedDocument | null {
    const stmt = this.db.prepare(
      `SELECT * FROM ${this.tableName} WHERE _id = ?`
    );
    try {
      stmt.bind([id]);
      if (stmt.step()) {
        return stmt.getAsObject() as unknown as SerializedDocument;
      }
      return null;
    } finally {
      stmt.free();
    }
  }

  /**
   * Serialize a document into column values for storage.
   */
  private serialize(doc: T): SerializedDocument {
    const { _id, _rev, _deleted, _updatedAt, _vclock, ...data } = doc;
    return {
      _id,
      _rev: _rev,
      _deleted: _deleted ? 1 : 0,
      _updatedAt: _updatedAt,
      _vclock: _vclock ? JSON.stringify(_vclock) : undefined,
      _data: JSON.stringify(data),
    };
  }

  /**
   * Deserialize a stored row back into a document.
   */
  private deserialize(row: SerializedDocument): T {
    const data = JSON.parse(row._data);
    return {
      _id: row._id,
      _rev: row._rev,
      _deleted: row._deleted === 1,
      _updatedAt: row._updatedAt,
      _vclock: row._vclock ? JSON.parse(row._vclock) : undefined,
      ...data,
    } as T;
  }

  /**
   * Build a SELECT query from a translated query.
   */
  private buildSelectQuery(translation: {
    whereClause: string;
    orderByClause: string;
    params: unknown[];
    limit?: number;
    offset?: number;
  }): { sql: string; params: unknown[] } {
    const allParams = [...translation.params];
    let sql = `SELECT * FROM ${this.tableName}`;

    // Always exclude soft-deleted documents
    const whereParts: string[] = ['_deleted = 0'];
    if (translation.whereClause) {
      whereParts.push(translation.whereClause);
    }
    sql += ` WHERE ${whereParts.join(' AND ')}`;

    if (translation.orderByClause) {
      sql += ` ORDER BY ${translation.orderByClause}`;
    }

    if (translation.limit !== undefined) {
      sql += ` LIMIT ${translation.limit}`;
    }

    if (translation.offset !== undefined) {
      if (translation.limit === undefined) {
        sql += ' LIMIT -1';
      }
      sql += ` OFFSET ${translation.offset}`;
    }

    return { sql, params: allParams };
  }

  /**
   * Build a COUNT query from a translated query.
   */
  private buildCountQuery(translation: {
    whereClause: string;
    params: unknown[];
  }): { sql: string; params: unknown[] } {
    const allParams = [...translation.params];
    let sql = `SELECT COUNT(*) as count FROM ${this.tableName}`;

    const whereParts: string[] = ['_deleted = 0'];
    if (translation.whereClause) {
      whereParts.push(translation.whereClause);
    }
    sql += ` WHERE ${whereParts.join(' AND ')}`;

    return { sql, params: allParams };
  }

  /**
   * Normalize an index definition to its canonical form.
   */
  private normalizeIndex(index: IndexDefinition): NormalizedIndex {
    const fields: IndexField[] = index.fields.map((f) =>
      typeof f === 'string'
        ? { field: f, direction: 'asc' }
        : { field: f.field, direction: f.direction ?? 'asc' }
    );

    const name =
      index.name ?? `idx_${this.name}_${fields.map((f) => f.field).join('_')}`;

    return {
      name,
      fields,
      unique: index.unique ?? false,
      sparse: index.sparse ?? false,
    };
  }

  /**
   * Emit a change event to all subscribers.
   */
  private emitChange(
    operation: ChangeEvent<T>['operation'],
    documentId: string,
    document: T | null,
    previousDocument?: T
  ): void {
    this.changes$.next({
      operation,
      documentId,
      document: document ? structuredClone(document) : null,
      previousDocument: previousDocument
        ? structuredClone(previousDocument)
        : undefined,
      isFromSync: false,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
    });
  }
}
