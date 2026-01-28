/**
 * Cloudflare D1 Storage Adapter
 *
 * Storage adapter for Cloudflare D1 database (edge SQLite).
 *
 * @module @pocket/storage-edge/d1
 */

import type {
  ChangeEvent,
  ChangeOperation,
  Document,
  DocumentStore,
  IndexDefinition,
  IndexField,
  NormalizedIndex,
  StorageAdapter,
  StorageConfig,
  StorageQuery,
  StorageStats,
} from '@pocket/core';
import { type Observable, Subject } from 'rxjs';

/** Helper to get field name from string or IndexField */
function getFieldName(field: string | IndexField): string {
  return typeof field === 'string' ? field : field.field;
}

/**
 * D1 Database type from Cloudflare Workers
 */
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta?: {
    duration: number;
    changes: number;
    last_row_id: number;
  };
}

interface D1ExecResult {
  count: number;
  duration: number;
}

/**
 * D1 storage configuration
 */
export interface D1StorageConfig {
  /** D1 database binding */
  database: D1Database;
  /** Table prefix for all collections */
  tablePrefix?: string;
}

/**
 * Document store implementation for D1
 */
class D1DocumentStore<T extends Document> implements DocumentStore<T> {
  readonly name: string;
  private changes$ = new Subject<ChangeEvent<T>>();
  private db: D1Database;
  private tableName: string;
  private initialized = false;
  private sequenceCounter = 0;

  constructor(db: D1Database, tableName: string) {
    this.db = db;
    this.tableName = tableName;
    this.name = tableName;
  }

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

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `);

    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS "${this.tableName}_updated"
      ON "${this.tableName}" (updated_at)
    `);

    this.initialized = true;
  }

  async get(id: string): Promise<T | null> {
    await this.ensureInitialized();

    const result = await this.db
      .prepare(`SELECT data FROM "${this.tableName}" WHERE id = ?`)
      .bind(id)
      .first<{ data: string }>();

    if (!result) return null;
    return JSON.parse(result.data) as T;
  }

  async getMany(ids: string[]): Promise<(T | null)[]> {
    return Promise.all(ids.map((id) => this.get(id)));
  }

  async getAll(): Promise<T[]> {
    await this.ensureInitialized();

    const result = await this.db
      .prepare(`SELECT data FROM "${this.tableName}"`)
      .all<{ data: string }>();

    if (!result.results) return [];
    return result.results.map((row) => JSON.parse(row.data) as T);
  }

  async put(doc: T): Promise<T> {
    await this.ensureInitialized();

    const id = doc._id;
    const existing = await this.get(id);
    const data = JSON.stringify(doc);

    await this.db
      .prepare(
        `INSERT OR REPLACE INTO "${this.tableName}" (id, data, updated_at)
         VALUES (?, ?, unixepoch())`
      )
      .bind(id, data)
      .run();

    const operation: ChangeOperation = existing ? 'update' : 'insert';
    this.emitChange(operation, id, doc, existing ?? undefined);
    return doc;
  }

  async bulkPut(docs: T[]): Promise<T[]> {
    await this.ensureInitialized();

    for (const doc of docs) {
      await this.put(doc);
    }

    return docs;
  }

  async delete(id: string): Promise<void> {
    await this.ensureInitialized();

    const existing = await this.get(id);
    if (!existing) return;

    await this.db.prepare(`DELETE FROM "${this.tableName}" WHERE id = ?`).bind(id).run();

    this.emitChange('delete', id, null, existing);
  }

  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  async query(query: StorageQuery<T>): Promise<T[]> {
    await this.ensureInitialized();

    let sql = `SELECT data FROM "${this.tableName}"`;
    const params: unknown[] = [];

    // Build WHERE clause from filter
    if (query.spec.filter) {
      const conditions: string[] = [];
      for (const [key, value] of Object.entries(query.spec.filter)) {
        conditions.push(`json_extract(data, '$.${key}') = ?`);
        params.push(value);
      }
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }
    }

    // Add ORDER BY
    if (query.spec.sort && query.spec.sort.length > 0) {
      const orderParts = query.spec.sort.map(
        (s: { field: string; direction: string }) =>
          `json_extract(data, '$.${s.field}') ${s.direction.toUpperCase()}`
      );
      sql += ` ORDER BY ${orderParts.join(', ')}`;
    }

    // Add LIMIT and OFFSET
    if (query.spec.limit) {
      sql += ` LIMIT ${query.spec.limit}`;
    }
    if (query.spec.skip) {
      sql += ` OFFSET ${query.spec.skip}`;
    }

    let stmt = this.db.prepare(sql);
    for (const param of params) {
      stmt = stmt.bind(param);
    }

    const result = await stmt.all<{ data: string }>();
    if (!result.results) return [];

    return result.results.map((row) => JSON.parse(row.data) as T);
  }

  async count(query?: StorageQuery<T>): Promise<number> {
    await this.ensureInitialized();

    if (!query?.spec.filter) {
      const result = await this.db
        .prepare(`SELECT COUNT(*) as count FROM "${this.tableName}"`)
        .first<{ count: number }>();
      return result?.count ?? 0;
    }

    const results = await this.query(query);
    return results.length;
  }

  async createIndex(index: IndexDefinition): Promise<void> {
    await this.ensureInitialized();

    const fieldNames = index.fields.map(getFieldName);
    const indexName = index.name ?? `idx_${this.tableName}_${fieldNames.join('_')}`;
    const unique = index.unique ? 'UNIQUE' : '';
    const firstField = fieldNames[0];

    await this.db.exec(`
      CREATE ${unique} INDEX IF NOT EXISTS "${indexName}"
      ON "${this.tableName}" (json_extract(data, '$.${firstField}'))
    `);
  }

  async dropIndex(name: string): Promise<void> {
    await this.db.exec(`DROP INDEX IF EXISTS "${name}"`);
  }

  async getIndexes(): Promise<NormalizedIndex[]> {
    const result = await this.db
      .prepare(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'index' AND tbl_name = ?`
      )
      .bind(this.tableName)
      .all<{ name: string; sql: string }>();

    if (!result.results) return [];

    return result.results
      .filter((row) => row.name && !row.name.startsWith('sqlite_'))
      .map((row) => ({
        name: row.name,
        fields: [],
        unique: row.sql?.includes('UNIQUE') ?? false,
        sparse: false,
      }));
  }

  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();

    // Get all documents to emit delete events
    const docs = await this.getAll();
    await this.db.exec(`DELETE FROM "${this.tableName}"`);

    // Emit delete events for all documents
    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }
}

/**
 * D1 storage adapter
 */
class D1StorageAdapter implements StorageAdapter {
  readonly name = 'd1';
  private db: D1Database;
  private stores = new Map<string, D1DocumentStore<Document>>();
  private tablePrefix: string;

  constructor(config: D1StorageConfig) {
    this.db = config.database;
    this.tablePrefix = config.tablePrefix ?? 'pocket_';
  }

  isAvailable(): boolean {
    return this.db !== null && this.db !== undefined;
  }

  async initialize(_config: StorageConfig): Promise<void> {
    // D1 doesn't require initialization
  }

  async close(): Promise<void> {
    this.stores.clear();
  }

  getStore<T extends Document>(name: string): DocumentStore<T> {
    const tableName = `${this.tablePrefix}${name}`;

    if (!this.stores.has(name)) {
      this.stores.set(name, new D1DocumentStore<Document>(this.db, tableName));
    }

    return this.stores.get(name) as unknown as DocumentStore<T>;
  }

  hasStore(name: string): boolean {
    return this.stores.has(name);
  }

  async listStores(): Promise<string[]> {
    const result = await this.db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name LIKE ?`
      )
      .bind(`${this.tablePrefix}%`)
      .all<{ name: string }>();

    if (!result.results) return [];

    return result.results.map((row) => row.name.substring(this.tablePrefix.length));
  }

  async deleteStore(name: string): Promise<void> {
    const tableName = `${this.tablePrefix}${name}`;
    await this.db.exec(`DROP TABLE IF EXISTS "${tableName}"`);
    this.stores.delete(name);
  }

  async transaction<R>(
    _storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R> {
    // D1 doesn't support explicit transactions from Workers
    // Operations are atomic at the statement level
    return fn();
  }

  async getStats(): Promise<StorageStats> {
    const stores = await this.listStores();
    let documentCount = 0;
    let indexCount = 0;

    for (const storeName of stores) {
      const store = this.getStore(storeName);
      documentCount += await store.count();
      const indexes = await store.getIndexes();
      indexCount += indexes.length;
    }

    return {
      documentCount,
      storeCount: stores.length,
      storageSize: 0, // D1 doesn't expose size information
      indexCount,
    };
  }
}

/**
 * Create a D1 storage adapter
 *
 * @example
 * ```typescript
 * // In your Cloudflare Worker
 * import { Database } from '@pocket/core';
 * import { createD1Storage } from '@pocket/storage-edge/d1';
 *
 * export default {
 *   async fetch(request, env) {
 *     const db = await Database.create({
 *       name: 'my-app',
 *       storage: createD1Storage({ database: env.DB }),
 *     });
 *
 *     const users = db.collection('users');
 *     const allUsers = await users.find().exec();
 *
 *     return new Response(JSON.stringify(allUsers));
 *   },
 * };
 * ```
 */
export function createD1Storage(config: D1StorageConfig): StorageAdapter {
  return new D1StorageAdapter(config);
}
