/**
 * Cloudflare Workers KV Storage Adapter
 *
 * Implements the StorageAdapter interface for Cloudflare Workers KV.
 *
 * @module @pocket/storage-edge/cloudflare
 */

import type {
  Document,
  DocumentStore,
  StorageAdapter,
  StorageConfig,
  StorageStats,
} from '@pocket/core';
import type { CloudflareKVConfig, CloudflareKVNamespace } from '../types.js';
import { CloudflareKVStore } from './cloudflare-store.js';

/**
 * Storage adapter backed by Cloudflare Workers KV.
 *
 * Cloudflare KV is a globally distributed, eventually consistent key-value
 * store. It is ideal for read-heavy workloads at the edge.
 *
 * @example
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createCloudflareKVStorage } from '@pocket/storage-edge/cloudflare';
 *
 * export default {
 *   async fetch(request, env) {
 *     const db = await Database.create({
 *       name: 'my-app',
 *       storage: createCloudflareKVStorage(env.MY_KV_NAMESPACE),
 *     });
 *     const users = db.collection('users');
 *     return new Response(JSON.stringify(await users.find().exec()));
 *   },
 * };
 * ```
 */
class CloudflareKVAdapter implements StorageAdapter {
  readonly name = 'cloudflare-kv';

  private namespace: CloudflareKVNamespace;
  private stores = new Map<string, CloudflareKVStore<Document>>();
  private prefix: string;
  private config: CloudflareKVConfig;

  constructor(config: CloudflareKVConfig) {
    this.namespace = config.namespace;
    this.prefix = config.prefix ?? 'pocket:';
    this.config = config;
  }

  isAvailable(): boolean {
    return this.namespace !== null && this.namespace !== undefined;
  }

  async initialize(_config: StorageConfig): Promise<void> {
    // KV doesn't require initialization
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
        new CloudflareKVStore<Document>(
          this.namespace,
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
    // List all keys with our prefix and extract unique collection names
    const result = await this.namespace.list({ prefix: this.prefix, limit: 1000 });
    const collections = new Set<string>();

    for (const key of result.keys) {
      const withoutPrefix = key.name.substring(this.prefix.length);
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
    // Cloudflare KV does not support transactions.
    // Operations are eventually consistent at the key level.
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
      storageSize: 0, // KV doesn't expose storage size
      indexCount,
    };
  }
}

/**
 * Create a Cloudflare Workers KV storage adapter.
 *
 * @param namespace - The KV namespace binding, or a full config object
 * @returns A StorageAdapter backed by Cloudflare Workers KV
 *
 * @example
 * ```typescript
 * // Simple usage with just the namespace binding
 * const storage = createCloudflareKVStorage(env.MY_KV);
 *
 * // With full config
 * const storage = createCloudflareKVStorage({
 *   namespace: env.MY_KV,
 *   prefix: 'myapp:',
 * });
 * ```
 */
export function createCloudflareKVStorage(
  namespace: CloudflareKVNamespace | CloudflareKVConfig
): StorageAdapter {
  const config: CloudflareKVConfig =
    'namespace' in namespace ? namespace : { namespace };
  return new CloudflareKVAdapter(config);
}
