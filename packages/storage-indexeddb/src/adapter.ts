import {
  matchesFilter,
  QueryExecutor,
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
import { Observable, Subject } from 'rxjs';
import { createKeyRange, deserializeDocument, serializeDocument } from './serialization.js';
import {
  collectCursor,
  IDBTransactionWrapper,
  openDatabase,
  promisifyRequest,
} from './transaction.js';

const META_STORE = '__pocket_meta__';
const INDEX_PREFIX = 'idx_';

/**
 * IndexedDB document store implementation
 */
class IndexedDBDocumentStore<T extends Document> implements DocumentStore<T> {
  readonly name: string;

  private db: IDBDatabase;
  private changes$ = new Subject<ChangeEvent<T>>();
  private sequenceCounter = 0;
  private indexes = new Map<string, NormalizedIndex>();

  constructor(name: string, db: IDBDatabase) {
    this.name = name;
    this.db = db;
  }

  async get(id: string): Promise<T | null> {
    const tx = this.db.transaction(this.name, 'readonly');
    const store = tx.objectStore(this.name);
    const result = await promisifyRequest(store.get(id));
    return result ? deserializeDocument<T>(result) : null;
  }

  async getMany(ids: string[]): Promise<(T | null)[]> {
    const tx = this.db.transaction(this.name, 'readonly');
    const store = tx.objectStore(this.name);

    const results = await Promise.all(ids.map((id) => promisifyRequest(store.get(id))));

    return results.map((r) => (r ? deserializeDocument<T>(r) : null));
  }

  async getAll(): Promise<T[]> {
    const tx = this.db.transaction(this.name, 'readonly');
    const store = tx.objectStore(this.name);
    const results = await promisifyRequest(store.getAll());
    return results.map((r) => deserializeDocument<T>(r));
  }

  async put(doc: T): Promise<T> {
    const existing = await this.get(doc._id);
    const operation: ChangeEvent<T>['operation'] = existing ? 'update' : 'insert';

    const serialized = serializeDocument(doc);

    const tx = this.db.transaction(this.name, 'readwrite');
    const store = tx.objectStore(this.name);
    await promisifyRequest(store.put(serialized));

    this.emitChange(operation, doc._id, doc, existing ?? undefined);

    return doc;
  }

  async bulkPut(docs: T[]): Promise<T[]> {
    // Get existing documents first
    const ids = docs.map((d) => d._id);
    const existing = await this.getMany(ids);
    const existingMap = new Map(existing.map((e, i) => [ids[i], e]));

    const tx = this.db.transaction(this.name, 'readwrite');
    const store = tx.objectStore(this.name);

    for (const doc of docs) {
      const serialized = serializeDocument(doc);
      store.put(serialized);
    }

    await new IDBTransactionWrapper(tx).complete();

    // Emit changes
    for (const doc of docs) {
      const prev = existingMap.get(doc._id);
      const operation: ChangeEvent<T>['operation'] = prev ? 'update' : 'insert';
      this.emitChange(operation, doc._id, doc, prev ?? undefined);
    }

    return docs;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;

    const tx = this.db.transaction(this.name, 'readwrite');
    const store = tx.objectStore(this.name);
    await promisifyRequest(store.delete(id));

    this.emitChange('delete', id, null, existing);
  }

  async bulkDelete(ids: string[]): Promise<void> {
    const existing = await this.getMany(ids);

    const tx = this.db.transaction(this.name, 'readwrite');
    const store = tx.objectStore(this.name);

    for (const id of ids) {
      store.delete(id);
    }

    await new IDBTransactionWrapper(tx).complete();

    // Emit changes
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const prev = existing[i];
      if (prev) {
        this.emitChange('delete', id, null, prev);
      }
    }
  }

  async query(query: StorageQuery<T>): Promise<T[]> {
    let docs: T[];

    // Try to use an index for efficient querying
    const indexHint = query.indexHint;
    const filter = query.spec.filter;

    if (indexHint && filter) {
      const indexDef = this.indexes.get(indexHint);
      if (indexDef) {
        docs = await this.queryWithIndex(indexDef, filter);
      } else {
        docs = await this.getAll();
      }
    } else {
      docs = await this.getAll();
    }

    // Execute remaining query logic
    const executor = new QueryExecutor<T>();
    const result = executor.execute(docs, query.spec);
    return result.documents;
  }

  private async queryWithIndex(
    indexDef: NormalizedIndex,
    filter: Record<string, unknown>
  ): Promise<T[]> {
    const tx = this.db.transaction(this.name, 'readonly');
    const store = tx.objectStore(this.name);

    // Try to get the IDB index
    const idbIndexName = INDEX_PREFIX + indexDef.name;
    let index: IDBIndex;

    try {
      index = store.index(idbIndexName);
    } catch {
      // Index doesn't exist, fall back to full scan
      return this.getAll();
    }

    // Get the filter condition for the first indexed field
    const firstField = indexDef.fields[0];
    if (!firstField) {
      return this.getAll();
    }

    const condition = filter[firstField.field];
    if (condition === undefined) {
      return this.getAll();
    }

    // Create key range
    const keyRange =
      typeof condition === 'object' && condition !== null
        ? createKeyRange(condition as Record<string, unknown>)
        : IDBKeyRange.only(condition);

    if (!keyRange) {
      return this.getAll();
    }

    // Collect results using cursor
    const cursor = index.openCursor(keyRange);
    const results = await collectCursor<T>(cursor);

    return results.map((r) => deserializeDocument<T>(r));
  }

  async count(query?: StorageQuery<T>): Promise<number> {
    if (!query || !query.spec.filter) {
      const tx = this.db.transaction(this.name, 'readonly');
      const store = tx.objectStore(this.name);
      return promisifyRequest(store.count());
    }

    const docs = await this.getAll();
    return docs.filter((doc) => matchesFilter(doc, query.spec.filter!)).length;
  }

  async createIndex(index: IndexDefinition): Promise<void> {
    const normalized = normalizeIndex(index);
    this.indexes.set(normalized.name, normalized);

    // Note: Creating IDB indexes requires a version upgrade
    // For now, we track the index definition and use it for query optimization
    // Actual IDB index creation happens during DB initialization
  }

  async dropIndex(name: string): Promise<void> {
    this.indexes.delete(name);
  }

  async getIndexes(): Promise<NormalizedIndex[]> {
    return Array.from(this.indexes.values());
  }

  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  async clear(): Promise<void> {
    const docs = await this.getAll();

    const tx = this.db.transaction(this.name, 'readwrite');
    const store = tx.objectStore(this.name);
    await promisifyRequest(store.clear());

    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }

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

  destroy(): void {
    this.changes$.complete();
  }

  /**
   * Update the database reference (after version upgrade)
   */
  updateDatabase(db: IDBDatabase): void {
    this.db = db;
  }
}

/**
 * Normalize an index definition
 */
function normalizeIndex(index: IndexDefinition): NormalizedIndex {
  const fields: IndexField[] = index.fields.map((f) =>
    typeof f === 'string'
      ? { field: f, direction: 'asc' }
      : { field: f.field, direction: f.direction ?? 'asc' }
  );

  const name = index.name ?? fields.map((f) => f.field).join('_');

  return {
    name,
    fields,
    unique: index.unique ?? false,
    sparse: index.sparse ?? false,
  };
}

/**
 * IndexedDB storage adapter options
 */
export interface IndexedDBAdapterOptions {
  /** Custom IndexedDB factory (for testing) */
  indexedDB?: IDBFactory;
}

/**
 * IndexedDB storage adapter
 */
export class IndexedDBAdapter implements StorageAdapter {
  readonly name = 'indexeddb';

  private db: IDBDatabase | null = null;
  private stores = new Map<string, IndexedDBDocumentStore<Document>>();
  private config: StorageConfig | null = null;
  private pendingIndexes = new Map<string, IndexDefinition[]>();
  private readonly options: IndexedDBAdapterOptions;

  constructor(options: IndexedDBAdapterOptions = {}) {
    this.options = options;
  }

  isAvailable(): boolean {
    const idb = this.options.indexedDB ?? (typeof indexedDB !== 'undefined' ? indexedDB : null);
    return idb !== null;
  }

  async initialize(config: StorageConfig): Promise<void> {
    this.config = config;

    const version = config.version ?? 1;

    this.db = await openDatabase(config.name, version, (db, oldVersion, newVersion) => {
      this.handleUpgrade(db, oldVersion, newVersion);
    });
  }

  private handleUpgrade(db: IDBDatabase, _oldVersion: number, _newVersion: number): void {
    // Create meta store if it doesn't exist
    if (!db.objectStoreNames.contains(META_STORE)) {
      db.createObjectStore(META_STORE, { keyPath: 'key' });
    }

    // Create any pending stores
    for (const [storeName, indexes] of this.pendingIndexes) {
      if (!db.objectStoreNames.contains(storeName)) {
        const store = db.createObjectStore(storeName, { keyPath: '_id' });

        // Create indexes
        for (const index of indexes) {
          const normalized = normalizeIndex(index);
          const idbIndexName = INDEX_PREFIX + normalized.name;

          if (normalized.fields.length === 1) {
            store.createIndex(idbIndexName, normalized.fields[0]!.field, {
              unique: normalized.unique,
            });
          } else {
            // Compound index
            const keyPath = normalized.fields.map((f) => f.field);
            store.createIndex(idbIndexName, keyPath, { unique: normalized.unique });
          }
        }
      }
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    for (const store of this.stores.values()) {
      store.destroy();
    }
    this.stores.clear();
  }

  getStore<T extends Document>(name: string): DocumentStore<T> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    let store = this.stores.get(name);

    if (!store) {
      // Create object store if it doesn't exist
      if (!this.db.objectStoreNames.contains(name)) {
        // Queue store creation for next version upgrade
        if (!this.pendingIndexes.has(name)) {
          this.pendingIndexes.set(name, []);
        }

        // We need to trigger a version upgrade
        this.triggerUpgrade();
      }

      store = new IndexedDBDocumentStore(name, this.db);
      this.stores.set(name, store);
    }

    return store as unknown as DocumentStore<T>;
  }

  private async triggerUpgrade(): Promise<void> {
    if (!this.config || !this.db) return;

    const currentVersion = this.db.version;
    const newVersion = currentVersion + 1;

    // Close current connection
    this.db.close();

    // Reopen with new version
    this.db = await openDatabase(this.config.name, newVersion, (db, oldVersion, newVersion) => {
      this.handleUpgrade(db, oldVersion, newVersion);
    });

    // Update all stores with new db reference
    for (const store of this.stores.values()) {
      store.updateDatabase(this.db);
    }

    // Clear pending indexes
    this.pendingIndexes.clear();
  }

  hasStore(name: string): boolean {
    if (!this.db) return false;
    return this.db.objectStoreNames.contains(name);
  }

  async listStores(): Promise<string[]> {
    if (!this.db) return [];
    return Array.from(this.db.objectStoreNames).filter((n) => n !== META_STORE);
  }

  async deleteStore(name: string): Promise<void> {
    const store = this.stores.get(name);
    if (store) {
      await store.clear();
      store.destroy();
      this.stores.delete(name);
    }
  }

  async transaction<R>(
    _storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R> {
    // IndexedDB transactions are auto-managed per operation
    // This is a simplified implementation
    return fn();
  }

  async getStats(): Promise<StorageStats> {
    if (!this.db) {
      return {
        documentCount: 0,
        storageSize: 0,
        storeCount: 0,
        indexCount: 0,
      };
    }

    let documentCount = 0;
    let indexCount = 0;
    const storeNames = Array.from(this.db.objectStoreNames).filter((n) => n !== META_STORE);

    for (const storeName of storeNames) {
      const store = this.getStore(storeName);
      documentCount += await store.count();
      const indexes = await store.getIndexes();
      indexCount += indexes.length;
    }

    // Try to get storage estimate
    let storageSize = 0;
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        storageSize = estimate.usage ?? 0;
      } catch {
        // Ignore errors
      }
    }

    return {
      documentCount,
      storageSize,
      storeCount: storeNames.length,
      indexCount,
    };
  }
}

/**
 * Create an IndexedDB storage adapter
 */
export function createIndexedDBStorage(options?: IndexedDBAdapterOptions): IndexedDBAdapter {
  return new IndexedDBAdapter(options);
}
