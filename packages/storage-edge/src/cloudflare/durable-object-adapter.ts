/**
 * Cloudflare Durable Objects Storage Adapter
 *
 * Implements the StorageAdapter interface for Cloudflare Durable Object storage.
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
import type { DurableObjectConfig, DurableObjectStorageAPI } from '../types.js';
import { DurableObjectStore } from './durable-object-store.js';

/**
 * Storage adapter backed by Cloudflare Durable Object storage.
 *
 * Durable Objects provide strongly consistent, transactional storage
 * that is co-located with compute. Each Durable Object instance has
 * its own private storage namespace.
 *
 * @example
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createDurableObjectStorage } from '@pocket/storage-edge/cloudflare';
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
 *     return new Response(JSON.stringify(await users.find().exec()));
 *   }
 * }
 * ```
 */
class DurableObjectAdapter implements StorageAdapter {
  readonly name = 'durable-objects';

  private storage: DurableObjectStorageAPI;
  private stores = new Map<string, DurableObjectStore<Document>>();
  private prefix: string;
  private config: DurableObjectConfig;

  constructor(config: DurableObjectConfig) {
    this.storage = config.storage;
    this.prefix = config.prefix ?? 'pocket:';
    this.config = config;
  }

  isAvailable(): boolean {
    return this.storage !== null && this.storage !== undefined;
  }

  async initialize(_config: StorageConfig): Promise<void> {
    // Durable Objects don't require initialization
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
        new DurableObjectStore<Document>(
          this.storage,
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
    const results = await this.storage.list({ prefix: this.prefix });
    const collections = new Set<string>();

    for (const key of results.keys()) {
      const withoutPrefix = key.substring(this.prefix.length);
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
    // Durable Objects support native transactions
    return this.storage.transaction(async () => {
      return fn();
    });
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
      storageSize: 0, // DO storage doesn't expose size information
      indexCount,
    };
  }
}

/**
 * Create a Durable Objects storage adapter.
 *
 * @param config - Durable Object config with the storage reference
 * @returns A StorageAdapter backed by Durable Object storage
 *
 * @example
 * ```typescript
 * // In a Durable Object class constructor
 * const storage = createDurableObjectStorage({ storage: state.storage });
 *
 * // With custom prefix
 * const storage = createDurableObjectStorage({
 *   storage: state.storage,
 *   prefix: 'myapp:',
 * });
 * ```
 */
export function createDurableObjectStorage(config: DurableObjectConfig): StorageAdapter {
  return new DurableObjectAdapter(config);
}
