import type { PrefetchConfig, PrefetchStats, PredictionResult } from './types.js';
import { DEFAULT_PREFETCH_CONFIG } from './types.js';
import { PatternAnalyzer } from './pattern-analyzer.js';
import { PrefetchCache } from './prefetch-cache.js';

/**
 * Generates a deterministic hash for a collection + filter pair.
 */
function hashQuery(collection: string, filter: Record<string, unknown>): string {
  const sortedFilter = JSON.stringify(filter, Object.keys(filter).sort());
  return `${collection}:${sortedFilter}`;
}

/** Callback invoked when the engine needs data for a predicted query. */
export type PrefetchCallback = (prediction: PredictionResult) => Promise<unknown[] | undefined>;

/**
 * Coordinates pattern analysis and cache management to
 * predictively prefetch query results before they are needed.
 */
export class PrefetchEngine {
  private readonly config: PrefetchConfig;
  private readonly analyzer: PatternAnalyzer;
  private readonly cache: PrefetchCache;
  private prefetchCallback?: PrefetchCallback;
  private intervalId?: ReturnType<typeof setInterval>;
  private totalPredictions = 0;
  private accuratePredictions = 0;

  constructor(config?: Partial<PrefetchConfig>) {
    this.config = { ...DEFAULT_PREFETCH_CONFIG, ...config };
    this.analyzer = new PatternAnalyzer(this.config);
    this.cache = new PrefetchCache(this.config);
  }

  /**
   * Start the prefetch loop that periodically triggers prefetching.
   */
  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      void this.triggerPrefetch();
    }, this.config.idleDelayMs);
  }

  /**
   * Stop the prefetch engine and clear the interval.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Record a query execution and optionally cache its result.
   */
  recordQuery<T>(
    collection: string,
    filter: Record<string, unknown>,
    executionMs: number,
    result?: T[],
  ): void {
    this.analyzer.recordQuery(collection, filter, executionMs);

    const qHash = hashQuery(collection, filter);

    // Track prediction accuracy
    if (this.cache.has(qHash)) {
      this.accuratePredictions++;
    }

    if (result) {
      this.cache.set(qHash, result);
    }
  }

  /**
   * Get a prefetched result from cache.
   */
  getCached<T>(collection: string, filter: Record<string, unknown>): T[] | undefined {
    const qHash = hashQuery(collection, filter);
    return this.cache.get<T>(qHash);
  }

  /**
   * Get prefetch statistics.
   */
  getStats(): PrefetchStats {
    const cacheStats = this.cache.getStats();
    return {
      ...cacheStats,
      totalPredictions: this.totalPredictions,
      accuratePredictions: this.accuratePredictions,
    };
  }

  /**
   * Register a callback that fetches data for a predicted query.
   */
  onPrefetchNeeded(callback: PrefetchCallback): void {
    this.prefetchCallback = callback;
  }

  /**
   * Manually trigger a prefetch cycle: predict queries and fetch results.
   */
  async triggerPrefetch(): Promise<void> {
    if (!this.prefetchCallback) return;

    const predictions = this.analyzer
      .predict(this.config.maxPredictions)
      .filter((p) => p.confidence >= this.config.confidenceThreshold);

    for (const prediction of predictions) {
      if (this.cache.has(prediction.queryHash)) continue;

      this.totalPredictions++;

      try {
        const data = await this.prefetchCallback(prediction);
        if (data) {
          this.cache.set(prediction.queryHash, data);
        }
      } catch {
        // Silently skip failed prefetches
      }
    }
  }
}

/**
 * Create a new PrefetchEngine instance.
 */
export function createPrefetchEngine(config?: Partial<PrefetchConfig>): PrefetchEngine {
  return new PrefetchEngine(config);
}
