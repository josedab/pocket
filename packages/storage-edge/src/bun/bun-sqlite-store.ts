/**
 * Bun SQLite Document Store
 *
 * Document store implementation backed by Bun's built-in SQLite (bun:sqlite).
 * This does NOT extend BaseKVDocumentStore because SQLite provides native
 * SQL query capabilities for better performance.
 *
 * @module @pocket/storage-edge/bun
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
import type { BunSQLiteDatabase, EdgeSerializer } from '../types.js';

/**
 * Default JSON serializer.
 */
const defaultSerializer: EdgeSerializer = {
  serialize: (value: unknown): string => JSON.stringify(value),
  deserialize: <T>(data: string): T => JSON.parse(data) as T,
};

/**
 * Row shape returned by SQLite queries.
 */
interface _DocumentRow {
  id: string;
  data: string;
  _rev: string | null;
  _updatedAt: number | null;
  _deleted: number;
}

/**
 * Document store backed by Bun's built-in SQLite.
 *
 * Uses native SQL for queries, providing better performance than
 * the KV-based stores for complex queries. Each collection gets
 * its own table with columns:
 *
 * - `id` TEXT PRIMARY KEY
 * - `data` TEXT NOT NULL (JSON blob)
 * - `_rev` TEXT
 * - `_updatedAt` INTEGER
 * - `_deleted` INTEGER DEFAULT 0
 *
 * @typeParam T - The document type stored in this collection
 */
export class BunSQLiteStore<T extends Document> implements DocumentStore<T> {
  readonly name: string;

  private db: BunSQLiteDatabase;
  private tableName: string;
  private changes$ = new Subject<ChangeEvent<T>>();
  private sequenceCounter = 0;
  private initialized = false;
  private serializer: EdgeSerializer;

  /**
   * @param db - Bun SQLite database instance
   * @param collectionName - The collection/store name
   * @param tablePrefix - Table name prefix (e.g. "pocket_")
   * @param serializer - Optional custom serializer
   */
  constructor(
    db: BunSQLiteDatabase,
    collectionName: string,
    tablePrefix: string,
    serializer?: EdgeSerializer
  ) {
    this.db = db;
    this.name = collectionName;
    this.tableName = `${tablePrefix}${collectionName}`;
    this.serializer = serializer ?? defaultSerializer;
  }

  // -------------------------------------------------------------------------
  // Table initialization
  // -------------------------------------------------------------------------

  private ensureInitialized(): void {
    if (this.initialized) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        _rev TEXT,
        _updatedAt INTEGER,
        _deleted INTEGER DEFAULT 0
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS "${this.tableName}_updatedAt"
      ON "${this.tableName}" (_updatedAt)
    `);

    this.initialized = true;
  }

  // -------------------------------------------------------------------------
  // DocumentStore implementation
  // -------------------------------------------------------------------------

  async get(id: string): Promise<T | null> {
    this.ensureInitialized();

    const row = this.db
      .query(`SELECT data FROM "${this.tableName}" WHERE id = ? AND _deleted = 0`)
      .get(id) as { data: string } | null;

    if (!row) return null;
    return this.serializer.deserialize<T>(row.data);
  }

  async getMany(ids: string[]): Promise<(T | null)[]> {
    this.ensureInitialized();
    return Promise.all(ids.map((id) => this.get(id)));
  }

  async getAll(): Promise<T[]> {
    this.ensureInitialized();

    const rows = this.db
      .query(`SELECT data FROM "${this.tableName}" WHERE _deleted = 0`)
      .all() as { data: string }[];

    return rows.map((row) => this.serializer.deserialize<T>(row.data));
  }

  async put(doc: T): Promise<T> {
    this.ensureInitialized();

    const id = doc._id;
    const existing = await this.get(id);
    const data = this.serializer.serialize(doc);
    const rev = doc._rev ?? null;
    const updatedAt = doc._updatedAt ?? Date.now();

    this.db
      .query(
        `INSERT OR REPLACE INTO "${this.tableName}" (id, data, _rev, _updatedAt, _deleted)
         VALUES (?, ?, ?, ?, 0)`
      )
      .run(id, data, rev, updatedAt);

    const operation: ChangeOperation = existing ? 'update' : 'insert';
    this.emitChange(operation, id, doc, existing ?? undefined);

    return doc;
  }

  async bulkPut(docs: T[]): Promise<T[]> {
    this.ensureInitialized();

    // Use a transaction for bulk operations (Bun SQLite supports this)
    const txnFn = this.db.transaction(() => {
      const results: T[] = [];
      for (const doc of docs) {
        const id = doc._id;
        const data = this.serializer.serialize(doc);
        const rev = doc._rev ?? null;
        const updatedAt = doc._updatedAt ?? Date.now();

        this.db
          .query(
            `INSERT OR REPLACE INTO "${this.tableName}" (id, data, _rev, _updatedAt, _deleted)
             VALUES (?, ?, ?, ?, 0)`
          )
          .run(id, data, rev, updatedAt);

        results.push(doc);
      }
      return results;
    });

    const results = txnFn();

    // Emit changes after transaction completes
    for (const doc of results) {
      this.emitChange('insert', doc._id, doc);
    }

    return results;
  }

  async delete(id: string): Promise<void> {
    this.ensureInitialized();

    const existing = await this.get(id);
    if (!existing) return;

    this.db
      .query(`DELETE FROM "${this.tableName}" WHERE id = ?`)
      .run(id);

    this.emitChange('delete', id, null, existing);
  }

  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  async query(query: StorageQuery<T>): Promise<T[]> {
    this.ensureInitialized();

    let sql = `SELECT data FROM "${this.tableName}" WHERE _deleted = 0`;
    const params: unknown[] = [];

    // Build WHERE clause from simple equality filters
    if (query.spec.filter) {
      for (const [key, value] of Object.entries(query.spec.filter)) {
        if (key.startsWith('$')) continue; // Skip logical operators

        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          // Handle operator-based conditions
          const ops = value as Record<string, unknown>;
          for (const [op, opValue] of Object.entries(ops)) {
            switch (op) {
              case '$eq':
                sql += ` AND json_extract(data, '$.${key}') = ?`;
                params.push(opValue);
                break;
              case '$ne':
                sql += ` AND json_extract(data, '$.${key}') != ?`;
                params.push(opValue);
                break;
              case '$gt':
                sql += ` AND json_extract(data, '$.${key}') > ?`;
                params.push(opValue);
                break;
              case '$gte':
                sql += ` AND json_extract(data, '$.${key}') >= ?`;
                params.push(opValue);
                break;
              case '$lt':
                sql += ` AND json_extract(data, '$.${key}') < ?`;
                params.push(opValue);
                break;
              case '$lte':
                sql += ` AND json_extract(data, '$.${key}') <= ?`;
                params.push(opValue);
                break;
              case '$in':
                if (Array.isArray(opValue) && opValue.length > 0) {
                  const placeholders = opValue.map(() => '?').join(', ');
                  sql += ` AND json_extract(data, '$.${key}') IN (${placeholders})`;
                  params.push(...opValue);
                }
                break;
              case '$nin':
                if (Array.isArray(opValue) && opValue.length > 0) {
                  const placeholders = opValue.map(() => '?').join(', ');
                  sql += ` AND json_extract(data, '$.${key}') NOT IN (${placeholders})`;
                  params.push(...opValue);
                }
                break;
              default:
                break;
            }
          }
        } else {
          // Direct equality
          sql += ` AND json_extract(data, '$.${key}') = ?`;
          params.push(value);
        }
      }
    }

    // Add ORDER BY
    if (query.spec.sort && query.spec.sort.length > 0) {
      const orderParts = query.spec.sort.map(
        (s) => `json_extract(data, '$.${s.field}') ${s.direction.toUpperCase()}`
      );
      sql += ` ORDER BY ${orderParts.join(', ')}`;
    }

    // Add LIMIT and OFFSET
    if (query.spec.limit) {
      sql += ` LIMIT ?`;
      params.push(query.spec.limit);
    }
    if (query.spec.skip) {
      if (!query.spec.limit) {
        sql += ` LIMIT -1`; // SQLite requires LIMIT before OFFSET
      }
      sql += ` OFFSET ?`;
      params.push(query.spec.skip);
    }

    const rows = this.db.query(sql).all(...params) as { data: string }[];
    return rows.map((row) => this.serializer.deserialize<T>(row.data));
  }

  async count(query?: StorageQuery<T>): Promise<number> {
    this.ensureInitialized();

    if (!query?.spec.filter) {
      const result = this.db
        .query(`SELECT COUNT(*) as count FROM "${this.tableName}" WHERE _deleted = 0`)
        .get() as { count: number } | null;
      return result?.count ?? 0;
    }

    const results = await this.query(query);
    return results.length;
  }

  async createIndex(index: IndexDefinition): Promise<void> {
    this.ensureInitialized();

    const fields = index.fields.map((f) => (typeof f === 'string' ? f : f.field));
    const indexName = index.name ?? `idx_${this.tableName}_${fields.join('_')}`;
    const unique = index.unique ? 'UNIQUE' : '';

    // Create an index on json_extract for each field
    const indexExprs = fields.map((f) => `json_extract(data, '$.${f}')`);

    this.db.exec(`
      CREATE ${unique} INDEX IF NOT EXISTS "${indexName}"
      ON "${this.tableName}" (${indexExprs.join(', ')})
    `);
  }

  async dropIndex(name: string): Promise<void> {
    this.db.exec(`DROP INDEX IF EXISTS "${name}"`);
  }

  async getIndexes(): Promise<NormalizedIndex[]> {
    const rows = this.db
      .query(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'`
      )
      .all(this.tableName) as { name: string; sql: string | null }[];

    return rows.map((row) => ({
      name: row.name,
      fields: [] as IndexField[],
      unique: row.sql?.includes('UNIQUE') ?? false,
      sparse: false,
    }));
  }

  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  async clear(): Promise<void> {
    this.ensureInitialized();

    const docs = await this.getAll();
    this.db.exec(`DELETE FROM "${this.tableName}"`);

    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private emitChange(
    operation: ChangeOperation,
    documentId: string,
    document: T | null,
    previousDocument?: T
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
   * Destroy the store and release resources.
   */
  destroy(): void {
    this.changes$.complete();
  }
}
