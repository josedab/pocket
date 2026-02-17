/**
 * Expo SQLite Document Store
 *
 * Implements the Pocket DocumentStore<T> interface using expo-sqlite's async API.
 * Each collection is backed by a SQLite table with the schema:
 *
 *   id TEXT PRIMARY KEY, data TEXT, _rev TEXT, _updatedAt INTEGER, _deleted INTEGER
 *
 * The 'data' column stores the full JSON-serialized document. The top-level
 * metadata columns (_rev, _updatedAt, _deleted) are denormalized for efficient
 * querying, while user-defined fields are accessed via json_extract().
 *
 * @module @pocket/storage-expo-sqlite
 */

import type {
  ChangeEvent,
  ChangeOperation,
  Document,
  DocumentStore,
  IndexDefinition,
  IndexField,
  NormalizedIndex,
  StorageQuery,
} from '@pocket/core';
import { type Observable, Subject } from 'rxjs';
import { QueryTranslator } from './query-translator.js';
import type { ExpoSQLiteDatabase, SQLiteIndexMeta } from './types.js';

/** Helper to get field name from string or IndexField */
function getFieldName(field: string | IndexField): string {
  return typeof field === 'string' ? field : field.field;
}

/** Helper to get field direction from string or IndexField */
function getFieldDirection(field: string | IndexField): 'asc' | 'desc' {
  if (typeof field === 'string') return 'asc';
  return field.direction ?? 'asc';
}

/**
 * Document store implementation backed by expo-sqlite.
 *
 * Each instance manages a single SQLite table. Documents are serialized as JSON
 * in the 'data' column, with metadata fields (_rev, _updatedAt, _deleted)
 * denormalized as columns for efficient filtering.
 *
 * @typeParam T - The document type extending Document
 */
export class ExpoSQLiteDocumentStore<T extends Document> implements DocumentStore<T> {
  readonly name: string;
  private readonly db: ExpoSQLiteDatabase;
  private readonly tableName: string;
  private readonly changes$ = new Subject<ChangeEvent<T>>();
  private readonly queryTranslator = new QueryTranslator();
  private sequenceCounter = 0;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(db: ExpoSQLiteDatabase, storeName: string) {
    this.db = db;
    this.name = storeName;
    this.tableName = this.sanitizeTableName(storeName);
    // Eagerly start initialization
    this.initPromise = this.initializeTable();
  }

  /**
   * Ensure the backing table and index metadata table exist.
   */
  private async initializeTable(): Promise<void> {
    if (this.initialized) return;

    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id TEXT PRIMARY KEY NOT NULL,
        data TEXT NOT NULL,
        _rev TEXT,
        _updatedAt INTEGER,
        _deleted INTEGER DEFAULT 0
      );
    `);

    // Create a time-based index for efficient change tracking
    await this.db.execAsync(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_updatedAt"
        ON "${this.tableName}" (_updatedAt);
    `);

    // Create the index metadata table if it does not exist
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS "_pocket_indexes" (
        name TEXT PRIMARY KEY NOT NULL,
        collection TEXT NOT NULL,
        fields TEXT NOT NULL,
        isUnique INTEGER DEFAULT 0,
        isSparse INTEGER DEFAULT 0
      );
    `);

    this.initialized = true;
  }

  /**
   * Wait for initialization before any data operation.
   */
  private async ensureReady(): Promise<void> {
    if (!this.initialized && this.initPromise) {
      await this.initPromise;
    }
  }

  /**
   * Sanitize a store name to be safe for use as a SQL table name.
   */
  private sanitizeTableName(name: string): string {
    // Replace any non-alphanumeric/underscore characters with underscores
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Emit a change event to subscribers.
   */
  private emitChange(
    operation: ChangeOperation,
    documentId: string,
    document: T | null,
    previousDocument?: T,
  ): void {
    this.changes$.next({
      operation,
      documentId,
      document,
      previousDocument,
      isFromSync: false,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
    });
  }

  /**
   * Deserialize a database row into a document.
   */
  private deserializeRow(row: { data: string }): T {
    return JSON.parse(row.data) as T;
  }

  /**
   * Serialize a document to JSON string.
   */
  private serializeDocument(doc: T): string {
    return JSON.stringify(doc);
  }

  // ────────────────────────────── CRUD ──────────────────────────────

  async get(id: string): Promise<T | null> {
    await this.ensureReady();

    const row = await this.db.getFirstAsync<{ data: string }>(
      `SELECT data FROM "${this.tableName}" WHERE id = ? AND _deleted = 0`,
      [id],
    );

    if (!row) return null;
    return this.deserializeRow(row);
  }

  async getMany(ids: string[]): Promise<(T | null)[]> {
    await this.ensureReady();

    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(', ');
    const rows = await this.db.getAllAsync<{ id: string; data: string }>(
      `SELECT id, data FROM "${this.tableName}" WHERE id IN (${placeholders}) AND _deleted = 0`,
      ids,
    );

    // Build a map for O(1) lookup and return in the same order as ids
    const rowMap = new Map<string, string>();
    for (const row of rows) {
      rowMap.set(row.id, row.data);
    }

    return ids.map((id) => {
      const data = rowMap.get(id);
      if (!data) return null;
      return JSON.parse(data) as T;
    });
  }

  async getAll(): Promise<T[]> {
    await this.ensureReady();

    const rows = await this.db.getAllAsync<{ data: string }>(
      `SELECT data FROM "${this.tableName}" WHERE _deleted = 0`,
    );

    return rows.map((row) => this.deserializeRow(row));
  }

  async put(doc: T): Promise<T> {
    await this.ensureReady();

    const id = doc._id;
    const existing = await this.get(id);
    const data = this.serializeDocument(doc);
    const rev = doc._rev ?? null;
    const updatedAt = doc._updatedAt ?? Date.now();
    const deleted = doc._deleted ? 1 : 0;

    await this.db.runAsync(
      `INSERT OR REPLACE INTO "${this.tableName}" (id, data, _rev, _updatedAt, _deleted) VALUES (?, ?, ?, ?, ?)`,
      [id, data, rev, updatedAt, deleted],
    );

    const operation: ChangeOperation = existing ? 'update' : 'insert';
    this.emitChange(operation, id, doc, existing ?? undefined);
    return doc;
  }

  async bulkPut(docs: T[]): Promise<T[]> {
    await this.ensureReady();

    if (docs.length === 0) return [];

    // Fetch existing documents for change events
    const ids = docs.map((d) => d._id);
    const existingDocs = await this.getMany(ids);
    const existingMap = new Map<string, T>();
    for (let i = 0; i < ids.length; i++) {
      const existing = existingDocs[i];
      if (existing) {
        existingMap.set(ids[i]!, existing);
      }
    }

    // Insert all documents
    for (const doc of docs) {
      const data = this.serializeDocument(doc);
      const rev = doc._rev ?? null;
      const updatedAt = doc._updatedAt ?? Date.now();
      const deleted = doc._deleted ? 1 : 0;

      await this.db.runAsync(
        `INSERT OR REPLACE INTO "${this.tableName}" (id, data, _rev, _updatedAt, _deleted) VALUES (?, ?, ?, ?, ?)`,
        [doc._id, data, rev, updatedAt, deleted],
      );
    }

    // Emit change events
    for (const doc of docs) {
      const existing = existingMap.get(doc._id);
      const operation: ChangeOperation = existing ? 'update' : 'insert';
      this.emitChange(operation, doc._id, doc, existing);
    }

    return docs;
  }

  async delete(id: string): Promise<void> {
    await this.ensureReady();

    const existing = await this.get(id);
    if (!existing) return;

    await this.db.runAsync(
      `DELETE FROM "${this.tableName}" WHERE id = ?`,
      [id],
    );

    this.emitChange('delete', id, null, existing);
  }

  async bulkDelete(ids: string[]): Promise<void> {
    await this.ensureReady();

    if (ids.length === 0) return;

    // Fetch existing documents for change events
    const existingDocs = await this.getMany(ids);

    const placeholders = ids.map(() => '?').join(', ');
    await this.db.runAsync(
      `DELETE FROM "${this.tableName}" WHERE id IN (${placeholders})`,
      ids,
    );

    // Emit change events
    for (let i = 0; i < ids.length; i++) {
      const existing = existingDocs[i];
      if (existing) {
        this.emitChange('delete', ids[i]!, null, existing);
      }
    }
  }

  // ────────────────────────────── Query ──────────────────────────────

  async query(query: StorageQuery<T>): Promise<T[]> {
    await this.ensureReady();

    const translation = this.queryTranslator.translate(query.spec);

    let sql = `SELECT data FROM "${this.tableName}"`;

    if (translation.whereClause) {
      sql += ` WHERE ${translation.whereClause}`;
    }

    if (translation.orderByClause) {
      sql += ` ORDER BY ${translation.orderByClause}`;
    }

    if (translation.limit !== undefined) {
      sql += ` LIMIT ${translation.limit}`;
    }

    if (translation.offset !== undefined) {
      sql += ` OFFSET ${translation.offset}`;
    }

    const rows = await this.db.getAllAsync<{ data: string }>(sql, translation.params);
    return rows.map((row) => this.deserializeRow(row));
  }

  async count(query?: StorageQuery<T>): Promise<number> {
    await this.ensureReady();

    if (!query) {
      const row = await this.db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM "${this.tableName}" WHERE _deleted = 0`,
      );
      return row?.count ?? 0;
    }

    const translation = this.queryTranslator.translate(query.spec);

    let sql = `SELECT COUNT(*) as count FROM "${this.tableName}"`;

    if (translation.whereClause) {
      sql += ` WHERE ${translation.whereClause}`;
    }

    const row = await this.db.getFirstAsync<{ count: number }>(sql, translation.params);
    return row?.count ?? 0;
  }

  // ────────────────────────────── Indexes ──────────────────────────────

  async createIndex(index: IndexDefinition): Promise<void> {
    await this.ensureReady();

    const fieldNames = index.fields.map(getFieldName);
    const indexName = index.name ?? `idx_${this.tableName}_${fieldNames.join('_')}`;
    const unique = index.unique ? 'UNIQUE' : '';

    // Build index columns using json_extract for each field
    const indexColumns = index.fields.map((field) => {
      const name = getFieldName(field);
      const direction = getFieldDirection(field);
      // For internal fields, use the column directly
      if (['_id', '_rev', '_updatedAt', '_deleted'].includes(name)) {
        const colName = name === '_id' ? 'id' : name;
        return `${colName} ${direction === 'desc' ? 'DESC' : 'ASC'}`;
      }
      return `json_extract(data, '$.${name}') ${direction === 'desc' ? 'DESC' : 'ASC'}`;
    });

    await this.db.execAsync(`
      CREATE ${unique} INDEX IF NOT EXISTS "${indexName}"
        ON "${this.tableName}" (${indexColumns.join(', ')});
    `);

    // Store index metadata
    const fieldsJson = JSON.stringify(
      index.fields.map((f) => (typeof f === 'string' ? { field: f, direction: 'asc' } : f)),
    );

    await this.db.runAsync(
      `INSERT OR REPLACE INTO "_pocket_indexes" (name, collection, fields, isUnique, isSparse)
       VALUES (?, ?, ?, ?, ?)`,
      [indexName, this.tableName, fieldsJson, index.unique ? 1 : 0, index.sparse ? 1 : 0],
    );
  }

  async dropIndex(name: string): Promise<void> {
    await this.ensureReady();

    await this.db.execAsync(`DROP INDEX IF EXISTS "${name}"`);
    await this.db.runAsync(
      `DELETE FROM "_pocket_indexes" WHERE name = ?`,
      [name],
    );
  }

  async getIndexes(): Promise<NormalizedIndex[]> {
    await this.ensureReady();

    const rows = await this.db.getAllAsync<SQLiteIndexMeta>(
      `SELECT name, collection, fields, isUnique, isSparse FROM "_pocket_indexes" WHERE collection = ?`,
      [this.tableName],
    );

    return rows.map((row) => ({
      name: row.name,
      fields: JSON.parse(row.fields) as IndexField[],
      unique: row.isUnique === 1,
      sparse: row.isSparse === 1,
    }));
  }

  // ────────────────────────────── Changes ──────────────────────────────

  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  // ────────────────────────────── Clear ──────────────────────────────

  async clear(): Promise<void> {
    await this.ensureReady();

    // Get all documents to emit delete events
    const docs = await this.getAll();

    await this.db.runAsync(`DELETE FROM "${this.tableName}"`, []);

    // Emit delete events for all documents
    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }

  /** Release resources */
  destroy(): void {
    this.changes$.complete();
  }
}
