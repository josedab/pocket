import type { CollectionConfig, DatabaseConfig } from '../schema/schema.js';
import type { Document } from '../types/document.js';
import { generateId } from '../types/document.js';
import type { StorageAdapter, StorageConfig } from '../types/storage.js';
import { Collection } from './collection.js';

/**
 * Database options for initialization
 */
export interface DatabaseOptions extends DatabaseConfig {
  /** Storage adapter to use */
  storage: StorageAdapter;
  /** Unique node ID for this client (for sync) */
  nodeId?: string;
}

/**
 * Main Database class - entry point for Pocket
 */
export class Database {
  readonly name: string;
  readonly version: number;
  readonly nodeId: string;

  private readonly storage: StorageAdapter;
  private readonly collections = new Map<string, Collection<Document>>();
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
   * Create and initialize a new database
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
    this.collections.set(name, collection as unknown as Collection<Document>);
    return collection;
  }

  /**
   * Get or create a collection
   */
  collection<T extends Document>(name: string): Collection<T> {
    this.ensureOpen();

    const collection = this.collections.get(name);

    if (!collection) {
      // Create collection on-demand
      const config = this.collectionConfigs.get(name) ?? { name };
      const store = this.storage.getStore<T>(name);
      const newCollection = new Collection<T>(config as CollectionConfig<T>, store, this.nodeId);
      this.collections.set(name, newCollection as unknown as Collection<Document>);
      return newCollection;
    }

    return collection as unknown as Collection<T>;
  }

  /**
   * Check if a collection exists
   */
  hasCollection(name: string): boolean {
    return this.collections.has(name) || this.storage.hasStore(name);
  }

  /**
   * List all collection names
   */
  async listCollections(): Promise<string[]> {
    return this.storage.listStores();
  }

  /**
   * Delete a collection
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
   * Execute a function within a transaction
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
   * Get storage statistics
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
   * Close the database
   */
  async close(): Promise<void> {
    if (this.isClosed) return;

    await this.storage.close();
    this.collections.clear();
    this.isClosed = true;
  }

  /**
   * Check if database is open
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
 * Database statistics
 */
export interface DatabaseStats {
  databaseName: string;
  databaseVersion: number;
  collectionCount: number;
  documentCount: number;
  storageSize: number;
  storeCount: number;
  indexCount: number;
}

/**
 * Convenience function to create a database
 */
export async function createDatabase(options: DatabaseOptions): Promise<Database> {
  return Database.create(options);
}
