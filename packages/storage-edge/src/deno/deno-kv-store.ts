/**
 * Deno KV Document Store
 *
 * Document store implementation backed by Deno KV.
 *
 * @module @pocket/storage-edge/deno
 */

import type { Document } from '@pocket/core';
import { BaseKVDocumentStore, type KVListEntry } from '../base-kv-store.js';
import type { DenoKv, DenoKvKey, EdgeSerializer } from '../types.js';

/**
 * Document store backed by Deno KV.
 *
 * Deno KV is a key-value database built into the Deno runtime. It uses
 * a hierarchical key structure (arrays of key parts) and supports
 * atomic operations.
 *
 * Key format: ["pocket", collection, "doc", id] (or custom prefix)
 *
 * @typeParam T - The document type stored in this collection
 */
export class DenoKVStore<T extends Document> extends BaseKVDocumentStore<T> {
  private kv: DenoKv;
  private baseKey: DenoKvKey;

  /**
   * @param kv - Deno.Kv instance
   * @param collectionName - The collection/store name
   * @param prefix - Key prefix parts (default: ["pocket"])
   * @param serializer - Optional custom serializer
   */
  constructor(
    kv: DenoKv,
    collectionName: string,
    prefix: string,
    serializer?: EdgeSerializer
  ) {
    super(collectionName, serializer);
    this.kv = kv;
    this.baseKey = [prefix, collectionName];
  }

  // -------------------------------------------------------------------------
  // KV Primitives
  // -------------------------------------------------------------------------

  protected async kvGet(key: string): Promise<string | null> {
    const kvKey = this.toDenoKey(key);
    const result = await this.kv.get<string>(kvKey);
    if (result.value === null) return null;
    return result.value;
  }

  protected async kvSet(key: string, value: string): Promise<void> {
    const kvKey = this.toDenoKey(key);
    await this.kv.set(kvKey, value);
  }

  protected async kvDelete(key: string): Promise<void> {
    const kvKey = this.toDenoKey(key);
    await this.kv.delete(kvKey);
  }

  protected async kvList(prefix: string): Promise<KVListEntry[]> {
    const kvPrefix = this.toDenoKey(prefix);
    const entries: KVListEntry[] = [];

    const iter = this.kv.list<string>({ prefix: kvPrefix });
    for await (const entry of iter) {
      // Convert the Deno key back to our internal key format
      const keyParts = entry.key.slice(this.baseKey.length);
      const internalKey = keyParts.map(String).join(':');
      entries.push({
        key: internalKey,
        value: entry.value ?? undefined,
      });
    }

    return entries;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert an internal key string (e.g. "doc:my-id") to a Deno KV key array.
   * The internal key is split by ":" and appended to the base key.
   */
  private toDenoKey(key: string): DenoKvKey {
    const parts = key.split(':');
    return [...this.baseKey, ...parts];
  }
}
