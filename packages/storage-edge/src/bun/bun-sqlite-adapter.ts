/**
 * Bun SQLite Storage Adapter
 *
 * Implements the StorageAdapter interface for Bun's built-in SQLite.
 *
 * @module @pocket/storage-edge/bun
 */

import type {
  Document,
  DocumentStore,
  StorageAdapter,
  StorageConfig,
  StorageStats,
} from '@pocket/core';
import type { BunSQLiteConfig, BunSQLiteDatabase } from '../types.js';
import { BunSQLiteStore } from './bun-sqlite-store.js';

/**
 * Storage adapter backed by Bun's built-in SQLite (bun:sqlite).
 *
 * Bun includes a high-performance SQLite implementation accessible
 * via `bun:sqlite`. This adapter leverages native SQL for queries,
 * making it significantly faster than KV-based stores for complex
 * query patterns.
 *
 * @example
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createBunSQLiteStorage } from '@pocket/storage-edge/bun';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createBunSQLiteStorage({ filename: './data.db' }),
 * });
 *
 * const users = db.collection('users');
 * await users.insert({ name: 'Alice' });
 * ```
 */
class BunSQLiteAdapter implements StorageAdapter {
  readonly name = 'bun-sqlite';

  private db: BunSQLiteDatabase;
  private stores = new Map<string, BunSQLiteStore<Document>>();
  private tablePrefix: string;
  private config: BunSQLiteConfig;

  constructor(config: BunSQLiteConfig, db: BunSQLiteDatabase) {
    this.db = db;
    this.tablePrefix = config.prefix ?? 'pocket_';
    this.config = config;
  }

  isAvailable(): boolean {
    return this.db !== null && this.db !== undefined;
  }

  async initialize(_config: StorageConfig): Promise<void> {
    // Enable WAL mode for better concurrent performance
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
  }

  async close(): Promise<void> {
    for (const store of this.stores.values()) {
      store.destroy();
    }
    this.stores.clear();
    this.db.close();
  }

  getStore<T extends Document>(name: string): DocumentStore<T> {
    if (!this.stores.has(name)) {
      this.stores.set(
        name,
        new BunSQLiteStore<Document>(
          this.db,
          name,
          this.tablePrefix,
          this.config.serializer
        )
      );
    }
    return this.stores.get(name) as unknown as DocumentStore<T>;
  }

  hasStore(name: string): boolean {
    return this.stores.has(name);
  }

  async listStores(): Promise<string[]> {
    const rows = this.db
      .query(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE ?`
      )
      .all(`${this.tablePrefix}%`) as { name: string }[];

    return rows.map((row) => row.name.substring(this.tablePrefix.length));
  }

  async deleteStore(name: string): Promise<void> {
    const tableName = `${this.tablePrefix}${name}`;
    this.db.exec(`DROP TABLE IF EXISTS "${tableName}"`);
    const store = this.stores.get(name);
    if (store) {
      store.destroy();
      this.stores.delete(name);
    }
  }

  async transaction<R>(
    _storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R> {
    // Bun SQLite supports synchronous transactions. We wrap the async
    // function to execute within a SQLite transaction context.
    // Note: since the fn is async, we cannot use Bun's synchronous
    // transaction API directly. We use BEGIN/COMMIT/ROLLBACK instead.
    this.db.exec('BEGIN TRANSACTION');
    try {
      const result = await fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async getStats(): Promise<StorageStats> {
    const storeNames = await this.listStores();
    let documentCount = 0;
    let indexCount = 0;

    for (const storeName of storeNames) {
      const store = this.getStore(storeName);
      documentCount += await store.count();
      const indexes = await store.getIndexes();
      indexCount += indexes.length;
    }

    // Get database file size (approximate)
    const pageSizeRow = this.db
      .query('PRAGMA page_size')
      .get() as { page_size: number } | null;
    const pageCountRow = this.db
      .query('PRAGMA page_count')
      .get() as { page_count: number } | null;

    const pageSize = pageSizeRow?.page_size ?? 4096;
    const pageCount = pageCountRow?.page_count ?? 0;

    return {
      documentCount,
      storeCount: storeNames.length,
      storageSize: pageSize * pageCount,
      indexCount,
    };
  }
}

/**
 * Create a Bun SQLite storage adapter.
 *
 * @param config - Configuration with filename or pre-configured database
 * @returns A StorageAdapter backed by Bun's built-in SQLite
 *
 * @example
 * ```typescript
 * // In-memory database (default)
 * const storage = createBunSQLiteStorage();
 *
 * // File-based database
 * const storage = createBunSQLiteStorage({ filename: './data.db' });
 *
 * // With a pre-configured database instance
 * import { Database } from 'bun:sqlite';
 * const sqliteDb = new Database('./data.db');
 * const storage = createBunSQLiteStorage({ database: sqliteDb });
 * ```
 */
export function createBunSQLiteStorage(config?: BunSQLiteConfig): StorageAdapter {
  const resolvedConfig = config ?? {};

  if (resolvedConfig.database) {
    return new BunSQLiteAdapter(resolvedConfig, resolvedConfig.database);
  }

  // Dynamically create a Bun SQLite database
  // This will only work in the Bun runtime
  const filename = resolvedConfig.filename ?? ':memory:';

   
  let BunDatabase: new (filename: string) => BunSQLiteDatabase;
  try {
    // Dynamic import of bun:sqlite - only available in Bun runtime
     
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bunSqlite = require('bun:sqlite');
    BunDatabase = bunSqlite.Database;
  } catch {
    throw new Error(
      'createBunSQLiteStorage: bun:sqlite is not available. ' +
      'This adapter requires the Bun runtime, or pass a pre-configured ' +
      'database instance via config.database.'
    );
  }

  const db = new BunDatabase(filename);
  return new BunSQLiteAdapter(resolvedConfig, db);
}
