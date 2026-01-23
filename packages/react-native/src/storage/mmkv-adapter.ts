import type {
  ChangeEvent,
  Document,
  DocumentStore,
  IndexDefinition,
  NormalizedIndex,
  StorageQuery,
} from '@pocket/core';
import { Subject, type Observable } from 'rxjs';
import type { MMKVInterface } from '../types.js';

/**
 * Document store implementation using MMKV
 * Suitable for React Native apps using react-native-mmkv
 * MMKV is synchronous and much faster than AsyncStorage
 */
export class MMKVDocumentStore<T extends Document = Document> implements DocumentStore<T> {
  readonly name: string;
  private readonly mmkv: MMKVInterface;
  private readonly keyPrefix: string;
  private readonly indexKey: string;
  private readonly changes$ = new Subject<ChangeEvent<T>>();
  private sequence = 0;

  constructor(collectionName: string, mmkv: MMKVInterface, dbName = 'pocket') {
    this.name = collectionName;
    this.mmkv = mmkv;
    this.keyPrefix = `${dbName}:${collectionName}:`;
    this.indexKey = `${dbName}:${collectionName}:__index__`;
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
   * Get the storage key for a document ID
   */
  private getKey(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  /**
   * Get all document IDs
   */
  private getDocumentIds(): string[] {
    const indexValue = this.mmkv.getString(this.indexKey);
    if (!indexValue) return [];

    try {
      return JSON.parse(indexValue) as string[];
    } catch {
      return [];
    }
  }

  /**
   * Save document IDs index
   */
  private saveDocumentIds(ids: string[]): void {
    this.mmkv.set(this.indexKey, JSON.stringify(ids));
  }

  /**
   * Get a document by ID
   */
  async get(id: string): Promise<T | null> {
    const value = this.mmkv.getString(this.getKey(id));
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Get multiple documents by IDs
   */
  async getMany(ids: string[]): Promise<(T | null)[]> {
    return ids.map((id) => {
      const value = this.mmkv.getString(this.getKey(id));
      if (!value) return null;

      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    });
  }

  /**
   * Get all documents
   */
  async getAll(): Promise<T[]> {
    const ids = this.getDocumentIds();
    const docs: T[] = [];

    for (const id of ids) {
      const value = this.mmkv.getString(this.getKey(id));
      if (value) {
        try {
          docs.push(JSON.parse(value) as T);
        } catch {
          // Skip invalid JSON
        }
      }
    }

    return docs;
  }

  /**
   * Put (insert/update) a document
   */
  async put(doc: T): Promise<T> {
    const existing = await this.get(doc._id);
    const key = this.getKey(doc._id);
    const value = JSON.stringify(doc);

    this.mmkv.set(key, value);

    // Update index
    const ids = this.getDocumentIds();
    if (!ids.includes(doc._id)) {
      ids.push(doc._id);
      this.saveDocumentIds(ids);
    }

    this.emitChange(existing ? 'update' : 'insert', doc, existing ?? undefined);

    return doc;
  }

  /**
   * Put multiple documents
   */
  async bulkPut(docs: T[]): Promise<T[]> {
    const ids = this.getDocumentIds();
    const idSet = new Set(ids);
    const existingDocs = await this.getMany(docs.map((d) => d._id));

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i]!;
      const existing = existingDocs[i];
      const key = this.getKey(doc._id);
      this.mmkv.set(key, JSON.stringify(doc));

      if (!idSet.has(doc._id)) {
        idSet.add(doc._id);
        ids.push(doc._id);
      }

      this.emitChange(existing ? 'update' : 'insert', doc, existing ?? undefined);
    }

    this.saveDocumentIds(ids);
    return docs;
  }

  /**
   * Delete a document
   */
  async delete(id: string): Promise<void> {
    const existing = await this.get(id);
    this.mmkv.delete(this.getKey(id));

    // Update index
    const ids = this.getDocumentIds();
    const newIds = ids.filter((docId) => docId !== id);
    this.saveDocumentIds(newIds);

    if (existing) {
      this.emitChange('delete', null, existing);
    }
  }

  /**
   * Delete multiple documents
   */
  async bulkDelete(ids: string[]): Promise<void> {
    const idSet = new Set(ids);
    const existingDocs = await this.getMany(ids);

    for (const id of ids) {
      this.mmkv.delete(this.getKey(id));
    }

    // Update index
    const currentIds = this.getDocumentIds();
    const newIds = currentIds.filter((docId) => !idSet.has(docId));
    this.saveDocumentIds(newIds);

    for (const doc of existingDocs) {
      if (doc) {
        this.emitChange('delete', null, doc);
      }
    }
  }

  /**
   * Query documents
   */
  async query(query: StorageQuery<T>): Promise<T[]> {
    let results = await this.getAll();

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
    if (!query?.spec.filter) {
      return this.getDocumentIds().length;
    }

    const docs = await this.getAll();
    return docs.filter((doc) => this.matchesFilter(doc, query.spec.filter!)).length;
  }

  /**
   * Check if a document matches a filter
   */
  private matchesFilter(doc: T, filter: Record<string, unknown>): boolean {
    for (const [key, condition] of Object.entries(filter)) {
      const value = (doc as Record<string, unknown>)[key];

      if (typeof condition === 'object' && condition !== null) {
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
        if (value !== condition) return false;
      }
    }
    return true;
  }

  /**
   * Create an index (no-op for MMKV)
   */
  async createIndex(_index: IndexDefinition): Promise<void> {
    // MMKV doesn't support native indexes
  }

  /**
   * Drop an index (no-op for MMKV)
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
    const ids = this.getDocumentIds();

    for (const id of ids) {
      this.mmkv.delete(this.getKey(id));
    }

    this.mmkv.delete(this.indexKey);
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.changes$.complete();
  }
}

/**
 * Create an MMKV document store
 */
export function createMMKVDocumentStore<T extends Document>(
  collectionName: string,
  mmkv: MMKVInterface,
  dbName?: string
): MMKVDocumentStore<T> {
  return new MMKVDocumentStore<T>(collectionName, mmkv, dbName);
}
