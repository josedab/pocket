import type { Document } from '../types/document.js';

/**
 * Configuration for the query result cache.
 */
export interface QueryCacheConfig {
  /** Maximum number of cached entries (default: 200) */
  maxSize?: number;
  /** Default TTL in milliseconds (default: 30000 — 30s) */
  defaultTTL?: number;
  /** Whether to invalidate on any write to the collection (default: true) */
  invalidateOnWrite?: boolean;
}

interface CacheEntry<T> {
  results: T[];
  createdAt: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
}

/**
 * LRU query result cache with TTL-based expiration.
 *
 * Caches query results keyed by a serialized query spec. Entries are evicted
 * using LRU policy when the cache is full, and expire after their TTL.
 *
 * @typeParam T - The document type
 */
export class QueryCache<T extends Document = Document> {
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly config: Required<QueryCacheConfig>;
  private hits = 0;
  private misses = 0;

  constructor(config: QueryCacheConfig = {}) {
    this.config = {
      maxSize: config.maxSize ?? 200,
      defaultTTL: config.defaultTTL ?? 30_000,
      invalidateOnWrite: config.invalidateOnWrite ?? true,
    };
  }

  /**
   * Get cached results for a query key.
   * Returns undefined on cache miss or expired entry.
   */
  get(key: string): T[] | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() - entry.createdAt > entry.ttl) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    // Move to end (most recently used) by re-inserting
    this.cache.delete(key);
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    this.cache.set(key, entry);
    this.hits++;

    return entry.results;
  }

  /**
   * Store query results in the cache.
   */
  set(key: string, results: T[], ttl?: number): void {
    // Evict LRU entries if at capacity
    while (this.cache.size >= this.config.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      } else {
        break;
      }
    }

    this.cache.set(key, {
      results,
      createdAt: Date.now(),
      ttl: ttl ?? this.config.defaultTTL,
      accessCount: 0,
      lastAccessed: Date.now(),
    });
  }

  /**
   * Invalidate all entries for a specific collection.
   */
  invalidateCollection(collection: string): void {
    for (const [key] of this.cache) {
      if (key.startsWith(`${collection}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidate a specific cache entry.
   */
  invalidate(key: string): void {
    this.cache.delete(key);
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
  getStats(): QueryCacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Remove expired entries proactively.
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > entry.ttl) {
        this.cache.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Build a cache key from collection name and query specification.
   */
  static buildKey(collection: string, querySpec: Record<string, unknown>): string {
    return `${collection}:${stableStringify(querySpec)}`;
  }
}

/**
 * Cache statistics.
 */
export interface QueryCacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
}

/**
 * Create a new QueryCache instance.
 */
export function createQueryCache<T extends Document = Document>(
  config?: QueryCacheConfig,
): QueryCache<T> {
  return new QueryCache<T>(config);
}

/**
 * Deterministic JSON serialization for cache keys.
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return String(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}
