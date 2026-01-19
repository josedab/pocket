import type { Observable } from 'rxjs';
import type { ChangeEvent, Document } from './document.js';
import type { QuerySpec } from './query.js';

/**
 * Index field specification
 */
export interface IndexField {
  /** Field name */
  field: string;
  /** Sort direction for this field */
  direction?: 'asc' | 'desc';
}

/**
 * Index definition
 */
export interface IndexDefinition {
  /** Index name (auto-generated if not provided) */
  name?: string;
  /** Fields to index */
  fields: (string | IndexField)[];
  /** Whether index values must be unique */
  unique?: boolean;
  /** Sparse index (skip documents without indexed fields) */
  sparse?: boolean;
}

/**
 * Normalized index definition (after processing)
 */
export interface NormalizedIndex {
  name: string;
  fields: IndexField[];
  unique: boolean;
  sparse: boolean;
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Database name */
  name: string;
  /** Database version for migrations */
  version?: number;
  /** Storage-specific options */
  options?: Record<string, unknown>;
}

/**
 * Storage query passed to adapter
 */
export interface StorageQuery<T extends Document = Document> {
  /** Query specification */
  spec: QuerySpec<T>;
  /** Hint for index to use */
  indexHint?: string;
}

/**
 * Transaction isolation levels
 */
export type IsolationLevel =
  | 'read-uncommitted'
  | 'read-committed'
  | 'repeatable-read'
  | 'serializable';

/**
 * Transaction options
 */
export interface TransactionOptions {
  /** Transaction mode */
  mode: 'readonly' | 'readwrite';
  /** Isolation level (if supported) */
  isolation?: IsolationLevel;
  /** Timeout in ms */
  timeout?: number;
}

/**
 * Document store interface for a single collection
 */
export interface DocumentStore<T extends Document> {
  /** Store/collection name */
  readonly name: string;

  /**
   * Get a document by ID
   */
  get(id: string): Promise<T | null>;

  /**
   * Get multiple documents by IDs
   */
  getMany(ids: string[]): Promise<(T | null)[]>;

  /**
   * Get all documents in the store
   */
  getAll(): Promise<T[]>;

  /**
   * Insert or update a document
   */
  put(doc: T): Promise<T>;

  /**
   * Insert or update multiple documents
   */
  bulkPut(docs: T[]): Promise<T[]>;

  /**
   * Delete a document by ID
   */
  delete(id: string): Promise<void>;

  /**
   * Delete multiple documents
   */
  bulkDelete(ids: string[]): Promise<void>;

  /**
   * Execute a query
   */
  query(query: StorageQuery<T>): Promise<T[]>;

  /**
   * Count documents matching query
   */
  count(query?: StorageQuery<T>): Promise<number>;

  /**
   * Create an index
   */
  createIndex(index: IndexDefinition): Promise<void>;

  /**
   * Drop an index
   */
  dropIndex(name: string): Promise<void>;

  /**
   * Get all index definitions
   */
  getIndexes(): Promise<NormalizedIndex[]>;

  /**
   * Observable stream of changes
   */
  changes(): Observable<ChangeEvent<T>>;

  /**
   * Clear all documents
   */
  clear(): Promise<void>;
}

/**
 * Storage adapter interface (pluggable backend)
 */
export interface StorageAdapter {
  /** Adapter name for identification */
  readonly name: string;

  /**
   * Initialize the storage adapter
   */
  initialize(config: StorageConfig): Promise<void>;

  /**
   * Close the storage adapter and release resources
   */
  close(): Promise<void>;

  /**
   * Check if this storage type is available in the current environment
   */
  isAvailable(): boolean;

  /**
   * Get or create a document store for a collection
   */
  getStore<T extends Document>(name: string): DocumentStore<T>;

  /**
   * Check if a store exists
   */
  hasStore(name: string): boolean;

  /**
   * List all store names
   */
  listStores(): Promise<string[]>;

  /**
   * Delete a store
   */
  deleteStore(name: string): Promise<void>;

  /**
   * Execute a function within a transaction
   */
  transaction<R>(
    storeNames: string[],
    mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R>;

  /**
   * Get storage statistics
   */
  getStats(): Promise<StorageStats>;
}

/**
 * Storage statistics
 */
export interface StorageStats {
  /** Total number of documents */
  documentCount: number;
  /** Estimated storage size in bytes */
  storageSize: number;
  /** Number of stores/collections */
  storeCount: number;
  /** Index count */
  indexCount: number;
}

/**
 * Storage adapter factory function type
 */
export type StorageAdapterFactory = (options?: Record<string, unknown>) => StorageAdapter;
