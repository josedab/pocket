/**
 * SQLite storage adapter for Pocket.
 *
 * This module provides SQL-based storage using SQLite, which can run in
 * various environments via different driver backends:
 *
 * - **sql.js**: Pure JavaScript SQLite (browser/Node.js)
 * - **better-sqlite3**: Native Node.js SQLite bindings
 * - **wa-sqlite**: WebAssembly SQLite for browsers
 *
 * ## Features
 *
 * - **SQL Queries**: Full SQL power for complex queries
 * - **ACID Transactions**: Atomic, consistent, isolated, durable operations
 * - **JSON Support**: Documents stored as JSON with json_extract indexes
 * - **Portable**: Same code works in browser and Node.js
 * - **Exportable**: Database can be exported as a binary blob
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    SQLiteStorageAdapter                         │
 * │                                                                  │
 * │  ┌──────────────────────────────────────────────────────────┐  │
 * │  │                    SQLiteDriver                           │  │
 * │  │  (Abstraction over different SQLite implementations)     │  │
 * │  └──────────────────────────┬───────────────────────────────┘  │
 * │                             │                                   │
 * │  ┌──────────────────────────┼───────────────────────────────┐  │
 * │  │                          ▼                                │  │
 * │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │  │
 * │  │  │   sql.js    │  │better-sqlite│  │  wa-sqlite  │       │  │
 * │  │  │  (WASM)     │  │  (Native)   │  │  (WASM)     │       │  │
 * │  │  └─────────────┘  └─────────────┘  └─────────────┘       │  │
 * │  └──────────────────────────────────────────────────────────┘  │
 * │                                                                  │
 * │  ┌──────────────────────────────────────────────────────────┐  │
 * │  │              SQLiteDocumentStore (per collection)         │  │
 * │  │  - Table: pocket_{collection}                            │  │
 * │  │  - Columns: _id, _rev, _deleted, _updatedAt, _data       │  │
 * │  │  - JSON indexes via json_extract()                       │  │
 * │  └──────────────────────────────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Table Schema
 *
 * Each collection is stored as a table with this schema:
 *
 * | Column | Type | Description |
 * |--------|------|-------------|
 * | _id | TEXT PRIMARY KEY | Document ID |
 * | _rev | TEXT | Revision for conflict detection |
 * | _deleted | INTEGER | Soft delete flag (0/1) |
 * | _updatedAt | INTEGER | Unix timestamp |
 * | _vclock | TEXT | Vector clock JSON (for sync) |
 * | _data | TEXT | Document fields as JSON |
 *
 * @module storage-sqlite
 *
 * @example Basic usage
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createSQLiteStorage } from '@pocket/storage-sqlite';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createSQLiteStorage()
 * });
 * ```
 *
 * @example With sql.js (browser)
 * ```typescript
 * import initSqlJs from 'sql.js';
 *
 * const SQL = await initSqlJs();
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createSQLiteStorage({
 *     driver: 'sqljs',
 *     sqlJsFactory: () => new SQL.Database()
 *   })
 * });
 * ```
 *
 * @example Exporting database
 * ```typescript
 * const adapter = db.storage as SQLiteStorageAdapter;
 * const data = adapter.export();
 * if (data) {
 *   // Save data to file or send to server
 *   const blob = new Blob([data], { type: 'application/x-sqlite3' });
 * }
 * ```
 *
 * @see {@link SQLiteStorageAdapter} for the adapter class
 * @see {@link createSQLiteStorage} for the factory function
 */

import type {
  ChangeEvent,
  Document,
  DocumentStore,
  IndexDefinition,
  NormalizedIndex,
  StorageAdapter,
  StorageConfig,
  StorageQuery,
  StorageStats,
} from '@pocket/core';
import { Subject, type Observable } from 'rxjs';
import { createDriver } from './driver.js';
import type {
  IndexMetadata,
  SerializedDocument,
  SQLiteAdapterConfig,
  SQLiteDriver,
} from './types.js';

/**
 * SQLite storage adapter implementing the Pocket StorageAdapter interface.
 *
 * This adapter stores documents in SQLite tables with full SQL query support.
 * Documents are serialized to JSON and stored in a `_data` column, with
 * metadata fields (`_id`, `_rev`, etc.) stored as separate columns for indexing.
 *
 * ## Key Features
 *
 * - **Full SQL Support**: Use json_extract for querying JSON fields
 * - **ACID Transactions**: Wrap operations in transactions
 * - **Index Support**: Create indexes on JSON fields
 * - **Export/Import**: Serialize entire database to Uint8Array
 *
 * @example Basic operations
 * ```typescript
 * const adapter = new SQLiteStorageAdapter();
 * await adapter.initialize({ name: 'my-app' });
 *
 * const todos = adapter.getStore<Todo>('todos');
 * await todos.put({ _id: '1', title: 'Learn SQLite' });
 *
 * const stats = await adapter.getStats();
 * console.log(`Size: ${stats.storageSize} bytes`);
 * ```
 *
 * @example Creating indexes
 * ```typescript
 * const todos = adapter.getStore<Todo>('todos');
 *
 * // Create index on JSON field
 * await todos.createIndex({
 *   name: 'idx_todos_completed',
 *   fields: ['completed']
 * });
 *
 * // Queries on 'completed' field will use the index
 * const incomplete = await todos.query({
 *   filter: { completed: false }
 * });
 * ```
 *
 * @see {@link createSQLiteStorage} for the factory function
 * @see {@link SQLiteAdapterConfig} for configuration options
 */
export class SQLiteStorageAdapter implements StorageAdapter {
  readonly name = 'sqlite';

  private driver: SQLiteDriver | null = null;
  private config: SQLiteAdapterConfig;
  private stores = new Map<string, SQLiteDocumentStore<Document>>();
  private dbVersion = 1;

  constructor(config: SQLiteAdapterConfig = {}) {
    this.config = config;
  }

  async initialize(config: StorageConfig): Promise<void> {
    this.dbVersion = config.version ?? 1;

    this.driver = await createDriver(this.config);

    // Create metadata table
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS _pocket_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // Create index metadata table
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS _pocket_indexes (
        name TEXT PRIMARY KEY,
        collection TEXT NOT NULL,
        fields TEXT NOT NULL,
        is_unique INTEGER NOT NULL DEFAULT 0,
        sparse INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Store version
    this.driver
      .prepare('INSERT OR REPLACE INTO _pocket_meta (key, value) VALUES (?, ?)')
      .run('version', String(this.dbVersion));
  }

  async close(): Promise<void> {
    if (this.driver) {
      this.driver.close();
      this.driver = null;
    }
    this.stores.clear();
  }

  isAvailable(): boolean {
    return true;
  }

  getStore<T extends Document>(name: string): DocumentStore<T> {
    if (!this.driver) {
      throw new Error('Storage not initialized');
    }

    if (!this.stores.has(name)) {
      this.ensureCollectionTable(name);
      const store = new SQLiteDocumentStore<T>(this.driver, name);
      this.stores.set(name, store as unknown as SQLiteDocumentStore<Document>);
    }

    return this.stores.get(name) as unknown as DocumentStore<T>;
  }

  hasStore(name: string): boolean {
    if (!this.driver) return false;

    const result = this.driver
      .prepare<{
        count: number;
      }>("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?")
      .get(`pocket_${name}`);

    return (result?.count ?? 0) > 0;
  }

  async listStores(): Promise<string[]> {
    if (!this.driver) return [];

    const tables = this.driver
      .prepare<{
        name: string;
      }>("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pocket_%'")
      .all();

    return tables.map((t) => t.name.replace('pocket_', '')).filter((name) => !name.startsWith('_'));
  }

  async deleteStore(name: string): Promise<void> {
    if (!this.driver) return;

    this.driver.exec(`DROP TABLE IF EXISTS pocket_${name}`);
    this.stores.delete(name);

    // Remove index metadata
    this.driver.prepare('DELETE FROM _pocket_indexes WHERE collection = ?').run(name);
  }

  async transaction<R>(
    _storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R> {
    if (!this.driver) {
      throw new Error('Storage not initialized');
    }

    // SQLite handles transactions automatically
    // For explicit transaction control:
    this.driver.exec('BEGIN TRANSACTION');
    try {
      const result = await fn();
      this.driver.exec('COMMIT');
      return result;
    } catch (error) {
      this.driver.exec('ROLLBACK');
      throw error;
    }
  }

  async getStats(): Promise<StorageStats> {
    if (!this.driver) {
      return { documentCount: 0, storageSize: 0, storeCount: 0, indexCount: 0 };
    }

    const stores = await this.listStores();
    let documentCount = 0;
    let indexCount = 0;

    for (const storeName of stores) {
      const count = this.driver
        .prepare<{ count: number }>(`SELECT COUNT(*) as count FROM pocket_${storeName}`)
        .get();
      documentCount += count?.count ?? 0;

      const indexes = this.driver
        .prepare<IndexMetadata>('SELECT * FROM _pocket_indexes WHERE collection = ?')
        .all(storeName);
      indexCount += indexes.length;
    }

    // Get page count for size estimation
    const pageCount = this.driver.pragma('page_count') as number;
    const pageSize = this.driver.pragma('page_size') as number;
    const storageSize = (pageCount || 0) * (pageSize || 4096);

    return {
      documentCount,
      storageSize,
      storeCount: stores.length,
      indexCount,
    };
  }

  private ensureCollectionTable(name: string): void {
    if (!this.driver) return;

    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS pocket_${name} (
        _id TEXT PRIMARY KEY,
        _rev TEXT,
        _deleted INTEGER DEFAULT 0,
        _updatedAt INTEGER,
        _vclock TEXT,
        _data TEXT NOT NULL
      )
    `);

    // Create default index on _updatedAt
    this.driver.exec(`
      CREATE INDEX IF NOT EXISTS idx_${name}_updatedAt ON pocket_${name}(_updatedAt)
    `);
  }

  /**
   * Export database (for sql.js)
   */
  export(): Uint8Array | null {
    if (this.driver?.export) {
      return this.driver.export();
    }
    return null;
  }
}

/**
 * SQLite implementation of the DocumentStore interface.
 *
 * Each instance manages a single SQLite table representing a collection.
 * Documents are stored with metadata columns for efficient filtering and
 * a JSON `_data` column for arbitrary document fields.
 *
 * ## Table Structure
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
 * @typeParam T - The document type stored in this collection
 * @internal
 */
class SQLiteDocumentStore<T extends Document> implements DocumentStore<T> {
  readonly name: string;
  private readonly driver: SQLiteDriver;
  private readonly changes$ = new Subject<ChangeEvent<T>>();
  private readonly tableName: string;

  constructor(driver: SQLiteDriver, name: string) {
    this.driver = driver;
    this.name = name;
    this.tableName = `pocket_${name}`;
  }

  async get(id: string): Promise<T | null> {
    const row = this.driver
      .prepare<SerializedDocument>(`SELECT * FROM ${this.tableName} WHERE _id = ?`)
      .get(id);

    if (!row) return null;
    return this.deserialize(row);
  }

  async getMany(ids: string[]): Promise<(T | null)[]> {
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.driver
      .prepare<SerializedDocument>(`SELECT * FROM ${this.tableName} WHERE _id IN (${placeholders})`)
      .all(...ids);

    const rowMap = new Map(rows.map((r) => [r._id, r]));
    return ids.map((id) => {
      const row = rowMap.get(id);
      return row ? this.deserialize(row) : null;
    });
  }

  async getAll(): Promise<T[]> {
    const rows = this.driver.prepare<SerializedDocument>(`SELECT * FROM ${this.tableName}`).all();

    return rows.map((row) => this.deserialize(row));
  }

  async put(doc: T): Promise<T> {
    const serialized = this.serialize(doc);

    this.driver
      .prepare(
        `
      INSERT OR REPLACE INTO ${this.tableName}
      (_id, _rev, _deleted, _updatedAt, _vclock, _data)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        serialized._id,
        serialized._rev,
        serialized._deleted,
        serialized._updatedAt,
        serialized._vclock,
        serialized._data
      );

    return doc;
  }

  async bulkPut(docs: T[]): Promise<T[]> {
    const stmt = this.driver.prepare(`
      INSERT OR REPLACE INTO ${this.tableName}
      (_id, _rev, _deleted, _updatedAt, _vclock, _data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const doc of docs) {
      const serialized = this.serialize(doc);
      stmt.run(
        serialized._id,
        serialized._rev,
        serialized._deleted,
        serialized._updatedAt,
        serialized._vclock,
        serialized._data
      );
    }

    return docs;
  }

  async delete(id: string): Promise<void> {
    this.driver.prepare(`DELETE FROM ${this.tableName} WHERE _id = ?`).run(id);
  }

  async bulkDelete(ids: string[]): Promise<void> {
    const placeholders = ids.map(() => '?').join(',');
    this.driver.prepare(`DELETE FROM ${this.tableName} WHERE _id IN (${placeholders})`).run(...ids);
  }

  async query(query: StorageQuery<T>): Promise<T[]> {
    const { sql, params } = this.buildQuery(query);
    const rows = this.driver.prepare<SerializedDocument>(sql).all(...params);
    return rows.map((row) => this.deserialize(row));
  }

  async count(query?: StorageQuery<T>): Promise<number> {
    if (!query?.spec.filter) {
      const result = this.driver
        .prepare<{ count: number }>(`SELECT COUNT(*) as count FROM ${this.tableName}`)
        .get();
      return result?.count ?? 0;
    }

    const { sql, params } = this.buildCountQuery(query);
    const result = this.driver.prepare<{ count: number }>(sql).get(...params);
    return result?.count ?? 0;
  }

  async createIndex(index: IndexDefinition): Promise<void> {
    const indexName = index.name ?? `idx_${this.name}_${Date.now()}`;
    const fields = index.fields.map((f) => (typeof f === 'string' ? f : f.field));

    // Store index metadata
    this.driver
      .prepare(
        `
      INSERT OR REPLACE INTO _pocket_indexes (name, collection, fields, is_unique, sparse)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(
        indexName,
        this.name,
        JSON.stringify(fields),
        index.unique ? 1 : 0,
        index.sparse ? 1 : 0
      );

    // For SQLite, we create functional indexes using json_extract
    const indexColumns = fields.map((f) => `json_extract(_data, '$.${f}')`).join(', ');

    const uniqueClause = index.unique ? 'UNIQUE' : '';

    this.driver.exec(`
      CREATE ${uniqueClause} INDEX IF NOT EXISTS ${indexName}
      ON ${this.tableName} (${indexColumns})
    `);
  }

  async dropIndex(name: string): Promise<void> {
    this.driver.exec(`DROP INDEX IF EXISTS ${name}`);
    this.driver.prepare('DELETE FROM _pocket_indexes WHERE name = ?').run(name);
  }

  async getIndexes(): Promise<NormalizedIndex[]> {
    const rows = this.driver
      .prepare<IndexMetadata>('SELECT * FROM _pocket_indexes WHERE collection = ?')
      .all(this.name);

    return rows.map((row) => ({
      name: row.name,
      fields: JSON.parse(row.fields).map((f: string) => ({ field: f, direction: 'asc' as const })),
      unique: row.unique === 1,
      sparse: row.sparse === 1,
    }));
  }

  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  async clear(): Promise<void> {
    this.driver.exec(`DELETE FROM ${this.tableName}`);
  }

  private serialize(doc: T): SerializedDocument {
    const { _id, _rev, _deleted, _updatedAt, _vclock, ...data } = doc;

    return {
      _id,
      _rev,
      _deleted: _deleted ? 1 : 0,
      _updatedAt,
      _vclock: _vclock ? JSON.stringify(_vclock) : undefined,
      _data: JSON.stringify(data),
    };
  }

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

  private buildQuery(query: StorageQuery<T>): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    let sql = `SELECT * FROM ${this.tableName}`;
    const whereClauses: string[] = [];

    // Build WHERE clause from filter
    if (query.spec.filter) {
      for (const [key, value] of Object.entries(query.spec.filter)) {
        if (key.startsWith('_')) {
          // Internal field
          whereClauses.push(`${key} = ?`);
          params.push(value);
        } else {
          // JSON field
          whereClauses.push(`json_extract(_data, '$.${key}') = ?`);
          params.push(JSON.stringify(value));
        }
      }
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    // Add ORDER BY
    if (query.spec.sort && query.spec.sort.length > 0) {
      const sortClauses = query.spec.sort.map((sortSpec) => {
        const field = sortSpec.field;
        const direction = sortSpec.direction.toUpperCase();
        if (field.startsWith('_')) {
          return `${field} ${direction}`;
        }
        return `json_extract(_data, '$.${field}') ${direction}`;
      });
      sql += ` ORDER BY ${sortClauses.join(', ')}`;
    }

    // Add LIMIT and OFFSET
    if (query.spec.limit) {
      sql += ` LIMIT ${query.spec.limit}`;
    }
    if (query.spec.skip) {
      sql += ` OFFSET ${query.spec.skip}`;
    }

    return { sql, params };
  }

  private buildCountQuery(query: StorageQuery<T>): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    let sql = `SELECT COUNT(*) as count FROM ${this.tableName}`;
    const whereClauses: string[] = [];

    if (query.spec.filter) {
      for (const [key, value] of Object.entries(query.spec.filter)) {
        if (key.startsWith('_')) {
          whereClauses.push(`${key} = ?`);
          params.push(value);
        } else {
          whereClauses.push(`json_extract(_data, '$.${key}') = ?`);
          params.push(JSON.stringify(value));
        }
      }
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    return { sql, params };
  }
}

/**
 * Creates a SQLite storage adapter for use with Pocket databases.
 *
 * SQLite provides powerful SQL-based querying and ACID transactions.
 * The adapter supports multiple SQLite implementations for different
 * environments (browser, Node.js).
 *
 * @param config - Optional configuration for the adapter
 * @returns A new SQLiteStorageAdapter instance
 *
 * @example Basic usage
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createSQLiteStorage } from '@pocket/storage-sqlite';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createSQLiteStorage()
 * });
 * ```
 *
 * @example With custom driver configuration
 * ```typescript
 * const storage = createSQLiteStorage({
 *   driver: 'sqljs',
 *   // Other driver-specific options
 * });
 * ```
 *
 * @example Export database for backup
 * ```typescript
 * const adapter = createSQLiteStorage();
 * await adapter.initialize({ name: 'my-app' });
 *
 * // After some operations...
 * const backup = adapter.export();
 * if (backup) {
 *   // Save to file or IndexedDB
 *   localStorage.setItem('db-backup', btoa(String.fromCharCode(...backup)));
 * }
 * ```
 *
 * @see {@link SQLiteStorageAdapter} for the adapter class
 * @see {@link SQLiteAdapterConfig} for configuration options
 */
export function createSQLiteStorage(config?: SQLiteAdapterConfig): SQLiteStorageAdapter {
  return new SQLiteStorageAdapter(config);
}
