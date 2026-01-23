import type { CollectionConfig, DatabaseConfig } from '../schema/schema.js';
import type { Document } from '../types/document.js';
import { generateId } from '../types/document.js';
import type { StorageAdapter, StorageConfig } from '../types/storage.js';
import { Collection } from './collection.js';

/**
 * Configuration options for creating a new database instance.
 *
 * @example
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createIndexedDBStorage } from '@pocket/storage-indexeddb';
 *
 * const options: DatabaseOptions = {
 *   name: 'my-app',
 *   version: 1,
 *   storage: createIndexedDBStorage(),
 *   collections: [
 *     { name: 'users', sync: true },
 *     { name: 'todos', sync: true }
 *   ]
 * };
 * ```
 *
 * @see {@link Database.create} for creating a database instance
 * @see {@link StorageAdapter} for available storage backends
 */
export interface DatabaseOptions extends DatabaseConfig {
  /**
   * Storage adapter to use for persisting data.
   * Choose from IndexedDB, OPFS, Memory, or SQLite adapters.
   */
  storage: StorageAdapter;

  /**
   * Unique node ID for this client instance.
   * Used for sync conflict resolution and vector clocks.
   * Auto-generated if not provided.
   */
  nodeId?: string;
}

/**
 * Main Database class - the primary entry point for Pocket.
 *
 * The Database manages collections, coordinates storage operations,
 * and provides the foundation for sync functionality. Data is stored
 * locally first, enabling offline-capable applications.
 *
 * @example Basic usage
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createIndexedDBStorage } from '@pocket/storage-indexeddb';
 *
 * // Create database
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createIndexedDBStorage(),
 * });
 *
 * // Get a collection
 * const users = db.collection<User>('users');
 *
 * // Insert a document
 * const user = await users.insert({ name: 'Alice', email: 'alice@example.com' });
 *
 * // Query documents
 * const results = await users.find({ name: 'Alice' }).exec();
 *
 * // Close when done
 * await db.close();
 * ```
 *
 * @example With schema validation
 * ```typescript
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createIndexedDBStorage(),
 *   collections: [{
 *     name: 'users',
 *     schema: {
 *       properties: {
 *         name: { type: 'string', required: true },
 *         email: { type: 'string', pattern: '^[^@]+@[^@]+$' },
 *         age: { type: 'number', min: 0 }
 *       }
 *     }
 *   }]
 * });
 * ```
 *
 * @see {@link Collection} for document operations
 * @see {@link DatabaseOptions} for configuration options
 */
export class Database {
  readonly name: string;
  readonly version: number;
  readonly nodeId: string;

  private readonly storage: StorageAdapter;
  private readonly collections = new Map<string, Collection>();
  private readonly collectionConfigs = new Map<string, CollectionConfig>();
  private isInitialized = false;
  private isClosed = false;

  private constructor(options: DatabaseOptions) {
    this.name = options.name;
    this.version = options.version ?? 1;
    this.nodeId = options.nodeId ?? generateId();
    this.storage = options.storage;

    // Register collection configs
    if (options.collections) {
      for (const config of options.collections) {
        this.collectionConfigs.set(config.name, config);
      }
    }
  }

  /**
   * Create and initialize a new database instance.
   *
   * This is the recommended way to create a database. The method initializes
   * the storage adapter and sets up any pre-configured collections.
   *
   * @param options - Database configuration options
   * @returns A promise that resolves to the initialized database instance
   * @throws Error if the storage adapter is not available in the current environment
   *
   * @example
   * ```typescript
   * const db = await Database.create({
   *   name: 'my-app',
   *   storage: createIndexedDBStorage(),
   * });
   * ```
   *
   * @see {@link DatabaseOptions} for available configuration options
   */
  static async create(options: DatabaseOptions): Promise<Database> {
    const db = new Database(options);
    await db.initialize();
    return db;
  }

  /**
   * Initialize the database
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Check if storage is available
    if (!this.storage.isAvailable()) {
      throw new Error(
        `Storage adapter "${this.storage.name}" is not available in this environment`
      );
    }

    // Initialize storage
    const storageConfig: StorageConfig = {
      name: this.name,
      version: this.version,
    };
    await this.storage.initialize(storageConfig);

    // Initialize configured collections
    for (const [name, config] of this.collectionConfigs) {
      await this.initializeCollection(name, config);
    }

    this.isInitialized = true;
  }

  /**
   * Initialize a collection
   */
  private async initializeCollection<T extends Document>(
    name: string,
    config: CollectionConfig<T>
  ): Promise<Collection<T>> {
    const store = this.storage.getStore<T>(name);
    const collection = new Collection<T>(config, store, this.nodeId);
    await collection.initialize(config.indexes);
    this.collections.set(name, collection as unknown as Collection);
    return collection;
  }

  /**
   * Get or create a collection by name.
   *
   * Collections are created lazily on first access. If the collection was
   * pre-configured in {@link DatabaseOptions.collections}, its configuration
   * (schema, indexes, etc.) will be applied.
   *
   * @typeParam T - The document type for this collection
   * @param name - The collection name
   * @returns The collection instance
   * @throws Error if the database has been closed
   *
   * @example
   * ```typescript
   * interface User extends Document {
   *   name: string;
   *   email: string;
   * }
   *
   * // Get typed collection
   * const users = db.collection<User>('users');
   *
   * // Insert documents
   * await users.insert({ name: 'Alice', email: 'alice@example.com' });
   *
   * // Query with type safety
   * const alice = await users.findOne({ name: 'Alice' });
   * ```
   *
   * @see {@link Collection} for available operations
   */
  collection<T extends Document>(name: string): Collection<T> {
    this.ensureOpen();

    const collection = this.collections.get(name);

    if (!collection) {
      // Create collection on-demand
      const config = this.collectionConfigs.get(name) ?? { name };
      const store = this.storage.getStore<T>(name);
      const newCollection = new Collection<T>(config as CollectionConfig<T>, store, this.nodeId);
      this.collections.set(name, newCollection as unknown as Collection);
      return newCollection;
    }

    return collection as unknown as Collection<T>;
  }

  /**
   * Check if a collection exists in the database.
   *
   * @param name - The collection name to check
   * @returns `true` if the collection exists, `false` otherwise
   *
   * @example
   * ```typescript
   * if (db.hasCollection('users')) {
   *   const users = db.collection('users');
   * }
   * ```
   */
  hasCollection(name: string): boolean {
    return this.collections.has(name) || this.storage.hasStore(name);
  }

  /**
   * List all collection names in the database.
   *
   * @returns A promise resolving to an array of collection names
   *
   * @example
   * ```typescript
   * const collections = await db.listCollections();
   * console.log('Collections:', collections);
   * // ['users', 'todos', 'settings']
   * ```
   */
  async listCollections(): Promise<string[]> {
    return this.storage.listStores();
  }

  /**
   * Delete a collection and all its documents.
   *
   * This operation is permanent and cannot be undone.
   *
   * @param name - The name of the collection to delete
   * @throws Error if the database has been closed
   *
   * @example
   * ```typescript
   * await db.deleteCollection('temporary-data');
   * ```
   */
  async deleteCollection(name: string): Promise<void> {
    this.ensureOpen();

    const collection = this.collections.get(name);
    if (collection) {
      await collection.clear();
      this.collections.delete(name);
    }

    await this.storage.deleteStore(name);
    this.collectionConfigs.delete(name);
  }

  /**
   * Execute a function within a database transaction.
   *
   * Transactions ensure atomicity - either all operations succeed,
   * or none of them are applied. The available isolation level
   * depends on the storage adapter being used.
   *
   * @typeParam R - The return type of the transaction function
   * @param collectionNames - Names of collections involved in the transaction
   * @param mode - Transaction mode: 'readonly' for queries, 'readwrite' for mutations
   * @param fn - The function to execute within the transaction
   * @returns A promise resolving to the function's return value
   * @throws Error if the database has been closed
   *
   * @example
   * ```typescript
   * // Transfer balance between accounts atomically
   * await db.transaction(['accounts'], 'readwrite', async () => {
   *   const accounts = db.collection('accounts');
   *   const from = await accounts.get('account-1');
   *   const to = await accounts.get('account-2');
   *
   *   await accounts.update('account-1', { balance: from.balance - 100 });
   *   await accounts.update('account-2', { balance: to.balance + 100 });
   * });
   * ```
   */
  async transaction<R>(
    collectionNames: string[],
    mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R> {
    this.ensureOpen();
    return this.storage.transaction(collectionNames, mode, fn);
  }

  /**
   * Get statistics about the database.
   *
   * Returns information about storage usage, document counts,
   * and index counts across all collections.
   *
   * @returns A promise resolving to database statistics
   * @throws Error if the database has been closed
   *
   * @example
   * ```typescript
   * const stats = await db.getStats();
   * console.log(`Documents: ${stats.documentCount}`);
   * console.log(`Storage: ${(stats.storageSize / 1024).toFixed(2)} KB`);
   * ```
   */
  async getStats(): Promise<DatabaseStats> {
    this.ensureOpen();
    const storageStats = await this.storage.getStats();
    return {
      ...storageStats,
      databaseName: this.name,
      databaseVersion: this.version,
      collectionCount: this.collections.size,
    };
  }

  /**
   * Close the database and release resources.
   *
   * After closing, the database cannot be used and any operations
   * will throw an error. If sync is enabled, pending changes may
   * be lost - ensure sync is complete before closing.
   *
   * @example
   * ```typescript
   * // Cleanup on app shutdown
   * await db.close();
   * ```
   */
  async close(): Promise<void> {
    if (this.isClosed) return;

    await this.storage.close();
    this.collections.clear();
    this.isClosed = true;
  }

  /**
   * Check if the database is currently open and usable.
   *
   * @returns `true` if the database is initialized and not closed
   *
   * @example
   * ```typescript
   * if (db.isOpen) {
   *   await db.collection('users').insert({ name: 'Bob' });
   * }
   * ```
   */
  get isOpen(): boolean {
    return this.isInitialized && !this.isClosed;
  }

  /**
   * Ensure database is open
   */
  private ensureOpen(): void {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call Database.create() first.');
    }
    if (this.isClosed) {
      throw new Error('Database has been closed.');
    }
  }
}

/**
 * Statistics about database storage and usage.
 *
 * @see {@link Database.getStats}
 */
export interface DatabaseStats {
  /** Database name */
  databaseName: string;
  /** Database schema version */
  databaseVersion: number;
  /** Number of active collections */
  collectionCount: number;
  /** Total number of documents across all collections */
  documentCount: number;
  /** Estimated storage size in bytes */
  storageSize: number;
  /** Number of storage stores/tables */
  storeCount: number;
  /** Total number of indexes */
  indexCount: number;
}

/**
 * Convenience function to create a database.
 *
 * This is a shorthand for {@link Database.create}.
 *
 * @param options - Database configuration options
 * @returns A promise that resolves to the initialized database instance
 *
 * @example
 * ```typescript
 * import { createDatabase } from '@pocket/core';
 * import { createMemoryStorage } from '@pocket/storage-memory';
 *
 * const db = await createDatabase({
 *   name: 'test-db',
 *   storage: createMemoryStorage(),
 * });
 * ```
 *
 * @see {@link Database.create}
 */
export async function createDatabase(options: DatabaseOptions): Promise<Database> {
  return Database.create(options);
}
