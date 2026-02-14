/**
 * @module @pocket/incremental-views/lru-cache
 *
 * LRU (Least Recently Used) eviction cache for materialized views.
 * Automatically evicts the least-recently-accessed views when the cache
 * exceeds its maximum size, freeing memory in applications with many views.
 *
 * @example
 * ```typescript
 * const cache = createViewCache<AggregateResult>({ maxSize: 100 });
 * cache.set('user-stats', { count: 42 });
 * const result = cache.get('user-stats'); // moves to front
 * ```
 */

export interface ViewCacheConfig {
  maxSize: number;
  onEvict?: (key: string, value: unknown) => void;
}

export interface ViewCacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

export interface ViewCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  getStats(): ViewCacheStats;
  keys(): string[];
  size: number;
}

export function createViewCache<T>(config: ViewCacheConfig): ViewCache<T> {
  const cache = new Map<string, T>();
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  function moveToFront(key: string): void {
    const value = cache.get(key);
    if (value !== undefined) {
      cache.delete(key);
      cache.set(key, value);
    }
  }

  function evictLRU(): void {
    if (cache.size <= config.maxSize) return;

    // Map iteration order is insertion order — first key is LRU
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      const value = cache.get(firstKey);
      cache.delete(firstKey);
      evictions++;
      if (config.onEvict) {
        config.onEvict(firstKey, value);
      }
    }
  }

  function get(key: string): T | undefined {
    if (cache.has(key)) {
      hits++;
      moveToFront(key);
      return cache.get(key);
    }
    misses++;
    return undefined;
  }

  function set(key: string, value: T): void {
    if (cache.has(key)) {
      cache.delete(key);
    }
    cache.set(key, value);
    evictLRU();
  }

  function has(key: string): boolean {
    return cache.has(key);
  }

  function del(key: string): boolean {
    return cache.delete(key);
  }

  function clear(): void {
    cache.clear();
  }

  function getStats(): ViewCacheStats {
    const total = hits + misses;
    return {
      size: cache.size,
      maxSize: config.maxSize,
      hits,
      misses,
      evictions,
      hitRate: total > 0 ? hits / total : 0,
    };
  }

  function keys(): string[] {
    return Array.from(cache.keys());
  }

  return {
    get,
    set,
    has,
    delete: del,
    clear,
    getStats,
    keys,
    get size() {
      return cache.size;
    },
  };
}
