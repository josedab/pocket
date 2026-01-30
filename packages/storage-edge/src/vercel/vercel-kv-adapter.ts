/**
 * Vercel KV Storage Adapter
 *
 * Implements the StorageAdapter interface for Vercel KV (Redis-based).
 *
 * @module @pocket/storage-edge/vercel
 */

import type {
  Document,
  DocumentStore,
  StorageAdapter,
  StorageConfig,
  StorageStats,
} from '@pocket/core';
import type { VercelKVClient, VercelKVConfig } from '../types.js';
import { VercelKVStore } from './vercel-kv-store.js';

/**
 * Storage adapter backed by Vercel KV.
 *
 * Vercel KV is a durable Redis-based key-value store available on
 * Vercel's Edge and Serverless runtimes.
 *
 * @example
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createVercelKVStorage } from '@pocket/storage-edge/vercel';
 * import { kv } from '@vercel/kv';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createVercelKVStorage({ client: kv }),
 * });
 *
 * const users = db.collection('users');
 * await users.insert({ name: 'Alice' });
 * ```
 */
class VercelKVAdapter implements StorageAdapter {
  readonly name = 'vercel-kv';

  private client: VercelKVClient;
  private stores = new Map<string, VercelKVStore<Document>>();
  private prefix: string;
  private config: VercelKVConfig;

  constructor(config: VercelKVConfig, client: VercelKVClient) {
    this.client = client;
    this.prefix = config.prefix ?? 'pocket:';
    this.config = config;
  }

  isAvailable(): boolean {
    return this.client !== null && this.client !== undefined;
  }

  async initialize(_config: StorageConfig): Promise<void> {
    // Vercel KV is ready to use once a client is provided
  }

  async close(): Promise<void> {
    for (const store of this.stores.values()) {
      store.destroy();
    }
    this.stores.clear();
  }

  getStore<T extends Document>(name: string): DocumentStore<T> {
    if (!this.stores.has(name)) {
      this.stores.set(
        name,
        new VercelKVStore<Document>(
          this.client,
          name,
          this.prefix,
          this.config.serializer
        )
      );
    }
    return this.stores.get(name) as unknown as DocumentStore<T>;
  }

  hasStore(name: string): boolean {
    return this.stores.has(name);
  }

  async listStores(): Promise<string[]> {
    const pattern = `${this.prefix}*`;
    const keys = await this.client.keys(pattern);
    const collections = new Set<string>();

    for (const key of keys) {
      const withoutPrefix = key.substring(this.prefix.length);
      const colonIndex = withoutPrefix.indexOf(':');
      if (colonIndex > 0) {
        collections.add(withoutPrefix.substring(0, colonIndex));
      }
    }

    return Array.from(collections);
  }

  async deleteStore(name: string): Promise<void> {
    // Delete all keys with the store prefix
    const storePrefix = `${this.prefix}${name}:`;
    const pattern = `${storePrefix}*`;
    const keys = await this.client.keys(pattern);

    if (keys.length > 0) {
      await this.client.del(...keys);
    }

    this.stores.delete(name);
  }

  async transaction<R>(
    _storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R> {
    // Vercel KV (Redis) doesn't provide multi-key transactions
    // through the REST API. Execute the function directly.
    return fn();
  }

  async getStats(): Promise<StorageStats> {
    const storeNames = await this.listStores();
    let documentCount = 0;
    let indexCount = 0;

    for (const storeName of storeNames) {
      const store = this.getStore(storeName);
      documentCount += await store.count();
      const indexes = await store.getIndexes();
      indexCount += indexes.length;
    }

    return {
      documentCount,
      storeCount: storeNames.length,
      storageSize: 0, // Vercel KV doesn't expose size information via REST
      indexCount,
    };
  }
}

/**
 * Create a Vercel KV storage adapter.
 *
 * Requires a Vercel KV client instance. You can either pass the `@vercel/kv`
 * default export directly or provide url/token for custom configuration.
 *
 * @param config - Configuration with a pre-configured client or url/token
 * @returns A StorageAdapter backed by Vercel KV
 *
 * @example
 * ```typescript
 * // Using the default @vercel/kv client
 * import { kv } from '@vercel/kv';
 * const storage = createVercelKVStorage({ client: kv });
 *
 * // With custom prefix
 * const storage = createVercelKVStorage({
 *   client: kv,
 *   prefix: 'myapp:',
 * });
 * ```
 */
export function createVercelKVStorage(config: VercelKVConfig): StorageAdapter {
  if (!config.client) {
    throw new Error(
      'createVercelKVStorage: A Vercel KV client is required. ' +
      'Pass { client: kv } from @vercel/kv or provide a compatible client.'
    );
  }
  return new VercelKVAdapter(config, config.client);
}
