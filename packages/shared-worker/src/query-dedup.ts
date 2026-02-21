/**
 * @module @pocket/shared-worker
 * Query deduplication with TTL-based cache expiration.
 */

import type {
  QueryDeduplicationConfig,
  QueryDeduplicationEntry,
  QueryDeduplicationStats,
} from './types.js';

export interface QueryDeduplicator {
  deduplicate<T>(queryHash: string, executeFn: () => Promise<T>): Promise<T>;
  invalidate(queryHash: string): void;
  invalidateAll(): void;
  getStats(): QueryDeduplicationStats;
}

export function createWorkerQueryDedup(config: QueryDeduplicationConfig): QueryDeduplicator {
  const cache = new Map<string, QueryDeduplicationEntry>();
  const inflight = new Map<string, Promise<unknown>>();
  let cacheHits = 0;
  let cacheMisses = 0;

  function isExpired(entry: QueryDeduplicationEntry): boolean {
    return Date.now() - entry.timestamp > config.ttlMs;
  }

  function cleanup(): void {
    for (const [hash, entry] of cache) {
      if (isExpired(entry)) {
        cache.delete(hash);
      }
    }
  }

  async function deduplicate<T>(queryHash: string, executeFn: () => Promise<T>): Promise<T> {
    cleanup();

    const cached = cache.get(queryHash);
    if (cached && !isExpired(cached)) {
      cacheHits++;
      cached.refCount++;
      cache.set(queryHash, cached);
      return cached.result as T;
    }

    const existing = inflight.get(queryHash);
    if (existing) {
      cacheHits++;
      return existing as Promise<T>;
    }

    cacheMisses++;

    const promise = executeFn().then((result) => {
      cache.set(queryHash, {
        queryHash,
        result,
        timestamp: Date.now(),
        refCount: 1,
      });
      inflight.delete(queryHash);
      return result;
    });

    inflight.set(queryHash, promise);
    return promise;
  }

  function invalidate(queryHash: string): void {
    cache.delete(queryHash);
    inflight.delete(queryHash);
  }

  function invalidateAll(): void {
    cache.clear();
    inflight.clear();
  }

  function getStats(): QueryDeduplicationStats {
    cleanup();
    return {
      cacheHits,
      cacheMisses,
      cacheSize: cache.size,
    };
  }

  return {
    deduplicate,
    invalidate,
    invalidateAll,
    getStats,
  };
}
