import type { CacheEntry, PrefetchConfig, PrefetchStats } from './types.js';
import { DEFAULT_PREFETCH_CONFIG } from './types.js';

/**
 * LRU cache for prefetched query results with TTL-based expiration.
 */
export class PrefetchCache {
  private readonly config: PrefetchConfig;
  private cache: Map<string, CacheEntry> = new Map();
  private hits = 0;
  private misses = 0;

  constructor(config?: Partial<PrefetchConfig>) {
    this.config = { ...DEFAULT_PREFETCH_CONFIG, ...config };
  }

  /**
   * Get a cached result. Returns undefined if expired or missing.
   * Counts as a hit or miss for stats.
   */
  get<T>(queryHash: string): T[] | undefined {
    const entry = this.cache.get(queryHash);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(queryHash);
      this.misses++;
      return undefined;
    }

    entry.hitCount++;
    this.hits++;

    // Move to end for LRU ordering
    this.cache.delete(queryHash);
    this.cache.set(queryHash, entry);

    return entry.data as T[];
  }

  /**
   * Cache a query result with optional custom TTL.
   */
  set<T>(queryHash: string, data: T[], ttl?: number): void {
    // Evict if at capacity (remove oldest / least-recently-used)
    if (this.cache.size >= this.config.maxCacheSize && !this.cache.has(queryHash)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    const entry: CacheEntry = {
      queryHash,
      data: data as unknown[],
      cachedAt: Date.now(),
      ttl: ttl ?? this.config.ttlMs,
      hitCount: 0,
    };

    // Delete first to reset LRU position
    this.cache.delete(queryHash);
    this.cache.set(queryHash, entry);
  }

  /**
   * Check if a query hash exists in cache and is not expired.
   */
  has(queryHash: string): boolean {
    const entry = this.cache.get(queryHash);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.cache.delete(queryHash);
      return false;
    }
    return true;
  }

  /**
   * Remove a specific entry from cache.
   */
  evict(queryHash: string): void {
    this.cache.delete(queryHash);
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics.
   */
  getStats(): PrefetchStats {
    const total = this.hits + this.misses;
    return {
      cacheHits: this.hits,
      cacheMisses: this.misses,
      totalPredictions: 0,
      accuratePredictions: 0,
      cacheSize: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Remove all expired entries from cache.
   */
  prune(): void {
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
      }
    }
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.cachedAt > entry.ttl;
  }
}

/**
 * Create a new PrefetchCache instance.
 */
export function createPrefetchCache(config?: Partial<PrefetchConfig>): PrefetchCache {
  return new PrefetchCache(config);
}
