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
import { Observable, Subject } from 'rxjs';

/**
 * In-memory document store
 */
class MemoryDocumentStore<T extends Document> implements DocumentStore<T> {
  readonly name: string;

  private documents = new Map<string, T>();
  private indexes = new Map<string, MemoryIndex<T>>();
  private changes$ = new Subject<ChangeEvent<T>>();
  private sequenceCounter = 0;

  constructor(name: string) {
    this.name = name;
  }

  async get(id: string): Promise<T | null> {
    return this.documents.get(id) ?? null;
  }

  async getMany(ids: string[]): Promise<(T | null)[]> {
    return ids.map((id) => this.documents.get(id) ?? null);
  }

  async getAll(): Promise<T[]> {
    return Array.from(this.documents.values());
  }

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

  async bulkPut(docs: T[]): Promise<T[]> {
    const results: T[] = [];
    for (const doc of docs) {
      const result = await this.put(doc);
      results.push(result);
    }
    return results;
  }

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

  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

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

  async count(query?: StorageQuery<T>): Promise<number> {
    if (!query || !query.spec.filter) {
      return this.documents.size;
    }

    const docs = Array.from(this.documents.values());
    return docs.filter((doc) => matchesFilter(doc, query.spec.filter!)).length;
  }

  async createIndex(index: IndexDefinition): Promise<void> {
    const normalized = normalizeIndex(index);
    const memIndex = new MemoryIndex<T>(normalized);

    // Index existing documents
    for (const doc of this.documents.values()) {
      memIndex.add(doc);
    }

    this.indexes.set(normalized.name, memIndex);
  }

  async dropIndex(name: string): Promise<void> {
    this.indexes.delete(name);
  }

  async getIndexes(): Promise<NormalizedIndex[]> {
    return Array.from(this.indexes.values()).map((idx) => idx.definition);
  }

  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

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
    this.documents.clear();
    this.indexes.clear();
  }
}

/**
 * In-memory index implementation
 */
class MemoryIndex<T extends Document> {
  readonly definition: NormalizedIndex;

  private entries = new Map<string, Set<string>>();

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
   * Query the index for matching document IDs
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
   * Get the index key for a document
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
   * Get a field value from a document (supports dot notation)
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
   * Serialize a value for use as index key
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
 * Normalize an index definition
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
 * Memory storage adapter
 */
export class MemoryStorageAdapter implements StorageAdapter {
  readonly name = 'memory';

  private stores = new Map<string, MemoryDocumentStore<Document>>();

  isAvailable(): boolean {
    return true; // Memory storage is always available
  }

  async initialize(_config: StorageConfig): Promise<void> {
    // Memory storage doesn't need initialization
  }

  async close(): Promise<void> {
    for (const store of this.stores.values()) {
      store.destroy();
    }
    this.stores.clear();
  }

  getStore<T extends Document>(name: string): DocumentStore<T> {
    let store = this.stores.get(name);

    if (!store) {
      store = new MemoryDocumentStore(name);
      this.stores.set(name, store);
    }

    return store as unknown as DocumentStore<T>;
  }

  hasStore(name: string): boolean {
    return this.stores.has(name);
  }

  async listStores(): Promise<string[]> {
    return Array.from(this.stores.keys());
  }

  async deleteStore(name: string): Promise<void> {
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
    // Memory storage doesn't need transaction support
    // Just execute the function directly
    return fn();
  }

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
 * Create a memory storage adapter
 */
export function createMemoryStorage(): MemoryStorageAdapter {
  return new MemoryStorageAdapter();
}
