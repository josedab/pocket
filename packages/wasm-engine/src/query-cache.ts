/**
 * LRU query result cache with TTL expiration.
 *
 * Caches query results keyed by a hash of the query plan, avoiding
 * re-execution for identical queries within the TTL window.
 */

export interface CacheEntry<T> {
  readonly result: T;
  readonly timestamp: number;
}

export class QueryCache<T = unknown> {
  private readonly cache = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly maxSize = 100,
    private readonly ttlMs = 5000
  ) {}

  /** Generate a cache key from a query plan and document fingerprint. */
  static buildKey(plan: unknown, docCount: number): string {
    return `${docCount}:${JSON.stringify(plan)}`;
  }

  /** Retrieve a cached result, or undefined if expired/missing. */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry.result;
  }

  /** Store a result in the cache. */
  set(key: string, result: T): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, { result, timestamp: Date.now() });
  }

  /** Invalidate all entries (e.g., on data mutation). */
  clear(): void {
    this.cache.clear();
  }

  /** Cache hit rate as a number between 0 and 1. */
  get hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  get size(): number {
    return this.cache.size;
  }
}

export function createQueryCache<T>(maxSize?: number, ttlMs?: number): QueryCache<T> {
  return new QueryCache<T>(maxSize, ttlMs);
}
