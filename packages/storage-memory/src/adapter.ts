import {
  QueryExecutor,
  matchesFilter,
  type ChangeEvent,
  type Document,
  type DocumentStore,
  type IndexDefinition,
  type IndexField,
  type NormalizedIndex,
  type StorageAdapter,
  type StorageConfig,
  type StorageQuery,
  type StorageStats,
} from '@pocket/core';
import { Subject, type Observable } from 'rxjs';

/**
 * In-memory document store implementation.
 *
 * Provides a complete implementation of the {@link DocumentStore} interface
 * using in-memory data structures. Documents are stored in a Map for O(1)
 * lookups, and indexes are maintained automatically on mutations.
 *
 * This store is ideal for:
 * - Unit and integration testing
 * - Development and prototyping
 * - Temporary data that doesn't need persistence
 * - Server-side rendering where browser APIs aren't available
 *
 * @typeParam T - The document type stored in this collection
 *
 * @example
 * ```typescript
 * // Typically accessed through MemoryStorageAdapter
 * const adapter = createMemoryStorage();
 * const store = adapter.getStore<User>('users');
 *
 * await store.put({ _id: '1', name: 'Alice' });
 * const user = await store.get('1');
 * ```
 *
 * @see {@link MemoryStorageAdapter} for the main adapter class
 * @see {@link DocumentStore} for the interface this implements
 *
 * @internal
 */
class MemoryDocumentStore<T extends Document> implements DocumentStore<T> {
  /** The name of this document store (collection name) */
  readonly name: string;

  /** Map of document ID to document for O(1) lookups */
  private documents = new Map<string, T>();

  /** Map of index name to MemoryIndex for accelerated queries */
  private indexes = new Map<string, MemoryIndex<T>>();

  /** Subject for emitting change events to subscribers */
  private changes$ = new Subject<ChangeEvent<T>>();

  /** Counter for generating unique sequence numbers for changes */
  private sequenceCounter = 0;

  /**
   * Create a new in-memory document store.
   *
   * @param name - The name of the store (typically the collection name)
   */
  constructor(name: string) {
    this.name = name;
  }

  /**
   * Retrieve a single document by its ID.
   *
   * @param id - The document ID to retrieve
   * @returns The document if found, or null if not found
   *
   * @example
   * ```typescript
   * const user = await store.get('user-123');
   * if (user) {
   *   console.log(user.name);
   * }
   * ```
   */
  async get(id: string): Promise<T | null> {
    return this.documents.get(id) ?? null;
  }

  /**
   * Retrieve multiple documents by their IDs.
   *
   * Returns documents in the same order as the input IDs. Missing documents
   * are represented as null in the returned array.
   *
   * @param ids - Array of document IDs to retrieve
   * @returns Array of documents (or null for missing) in the same order as input IDs
   *
   * @example
   * ```typescript
   * const users = await store.getMany(['user-1', 'user-2', 'user-3']);
   * // users[1] will be null if 'user-2' doesn't exist
   * ```
   */
  async getMany(ids: string[]): Promise<(T | null)[]> {
    return ids.map((id) => this.documents.get(id) ?? null);
  }

  /**
   * Retrieve all documents in the store.
   *
   * @returns Array of all documents in the store
   *
   * @example
   * ```typescript
   * const allUsers = await store.getAll();
   * console.log(`Total users: ${allUsers.length}`);
   * ```
   */
  async getAll(): Promise<T[]> {
    return Array.from(this.documents.values());
  }

  /**
   * Insert or update a document in the store.
   *
   * If a document with the same `_id` exists, it will be updated.
   * Otherwise, a new document is created. The document is cloned
   * before storage to prevent external mutations from affecting
   * the stored data.
   *
   * This method also:
   * - Updates all indexes with the new document
   * - Emits a change event ('insert' or 'update')
   *
   * @param doc - The document to store (must have an `_id` property)
   * @returns A clone of the stored document
   *
   * @example
   * ```typescript
   * // Insert a new document
   * const user = await store.put({ _id: 'user-1', name: 'Alice' });
   *
   * // Update an existing document
   * await store.put({ _id: 'user-1', name: 'Alice Smith' });
   * ```
   */
  async put(doc: T): Promise<T> {
    const existing = this.documents.get(doc._id);
    const operation: ChangeEvent<T>['operation'] = existing ? 'update' : 'insert';

    // Clone document to prevent external mutations
    const stored = structuredClone(doc);
    this.documents.set(doc._id, stored);

    // Update indexes
    for (const index of this.indexes.values()) {
      if (existing) {
        index.remove(existing);
      }
      index.add(stored);
    }

    // Emit change
    this.emitChange(operation, doc._id, stored, existing);

    return stored;
  }

  /**
   * Insert or update multiple documents in a single operation.
   *
   * Each document is processed sequentially, maintaining index consistency
   * and emitting change events for each document.
   *
   * @param docs - Array of documents to store
   * @returns Array of cloned stored documents
   *
   * @example
   * ```typescript
   * const users = await store.bulkPut([
   *   { _id: 'user-1', name: 'Alice' },
   *   { _id: 'user-2', name: 'Bob' },
   * ]);
   * ```
   */
  async bulkPut(docs: T[]): Promise<T[]> {
    const results: T[] = [];
    for (const doc of docs) {
      const result = await this.put(doc);
      results.push(result);
    }
    return results;
  }

  /**
   * Delete a document by its ID.
   *
   * If the document exists, it is removed from storage and all indexes,
   * and a 'delete' change event is emitted. If the document doesn't exist,
   * this method does nothing.
   *
   * @param id - The ID of the document to delete
   *
   * @example
   * ```typescript
   * await store.delete('user-123');
   * // Document is now removed
   * ```
   */
  async delete(id: string): Promise<void> {
    const existing = this.documents.get(id);
    if (!existing) return;

    this.documents.delete(id);

    // Update indexes
    for (const index of this.indexes.values()) {
      index.remove(existing);
    }

    // Emit change
    this.emitChange('delete', id, null, existing);
  }

  /**
   * Delete multiple documents by their IDs.
   *
   * Each document is deleted sequentially. If a document doesn't exist,
   * it is silently skipped.
   *
   * @param ids - Array of document IDs to delete
   *
   * @example
   * ```typescript
   * await store.bulkDelete(['user-1', 'user-2', 'user-3']);
   * ```
   */
  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  /**
   * Execute a query against the document store.
   *
   * The query is processed in the following order:
   * 1. If an index hint is provided and the index exists, use it to narrow the candidate set
   * 2. Apply filter conditions to candidate documents
   * 3. Apply sorting, skip, and limit via the QueryExecutor
   *
   * @param query - The query specification including filter, sort, skip, and limit
   * @returns Array of documents matching the query
   *
   * @example
   * ```typescript
   * const results = await store.query({
   *   spec: {
   *     filter: { status: 'active' },
   *     sort: { createdAt: -1 },
   *     limit: 10
   *   },
   *   indexHint: 'idx_status'
   * });
   * ```
   */
  async query(query: StorageQuery<T>): Promise<T[]> {
    let docs = Array.from(this.documents.values());

    // Try to use an index
    if (query.spec.filter && query.indexHint) {
      const index = this.indexes.get(query.indexHint);
      if (index) {
        const indexedIds = index.query(query.spec.filter);
        if (indexedIds) {
          docs = indexedIds
            .map((id) => this.documents.get(id))
            .filter((d): d is T => d !== undefined);
        }
      }
    }

    // Execute query
    const executor = new QueryExecutor<T>();
    const result = executor.execute(docs, query.spec);
    return result.documents;
  }

  /**
   * Count documents matching a query.
   *
   * If no query is provided, returns the total document count.
   * Otherwise, filters documents and returns the count of matches.
   *
   * @param query - Optional query to filter documents before counting
   * @returns The count of matching documents
   *
   * @example
   * ```typescript
   * // Count all documents
   * const total = await store.count();
   *
   * // Count documents matching a filter
   * const activeCount = await store.count({
   *   spec: { filter: { status: 'active' } }
   * });
   * ```
   */
  async count(query?: StorageQuery<T>): Promise<number> {
    if (!query?.spec.filter) {
      return this.documents.size;
    }

    const docs = Array.from(this.documents.values());
    return docs.filter((doc) => matchesFilter(doc, query.spec.filter!)).length;
  }

  /**
   * Create an index on the document store.
   *
   * The index is built immediately from existing documents. New documents
   * are automatically indexed on insert/update. Indexes can significantly
   * improve query performance for filtered queries.
   *
   * @param index - The index definition specifying fields and options
   *
   * @example
   * ```typescript
   * // Create a single-field index
   * await store.createIndex({ name: 'idx_status', fields: ['status'] });
   *
   * // Create a compound index
   * await store.createIndex({
   *   name: 'idx_user_date',
   *   fields: ['userId', { field: 'createdAt', direction: 'desc' }]
   * });
   *
   * // Create a sparse index (excludes documents without the field)
   * await store.createIndex({
   *   name: 'idx_email',
   *   fields: ['email'],
   *   sparse: true
   * });
   * ```
   */
  async createIndex(index: IndexDefinition): Promise<void> {
    const normalized = normalizeIndex(index);
    const memIndex = new MemoryIndex<T>(normalized);

    // Index existing documents
    for (const doc of this.documents.values()) {
      memIndex.add(doc);
    }

    this.indexes.set(normalized.name, memIndex);
  }

  /**
   * Drop (remove) an index from the store.
   *
   * @param name - The name of the index to drop
   *
   * @example
   * ```typescript
   * await store.dropIndex('idx_status');
   * ```
   */
  async dropIndex(name: string): Promise<void> {
    this.indexes.delete(name);
  }

  /**
   * Get all indexes defined on this store.
   *
   * @returns Array of normalized index definitions
   *
   * @example
   * ```typescript
   * const indexes = await store.getIndexes();
   * console.log('Indexes:', indexes.map(i => i.name));
   * ```
   */
  async getIndexes(): Promise<NormalizedIndex[]> {
    return Array.from(this.indexes.values()).map((idx) => idx.definition);
  }

  /**
   * Get an observable stream of change events.
   *
   * Emits events whenever documents are inserted, updated, or deleted.
   * Useful for reactive updates and sync functionality.
   *
   * @returns Observable that emits change events
   *
   * @example
   * ```typescript
   * store.changes().subscribe(event => {
   *   console.log(`${event.operation} on ${event.documentId}`);
   * });
   * ```
   */
  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  /**
   * Remove all documents from the store.
   *
   * Also clears all indexes and emits 'delete' events for each document.
   *
   * @example
   * ```typescript
   * await store.clear();
   * // Store is now empty
   * ```
   */
  async clear(): Promise<void> {
    const docs = Array.from(this.documents.values());
    this.documents.clear();

    for (const index of this.indexes.values()) {
      index.clear();
    }

    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }

  /**
   * Emit a change event to all subscribers.
   *
   * Documents are cloned before emission to prevent subscribers
   * from mutating the stored data.
   *
   * @param operation - The type of change ('insert', 'update', or 'delete')
   * @param documentId - The ID of the affected document
   * @param document - The current document state (null for deletes)
   * @param previousDocument - The previous document state (for updates/deletes)
   */
  private emitChange(
    operation: ChangeEvent<T>['operation'],
    documentId: string,
    document: T | null,
    previousDocument?: T
  ): void {
    this.changes$.next({
      operation,
      documentId,
      document: document ? structuredClone(document) : null,
      previousDocument: previousDocument ? structuredClone(previousDocument) : undefined,
      isFromSync: false,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
    });
  }

  /**
   * Destroy the store and release all resources.
   *
   * Completes the change stream and clears all data. After calling destroy(),
   * the store should not be used.
   */
  destroy(): void {
    this.changes$.complete();
    this.documents.clear();
    this.indexes.clear();
  }
}

/**
 * In-memory index implementation for accelerating queries.
 *
 * MemoryIndex maintains a mapping from field values to document IDs,
 * enabling O(1) lookups for equality queries on indexed fields.
 *
 * The index supports:
 * - Single-field and compound indexes
 * - Sparse indexes (documents without the field are not indexed)
 * - Automatic maintenance on document insert/update/delete
 *
 * Index keys are serialized with type prefixes to ensure type-safe
 * comparisons (e.g., number 1 vs string "1" produce different keys).
 *
 * @typeParam T - The document type being indexed
 *
 * @example
 * ```typescript
 * const index = new MemoryIndex<User>({
 *   name: 'idx_status',
 *   fields: [{ field: 'status', direction: 'asc' }],
 *   unique: false,
 *   sparse: false
 * });
 *
 * index.add(user);
 * const ids = index.query({ status: 'active' });
 * ```
 *
 * @internal
 */
class MemoryIndex<T extends Document> {
  /** The normalized index definition */
  readonly definition: NormalizedIndex;

  /**
   * Map from serialized index key to set of document IDs.
   * Using a Set for IDs enables O(1) add/remove operations.
   */
  private entries = new Map<string, Set<string>>();

  /**
   * Create a new in-memory index.
   *
   * @param definition - The normalized index definition
   */
  constructor(definition: NormalizedIndex) {
    this.definition = definition;
  }

  /**
   * Add a document to the index
   */
  add(doc: T): void {
    const key = this.getKey(doc);
    if (key === null) return;

    let ids = this.entries.get(key);
    if (!ids) {
      ids = new Set();
      this.entries.set(key, ids);
    }
    ids.add(doc._id);
  }

  /**
   * Remove a document from the index
   */
  remove(doc: T): void {
    const key = this.getKey(doc);
    if (key === null) return;

    const ids = this.entries.get(key);
    if (ids) {
      ids.delete(doc._id);
      if (ids.size === 0) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Query the index for matching document IDs.
   *
   * Currently supports simple equality queries on the first indexed field.
   * Returns null if the index cannot be used for the given filter.
   *
   * @param filter - The filter conditions to match
   * @returns Array of matching document IDs, or null if index cannot be used
   *
   * @example
   * ```typescript
   * // Direct value match
   * const ids = index.query({ status: 'active' });
   *
   * // Using $eq operator
   * const ids = index.query({ status: { $eq: 'active' } });
   * ```
   */
  query(filter: Record<string, unknown>): string[] | null {
    // Simple equality query on first indexed field
    const firstField = this.definition.fields[0];
    if (!firstField) return null;

    const filterValue = filter[firstField.field];
    if (filterValue === undefined) return null;

    // Handle direct value or $eq operator
    const value =
      typeof filterValue === 'object' && filterValue !== null && '$eq' in filterValue
        ? (filterValue as { $eq: unknown }).$eq
        : filterValue;

    const key = this.serializeValue(value);
    const ids = this.entries.get(key);

    return ids ? Array.from(ids) : [];
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Compute the index key for a document.
   *
   * For compound indexes, field values are joined with '|' separator.
   * For sparse indexes, returns null if any indexed field is undefined.
   *
   * @param doc - The document to compute a key for
   * @returns The serialized index key, or null if the document should not be indexed
   */
  private getKey(doc: T): string | null {
    const values: unknown[] = [];

    for (const field of this.definition.fields) {
      const value = this.getFieldValue(doc, field.field);

      // Skip if sparse index and value is undefined
      if (this.definition.sparse && value === undefined) {
        return null;
      }

      values.push(value);
    }

    return values.map((v) => this.serializeValue(v)).join('|');
  }

  /**
   * Extract a field value from a document using dot notation.
   *
   * Supports nested field access like 'user.profile.name'.
   *
   * @param doc - The document to extract from
   * @param path - The field path (e.g., 'name' or 'user.email')
   * @returns The field value, or undefined if the path doesn't exist
   */
  private getFieldValue(doc: T, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = doc;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Serialize a value to a string for use as an index key.
   *
   * Values are prefixed with their type to ensure type-safe comparisons:
   * - `s:` for strings
   * - `n:` for numbers
   * - `b:` for booleans
   * - `d:` for dates (stored as timestamp)
   * - `j:` for other values (JSON serialized)
   * - `null` and `undefined` are stored as-is
   *
   * @param value - The value to serialize
   * @returns A string representation suitable for index key comparisons
   */
  private serializeValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `s:${value}`;
    if (typeof value === 'number') return `n:${value}`;
    if (typeof value === 'boolean') return `b:${value}`;
    if (value instanceof Date) return `d:${value.getTime()}`;
    return `j:${JSON.stringify(value)}`;
  }
}

/**
 * Convert an index definition to its normalized form.
 *
 * Handles the following normalization:
 * - String field specs are converted to objects with default ascending direction
 * - Auto-generates index name if not provided (e.g., 'idx_field1_field2')
 * - Sets default values for unique and sparse options
 *
 * @param index - The index definition to normalize
 * @returns A normalized index with all fields fully specified
 *
 * @example
 * ```typescript
 * // Input
 * normalizeIndex({ fields: ['status', { field: 'date', direction: 'desc' }] });
 *
 * // Output
 * {
 *   name: 'idx_status_date',
 *   fields: [
 *     { field: 'status', direction: 'asc' },
 *     { field: 'date', direction: 'desc' }
 *   ],
 *   unique: false,
 *   sparse: false
 * }
 * ```
 */
function normalizeIndex(index: IndexDefinition): NormalizedIndex {
  const fields: IndexField[] = index.fields.map((f) =>
    typeof f === 'string'
      ? { field: f, direction: 'asc' }
      : { field: f.field, direction: f.direction ?? 'asc' }
  );

  const name = index.name ?? `idx_${fields.map((f) => f.field).join('_')}`;

  return {
    name,
    fields,
    unique: index.unique ?? false,
    sparse: index.sparse ?? false,
  };
}

/**
 * In-memory storage adapter for Pocket.
 *
 * MemoryStorageAdapter provides a complete, non-persistent storage implementation
 * that keeps all data in JavaScript memory. It's ideal for:
 *
 * - **Testing**: Fast, isolated tests without external dependencies
 * - **Development**: Quick prototyping without setting up storage
 * - **Server-side rendering**: Works in Node.js where browser APIs aren't available
 * - **Temporary data**: Caching or session data that doesn't need persistence
 *
 * The adapter is always available (no browser APIs required) and provides
 * full support for indexes, queries, and change streams.
 *
 * **Note**: All data is lost when the adapter is closed or the process ends.
 * For persistent storage, use IndexedDB, OPFS, or SQLite adapters.
 *
 * @example Basic usage
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createMemoryStorage } from '@pocket/storage-memory';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createMemoryStorage(),
 * });
 *
 * const users = db.collection<User>('users');
 * await users.insert({ name: 'Alice' });
 * ```
 *
 * @example Testing with isolated storage
 * ```typescript
 * describe('MyFeature', () => {
 *   let db: Database;
 *
 *   beforeEach(async () => {
 *     // Each test gets a fresh database
 *     db = await Database.create({
 *       name: 'test-db',
 *       storage: createMemoryStorage(),
 *     });
 *   });
 *
 *   afterEach(async () => {
 *     await db.close();
 *   });
 *
 *   it('should insert a user', async () => {
 *     const users = db.collection<User>('users');
 *     const user = await users.insert({ name: 'Test User' });
 *     expect(user.name).toBe('Test User');
 *   });
 * });
 * ```
 *
 * @see {@link createMemoryStorage} for the factory function
 * @see {@link StorageAdapter} for the interface this implements
 */
export class MemoryStorageAdapter implements StorageAdapter {
  /** Unique identifier for this adapter type */
  readonly name = 'memory';

  /** Map of store names to MemoryDocumentStore instances */
  private stores = new Map<string, MemoryDocumentStore<Document>>();

  /**
   * Check if the memory storage adapter is available.
   *
   * Memory storage is always available since it doesn't depend on
   * browser APIs or external services.
   *
   * @returns Always returns `true`
   */
  isAvailable(): boolean {
    return true; // Memory storage is always available
  }

  /**
   * Initialize the storage adapter.
   *
   * Memory storage doesn't require initialization, so this method
   * is a no-op. It exists to satisfy the StorageAdapter interface.
   *
   * @param _config - Configuration options (ignored for memory storage)
   */
  async initialize(_config: StorageConfig): Promise<void> {
    // Memory storage doesn't need initialization
  }

  /**
   * Close the storage adapter and release all resources.
   *
   * Destroys all document stores and clears the store registry.
   * After calling close(), the adapter should not be used.
   */
  async close(): Promise<void> {
    for (const store of this.stores.values()) {
      store.destroy();
    }
    this.stores.clear();
  }

  /**
   * Get or create a document store by name.
   *
   * Stores are created lazily on first access. Subsequent calls
   * with the same name return the existing store.
   *
   * @typeParam T - The document type for this store
   * @param name - The store name (typically the collection name)
   * @returns The document store instance
   *
   * @example
   * ```typescript
   * const adapter = createMemoryStorage();
   * const userStore = adapter.getStore<User>('users');
   * await userStore.put({ _id: '1', name: 'Alice' });
   * ```
   */
  getStore<T extends Document>(name: string): DocumentStore<T> {
    let store = this.stores.get(name);

    if (!store) {
      store = new MemoryDocumentStore(name);
      this.stores.set(name, store);
    }

    return store as unknown as DocumentStore<T>;
  }

  /**
   * Check if a store exists.
   *
   * @param name - The store name to check
   * @returns `true` if the store exists, `false` otherwise
   */
  hasStore(name: string): boolean {
    return this.stores.has(name);
  }

  /**
   * List all store names.
   *
   * @returns Array of store names
   */
  async listStores(): Promise<string[]> {
    return Array.from(this.stores.keys());
  }

  /**
   * Delete a store and all its documents.
   *
   * @param name - The name of the store to delete
   */
  async deleteStore(name: string): Promise<void> {
    const store = this.stores.get(name);
    if (store) {
      store.destroy();
      this.stores.delete(name);
    }
  }

  /**
   * Execute a function within a transaction context.
   *
   * Memory storage doesn't provide true transaction semantics (isolation,
   * atomicity). This method simply executes the function directly.
   * For applications requiring ACID transactions, use a storage adapter
   * that supports them (e.g., IndexedDB, SQLite).
   *
   * @typeParam R - The return type of the transaction function
   * @param _storeNames - Store names involved (ignored for memory storage)
   * @param _mode - Transaction mode (ignored for memory storage)
   * @param fn - The function to execute
   * @returns The function's return value
   *
   * @example
   * ```typescript
   * const result = await adapter.transaction(
   *   ['users', 'orders'],
   *   'readwrite',
   *   async () => {
   *     // Operations here are NOT atomic in memory storage
   *     return 'done';
   *   }
   * );
   * ```
   */
  async transaction<R>(
    _storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R> {
    // Memory storage doesn't need transaction support
    // Just execute the function directly
    return fn();
  }

  /**
   * Get storage statistics.
   *
   * Returns counts for documents, stores, and indexes.
   * Note that `storageSize` is always 0 for memory storage since
   * accurately measuring JavaScript object memory usage is not
   * reliably possible.
   *
   * @returns Storage statistics object
   *
   * @example
   * ```typescript
   * const stats = await adapter.getStats();
   * console.log(`Documents: ${stats.documentCount}`);
   * console.log(`Stores: ${stats.storeCount}`);
   * console.log(`Indexes: ${stats.indexCount}`);
   * ```
   */
  async getStats(): Promise<StorageStats> {
    let documentCount = 0;
    let indexCount = 0;

    for (const store of this.stores.values()) {
      const docs = await store.getAll();
      documentCount += docs.length;
      const indexes = await store.getIndexes();
      indexCount += indexes.length;
    }

    return {
      documentCount,
      storageSize: 0, // Cannot accurately measure in-memory size
      storeCount: this.stores.size,
      indexCount,
    };
  }
}

/**
 * Create a new in-memory storage adapter.
 *
 * This is the recommended way to create a memory storage adapter.
 * Each call creates a new, independent adapter instance with its
 * own data stores.
 *
 * @returns A new MemoryStorageAdapter instance
 *
 * @example Basic usage
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createMemoryStorage } from '@pocket/storage-memory';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createMemoryStorage(),
 * });
 * ```
 *
 * @example Multiple isolated instances
 * ```typescript
 * // Each database gets its own isolated storage
 * const db1 = await Database.create({
 *   name: 'app1',
 *   storage: createMemoryStorage(),
 * });
 *
 * const db2 = await Database.create({
 *   name: 'app2',
 *   storage: createMemoryStorage(),
 * });
 *
 * // db1 and db2 have completely separate data
 * ```
 *
 * @see {@link MemoryStorageAdapter} for the adapter class
 */
export function createMemoryStorage(): MemoryStorageAdapter {
  return new MemoryStorageAdapter();
}
