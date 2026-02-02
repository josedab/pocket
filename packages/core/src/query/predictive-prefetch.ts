/**
 * Predictive pre-fetcher — tracks collection access patterns and
 * proactively loads likely-needed data in the background.
 */

export interface PrefetchRule {
  /** Source collection that triggers pre-fetch */
  source: string;
  /** Target collection to pre-fetch */
  target: string;
  /** Co-access count */
  count: number;
  /** Probability of co-access (0-1) */
  probability: number;
}

export interface PrefetchConfig {
  /** Enable/disable pre-fetching (default: true) */
  enabled?: boolean;
  /** Minimum co-access probability to trigger pre-fetch (default: 0.6) */
  minProbability?: number;
  /** Maximum number of access records to retain (default: 500) */
  maxRecords?: number;
  /** Cooldown in ms before re-prefetching the same target (default: 5000) */
  cooldownMs?: number;
}

export interface PrefetchStats {
  trackedCollections: number;
  rules: PrefetchRule[];
  prefetchesFired: number;
}

/**
 * Tracks sequential collection access patterns and computes
 * co-access probabilities to drive predictive pre-fetching.
 */
export class PredictivePrefetcher {
  private readonly config: Required<PrefetchConfig>;
  private readonly accessLog: { collection: string; timestamp: number }[] = [];
  private readonly coAccessCounts = new Map<string, Map<string, number>>();
  private readonly accessCounts = new Map<string, number>();
  private readonly lastPrefetch = new Map<string, number>();
  private prefetchesFired = 0;

  /** Callback invoked when a pre-fetch should be triggered. */
  onPrefetch: ((collection: string) => void) | null = null;

  constructor(config: PrefetchConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      minProbability: config.minProbability ?? 0.6,
      maxRecords: config.maxRecords ?? 500,
      cooldownMs: config.cooldownMs ?? 5000,
    };
  }

  /**
   * Record a collection access event. Analyzes whether to trigger
   * pre-fetches for likely co-accessed collections.
   */
  recordAccess(collection: string): void {
    if (!this.config.enabled) return;

    const now = Date.now();

    // Trim old records
    while (this.accessLog.length >= this.config.maxRecords) {
      this.accessLog.shift();
    }

    // Record co-access with the previous access (within 2s window)
    const lastAccess = this.accessLog[this.accessLog.length - 1];
    if (lastAccess && lastAccess.collection !== collection && now - lastAccess.timestamp < 2000) {
      const source = lastAccess.collection;
      if (!this.coAccessCounts.has(source)) {
        this.coAccessCounts.set(source, new Map());
      }
      const sourceMap = this.coAccessCounts.get(source)!;
      sourceMap.set(collection, (sourceMap.get(collection) ?? 0) + 1);
    }

    this.accessCounts.set(collection, (this.accessCounts.get(collection) ?? 0) + 1);
    this.accessLog.push({ collection, timestamp: now });

    // Trigger pre-fetches for likely next collections
    this.triggerPrefetches(collection, now);
  }

  /**
   * Get pre-fetch rules sorted by probability.
   */
  getRules(): PrefetchRule[] {
    const rules: PrefetchRule[] = [];

    for (const [source, targets] of this.coAccessCounts) {
      const sourceCount = this.accessCounts.get(source) ?? 1;
      for (const [target, count] of targets) {
        const probability = count / sourceCount;
        if (probability >= this.config.minProbability) {
          rules.push({ source, target, count, probability });
        }
      }
    }

    return rules.sort((a, b) => b.probability - a.probability);
  }

  /**
   * Get statistics about the pre-fetcher state.
   */
  getStats(): PrefetchStats {
    return {
      trackedCollections: this.accessCounts.size,
      rules: this.getRules(),
      prefetchesFired: this.prefetchesFired,
    };
  }

  /**
   * Reset all tracked data.
   */
  clear(): void {
    this.accessLog.length = 0;
    this.coAccessCounts.clear();
    this.accessCounts.clear();
    this.lastPrefetch.clear();
    this.prefetchesFired = 0;
  }

  private triggerPrefetches(currentCollection: string, now: number): void {
    if (!this.onPrefetch) return;

    const targets = this.coAccessCounts.get(currentCollection);
    if (!targets) return;

    const sourceCount = this.accessCounts.get(currentCollection) ?? 1;

    for (const [target, count] of targets) {
      const probability = count / sourceCount;
      if (probability < this.config.minProbability) continue;

      const lastFetch = this.lastPrefetch.get(target) ?? 0;
      if (now - lastFetch < this.config.cooldownMs) continue;

      this.lastPrefetch.set(target, now);
      this.prefetchesFired++;
      this.onPrefetch(target);
    }
  }
}

/**
 * Create a new PredictivePrefetcher instance.
 */
export function createPredictivePrefetcher(config?: PrefetchConfig): PredictivePrefetcher {
  return new PredictivePrefetcher(config);
}
