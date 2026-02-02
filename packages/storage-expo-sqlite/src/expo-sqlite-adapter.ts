/**
 * Expo SQLite Storage Adapter
 *
 * Implements the Pocket StorageAdapter interface using expo-sqlite's native
 * async API. Provides full SQLite storage with WAL mode, foreign key support,
 * transactions, and comprehensive query translation.
 *
 * @module @pocket/storage-expo-sqlite
 */

import type {
  Document,
  DocumentStore,
  StorageAdapter,
  StorageConfig,
  StorageStats,
} from '@pocket/core';
import { ExpoSQLiteDocumentStore } from './expo-sqlite-store.js';
import type { ExpoSQLiteConfig, ExpoSQLiteDatabase } from './types.js';

/**
 * Storage adapter that uses expo-sqlite for native SQLite persistence on
 * React Native / Expo apps.
 *
 * Features:
 * - WAL journal mode for concurrent reads
 * - Foreign key constraint support
 * - Full SQL query translation (json_extract based)
 * - Transaction support via withTransactionAsync
 * - Automatic table creation per collection
 *
 * @example
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createExpoSQLiteStorage } from '@pocket/storage-expo-sqlite';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createExpoSQLiteStorage({ enableWAL: true }),
 * });
 * ```
 */
export class ExpoSQLiteAdapter implements StorageAdapter {
  readonly name = 'expo-sqlite';

  private db: ExpoSQLiteDatabase | null = null;
  private stores = new Map<string, DocumentStore<Document>>();
  private adapterConfig: ExpoSQLiteConfig;
  private initialized = false;

  constructor(config: ExpoSQLiteConfig = { name: 'pocket' }) {
    this.adapterConfig = config;
  }

  /**
   * Check if expo-sqlite is available in the current environment.
   *
   * This performs a runtime require check, which works in React Native
   * but will return false in Node.js or browser environments.
   */
  isAvailable(): boolean {
    if (this.adapterConfig.openDatabase) {
      return true;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime availability check for React Native
      require('expo-sqlite');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize the storage adapter.
   *
   * Opens (or creates) the SQLite database using expo-sqlite's openDatabaseAsync.
   * Configures WAL mode and foreign keys according to the adapter config.
   *
   * @param config - Base storage configuration (name, version, options)
   */
  async initialize(config: StorageConfig): Promise<void> {
    if (this.initialized) return;

    const dbName = this.adapterConfig.databaseName ?? config.name ?? 'pocket.db';

    if (this.adapterConfig.openDatabase) {
      // Use the injected factory
      this.db = await this.adapterConfig.openDatabase(dbName);
    } else {
      // Dynamically import expo-sqlite
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic import for React Native
      const SQLite = require('expo-sqlite') as {
        openDatabaseAsync: (name: string) => Promise<ExpoSQLiteDatabase>;
      };
      this.db = await SQLite.openDatabaseAsync(dbName);
    }

    // Enable WAL mode for better concurrent performance (default: true)
    if (this.adapterConfig.enableWAL !== false) {
      await this.db.execAsync('PRAGMA journal_mode = WAL;');
    }

    // Enable foreign key constraints (default: true)
    if (this.adapterConfig.enableForeignKeys !== false) {
      await this.db.execAsync('PRAGMA foreign_keys = ON;');
    }

    this.initialized = true;
  }

  /**
   * Close the database connection and release all resources.
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
    }
    this.stores.clear();
    this.initialized = false;
  }

  /**
   * Get or create a document store for the given collection name.
   *
   * If the store does not exist, a new ExpoSQLiteDocumentStore is created
   * which will automatically initialize its backing table.
   *
   * @typeParam T - The document type for the store
   * @param name - Collection name
   * @returns DocumentStore instance for the collection
   * @throws Error if the database has not been initialized
   */
  getStore<T extends Document>(name: string): DocumentStore<T> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    if (!this.stores.has(name)) {
      this.stores.set(name, new ExpoSQLiteDocumentStore<Document>(this.db, name));
    }

    return this.stores.get(name) as unknown as DocumentStore<T>;
  }

  /**
   * Check if a store with the given name exists in the in-memory store map.
   */
  hasStore(name: string): boolean {
    return this.stores.has(name);
  }

  /**
   * List all table names in the database that are not SQLite internal tables
   * or Pocket metadata tables.
   */
  async listStores(): Promise<string[]> {
    if (!this.db) return [];

    const rows = await this.db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_pocket_indexes'`,
    );

    return rows.map((row) => row.name);
  }

  /**
   * Drop a store's backing table and remove it from the in-memory map.
   */
  async deleteStore(name: string): Promise<void> {
    if (!this.db) return;

    // Sanitize the name the same way the store does
    const tableName = name.replace(/[^a-zA-Z0-9_]/g, '_');

    await this.db.execAsync(`DROP TABLE IF EXISTS "${tableName}"`);

    // Clean up index metadata for this collection
    await this.db.runAsync(
      `DELETE FROM "_pocket_indexes" WHERE collection = ?`,
      [tableName],
    );

    this.stores.delete(name);
  }

  /**
   * Execute a function within a SQLite transaction.
   *
   * Uses expo-sqlite's withTransactionAsync for proper transaction
   * boundaries including automatic commit/rollback.
   *
   * @typeParam R - Return type of the transaction function
   * @param _storeNames - Store names involved (used for documentation; SQLite locks at DB level)
   * @param _mode - Transaction mode (readonly or readwrite)
   * @param fn - The function to execute within the transaction
   * @returns The result of the transaction function
   */
  async transaction<R>(
    _storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>,
  ): Promise<R> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    let result: R;

    await this.db.withTransactionAsync(async () => {
      result = await fn();
    });

    // The variable is guaranteed to be assigned if withTransactionAsync completes
    return result!;
  }

  /**
   * Get storage statistics including document count, store count,
   * storage size, and index count.
   */
  async getStats(): Promise<StorageStats> {
    if (!this.db) {
      return {
        documentCount: 0,
        storeCount: 0,
        storageSize: 0,
        indexCount: 0,
      };
    }

    const storeNames = await this.listStores();
    let documentCount = 0;
    let indexCount = 0;

    for (const storeName of storeNames) {
      // Count non-deleted documents
      const countRow = await this.db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM "${storeName}" WHERE _deleted = 0`,
      );
      documentCount += countRow?.count ?? 0;
    }

    // Count indexes from metadata table
    try {
      const indexRow = await this.db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM "_pocket_indexes"`,
      );
      indexCount = indexRow?.count ?? 0;
    } catch {
      // Index metadata table might not exist yet
      indexCount = 0;
    }

    // Estimate storage size via SQLite page count
    let storageSize = 0;
    try {
      const pageCountRow = await this.db.getFirstAsync<{ page_count: number }>(
        `PRAGMA page_count`,
      );
      const pageSizeRow = await this.db.getFirstAsync<{ page_size: number }>(
        `PRAGMA page_size`,
      );
      if (pageCountRow && pageSizeRow) {
        storageSize = pageCountRow.page_count * pageSizeRow.page_size;
      }
    } catch {
      // PRAGMA queries might fail in some environments
      storageSize = 0;
    }

    return {
      documentCount,
      storeCount: storeNames.length,
      storageSize,
      indexCount,
    };
  }
}

/**
 * Create an Expo SQLite storage adapter.
 *
 * @param config - Optional configuration for the adapter
 * @returns A StorageAdapter backed by expo-sqlite
 *
 * @example
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createExpoSQLiteStorage } from '@pocket/storage-expo-sqlite';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createExpoSQLiteStorage({
 *     databaseName: 'my-app.db',
 *     enableWAL: true,
 *     enableForeignKeys: true,
 *   }),
 * });
 * ```
 */
export function createExpoSQLiteStorage(config?: ExpoSQLiteConfig): StorageAdapter {
  return new ExpoSQLiteAdapter(config);
}
