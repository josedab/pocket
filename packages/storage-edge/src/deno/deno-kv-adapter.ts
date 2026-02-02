/**
 * Deno KV Storage Adapter
 *
 * Implements the StorageAdapter interface for Deno KV.
 *
 * @module @pocket/storage-edge/deno
 */

import type {
  Document,
  DocumentStore,
  StorageAdapter,
  StorageConfig,
  StorageStats,
} from '@pocket/core';
import type { DenoKVConfig, DenoKv } from '../types.js';
import { DenoKVStore } from './deno-kv-store.js';

/**
 * Accessor for the Deno global, which may not exist in non-Deno runtimes.
 */
declare const Deno: {
  openKv(path?: string): Promise<DenoKv>;
} | undefined;

/**
 * Storage adapter backed by Deno KV.
 *
 * Deno KV is a key-value database built into the Deno runtime with
 * support for atomic operations and secondary indexes. On Deno Deploy,
 * it provides globally replicated persistent storage.
 *
 * @example
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createDenoKVStorage } from '@pocket/storage-edge/deno';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: await createDenoKVStorage(),
 * });
 *
 * const users = db.collection('users');
 * await users.insert({ name: 'Alice' });
 * ```
 */
class DenoKVAdapter implements StorageAdapter {
  readonly name = 'deno-kv';

  private kv: DenoKv | null = null;
  private stores = new Map<string, DenoKVStore<Document>>();
  private prefix: string;
  private config: DenoKVConfig;

  constructor(config: DenoKVConfig, kv?: DenoKv) {
    this.prefix = config.prefix ?? 'pocket';
    this.config = config;
    if (kv) {
      this.kv = kv;
    }
  }

  isAvailable(): boolean {
    return typeof Deno !== 'undefined' && typeof Deno.openKv === 'function';
  }

  async initialize(_config: StorageConfig): Promise<void> {
    if (!this.kv) {
      if (typeof Deno === 'undefined') {
        throw new Error('DenoKVAdapter: Deno runtime is not available');
      }
      this.kv = await Deno.openKv(this.config.path);
    }
  }

  async close(): Promise<void> {
    for (const store of this.stores.values()) {
      store.destroy();
    }
    this.stores.clear();

    if (this.kv) {
      this.kv.close();
      this.kv = null;
    }
  }

  getStore<T extends Document>(name: string): DocumentStore<T> {
    if (!this.kv) {
      throw new Error('DenoKVAdapter: Not initialized. Call initialize() first.');
    }

    if (!this.stores.has(name)) {
      this.stores.set(
        name,
        new DenoKVStore<Document>(
          this.kv,
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
    if (!this.kv) return [];

    // List all keys under our prefix and extract unique collection names
    const collections = new Set<string>();
    const iter = this.kv.list({ prefix: [this.prefix] });

    for await (const entry of iter) {
      // Key format: [prefix, collectionName, ...]
      if (entry.key.length >= 2) {
        collections.add(String(entry.key[1]));
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
    // Deno KV supports atomic operations but not multi-key transactions
    // in the traditional sense. Execute the function directly.
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
      storageSize: 0, // Deno KV doesn't expose size information
      indexCount,
    };
  }
}

/**
 * Create a Deno KV storage adapter.
 *
 * This is an async factory because opening a Deno KV database
 * is asynchronous on Deno Deploy.
 *
 * @param config - Optional configuration (path, prefix, serializer)
 * @returns A StorageAdapter backed by Deno KV
 *
 * @example
 * ```typescript
 * // Default (uses Deno's default KV path)
 * const storage = await createDenoKVStorage();
 *
 * // With a specific database path
 * const storage = await createDenoKVStorage({ path: './data/my-db.sqlite' });
 * ```
 */
export async function createDenoKVStorage(config?: DenoKVConfig): Promise<StorageAdapter> {
  const resolvedConfig = config ?? {};

  if (typeof Deno === 'undefined') {
    throw new Error('createDenoKVStorage: Deno runtime is not available');
  }

  const kv = await Deno.openKv(resolvedConfig.path);
  return new DenoKVAdapter(resolvedConfig, kv);
}
