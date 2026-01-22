import type {
  ChangeEvent,
  Document,
  DocumentStore,
  IndexDefinition,
  NormalizedIndex,
  StorageQuery,
} from '@pocket/core';
import { Subject, type Observable } from 'rxjs';
import type { AsyncStorageInterface } from '../types.js';

/**
 * Document store implementation using AsyncStorage
 * Suitable for React Native apps using @react-native-async-storage/async-storage
 */
export class AsyncStorageDocumentStore<T extends Document = Document> implements DocumentStore<T> {
  readonly name: string;
  private readonly storage: AsyncStorageInterface;
  private readonly keyPrefix: string;
  private readonly changes$ = new Subject<ChangeEvent<T>>();
  private sequence = 0;

  // In-memory cache for faster reads
  private cache = new Map<string, T>();
  private cacheLoaded = false;

  constructor(collectionName: string, storage: AsyncStorageInterface, dbName = 'pocket') {
    this.name = collectionName;
    this.storage = storage;
    this.keyPrefix = `${dbName}:${collectionName}:`;
  }

  /**
   * Observable stream of changes
   */
  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  /**
   * Emit a change event
   */
  private emitChange(
    operation: 'insert' | 'update' | 'delete',
    document: T | null,
    previousDocument?: T
  ): void {
    this.changes$.next({
      operation,
      documentId: document?._id ?? previousDocument?._id ?? '',
      document,
      previousDocument,
      isFromSync: false,
      timestamp: Date.now(),
      sequence: ++this.sequence,
    });
  }

  /**
   * Load all documents into cache
   */
  private async ensureCacheLoaded(): Promise<void> {
    if (this.cacheLoaded) return;

    const allKeys = await this.storage.getAllKeys();
    const collectionKeys = allKeys.filter((key) => key.startsWith(this.keyPrefix));

    if (collectionKeys.length > 0) {
      const pairs = await this.storage.multiGet(collectionKeys);
      for (const [key, value] of pairs) {
        if (value) {
          try {
            const doc = JSON.parse(value) as T;
            const id = key.replace(this.keyPrefix, '');
            this.cache.set(id, doc);
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    this.cacheLoaded = true;
  }

  /**
   * Get the storage key for a document ID
   */
  private getKey(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  /**
   * Get a document by ID
   */
  async get(id: string): Promise<T | null> {
    await this.ensureCacheLoaded();

    const cached = this.cache.get(id);
    if (cached) return cached;

    const value = await this.storage.getItem(this.getKey(id));
    if (!value) return null;

    try {
      const doc = JSON.parse(value) as T;
      this.cache.set(id, doc);
      return doc;
    } catch {
      return null;
    }
  }

  /**
   * Get multiple documents by IDs
   */
  async getMany(ids: string[]): Promise<(T | null)[]> {
    await this.ensureCacheLoaded();
    return ids.map((id) => this.cache.get(id) ?? null);
  }

  /**
   * Get all documents
   */
  async getAll(): Promise<T[]> {
    await this.ensureCacheLoaded();
    return Array.from(this.cache.values());
  }

  /**
   * Put (insert/update) a document
   */
  async put(doc: T): Promise<T> {
    await this.ensureCacheLoaded();

    const existing = this.cache.get(doc._id);
    const key = this.getKey(doc._id);
    const value = JSON.stringify(doc);

    await this.storage.setItem(key, value);
    this.cache.set(doc._id, doc);

    this.emitChange(existing ? 'update' : 'insert', doc, existing);

    return doc;
  }

  /**
   * Put multiple documents
   */
  async bulkPut(docs: T[]): Promise<T[]> {
    await this.ensureCacheLoaded();

    const pairs: [string, string][] = docs.map((doc) => [
      this.getKey(doc._id),
      JSON.stringify(doc),
    ]);

    await this.storage.multiSet(pairs);

    for (const doc of docs) {
      const existing = this.cache.get(doc._id);
      this.cache.set(doc._id, doc);
      this.emitChange(existing ? 'update' : 'insert', doc, existing);
    }

    return docs;
  }

  /**
   * Delete a document
   */
  async delete(id: string): Promise<void> {
    await this.ensureCacheLoaded();

    const existing = this.cache.get(id);
    await this.storage.removeItem(this.getKey(id));
    this.cache.delete(id);

    if (existing) {
      this.emitChange('delete', null, existing);
    }
  }

  /**
   * Delete multiple documents
   */
  async bulkDelete(ids: string[]): Promise<void> {
    await this.ensureCacheLoaded();

    const keys = ids.map((id) => this.getKey(id));
    const deletedDocs: T[] = [];

    for (const id of ids) {
      const existing = this.cache.get(id);
      if (existing) {
        deletedDocs.push(existing);
      }
      this.cache.delete(id);
    }

    await this.storage.multiRemove(keys);

    for (const doc of deletedDocs) {
      this.emitChange('delete', null, doc);
    }
  }

  /**
   * Query documents
   */
  async query(query: StorageQuery<T>): Promise<T[]> {
    await this.ensureCacheLoaded();

    let results = Array.from(this.cache.values());

    // Apply filters
    if (query.spec.filter) {
      results = results.filter((doc) => this.matchesFilter(doc, query.spec.filter!));
    }

    // Apply sorting
    if (query.spec.sort && query.spec.sort.length > 0) {
      results.sort((a, b) => {
        for (const sortSpec of query.spec.sort!) {
          const field = sortSpec.field as keyof T;
          const aVal = a[field];
          const bVal = b[field];

          let comparison = 0;
          if (aVal < bVal) comparison = -1;
          else if (aVal > bVal) comparison = 1;

          if (comparison !== 0) {
            return sortSpec.direction === 'desc' ? -comparison : comparison;
          }
        }
        return 0;
      });
    }

    // Apply skip
    if (query.spec.skip) {
      results = results.slice(query.spec.skip);
    }

    // Apply limit
    if (query.spec.limit) {
      results = results.slice(0, query.spec.limit);
    }

    return results;
  }

  /**
   * Count documents
   */
  async count(query?: StorageQuery<T>): Promise<number> {
    await this.ensureCacheLoaded();

    if (!query?.spec.filter) {
      return this.cache.size;
    }

    let count = 0;
    for (const doc of this.cache.values()) {
      if (this.matchesFilter(doc, query.spec.filter)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Check if a document matches a filter
   */
  private matchesFilter(doc: T, filter: Record<string, unknown>): boolean {
    for (const [key, condition] of Object.entries(filter)) {
      const value = (doc as Record<string, unknown>)[key];

      if (typeof condition === 'object' && condition !== null) {
        // Handle operators like $gt, $lt, $in, etc.
        const ops = condition as Record<string, unknown>;

        for (const [op, opValue] of Object.entries(ops)) {
          switch (op) {
            case '$eq':
              if (value !== opValue) return false;
              break;
            case '$ne':
              if (value === opValue) return false;
              break;
            case '$gt':
              if (!((value as number) > (opValue as number))) return false;
              break;
            case '$gte':
              if (!((value as number) >= (opValue as number))) return false;
              break;
            case '$lt':
              if (!((value as number) < (opValue as number))) return false;
              break;
            case '$lte':
              if (!((value as number) <= (opValue as number))) return false;
              break;
            case '$in':
              if (!Array.isArray(opValue) || !opValue.includes(value)) return false;
              break;
            case '$nin':
              if (Array.isArray(opValue) && opValue.includes(value)) return false;
              break;
            case '$exists':
              if ((value !== undefined) !== opValue) return false;
              break;
            case '$regex': {
              const regex = new RegExp(opValue as string);
              if (!regex.test(String(value))) return false;
              break;
            }
          }
        }
      } else {
        // Direct equality check
        if (value !== condition) return false;
      }
    }
    return true;
  }

  /**
   * Create an index (no-op for AsyncStorage)
   */
  async createIndex(_index: IndexDefinition): Promise<void> {
    // AsyncStorage doesn't support native indexes
    // Queries are performed in-memory
  }

  /**
   * Drop an index (no-op for AsyncStorage)
   */
  async dropIndex(_name: string): Promise<void> {
    // No-op
  }

  /**
   * Get all indexes
   */
  async getIndexes(): Promise<NormalizedIndex[]> {
    return [];
  }

  /**
   * Clear all documents
   */
  async clear(): Promise<void> {
    const allKeys = await this.storage.getAllKeys();
    const collectionKeys = allKeys.filter((key) => key.startsWith(this.keyPrefix));

    if (collectionKeys.length > 0) {
      await this.storage.multiRemove(collectionKeys);
    }

    this.cache.clear();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.cache.clear();
    this.cacheLoaded = false;
    this.changes$.complete();
  }
}

/**
 * Create an AsyncStorage document store
 */
export function createAsyncStorageDocumentStore<T extends Document>(
  collectionName: string,
  storage: AsyncStorageInterface,
  dbName?: string
): AsyncStorageDocumentStore<T> {
  return new AsyncStorageDocumentStore<T>(collectionName, storage, dbName);
}
