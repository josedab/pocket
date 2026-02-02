/**
 * Vercel KV Document Store
 *
 * Document store implementation backed by Vercel KV (Redis-based).
 *
 * @module @pocket/storage-edge/vercel
 */

import type { Document } from '@pocket/core';
import { BaseKVDocumentStore, type KVListEntry } from '../base-kv-store.js';
import type { EdgeSerializer, VercelKVClient } from '../types.js';

/**
 * Document store backed by Vercel KV.
 *
 * Vercel KV is a Redis-based key-value store accessible from Vercel
 * Edge Functions and Serverless Functions. It provides durable,
 * low-latency storage.
 *
 * Key format: "{prefix}{collection}:doc:{id}"
 *
 * @typeParam T - The document type stored in this collection
 */
export class VercelKVStore<T extends Document> extends BaseKVDocumentStore<T> {
  private client: VercelKVClient;
  private keyPrefix: string;

  /**
   * @param client - Vercel KV client instance
   * @param collectionName - The collection/store name
   * @param keyPrefix - Global key prefix (e.g. "pocket:")
   * @param serializer - Optional custom serializer
   */
  constructor(
    client: VercelKVClient,
    collectionName: string,
    keyPrefix: string,
    serializer?: EdgeSerializer
  ) {
    super(collectionName, serializer);
    this.client = client;
    this.keyPrefix = `${keyPrefix}${collectionName}:`;
  }

  // -------------------------------------------------------------------------
  // KV Primitives
  // -------------------------------------------------------------------------

  protected async kvGet(key: string): Promise<string | null> {
    const fullKey = `${this.keyPrefix}${key}`;
    const result = await this.client.get<string>(fullKey);
    if (result === null || result === undefined) return null;
    // Vercel KV may auto-deserialize JSON; ensure we have a string
    if (typeof result === 'string') return result;
    return JSON.stringify(result);
  }

  protected async kvSet(key: string, value: string): Promise<void> {
    const fullKey = `${this.keyPrefix}${key}`;
    await this.client.set(fullKey, value);
  }

  protected async kvDelete(key: string): Promise<void> {
    const fullKey = `${this.keyPrefix}${key}`;
    await this.client.del(fullKey);
  }

  protected async kvList(prefix: string): Promise<KVListEntry[]> {
    const fullPrefix = `${this.keyPrefix}${prefix}`;
    // Vercel KV uses Redis KEYS command with glob patterns
    const pattern = `${fullPrefix}*`;
    const keys = await this.client.keys(pattern);

    return keys.map((key) => ({
      key: key.substring(this.keyPrefix.length),
    }));
  }

  // -------------------------------------------------------------------------
  // Override getMany for efficiency using Redis MGET
  // -------------------------------------------------------------------------

  async getMany(ids: string[]): Promise<(T | null)[]> {
    if (ids.length === 0) return [];

    const fullKeys = ids.map((id) => `${this.keyPrefix}${this.docKey(id)}`);
    const results = await this.client.mget<string>(...fullKeys);

    return results.map((raw) => {
      if (raw === null || raw === undefined) return null;
      const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
      return this.serializer.deserialize<T>(value);
    });
  }

  // -------------------------------------------------------------------------
  // Override getAll for efficiency
  // -------------------------------------------------------------------------

  async getAll(): Promise<T[]> {
    const entries = await this.kvList(this.docPrefix());
    if (entries.length === 0) return [];

    // Use MGET for bulk fetch
    const fullKeys = entries.map((e) => `${this.keyPrefix}${e.key}`);
    const results = await this.client.mget<string>(...fullKeys);

    const docs: T[] = [];
    for (const raw of results) {
      if (raw !== null && raw !== undefined) {
        const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
        docs.push(this.serializer.deserialize<T>(value));
      }
    }

    return docs;
  }
}
