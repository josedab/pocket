/**
 * Cloudflare Workers KV Document Store
 *
 * Document store implementation backed by Cloudflare Workers KV.
 *
 * @module @pocket/storage-edge/cloudflare
 */

import type { Document } from '@pocket/core';
import { BaseKVDocumentStore, type KVListEntry } from '../base-kv-store.js';
import type { CloudflareKVNamespace, EdgeSerializer } from '../types.js';

/**
 * Document store backed by Cloudflare Workers KV.
 *
 * KV is a globally distributed key-value store with eventual consistency.
 * It is optimized for high-read, low-write workloads.
 *
 * Key format: "{prefix}{collection}:doc:{id}"
 *
 * @typeParam T - The document type stored in this collection
 */
export class CloudflareKVStore<T extends Document> extends BaseKVDocumentStore<T> {
  private namespace: CloudflareKVNamespace;
  private keyPrefix: string;

  /**
   * @param namespace - Cloudflare KV namespace binding
   * @param collectionName - The collection/store name
   * @param keyPrefix - Global key prefix (e.g. "pocket:")
   * @param serializer - Optional custom serializer
   */
  constructor(
    namespace: CloudflareKVNamespace,
    collectionName: string,
    keyPrefix: string,
    serializer?: EdgeSerializer
  ) {
    super(collectionName, serializer);
    this.namespace = namespace;
    this.keyPrefix = `${keyPrefix}${collectionName}:`;
  }

  // -------------------------------------------------------------------------
  // KV Primitives
  // -------------------------------------------------------------------------

  protected async kvGet(key: string): Promise<string | null> {
    const fullKey = `${this.keyPrefix}${key}`;
    const result = await this.namespace.get(fullKey, { type: 'text' });
    if (result === null || result === undefined) return null;
    return result as string;
  }

  protected async kvSet(key: string, value: string): Promise<void> {
    const fullKey = `${this.keyPrefix}${key}`;
    await this.namespace.put(fullKey, value);
  }

  protected async kvDelete(key: string): Promise<void> {
    const fullKey = `${this.keyPrefix}${key}`;
    await this.namespace.delete(fullKey);
  }

  protected async kvList(prefix: string): Promise<KVListEntry[]> {
    const fullPrefix = `${this.keyPrefix}${prefix}`;
    const entries: KVListEntry[] = [];
    let cursor: string | undefined;

    // Cloudflare KV list is paginated; we must loop to get all keys
    do {
      const result = await this.namespace.list({
        prefix: fullPrefix,
        limit: 1000,
        cursor,
      });

      for (const key of result.keys) {
        entries.push({ key: key.name.substring(this.keyPrefix.length) });
      }

      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor !== undefined);

    return entries;
  }

  // -------------------------------------------------------------------------
  // Overrides for KV-specific key format
  // -------------------------------------------------------------------------

  /**
   * Cloudflare KV list doesn't return values, so we need individual fetches.
   * Override getAll to avoid double prefix application.
   */
  async getAll(): Promise<T[]> {
    const entries = await this.kvList(this.docPrefix());
    const docs: T[] = [];

    // Fetch values individually (KV list only returns keys)
    for (const entry of entries) {
      const raw = await this.kvGet(entry.key);
      if (raw !== null) {
        docs.push(this.serializer.deserialize<T>(raw));
      }
    }

    return docs;
  }
}
