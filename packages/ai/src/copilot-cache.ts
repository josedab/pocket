/**
 * Copilot response cache with configurable TTL.
 *
 * Caches LLM query results keyed by normalized question text,
 * with configurable TTL eviction and LRU-style size limits.
 *
 * @module copilot-cache
 */

import type { GeneratedQuery } from './smart-query.js';

/** Cache entry */
export interface CopilotCacheEntry {
  readonly question: string;
  readonly normalizedKey: string;
  readonly query: GeneratedQuery;
  readonly cachedAt: number;
  readonly expiresAt: number;
  readonly hitCount: number;
}

/** Cache configuration */
export interface CopilotCacheConfig {
  /** Maximum entries in cache (default: 200) */
  readonly maxEntries?: number;
  /** TTL in milliseconds (default: 300000 = 5 min) */
  readonly ttlMs?: number;
}

/** Cache statistics */
export interface CopilotCacheStats {
  readonly entries: number;
  readonly hits: number;
  readonly misses: number;
  readonly hitRate: number;
  readonly evictions: number;
}

/**
 * TTL cache for copilot query responses.
 *
 * @example
 * ```typescript
 * const cache = new CopilotCache({ ttlMs: 60000, maxEntries: 100 });
 * const cached = cache.get('show incomplete todos');
 * if (cached) return cached.query;
 * cache.set('show incomplete todos', generatedQuery);
 * ```
 */
export class CopilotCache {
  private readonly config: Required<CopilotCacheConfig>;
  private readonly entries = new Map<string, CopilotCacheEntry>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(config: CopilotCacheConfig = {}) {
    this.config = {
      maxEntries: config.maxEntries ?? 200,
      ttlMs: config.ttlMs ?? 300_000,
    };
  }

  /** Get a cached entry by question text */
  get(question: string): CopilotCacheEntry | null {
    const key = this.normalizeKey(question);
    const entry = this.entries.get(key);
    if (!entry) { this.misses++; return null; }
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      this.misses++;
      this.evictions++;
      return null;
    }
    this.hits++;
    const updated: CopilotCacheEntry = { ...entry, hitCount: entry.hitCount + 1 };
    this.entries.set(key, updated);
    return updated;
  }

  /** Store a query result */
  set(question: string, query: GeneratedQuery): void {
    const key = this.normalizeKey(question);
    const now = Date.now();
    if (this.entries.size >= this.config.maxEntries && !this.entries.has(key)) {
      this.evictOldest();
    }
    this.entries.set(key, {
      question, normalizedKey: key, query,
      cachedAt: now, expiresAt: now + this.config.ttlMs, hitCount: 0,
    });
  }

  /** Check if cached (no hit count) */
  has(question: string): boolean {
    const key = this.normalizeKey(question);
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) { this.entries.delete(key); return false; }
    return true;
  }

  /** Invalidate a specific entry */
  invalidate(question: string): boolean {
    return this.entries.delete(this.normalizeKey(question));
  }

  /** Clear all */
  clear(): void { this.entries.clear(); }

  /** Get statistics */
  getStats(): CopilotCacheStats {
    const total = this.hits + this.misses;
    return {
      entries: this.entries.size, hits: this.hits, misses: this.misses,
      hitRate: total > 0 ? Math.round((this.hits / total) * 10000) / 100 : 0,
      evictions: this.evictions,
    };
  }

  /** Prune expired entries */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) { this.entries.delete(key); pruned++; }
    }
    this.evictions += pruned;
    return pruned;
  }

  private normalizeKey(question: string): string {
    return question.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[?.!]+$/, '');
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.cachedAt < oldestTime) { oldestTime = entry.cachedAt; oldestKey = key; }
    }
    if (oldestKey) { this.entries.delete(oldestKey); this.evictions++; }
  }
}

/** Factory function */
export function createCopilotCache(config?: CopilotCacheConfig): CopilotCache {
  return new CopilotCache(config);
}
