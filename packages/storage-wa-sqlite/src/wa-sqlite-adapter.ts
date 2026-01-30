import type {
  Document,
  DocumentStore,
  StorageAdapter,
  StorageConfig,
  StorageStats,
} from '@pocket/core';
import { StorageError } from '@pocket/core';
import { SQLiteDocumentStore } from './sqlite-store.js';
import type { SqlJsDatabase, SqlJsStatic, WaSQLiteConfig } from './types.js';

/**
 * WebAssembly SQLite storage adapter for Pocket.
 *
 * WaSQLiteAdapter provides SQL-based persistent storage using the sql.js
 * library, which compiles SQLite to WebAssembly for browser environments.
 * It implements the full Pocket StorageAdapter interface with real SQL
 * transactions and JSON document storage.
 *
 * ## Key Features
 *
 * - **SQL Power**: Full SQLite query engine via WebAssembly
 * - **ACID Transactions**: Real BEGIN/COMMIT/ROLLBACK semantics
 * - **JSON Documents**: Documents stored as JSON with json_extract indexes
 * - **Browser Compatible**: Runs entirely in the browser via WASM
 * - **Exportable**: Serialize the entire database to a Uint8Array
 *
 * ## Architecture
 *
 * ```
 * WaSQLiteAdapter
 *   ├── sql.js WASM Engine
 *   ├── SQLiteDocumentStore (per collection)
 *   │   └── Table: pocket_{collection}
 *   └── Metadata Tables
 *       ├── _pocket_meta (key-value config)
 *       └── _pocket_indexes (index definitions)
 * ```
 *
 * @example Basic usage
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createWaSQLiteStorage } from '@pocket/storage-wa-sqlite';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createWaSQLiteStorage(),
 * });
 *
 * const todos = db.collection<Todo>('todos');
 * await todos.insert({ title: 'Learn SQLite WASM' });
 * ```
 *
 * @example With custom sql.js initialization
 * ```typescript
 * import initSqlJs from 'sql.js';
 *
 * const storage = createWaSQLiteStorage({
 *   name: 'my-app',
 *   sqlJsFactory: () => initSqlJs({
 *     locateFile: file => `/wasm/${file}`
 *   }),
 *   journalMode: 'MEMORY',
 *   cacheSize: -4000,
 * });
 * ```
 *
 * @see {@link createWaSQLiteStorage} for the factory function
 * @see {@link WaSQLiteConfig} for configuration options
 */
export class WaSQLiteAdapter implements StorageAdapter {
  /** Unique identifier for this adapter type */
  readonly name = 'wa-sqlite';

  /** The sql.js database instance, null before initialization */
  private db: SqlJsDatabase | null = null;

  /** Cached document stores, keyed by collection name */
  private stores = new Map<string, SQLiteDocumentStore<Document>>();

  /** Adapter configuration */
  private config: WaSQLiteConfig;

  /** Database version for migrations */
  private dbVersion = 1;

  /** Whether the database is currently inside a transaction */
  private inTransaction = false;

  /**
   * Create a new WaSQLiteAdapter.
   *
   * The adapter is not usable until {@link initialize} is called.
   *
   * @param config - Optional adapter configuration
   */
  constructor(config: WaSQLiteConfig = { name: 'pocket-db' }) {
    this.config = config;
  }

  /**
   * Initialize the storage adapter.
   *
   * Loads the sql.js WASM module, creates an in-memory SQLite database,
   * applies pragmas for performance tuning, and creates the metadata tables.
   *
   * @param config - Storage configuration with database name and version
   * @throws {StorageError} If sql.js cannot be loaded
   */
  async initialize(config: StorageConfig): Promise<void> {
    this.dbVersion = config.version ?? 1;

    // Merge the initialization config with constructor config
    const mergedConfig: WaSQLiteConfig = {
      ...this.config,
      ...config,
      ...(config.options as Partial<WaSQLiteConfig> | undefined),
    };
    this.config = mergedConfig;

    // Load sql.js WASM module
    let SQL: SqlJsStatic;
    try {
      if (this.config.sqlJsFactory) {
        SQL = await this.config.sqlJsFactory();
      } else {
        // Dynamic import of sql.js
        const initSqlJs = await import('sql.js');
        const init = initSqlJs.default ?? initSqlJs;
        SQL = await (init as () => Promise<SqlJsStatic>)();
      }
    } catch (error) {
      throw new StorageError(
        'POCKET_S301',
        'Failed to load sql.js WASM module. Ensure sql.js is installed and accessible.',
        {
          adapter: 'wa-sqlite',
          operation: 'initialize',
          cause: error,
        }
      );
    }

    // Create the in-memory database
    this.db = new SQL.Database();

    // Apply pragmas for performance
    this.applyPragmas();

    // Create metadata tables
    this.db.run(`
      CREATE TABLE IF NOT EXISTS _pocket_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS _pocket_indexes (
        name TEXT PRIMARY KEY,
        collection TEXT NOT NULL,
        fields TEXT NOT NULL,
        is_unique INTEGER NOT NULL DEFAULT 0,
        sparse INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Store database version
    this.db.run(
      `INSERT OR REPLACE INTO _pocket_meta (key, value) VALUES (?, ?)`,
      ['version', String(this.dbVersion)]
    );
  }

  /**
   * Close the storage adapter and release all resources.
   *
   * Destroys all document stores, closes the SQLite database, and frees
   * the WASM memory. After calling close(), the adapter should not be used.
   */
  async close(): Promise<void> {
    for (const store of this.stores.values()) {
      store.destroy();
    }
    this.stores.clear();

    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Check if this storage adapter is available.
   *
   * The wa-sqlite adapter is available in any environment that supports
   * WebAssembly (virtually all modern browsers and Node.js 8+).
   *
   * @returns true if WebAssembly is supported
   */
  isAvailable(): boolean {
    return typeof WebAssembly !== 'undefined';
  }

  /**
   * Get or create a document store for a collection.
   *
   * Stores are created lazily on first access. The underlying SQLite
   * table is created if it does not already exist. Subsequent calls
   * with the same name return the cached store instance.
   *
   * @typeParam T - The document type for this store
   * @param name - The collection name
   * @returns The document store instance
   * @throws {StorageError} If the adapter has not been initialized
   */
  getStore<T extends Document>(name: string): DocumentStore<T> {
    if (!this.db) {
      throw new StorageError('POCKET_S303', 'Storage not initialized', {
        adapter: 'wa-sqlite',
        operation: 'getStore',
      });
    }

    if (!this.stores.has(name)) {
      this.ensureCollectionTable(name);
      const store = new SQLiteDocumentStore<T>(this.db, name);
      this.stores.set(name, store as unknown as SQLiteDocumentStore<Document>);
    }

    return this.stores.get(name) as unknown as DocumentStore<T>;
  }

  /**
   * Check if a store exists in the database.
   *
   * @param name - The store name to check
   * @returns true if the store's table exists
   */
  hasStore(name: string): boolean {
    if (!this.db) return false;

    const result = this.db.exec(
      `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='pocket_${name}'`
    );
    const count = result[0]?.values[0]?.[0] as number | undefined;
    return (count ?? 0) > 0;
  }

  /**
   * List all store (collection) names.
   *
   * @returns Array of store names
   */
  async listStores(): Promise<string[]> {
    if (!this.db) return [];

    const result = this.db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pocket_%'"
    );

    if (!result[0]) return [];

    return result[0].values
      .map((row) => (row[0] as string).replace('pocket_', ''))
      .filter((name) => !name.startsWith('_'));
  }

  /**
   * Delete a store and all its documents.
   *
   * Drops the underlying SQLite table and removes associated index metadata.
   *
   * @param name - The name of the store to delete
   */
  async deleteStore(name: string): Promise<void> {
    if (!this.db) return;

    const store = this.stores.get(name);
    if (store) {
      store.destroy();
      this.stores.delete(name);
    }

    this.db.run(`DROP TABLE IF EXISTS "pocket_${name}"`);
    this.db.run(
      `DELETE FROM _pocket_indexes WHERE collection = ?`,
      [name]
    );
  }

  /**
   * Execute a function within a SQLite transaction.
   *
   * Wraps the provided function in BEGIN/COMMIT. If the function throws,
   * the transaction is rolled back. Nested transactions are flattened
   * (the inner call runs directly without starting a new transaction).
   *
   * @typeParam R - The return type of the transaction function
   * @param _storeNames - Store names involved (for interface compatibility)
   * @param _mode - Transaction mode (for interface compatibility)
   * @param fn - The function to execute within the transaction
   * @returns The function's return value
   * @throws {StorageError} If the adapter has not been initialized
   */
  async transaction<R>(
    _storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R> {
    if (!this.db) {
      throw new StorageError('POCKET_S303', 'Storage not initialized', {
        adapter: 'wa-sqlite',
        operation: 'transaction',
      });
    }

    // Avoid nested transactions - SQLite does not support them natively
    if (this.inTransaction) {
      return fn();
    }

    this.inTransaction = true;
    this.db.run('BEGIN TRANSACTION');
    try {
      const result = await fn();
      this.db.run('COMMIT');
      return result;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  /**
   * Get storage statistics.
   *
   * Returns document count, estimated storage size, store count,
   * and index count.
   *
   * @returns Storage statistics
   */
  async getStats(): Promise<StorageStats> {
    if (!this.db) {
      return { documentCount: 0, storageSize: 0, storeCount: 0, indexCount: 0 };
    }

    const storeNames = await this.listStores();
    let documentCount = 0;
    let indexCount = 0;

    for (const storeName of storeNames) {
      const countResult = this.db.exec(
        `SELECT COUNT(*) as count FROM "pocket_${storeName}" WHERE _deleted = 0`
      );
      documentCount += (countResult[0]?.values[0]?.[0] as number) ?? 0;

      const indexResult = this.db.exec(
        `SELECT COUNT(*) as count FROM _pocket_indexes WHERE collection = '${storeName}'`
      );
      indexCount += (indexResult[0]?.values[0]?.[0] as number) ?? 0;
    }

    // Estimate storage size from page_count * page_size
    const pageCountResult = this.db.exec('PRAGMA page_count');
    const pageSizeResult = this.db.exec('PRAGMA page_size');
    const pageCount = (pageCountResult[0]?.values[0]?.[0] as number) ?? 0;
    const pageSize = (pageSizeResult[0]?.values[0]?.[0] as number) ?? 4096;
    const storageSize = pageCount * pageSize;

    return {
      documentCount,
      storageSize,
      storeCount: storeNames.length,
      indexCount,
    };
  }

  /**
   * Export the entire database as a Uint8Array.
   *
   * Useful for creating backups, transferring to another device,
   * or persisting the in-memory database to IndexedDB/OPFS.
   *
   * @returns The database as a binary blob, or null if not initialized
   */
  export(): Uint8Array | null {
    if (!this.db) return null;
    return this.db.export();
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Apply SQLite pragmas from configuration.
   */
  private applyPragmas(): void {
    if (!this.db) return;

    const journalMode = this.config.journalMode ?? 'MEMORY';
    this.db.run(`PRAGMA journal_mode = ${journalMode}`);

    if (this.config.foreignKeys) {
      this.db.run('PRAGMA foreign_keys = ON');
    }

    if (this.config.cacheSize !== undefined) {
      this.db.run(`PRAGMA cache_size = ${this.config.cacheSize}`);
    }

    if (this.config.pageSize !== undefined) {
      this.db.run(`PRAGMA page_size = ${this.config.pageSize}`);
    }
  }

  /**
   * Ensure a collection table exists in the database.
   */
  private ensureCollectionTable(name: string): void {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS "pocket_${name}" (
        _id TEXT PRIMARY KEY,
        _rev TEXT,
        _deleted INTEGER DEFAULT 0,
        _updatedAt INTEGER,
        _vclock TEXT,
        _data TEXT NOT NULL
      )
    `);

    // Create default index on _updatedAt for efficient sync queries
    this.db.run(
      `CREATE INDEX IF NOT EXISTS "idx_${name}_updatedAt" ON "pocket_${name}"(_updatedAt)`
    );

    // Create index on _deleted for efficient filtering
    this.db.run(
      `CREATE INDEX IF NOT EXISTS "idx_${name}_deleted" ON "pocket_${name}"(_deleted)`
    );
  }
}

/**
 * Create a new WebAssembly SQLite storage adapter.
 *
 * This is the recommended way to create a wa-sqlite storage adapter.
 * Each call creates a new, independent adapter instance.
 *
 * @param config - Optional adapter configuration
 * @returns A new WaSQLiteAdapter instance
 *
 * @example Basic usage
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createWaSQLiteStorage } from '@pocket/storage-wa-sqlite';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createWaSQLiteStorage(),
 * });
 * ```
 *
 * @example With custom configuration
 * ```typescript
 * import initSqlJs from 'sql.js';
 *
 * const storage = createWaSQLiteStorage({
 *   name: 'my-app',
 *   sqlJsFactory: () => initSqlJs({
 *     locateFile: file => `https://sql.js.org/dist/${file}`
 *   }),
 *   journalMode: 'MEMORY',
 *   cacheSize: -4000,
 *   pageSize: 8192,
 * });
 * ```
 *
 * @see {@link WaSQLiteAdapter} for the adapter class
 * @see {@link WaSQLiteConfig} for configuration options
 */
export function createWaSQLiteStorage(config?: WaSQLiteConfig): WaSQLiteAdapter {
  return new WaSQLiteAdapter(config);
}
