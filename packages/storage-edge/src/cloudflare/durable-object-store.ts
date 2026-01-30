/**
 * Cloudflare Durable Objects Document Store
 *
 * Document store implementation backed by Durable Object storage.
 *
 * @module @pocket/storage-edge/cloudflare
 */

import type { Document } from '@pocket/core';
import { BaseKVDocumentStore, type KVListEntry } from '../base-kv-store.js';
import type { DurableObjectStorageAPI, EdgeSerializer } from '../types.js';

/**
 * Internal wrapper for storing documents with metadata.
 */
interface StoredDocumentWrapper<T extends Document> {
  document: T;
  createdAt: number;
  updatedAt: number;
}

/**
 * Document store backed by Cloudflare Durable Object storage.
 *
 * Durable Objects provide strongly consistent, co-located storage with
 * support for transactions. Each Durable Object instance has its own
 * private storage.
 *
 * Key format: "{prefix}{collection}:doc:{id}"
 *
 * @typeParam T - The document type stored in this collection
 */
export class DurableObjectStore<T extends Document> extends BaseKVDocumentStore<T> {
  private storage: DurableObjectStorageAPI;
  private keyPrefix: string;

  /**
   * @param storage - DurableObjectState.storage reference
   * @param collectionName - The collection/store name
   * @param keyPrefix - Global key prefix (e.g. "pocket:")
   * @param serializer - Optional custom serializer
   */
  constructor(
    storage: DurableObjectStorageAPI,
    collectionName: string,
    keyPrefix: string,
    serializer?: EdgeSerializer
  ) {
    super(collectionName, serializer);
    this.storage = storage;
    this.keyPrefix = `${keyPrefix}${collectionName}:`;
  }

  // -------------------------------------------------------------------------
  // KV Primitives
  // -------------------------------------------------------------------------

  protected async kvGet(key: string): Promise<string | null> {
    const fullKey = `${this.keyPrefix}${key}`;
    const result = await this.storage.get<StoredDocumentWrapper<T>>(fullKey);
    if (result === undefined) return null;
    // Durable Objects store native JS objects, but our base class
    // expects serialized strings. Serialize the document part.
    return this.serializer.serialize(result.document);
  }

  protected async kvSet(key: string, value: string): Promise<void> {
    const fullKey = `${this.keyPrefix}${key}`;
    const doc = this.serializer.deserialize<T>(value);
    const now = Date.now();

    // Try to preserve createdAt from existing record
    const existing = await this.storage.get<StoredDocumentWrapper<T>>(fullKey);

    const wrapper: StoredDocumentWrapper<T> = {
      document: doc,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.storage.put(fullKey, wrapper);
  }

  protected async kvDelete(key: string): Promise<void> {
    const fullKey = `${this.keyPrefix}${key}`;
    await this.storage.delete(fullKey);
  }

  protected async kvList(prefix: string): Promise<KVListEntry[]> {
    const fullPrefix = `${this.keyPrefix}${prefix}`;
    const results = await this.storage.list<StoredDocumentWrapper<T>>({
      prefix: fullPrefix,
    });

    const entries: KVListEntry[] = [];
    for (const [fullKey, wrapper] of results) {
      const key = fullKey.substring(this.keyPrefix.length);
      entries.push({
        key,
        value: this.serializer.serialize(wrapper.document),
      });
    }

    return entries;
  }

  // -------------------------------------------------------------------------
  // Override clear to use Durable Object bulk delete
  // -------------------------------------------------------------------------

  async clear(): Promise<void> {
    const docs = await this.getAll();
    const fullPrefix = this.keyPrefix;
    const results = await this.storage.list({ prefix: fullPrefix });

    const keys = Array.from(results.keys());
    if (keys.length > 0) {
      await this.storage.delete(keys);
    }

    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }

  /**
   * Get the underlying Durable Object storage reference.
   * Useful for advanced operations like direct transactions.
   */
  getStorage(): DurableObjectStorageAPI {
    return this.storage;
  }
}
