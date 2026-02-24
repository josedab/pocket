/**
 * SmartPrefetchEngine — ML-trained query pattern prediction with background prefetch.
 *
 * Observes query patterns, builds a Markov chain prediction model,
 * and pre-fetches data the user is likely to need next.
 */

import type { PrefetchConfig, PrefetchStats, QueryPattern } from './types.js';
import { DEFAULT_PREFETCH_CONFIG } from './types.js';

// ── Types ──────────────────────────────────────────────────

export interface MarkovTransition {
  fromHash: string;
  toHash: string;
  count: number;
  probability: number;
}

export interface SmartPrefetchConfig extends Partial<PrefetchConfig> {
  /** Min transitions before making predictions (default: 3) */
  minTransitions?: number;
  /** Max prefetch queries per cycle (default: 3) */
  maxPrefetchPerCycle?: number;
  /** Budget: max prefetches per minute (default: 20) */
  prefetchBudgetPerMinute?: number;
}

export interface SmartPrefetchStats extends PrefetchStats {
  modelSize: number;
  transitionCount: number;
  prefetchesThisMinute: number;
  topPredictions: { queryHash: string; confidence: number }[];
}

// ── Markov Chain Model ────────────────────────────────────

class MarkovModel {
  private readonly transitions = new Map<string, Map<string, number>>();
  private totalTransitions = 0;

  record(from: string, to: string): void {
    let targets = this.transitions.get(from);
    if (!targets) {
      targets = new Map();
      this.transitions.set(from, targets);
    }
    targets.set(to, (targets.get(to) ?? 0) + 1);
    this.totalTransitions++;
  }

  predict(from: string, topK: number): { hash: string; confidence: number }[] {
    const targets = this.transitions.get(from);
    if (!targets) return [];

    let total = 0;
    for (const count of targets.values()) total += count;

    const predictions: { hash: string; confidence: number }[] = [];
    for (const [hash, count] of targets) {
      predictions.push({ hash, confidence: count / total });
    }

    return predictions.sort((a, b) => b.confidence - a.confidence).slice(0, topK);
  }

  get size(): number {
    return this.transitions.size;
  }
  get transitionCount(): number {
    return this.totalTransitions;
  }

  getTransitions(): MarkovTransition[] {
    const result: MarkovTransition[] = [];
    for (const [from, targets] of this.transitions) {
      let total = 0;
      for (const count of targets.values()) total += count;
      for (const [to, count] of targets) {
        result.push({ fromHash: from, toHash: to, count, probability: count / total });
      }
    }
    return result;
  }
}

// ── Smart Prefetch Engine ─────────────────────────────────

export class SmartPrefetchEngine {
  private readonly config: Required<SmartPrefetchConfig>;
  private readonly model = new MarkovModel();
  private readonly patterns = new Map<string, QueryPattern>();
  private readonly cache = new Map<string, { data: unknown[]; cachedAt: number }>();

  private lastQueryHash: string | null = null;
  private cacheHits = 0;
  private cacheMisses = 0;
  private prefetchesThisMinute = 0;
  private minuteResetTimer: ReturnType<typeof setInterval> | null = null;
  private prefetchTimer: ReturnType<typeof setInterval> | null = null;
  private prefetchCallback: ((pattern: QueryPattern) => Promise<unknown[] | undefined>) | null =
    null;

  constructor(config: SmartPrefetchConfig = {}) {
    this.config = {
      ...DEFAULT_PREFETCH_CONFIG,
      ...config,
      minTransitions: config.minTransitions ?? 3,
      maxPrefetchPerCycle: config.maxPrefetchPerCycle ?? 3,
      prefetchBudgetPerMinute: config.prefetchBudgetPerMinute ?? 20,
    };
  }

  /**
   * Start the prefetch engine with a callback for fetching data.
   */
  start(callback: (pattern: QueryPattern) => Promise<unknown[] | undefined>): void {
    this.prefetchCallback = callback;

    this.prefetchTimer = setInterval(() => {
      void this.prefetchCycle();
    }, this.config.idleDelayMs);

    this.minuteResetTimer = setInterval(() => {
      this.prefetchesThisMinute = 0;
    }, 60000);
  }

  /**
   * Stop the prefetch engine.
   */
  stop(): void {
    if (this.prefetchTimer) {
      clearInterval(this.prefetchTimer);
      this.prefetchTimer = null;
    }
    if (this.minuteResetTimer) {
      clearInterval(this.minuteResetTimer);
      this.minuteResetTimer = null;
    }
    this.prefetchCallback = null;
  }

  /**
   * Record a query execution and update the prediction model.
   */
  recordQuery(
    collection: string,
    filter: Record<string, unknown>,
    executionMs: number,
    result?: unknown[]
  ): void {
    const hash = this.hashQuery(collection, filter);

    // Update pattern
    const existing = this.patterns.get(hash);
    if (existing) {
      existing.frequency++;
      existing.lastAccessed = Date.now();
      existing.avgExecutionMs =
        (existing.avgExecutionMs * (existing.frequency - 1) + executionMs) / existing.frequency;
    } else {
      this.patterns.set(hash, {
        queryHash: hash,
        collection,
        filter: { ...filter },
        frequency: 1,
        lastAccessed: Date.now(),
        avgExecutionMs: executionMs,
      });
    }

    // Update Markov model
    if (this.lastQueryHash) {
      this.model.record(this.lastQueryHash, hash);
    }
    this.lastQueryHash = hash;

    // Cache result
    if (result) {
      this.cache.set(hash, { data: result, cachedAt: Date.now() });
    }

    // Track cache accuracy
    if (this.cache.has(hash)) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
  }

  /**
   * Get a cached result if available.
   */
  getCached(collection: string, filter: Record<string, unknown>): unknown[] | null {
    const hash = this.hashQuery(collection, filter);
    const entry = this.cache.get(hash);

    if (!entry) return null;
    if (Date.now() - entry.cachedAt > this.config.ttlMs) {
      this.cache.delete(hash);
      return null;
    }

    return entry.data;
  }

  /**
   * Get predictions for what query will be executed next.
   */
  getPredictions(): { pattern: QueryPattern; confidence: number }[] {
    if (!this.lastQueryHash || this.model.transitionCount < this.config.minTransitions) {
      return [];
    }

    const predictions = this.model.predict(this.lastQueryHash, this.config.maxPredictions);
    return predictions
      .filter((p) => p.confidence >= this.config.confidenceThreshold)
      .map((p) => ({
        pattern: this.patterns.get(p.hash)!,
        confidence: p.confidence,
      }))
      .filter((p) => p.pattern !== undefined);
  }

  /**
   * Get engine statistics.
   */
  getStats(): SmartPrefetchStats {
    const total = this.cacheHits + this.cacheMisses;
    const predictions = this.lastQueryHash ? this.model.predict(this.lastQueryHash, 5) : [];

    return {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      totalPredictions: this.model.transitionCount,
      accuratePredictions: this.cacheHits,
      cacheSize: this.cache.size,
      hitRate: total > 0 ? this.cacheHits / total : 0,
      modelSize: this.model.size,
      transitionCount: this.model.transitionCount,
      prefetchesThisMinute: this.prefetchesThisMinute,
      topPredictions: predictions.map((p) => ({
        queryHash: p.hash,
        confidence: p.confidence,
      })),
    };
  }

  /**
   * Get all Markov transitions for debugging.
   */
  getTransitions(): MarkovTransition[] {
    return this.model.getTransitions();
  }

  /**
   * Clear the model and cache.
   */
  clear(): void {
    this.patterns.clear();
    this.cache.clear();
    this.lastQueryHash = null;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  // ── Private ────────────────────────────────────────────

  private async prefetchCycle(): Promise<void> {
    if (!this.prefetchCallback) return;
    if (this.prefetchesThisMinute >= this.config.prefetchBudgetPerMinute) return;

    const predictions = this.getPredictions();
    const toPrefetch = predictions.slice(0, this.config.maxPrefetchPerCycle);

    for (const { pattern } of toPrefetch) {
      if (this.cache.has(pattern.queryHash)) continue;
      if (this.prefetchesThisMinute >= this.config.prefetchBudgetPerMinute) break;

      try {
        const data = await this.prefetchCallback(pattern);
        if (data) {
          this.cache.set(pattern.queryHash, { data, cachedAt: Date.now() });
        }
        this.prefetchesThisMinute++;
      } catch {
        // Prefetch is best-effort
      }
    }
  }

  private hashQuery(collection: string, filter: Record<string, unknown>): string {
    const sortedFilter = JSON.stringify(filter, Object.keys(filter).sort());
    return `${collection}:${sortedFilter}`;
  }
}

export function createSmartPrefetch(config?: SmartPrefetchConfig): SmartPrefetchEngine {
  return new SmartPrefetchEngine(config);
}
