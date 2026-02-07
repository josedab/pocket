import type { PrefetchConfig, PredictionResult, QueryPattern } from './types.js';
import { DEFAULT_PREFETCH_CONFIG } from './types.js';

/**
 * Generates a deterministic hash for a collection + filter pair.
 */
function hashQuery(collection: string, filter: Record<string, unknown>): string {
  const sortedFilter = JSON.stringify(filter, Object.keys(filter).sort());
  return `${collection}:${sortedFilter}`;
}

/**
 * Analyzes query patterns and predicts future queries using
 * frequency analysis and simple Markov-like transition tracking.
 */
export class PatternAnalyzer {
  private readonly config: PrefetchConfig;
  private patterns: Map<string, QueryPattern> = new Map();
  private queryHistory: string[] = [];
  private transitionMatrix: Map<string, Map<string, number>> = new Map();

  constructor(config?: Partial<PrefetchConfig>) {
    this.config = { ...DEFAULT_PREFETCH_CONFIG, ...config };
  }

  /**
   * Record a query execution for pattern learning.
   */
  recordQuery(collection: string, filter: Record<string, unknown>, executionMs: number): void {
    const qHash = hashQuery(collection, filter);
    const existing = this.patterns.get(qHash);

    if (existing) {
      const totalMs = existing.avgExecutionMs * existing.frequency + executionMs;
      existing.frequency += 1;
      existing.avgExecutionMs = totalMs / existing.frequency;
      existing.lastAccessed = Date.now();
    } else {
      this.patterns.set(qHash, {
        queryHash: qHash,
        collection,
        filter: { ...filter },
        frequency: 1,
        lastAccessed: Date.now(),
        avgExecutionMs: executionMs,
      });
    }

    // Track transitions (Markov chain)
    const prevHash = this.queryHistory[this.queryHistory.length - 1] as string | undefined;
    if (prevHash !== undefined) {
      let transitions = this.transitionMatrix.get(prevHash);
      if (!transitions) {
        transitions = new Map();
        this.transitionMatrix.set(prevHash, transitions);
      }
      transitions.set(qHash, (transitions.get(qHash) ?? 0) + 1);
    }

    this.queryHistory.push(qHash);
  }

  /**
   * Get all recorded patterns sorted by frequency (descending).
   */
  getPatterns(): QueryPattern[] {
    return [...this.patterns.values()].sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Predict next N likely queries based on recency, frequency,
   * and Markov transition probabilities.
   */
  predict(count?: number): PredictionResult[] {
    const max = count ?? this.config.maxPredictions;
    const lastQuery = this.queryHistory.length > 0
      ? this.queryHistory[this.queryHistory.length - 1]
      : undefined;

    const scored: PredictionResult[] = [];

    for (const pattern of this.patterns.values()) {
      let confidence = 0;

      // Frequency score: normalized by max frequency
      const maxFreq = Math.max(...[...this.patterns.values()].map((p) => p.frequency));
      const freqScore = maxFreq > 0 ? pattern.frequency / maxFreq : 0;

      // Recency score: decay over time (last 60 seconds = 1.0, older decays)
      const ageSec = (Date.now() - pattern.lastAccessed) / 1000;
      const recencyScore = Math.max(0, 1 - ageSec / 300);

      // Transition score: if we know what query came last
      let transitionScore = 0;
      if (lastQuery && this.transitionMatrix.has(lastQuery)) {
        const transitions = this.transitionMatrix.get(lastQuery)!;
        const total = [...transitions.values()].reduce((sum, v) => sum + v, 0);
        const transCount = transitions.get(pattern.queryHash) ?? 0;
        transitionScore = total > 0 ? transCount / total : 0;
      }

      confidence = freqScore * 0.3 + recencyScore * 0.3 + transitionScore * 0.4;

      scored.push({
        queryHash: pattern.queryHash,
        confidence,
        pattern,
      });
    }

    return scored
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, max);
  }

  /**
   * Get recorded query sequences (transition counts between queries).
   */
  getSequences(): Map<string, Map<string, number>> {
    return new Map(
      [...this.transitionMatrix.entries()].map(([k, v]) => [k, new Map(v)]),
    );
  }

  /**
   * Clear all patterns, history, and transitions.
   */
  reset(): void {
    this.patterns.clear();
    this.queryHistory = [];
    this.transitionMatrix.clear();
  }
}

/**
 * Create a new PatternAnalyzer instance.
 */
export function createPatternAnalyzer(config?: Partial<PrefetchConfig>): PatternAnalyzer {
  return new PatternAnalyzer(config);
}
