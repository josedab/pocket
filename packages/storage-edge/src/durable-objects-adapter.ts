/**
 * Cloudflare Durable Objects Storage Adapter
 *
 * Storage adapter for Cloudflare Durable Objects.
 *
 * @module @pocket/storage-edge/durable-objects
 */

import type {
  ChangeEvent,
  ChangeOperation,
  Document,
  DocumentStore,
  IndexDefinition,
  IndexField,
  NormalizedIndex,
  StorageAdapter,
  StorageConfig,
  StorageQuery,
  StorageStats,
} from '@pocket/core';
import { type Observable, Subject } from 'rxjs';

/**
 * Durable Object Storage type from Cloudflare Workers
 */
interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- Cloudflare API typing
  put<T>(key: string, value: T): Promise<void>;
  put<T>(entries: Record<string, T>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  deleteAll(): Promise<void>;
  list<T = unknown>(options?: DurableObjectListOptions): Promise<Map<string, T>>;
  transaction<T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T>;
}

interface DurableObjectListOptions {
  start?: string;
  startAfter?: string;
  end?: string;
  prefix?: string;
  reverse?: boolean;
  limit?: number;
}

interface DurableObjectTransaction {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- Cloudflare API typing
  put<T>(key: string, value: T): Promise<void>;
  put<T>(entries: Record<string, T>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  rollback(): void;
}

/**
 * Durable Objects storage configuration
 */
export interface DurableObjectStorageConfig {
  /** Durable Object storage binding */
  storage: DurableObjectStorage;
  /** Key prefix for all documents */
  keyPrefix?: string;
}

/**
 * Internal document wrapper with metadata
 */
interface StoredDocument<T extends Document> {
  document: T;
  createdAt: number;
  updatedAt: number;
}

/**
 * Document store implementation for Durable Objects
 */
class DurableObjectDocumentStore<T extends Document> implements DocumentStore<T> {
  readonly name: string;
  private changes$ = new Subject<ChangeEvent<T>>();
  private storage: DurableObjectStorage;
  private keyPrefix: string;
  private indexes = new Map<string, IndexDefinition>();
  private sequenceCounter = 0;

  constructor(storage: DurableObjectStorage, collectionName: string, keyPrefix: string) {
    this.storage = storage;
    this.keyPrefix = `${keyPrefix}${collectionName}:`;
    this.name = collectionName;
  }

  private emitChange(
    operation: ChangeOperation,
    documentId: string,
    document: T | null,
    previousDocument?: T
  ): void {
    this.changes$.next({
      operation,
      documentId,
      document,
      previousDocument,
      isFromSync: false,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
    });
  }

  private getKey(id: string): string {
    return `${this.keyPrefix}doc:${id}`;
  }

  private getIndexKey(indexName: string, value: unknown, docId: string): string {
    return `${this.keyPrefix}idx:${indexName}:${JSON.stringify(value)}:${docId}`;
  }

  private getMetaKey(key: string): string {
    return `${this.keyPrefix}meta:${key}`;
  }

  async get(id: string): Promise<T | null> {
    const stored = await this.storage.get<StoredDocument<T>>(this.getKey(id));
    return stored?.document ?? null;
  }

  async getMany(ids: string[]): Promise<(T | null)[]> {
    const keys = ids.map((id) => this.getKey(id));
    const results = await this.storage.get<StoredDocument<T>>(keys);

    return ids.map((id) => {
      const stored = results.get(this.getKey(id));
      return stored?.document ?? null;
    });
  }

  async getAll(): Promise<T[]> {
    const docPrefix = `${this.keyPrefix}doc:`;
    const results = await this.storage.list<StoredDocument<T>>({
      prefix: docPrefix,
    });

    return Array.from(results.values()).map((stored) => stored.document);
  }

  async put(doc: T): Promise<T> {
    const id = doc._id;
    const key = this.getKey(id);
    const now = Date.now();

    // Get existing document for index updates
    const existing = await this.storage.get<StoredDocument<T>>(key);

    const stored: StoredDocument<T> = {
      document: doc,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.storage.transaction(async (txn) => {
      // Update indexes
      for (const [indexName, indexDef] of this.indexes) {
        // Remove old index entries
        if (existing) {
          for (const field of indexDef.fields) {
            const fieldName = this.getFieldName(field);
            const oldValue = this.getFieldValue(existing.document, fieldName);
            if (oldValue !== undefined) {
              await txn.delete(this.getIndexKey(indexName, oldValue, id));
            }
          }
        }

        // Add new index entries
        for (const field of indexDef.fields) {
          const fieldName = this.getFieldName(field);
          const newValue = this.getFieldValue(doc, fieldName);
          if (newValue !== undefined) {
            await txn.put(this.getIndexKey(indexName, newValue, id), id);
          }
        }
      }

      // Store document
      await txn.put(key, stored);
    });

    const operation: ChangeOperation = existing ? 'update' : 'insert';
    this.emitChange(operation, id, doc, existing?.document);
    return doc;
  }

  async bulkPut(docs: T[]): Promise<T[]> {
    for (const doc of docs) {
      await this.put(doc);
    }
    return docs;
  }

  async delete(id: string): Promise<void> {
    const key = this.getKey(id);
    const existing = await this.storage.get<StoredDocument<T>>(key);

    if (!existing) return;

    await this.storage.transaction(async (txn) => {
      // Remove index entries
      for (const [indexName, indexDef] of this.indexes) {
        for (const field of indexDef.fields) {
          const fieldName = this.getFieldName(field);
          const value = this.getFieldValue(existing.document, fieldName);
          if (value !== undefined) {
            await txn.delete(this.getIndexKey(indexName, value, id));
          }
        }
      }

      await txn.delete(key);
    });

    this.emitChange('delete', id, null, existing.document);
  }

  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  async query(query: StorageQuery<T>): Promise<T[]> {
    // Get all documents and filter in memory
    // For better performance, use indexes when available
    let docs = await this.getAll();

    // Apply filter
    if (query.spec.filter) {
      docs = docs.filter((doc) => {
        for (const [key, value] of Object.entries(query.spec.filter!)) {
          if (this.getFieldValue(doc, key) !== value) {
            return false;
          }
        }
        return true;
      });
    }

    // Apply sort
    if (query.spec.sort && query.spec.sort.length > 0) {
      docs.sort((a, b) => {
        for (const { field, direction } of query.spec.sort!) {
          const aVal = this.getFieldValue(a, field) as string | number | boolean | null | undefined;
          const bVal = this.getFieldValue(b, field) as string | number | boolean | null | undefined;

          let cmp = 0;
          if (aVal == null && bVal != null) cmp = -1;
          else if (aVal != null && bVal == null) cmp = 1;
          else if (aVal != null && bVal != null) {
            if (aVal < bVal) cmp = -1;
            else if (aVal > bVal) cmp = 1;
          }

          if (cmp !== 0) {
            return direction === 'desc' ? -cmp : cmp;
          }
        }
        return 0;
      });
    }

    // Apply offset
    if (query.spec.skip) {
      docs = docs.slice(query.spec.skip);
    }

    // Apply limit
    if (query.spec.limit) {
      docs = docs.slice(0, query.spec.limit);
    }

    return docs;
  }

  async count(query?: StorageQuery<T>): Promise<number> {
    if (!query?.spec.filter && !query?.spec.sort) {
      const docPrefix = `${this.keyPrefix}doc:`;
      const results = await this.storage.list({ prefix: docPrefix });
      return results.size;
    }

    const docs = await this.query(query);
    return docs.length;
  }

  async createIndex(index: IndexDefinition): Promise<void> {
    const fieldNames = index.fields.map((f) => this.getFieldName(f));
    const indexName = index.name ?? `idx_${fieldNames.join('_')}`;

    // Store index definition
    this.indexes.set(indexName, index);
    await this.storage.put(this.getMetaKey(`index:${indexName}`), index);

    // Build index for existing documents
    const docs = await this.getAll();
    for (const doc of docs) {
      for (const field of index.fields) {
        const fieldName = this.getFieldName(field);
        const value = this.getFieldValue(doc, fieldName);
        if (value !== undefined) {
          await this.storage.put(this.getIndexKey(indexName, value, doc._id), doc._id);
        }
      }
    }
  }

  async dropIndex(name: string): Promise<void> {
    const indexDef = this.indexes.get(name);
    if (!indexDef) return;

    // Remove all index entries
    const indexPrefix = `${this.keyPrefix}idx:${name}:`;
    const entries = await this.storage.list({ prefix: indexPrefix });
    await this.storage.delete(Array.from(entries.keys()));

    // Remove index definition
    this.indexes.delete(name);
    await this.storage.delete(this.getMetaKey(`index:${name}`));
  }

  async getIndexes(): Promise<NormalizedIndex[]> {
    const metaPrefix = `${this.keyPrefix}meta:index:`;
    const results = await this.storage.list<IndexDefinition>({ prefix: metaPrefix });

    const indexes: NormalizedIndex[] = [];
    for (const [key, def] of results) {
      const name = key.substring(metaPrefix.length);
      indexes.push({
        name,
        fields: def.fields.map((f) => this.normalizeIndexField(f)),
        unique: def.unique ?? false,
        sparse: false,
      });
    }

    return indexes;
  }

  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  async clear(): Promise<void> {
    const prefix = this.keyPrefix;

    // Get all documents to emit delete events
    const docs = await this.getAll();

    const entries = await this.storage.list({ prefix });
    await this.storage.delete(Array.from(entries.keys()));

    // Emit delete events for all documents
    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }

  private getFieldValue(doc: T, field: string): unknown {
    const parts = field.split('.');
    let value: unknown = doc;

    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = (value as Record<string, unknown>)[part];
    }

    return value;
  }

  private getFieldName(field: string | IndexField): string {
    return typeof field === 'string' ? field : field.field;
  }

  private normalizeIndexField(field: string | IndexField): IndexField {
    return typeof field === 'string' ? { field } : field;
  }
}

/**
 * Durable Objects storage adapter
 */
class DurableObjectStorageAdapter implements StorageAdapter {
  readonly name = 'durable-objects';
  private storage: DurableObjectStorage;
  private stores = new Map<string, DurableObjectDocumentStore<Document>>();
  private keyPrefix: string;

  constructor(config: DurableObjectStorageConfig) {
    this.storage = config.storage;
    this.keyPrefix = config.keyPrefix ?? 'pocket:';
  }

  isAvailable(): boolean {
    return this.storage !== null && this.storage !== undefined;
  }

  async initialize(_config: StorageConfig): Promise<void> {
    // Durable Objects don't require initialization
  }

  async close(): Promise<void> {
    this.stores.clear();
  }

  getStore<T extends Document>(name: string): DocumentStore<T> {
    if (!this.stores.has(name)) {
      this.stores.set(
        name,
        new DurableObjectDocumentStore<Document>(this.storage, name, this.keyPrefix)
      );
    }

    return this.stores.get(name) as unknown as DocumentStore<T>;
  }

  hasStore(name: string): boolean {
    return this.stores.has(name);
  }

  async listStores(): Promise<string[]> {
    // List all unique collection names from stored documents
    const prefix = this.keyPrefix;
    const results = await this.storage.list({ prefix });

    const collections = new Set<string>();
    for (const key of results.keys()) {
      const withoutPrefix = key.substring(prefix.length);
      const colonIndex = withoutPrefix.indexOf(':');
      if (colonIndex > 0) {
        collections.add(withoutPrefix.substring(0, colonIndex));
      }
    }

    return Array.from(collections);
  }

  async deleteStore(name: string): Promise<void> {
    const store = this.getStore(name);
    await store.clear();
    this.stores.delete(name);
  }

  async transaction<R>(
    _storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R> {
    // Durable Objects support transactions
    return this.storage.transaction(async () => {
      return fn();
    });
  }

  async getStats(): Promise<StorageStats> {
    const stores = await this.listStores();
    let documentCount = 0;
    let indexCount = 0;

    for (const storeName of stores) {
      const store = this.getStore(storeName);
      documentCount += await store.count();
      const indexes = await store.getIndexes();
      indexCount += indexes.length;
    }

    return {
      documentCount,
      storeCount: stores.length,
      storageSize: 0, // Durable Objects don't expose size information
      indexCount,
    };
  }
}

/**
 * Create a Durable Objects storage adapter
 *
 * @example
 * ```typescript
 * // In your Durable Object class
 * import { Database } from '@pocket/core';
 * import { createDurableObjectStorage } from '@pocket/storage-edge/durable-objects';
 *
 * export class MyDurableObject {
 *   private db: Database;
 *
 *   constructor(state, env) {
 *     this.db = Database.create({
 *       name: 'my-do',
 *       storage: createDurableObjectStorage({ storage: state.storage }),
 *     });
 *   }
 *
 *   async fetch(request) {
 *     const users = this.db.collection('users');
 *     const allUsers = await users.find().exec();
 *     return new Response(JSON.stringify(allUsers));
 *   }
 * }
 * ```
 */
export function createDurableObjectStorage(config: DurableObjectStorageConfig): StorageAdapter {
  return new DurableObjectStorageAdapter(config);
}
