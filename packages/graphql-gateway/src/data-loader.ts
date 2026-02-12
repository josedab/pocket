/**
 * @module data-loader
 *
 * DataLoader integration for the GraphQL gateway.
 * Batches and caches per-request data fetches to prevent N+1 query problems
 * in nested resolvers.
 *
 * @example
 * ```typescript
 * import { createDataLoaderRegistry } from '@pocket/graphql-gateway';
 *
 * const registry = createDataLoaderRegistry({
 *   defaultBatchSize: 50,
 * });
 *
 * // Register a loader with a batch function
 * registry.registerLoader('users', async (ids) => {
 *   return db.users.findMany({ where: { id: { in: ids } } });
 * });
 *
 * // Load individual items — automatically batched
 * const user = await registry.load('users', 'user-1');
 * const users = await registry.loadMany('users', ['user-1', 'user-2']);
 *
 * // Clear cache between requests
 * registry.clearAll();
 * ```
 */

/** Configuration for the DataLoader registry. */
export interface DataLoaderConfig {
  /** Maximum number of keys batched in a single call (default: 100). */
  defaultBatchSize?: number;
  /** Whether caching is enabled by default (default: true). */
  enableCaching?: boolean;
}

/**
 * A batch-loading function that receives an array of keys and must return
 * results in the same order (or `null`/`undefined` for missing items).
 */
export type BatchLoadFn<T = unknown> = (
  keys: string[],
) => Promise<(T | null | undefined)[]>;

/** Per-loader configuration overrides. */
export interface LoaderOptions {
  /** Maximum batch size for this loader. */
  batchSize?: number;
  /** Whether caching is enabled for this loader. */
  caching?: boolean;
}

/** Statistics for a single loader. */
export interface LoaderStats {
  collection: string;
  loads: number;
  batchCalls: number;
  cacheHits: number;
  cacheMisses: number;
  cacheSize: number;
}

/** Internal state for one registered loader. */
interface LoaderEntry<T = unknown> {
  batchFn: BatchLoadFn<T>;
  options: Required<LoaderOptions>;
  cache: Map<string, T | null>;
  pendingKeys: Map<string, {
    resolve: (value: T | null) => void;
    reject: (reason: unknown) => void;
  }[]>;
  stats: {
    loads: number;
    batchCalls: number;
    cacheHits: number;
    cacheMisses: number;
  };
  scheduledFlush: boolean;
}

const DEFAULT_BATCH_SIZE = 100;

/**
 * Registry of per-collection DataLoaders that batch and cache lookups
 * within a single request lifecycle.
 */
export class DataLoaderRegistry {
  private readonly config: Required<DataLoaderConfig>;
  private readonly loaders = new Map<string, LoaderEntry>();

  constructor(config: DataLoaderConfig = {}) {
    this.config = {
      defaultBatchSize: config.defaultBatchSize ?? DEFAULT_BATCH_SIZE,
      enableCaching: config.enableCaching ?? true,
    };
  }

  /**
   * Register a batch-loading function for a collection.
   * If a loader is already registered for the collection, it is replaced.
   */
  registerLoader<T = unknown>(
    collection: string,
    batchFn: BatchLoadFn<T>,
    options?: LoaderOptions,
  ): void {
    const entry: LoaderEntry<T> = {
      batchFn,
      options: {
        batchSize: options?.batchSize ?? this.config.defaultBatchSize,
        caching: options?.caching ?? this.config.enableCaching,
      },
      cache: new Map(),
      pendingKeys: new Map(),
      stats: { loads: 0, batchCalls: 0, cacheHits: 0, cacheMisses: 0 },
      scheduledFlush: false,
    };
    this.loaders.set(collection, entry as LoaderEntry);
  }

  /**
   * Load a single item by key. Multiple calls within the same tick are
   * automatically batched into a single invocation of the batch function.
   */
  async load<T = unknown>(
    collection: string,
    key: string,
  ): Promise<T | null> {
    const entry = this.getEntry(collection);
    entry.stats.loads++;

    // Cache check
    if (entry.options.caching && entry.cache.has(key)) {
      entry.stats.cacheHits++;
      return entry.cache.get(key) as T | null;
    }

    entry.stats.cacheMisses++;

    return new Promise<T | null>((resolve, reject) => {
      const existing = entry.pendingKeys.get(key);
      if (existing) {
        existing.push({ resolve: resolve as (v: unknown | null) => void, reject });
      } else {
        entry.pendingKeys.set(key, [{ resolve: resolve as (v: unknown | null) => void, reject }]);
      }

      this.scheduleFlush(collection, entry);
    });
  }

  /**
   * Load multiple items by key. Delegates to {@link load} for batching.
   */
  async loadMany<T = unknown>(
    collection: string,
    keys: string[],
  ): Promise<(T | null)[]> {
    return Promise.all(keys.map((k) => this.load<T>(collection, k)));
  }

  /** Clear the cache for a specific collection loader. */
  clearCache(collection: string): void {
    const entry = this.loaders.get(collection);
    if (entry) {
      entry.cache.clear();
    }
  }

  /** Clear all caches across every registered loader. */
  clearAll(): void {
    for (const entry of this.loaders.values()) {
      entry.cache.clear();
    }
  }

  /** Return statistics for a specific loader. */
  getStats(collection: string): LoaderStats {
    const entry = this.getEntry(collection);
    return {
      collection,
      loads: entry.stats.loads,
      batchCalls: entry.stats.batchCalls,
      cacheHits: entry.stats.cacheHits,
      cacheMisses: entry.stats.cacheMisses,
      cacheSize: entry.cache.size,
    };
  }

  /** Return statistics for all registered loaders. */
  getAllStats(): LoaderStats[] {
    return Array.from(this.loaders.keys()).map((c) => this.getStats(c));
  }

  /** Return the names of all registered loaders. */
  getRegisteredCollections(): string[] {
    return Array.from(this.loaders.keys());
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                    */
  /* ------------------------------------------------------------------ */

  private getEntry(collection: string): LoaderEntry {
    const entry = this.loaders.get(collection);
    if (!entry) {
      throw new Error(
        `DataLoader: no loader registered for collection "${collection}"`,
      );
    }
    return entry;
  }

  private scheduleFlush(collection: string, entry: LoaderEntry): void {
    if (entry.scheduledFlush) return;
    entry.scheduledFlush = true;

    // Use queueMicrotask to batch all loads within the same tick
    queueMicrotask(() => {
      void this.flush(collection, entry);
    });
  }

  private async flush(collection: string, entry: LoaderEntry): Promise<void> {
    entry.scheduledFlush = false;
    const pending = new Map(entry.pendingKeys);
    entry.pendingKeys.clear();

    if (pending.size === 0) return;

    const allKeys = Array.from(pending.keys());

    // Split into batches
    const batchSize = entry.options.batchSize;
    for (let i = 0; i < allKeys.length; i += batchSize) {
      const batchKeys = allKeys.slice(i, i + batchSize);
      entry.stats.batchCalls++;

      try {
        const results = await entry.batchFn(batchKeys);

        for (let j = 0; j < batchKeys.length; j++) {
          const key = batchKeys[j]!;
          const value = (results[j] ?? null) as unknown | null;

          if (entry.options.caching) {
            entry.cache.set(key, value);
          }

          const callbacks = pending.get(key);
          if (callbacks) {
            for (const cb of callbacks) {
              cb.resolve(value);
            }
          }
        }
      } catch (err) {
        // Reject all promises in this batch
        for (const key of batchKeys) {
          const callbacks = pending.get(key);
          if (callbacks) {
            for (const cb of callbacks) {
              cb.reject(err);
            }
          }
        }
      }
    }

    // If collection string is unused, suppress the lint error
    void collection;
  }
}

/** Factory function to create a {@link DataLoaderRegistry}. */
export function createDataLoaderRegistry(
  config: DataLoaderConfig = {},
): DataLoaderRegistry {
  return new DataLoaderRegistry(config);
}
