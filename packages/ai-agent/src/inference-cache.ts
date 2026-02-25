/**
 * Inference Cache — caches AI responses to avoid redundant LLM calls.
 *
 * Uses content-addressable hashing of prompts to provide instant
 * responses for previously-seen queries, dramatically reducing
 * latency and API costs for repeated patterns.
 */

import { BehaviorSubject } from 'rxjs';

/** A cached inference result. */
interface CacheEntry {
  readonly response: string;
  readonly timestamp: number;
  readonly hitCount: number;
  readonly promptHash: string;
}

/** Cache statistics. */
export interface InferenceCacheStats {
  readonly entries: number;
  readonly hits: number;
  readonly misses: number;
  readonly hitRate: number;
  readonly totalSavedMs: number;
  readonly avgResponseTimeMs: number;
}

/** Configuration for the inference cache. */
export interface InferenceCacheConfig {
  /** Maximum number of cached responses. Defaults to 500. */
  readonly maxEntries?: number;
  /** Cache TTL in milliseconds. Defaults to 3600000 (1 hour). */
  readonly ttlMs?: number;
  /** Whether to use fuzzy matching for similar prompts. Defaults to false. */
  readonly fuzzyMatch?: boolean;
  /** Similarity threshold for fuzzy matching (0-1). Defaults to 0.9. */
  readonly similarityThreshold?: number;
}

/** Simple string hash for cache keys. */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

/** Normalized prompt for comparison (lowercase, trimmed, collapsed whitespace). */
function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Jaccard similarity for fuzzy matching. */
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(' '));
  const setB = new Set(b.split(' '));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

export class InferenceCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly config: Required<InferenceCacheConfig>;
  private hits = 0;
  private misses = 0;
  private totalSavedMs = 0;
  private readonly stats$: BehaviorSubject<InferenceCacheStats>;

  constructor(config: InferenceCacheConfig = {}) {
    this.config = {
      maxEntries: config.maxEntries ?? 500,
      ttlMs: config.ttlMs ?? 3_600_000,
      fuzzyMatch: config.fuzzyMatch ?? false,
      similarityThreshold: config.similarityThreshold ?? 0.9,
    };
    this.stats$ = new BehaviorSubject<InferenceCacheStats>(this.buildStats());
  }

  /**
   * Look up a cached response for a prompt.
   *
   * @param prompt The user prompt to look up
   * @param estimatedLatencyMs Estimated LLM latency saved on cache hit
   * @returns Cached response or undefined
   */
  get(prompt: string, estimatedLatencyMs = 500): string | undefined {
    const normalized = normalizePrompt(prompt);
    const hash = hashString(normalized);

    // Exact match
    const exact = this.cache.get(hash);
    if (exact && Date.now() - exact.timestamp <= this.config.ttlMs) {
      this.hits++;
      this.totalSavedMs += estimatedLatencyMs;
      this.cache.set(hash, { ...exact, hitCount: exact.hitCount + 1 });
      this.emitStats();
      return exact.response;
    }

    // Fuzzy match
    if (this.config.fuzzyMatch) {
      for (const [key, entry] of this.cache) {
        if (Date.now() - entry.timestamp > this.config.ttlMs) continue;
        const storedNormalized = normalizePrompt(entry.promptHash);
        const similarity = jaccardSimilarity(normalized, storedNormalized);
        if (similarity >= this.config.similarityThreshold) {
          this.hits++;
          this.totalSavedMs += estimatedLatencyMs;
          this.cache.set(key, { ...entry, hitCount: entry.hitCount + 1 });
          this.emitStats();
          return entry.response;
        }
      }
    }

    this.misses++;
    this.emitStats();
    return undefined;
  }

  /** Store a response in the cache. */
  set(prompt: string, response: string): void {
    const normalized = normalizePrompt(prompt);
    const hash = hashString(normalized);

    // Evict oldest if at capacity
    if (this.cache.size >= this.config.maxEntries && !this.cache.has(hash)) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [key, entry] of this.cache) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      }
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(hash, {
      response,
      timestamp: Date.now(),
      hitCount: 0,
      promptHash: normalized,
    });
  }

  /** Invalidate all cached entries. */
  clear(): void {
    this.cache.clear();
    this.emitStats();
  }

  /** Invalidate entries matching a prompt pattern. */
  invalidateMatching(pattern: string): number {
    const normalized = normalizePrompt(pattern);
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (entry.promptHash.includes(normalized)) {
        this.cache.delete(key);
        removed++;
      }
    }
    this.emitStats();
    return removed;
  }

  /** Observable of cache statistics. */
  get stats() {
    return this.stats$.asObservable();
  }

  /** Current statistics snapshot. */
  getStats(): InferenceCacheStats {
    return this.buildStats();
  }

  /** Shut down. */
  destroy(): void {
    this.stats$.complete();
  }

  private buildStats(): InferenceCacheStats {
    const total = this.hits + this.misses;
    return {
      entries: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      totalSavedMs: this.totalSavedMs,
      avgResponseTimeMs: this.hits > 0 ? this.totalSavedMs / this.hits : 0,
    };
  }

  private emitStats(): void {
    this.stats$.next(this.buildStats());
  }
}

export function createInferenceCache(config?: InferenceCacheConfig): InferenceCache {
  return new InferenceCache(config);
}
