/**
 * Base Key-Value Document Store
 *
 * Abstract base class for key-value based storage backends. Subclasses only
 * need to implement the low-level KV primitives (get, set, delete, list) and
 * this base class provides all the higher-level DocumentStore methods.
 *
 * @module @pocket/storage-edge/base-kv-store
 */

import type {
  ChangeEvent,
  ChangeOperation,
  Document,
  DocumentStore,
  IndexDefinition,
  IndexField,
  NormalizedIndex,
  StorageQuery,
} from '@pocket/core';
import { type Observable, Subject } from 'rxjs';
import type { EdgeSerializer } from './types.js';

/**
 * Default JSON serializer used when no custom serializer is provided.
 */
const defaultSerializer: EdgeSerializer = {
  serialize: (value: unknown): string => JSON.stringify(value),
  deserialize: <T>(data: string): T => JSON.parse(data) as T,
};

/**
 * Entry returned from the kvList primitive.
 */
export interface KVListEntry {
  /** The full key */
  key: string;
  /** The raw string value (already serialized) */
  value?: string;
}

/**
 * Abstract base class for key-value based document stores.
 *
 * Subclasses must implement the four abstract KV primitives:
 * - `kvGet(key)` - Get a single value by key
 * - `kvSet(key, value)` - Set a single key-value pair
 * - `kvDelete(key)` - Delete a single key
 * - `kvList(prefix)` - List all keys (and optionally values) with a prefix
 *
 * All higher-level DocumentStore methods (query, bulkPut, etc.) are built
 * on top of these primitives.
 *
 * @typeParam T - The document type stored in this collection
 */
export abstract class BaseKVDocumentStore<T extends Document> implements DocumentStore<T> {
  readonly name: string;

  /** RxJS Subject for emitting change events */
  protected changes$ = new Subject<ChangeEvent<T>>();

  /** Monotonically increasing sequence counter for change ordering */
  protected sequenceCounter = 0;

  /** The serializer to use for document storage */
  protected serializer: EdgeSerializer;

  /** In-memory index definitions (KV stores don't natively support indexes) */
  protected indexDefinitions = new Map<string, NormalizedIndex>();

  /**
   * @param name - The store/collection name
   * @param serializer - Optional custom serializer (defaults to JSON)
   */
  constructor(name: string, serializer?: EdgeSerializer) {
    this.name = name;
    this.serializer = serializer ?? defaultSerializer;
  }

  // -------------------------------------------------------------------------
  // Abstract KV primitives - must be implemented by subclasses
  // -------------------------------------------------------------------------

  /**
   * Get a raw serialized value by key.
   * @returns The serialized string value, or null if not found
   */
  protected abstract kvGet(key: string): Promise<string | null>;

  /**
   * Set a key to a serialized string value.
   */
  protected abstract kvSet(key: string, value: string): Promise<void>;

  /**
   * Delete a single key.
   */
  protected abstract kvDelete(key: string): Promise<void>;

  /**
   * List all entries matching a key prefix.
   *
   * Implementations should return entries with at least the `key` field.
   * If the underlying KV store can return values in the list call, include
   * them to avoid extra round-trips.
   */
  protected abstract kvList(prefix: string): Promise<KVListEntry[]>;

  // -------------------------------------------------------------------------
  // DocumentStore implementation
  // -------------------------------------------------------------------------

  async get(id: string): Promise<T | null> {
    const raw = await this.kvGet(this.docKey(id));
    if (raw === null) return null;
    return this.serializer.deserialize<T>(raw);
  }

  async getMany(ids: string[]): Promise<(T | null)[]> {
    return Promise.all(ids.map((id) => this.get(id)));
  }

  async getAll(): Promise<T[]> {
    const entries = await this.kvList(this.docPrefix());
    const docs: T[] = [];

    for (const entry of entries) {
      if (entry.value !== undefined) {
        docs.push(this.serializer.deserialize<T>(entry.value));
      } else {
        // If list didn't return values, fetch individually
        const raw = await this.kvGet(entry.key);
        if (raw !== null) {
          docs.push(this.serializer.deserialize<T>(raw));
        }
      }
    }

    return docs;
  }

  async put(doc: T): Promise<T> {
    const id = doc._id;
    const existing = await this.get(id);
    const serialized = this.serializer.serialize(doc);

    await this.kvSet(this.docKey(id), serialized);

    const operation: ChangeOperation = existing ? 'update' : 'insert';
    this.emitChange(operation, id, doc, existing ?? undefined);

    return doc;
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
    const existing = await this.get(id);
    if (!existing) return;

    await this.kvDelete(this.docKey(id));
    this.emitChange('delete', id, null, existing);
  }

  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  async query(query: StorageQuery<T>): Promise<T[]> {
    // KV stores do not support native queries, so we fetch everything
    // and filter/sort/paginate in memory.
    let docs = await this.getAll();

    // Apply filter
    if (query.spec.filter) {
      docs = docs.filter((doc) => this.matchesFilter(doc, query.spec.filter!));
    }

    // Apply sort
    if (query.spec.sort && query.spec.sort.length > 0) {
      docs.sort((a, b) => {
        for (const { field, direction } of query.spec.sort!) {
          const aVal = this.getFieldValue(a, field);
          const bVal = this.getFieldValue(b, field);

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

    // Apply skip
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
    if (!query?.spec.filter) {
      const entries = await this.kvList(this.docPrefix());
      return entries.length;
    }
    const docs = await this.query(query);
    return docs.length;
  }

  async createIndex(index: IndexDefinition): Promise<void> {
    const normalized = this.normalizeIndex(index);
    this.indexDefinitions.set(normalized.name, normalized);
    // KV stores manage indexes in-memory only (used as hints)
  }

  async dropIndex(name: string): Promise<void> {
    this.indexDefinitions.delete(name);
  }

  async getIndexes(): Promise<NormalizedIndex[]> {
    return Array.from(this.indexDefinitions.values());
  }

  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  async clear(): Promise<void> {
    const docs = await this.getAll();
    const entries = await this.kvList(this.docPrefix());

    for (const entry of entries) {
      await this.kvDelete(entry.key);
    }

    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }

  // -------------------------------------------------------------------------
  // Key helpers - subclasses can override to change key format
  // -------------------------------------------------------------------------

  /**
   * Get the full key for a document ID.
   * Default format: "doc:{id}"
   */
  protected docKey(id: string): string {
    return `doc:${id}`;
  }

  /**
   * Get the prefix for listing all documents.
   * Default format: "doc:"
   */
  protected docPrefix(): string {
    return 'doc:';
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Emit a change event to subscribers.
   */
  protected emitChange(
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

  /**
   * Simple filter matching for in-memory query execution.
   *
   * Supports direct equality and basic comparison operators ($eq, $ne, $gt,
   * $gte, $lt, $lte, $in, $nin). For full operator support, users should
   * rely on the core QueryExecutor.
   */
  protected matchesFilter(doc: T, filter: Record<string, unknown>): boolean {
    for (const [key, condition] of Object.entries(filter)) {
      // Skip logical operators at the top level for basic matching
      if (key.startsWith('$')) continue;

      const docValue = this.getFieldValue(doc, key);

      if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
        // Operator-based condition
        const ops = condition as Record<string, unknown>;
        for (const [op, opValue] of Object.entries(ops)) {
          switch (op) {
            case '$eq':
              if (docValue !== opValue) return false;
              break;
            case '$ne':
              if (docValue === opValue) return false;
              break;
            case '$gt':
              if (docValue == null || (docValue as number) <= (opValue as number)) return false;
              break;
            case '$gte':
              if (docValue == null || (docValue as number) < (opValue as number)) return false;
              break;
            case '$lt':
              if (docValue == null || (docValue as number) >= (opValue as number)) return false;
              break;
            case '$lte':
              if (docValue == null || (docValue as number) > (opValue as number)) return false;
              break;
            case '$in':
              if (!Array.isArray(opValue) || !opValue.includes(docValue)) return false;
              break;
            case '$nin':
              if (Array.isArray(opValue) && opValue.includes(docValue)) return false;
              break;
            default:
              // Unknown operator, skip
              break;
          }
        }
      } else {
        // Direct equality
        if (docValue !== condition) return false;
      }
    }
    return true;
  }

  /**
   * Extract a value from a document by dot-notation field path.
   */
  protected getFieldValue(doc: unknown, field: string): unknown {
    const parts = field.split('.');
    let value: unknown = doc;

    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = (value as Record<string, unknown>)[part];
    }

    return value;
  }

  /**
   * Normalize an index definition.
   */
  private normalizeIndex(index: IndexDefinition): NormalizedIndex {
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
   * Destroy the store and release resources.
   */
  destroy(): void {
    this.changes$.complete();
    this.indexDefinitions.clear();
  }
}
