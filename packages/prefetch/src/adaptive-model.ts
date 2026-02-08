/**
 * Adaptive learning model for predictive query prefetching.
 *
 * Builds on top of PatternAnalyzer with session-aware learning,
 * weighted Markov chains, and navigation context to predict queries
 * with higher accuracy over time.
 *
 * @module @pocket/prefetch
 */

import type { PredictionResult, PrefetchConfig, QueryPattern } from './types.js';
import { DEFAULT_PREFETCH_CONFIG } from './types.js';

// ── Types ─────────────────────────────────────────────────

export interface NavigationContext {
  /** Current route/page/view identifier */
  readonly route: string;
  /** Timestamp of navigation */
  readonly timestamp: number;
  /** Additional context metadata */
  readonly metadata?: Record<string, unknown>;
}

export interface SessionStats {
  /** Total queries in this session */
  readonly queryCount: number;
  /** Unique queries in this session */
  readonly uniqueQueries: number;
  /** Average prediction accuracy (0-1) */
  readonly avgAccuracy: number;
  /** Session duration in ms */
  readonly durationMs: number;
  /** Top predicted queries by confidence */
  readonly topPredictions: readonly PredictionResult[];
}

export interface AdaptiveModelConfig extends Partial<PrefetchConfig> {
  /** Weight for frequency-based scoring (default: 0.25) */
  readonly frequencyWeight?: number;
  /** Weight for recency-based scoring (default: 0.25) */
  readonly recencyWeight?: number;
  /** Weight for transition-based scoring (default: 0.30) */
  readonly transitionWeight?: number;
  /** Weight for navigation-context scoring (default: 0.20) */
  readonly navigationWeight?: number;
  /** Max navigation history entries (default: 50) */
  readonly maxNavigationHistory?: number;
  /** Session timeout in ms (default: 30 minutes) */
  readonly sessionTimeoutMs?: number;
  /** Memory budget in number of cached predictions (default: 200) */
  readonly memoryBudget?: number;
}

// ── AdaptiveLearningModel ─────────────────────────────────

/**
 * AdaptiveLearningModel — ML-powered query prediction.
 *
 * Combines four scoring signals into a weighted prediction:
 * 1. **Frequency**: How often a query is executed
 * 2. **Recency**: How recently a query was executed
 * 3. **Transition**: What query typically follows the current one (Markov)
 * 4. **Navigation**: What queries are associated with the current route
 *
 * The model adapts weights based on prediction accuracy feedback.
 *
 * @example
 * ```typescript
 * const model = createAdaptiveLearningModel();
 *
 * model.recordQuery('todos', { completed: false }, 15);
 * model.setNavigationContext({ route: '/dashboard', timestamp: Date.now() });
 * model.recordQuery('stats', {}, 8);
 *
 * const predictions = model.predict(5);
 * // predictions are ranked by combined confidence
 *
 * // Report accuracy to improve future predictions
 * model.reportAccuracy('todos:{"completed":false}', true);
 * ```
 */
export class AdaptiveLearningModel {
  private readonly config: Required<AdaptiveModelConfig>;

  // Pattern storage
  private patterns = new Map<string, QueryPattern & { navigationContexts: Set<string> }>();
  private queryHistory: string[] = [];
  private transitionMatrix = new Map<string, Map<string, number>>();

  // Navigation context
  private navigationHistory: NavigationContext[] = [];
  private routeQueryMap = new Map<string, Map<string, number>>();
  private currentRoute = '';

  // Adaptive weights
  private weights: { frequency: number; recency: number; transition: number; navigation: number };
  private predictionFeedback: { predicted: boolean; timestamp: number }[] = [];

  // Session tracking
  private sessionStart = Date.now();
  private totalQueries = 0;
  private correctPredictions = 0;
  private totalPredictions = 0;

  constructor(config?: AdaptiveModelConfig) {
    this.config = {
      ...DEFAULT_PREFETCH_CONFIG,
      frequencyWeight: config?.frequencyWeight ?? 0.25,
      recencyWeight: config?.recencyWeight ?? 0.25,
      transitionWeight: config?.transitionWeight ?? 0.3,
      navigationWeight: config?.navigationWeight ?? 0.2,
      maxNavigationHistory: config?.maxNavigationHistory ?? 50,
      sessionTimeoutMs: config?.sessionTimeoutMs ?? 30 * 60 * 1000,
      memoryBudget: config?.memoryBudget ?? 200,
      ...config,
    };

    this.weights = {
      frequency: this.config.frequencyWeight,
      recency: this.config.recencyWeight,
      transition: this.config.transitionWeight,
      navigation: this.config.navigationWeight,
    };
  }

  // ── Recording ───────────────────────────────────────────

  /** Record a query execution. */
  recordQuery(collection: string, filter: Record<string, unknown>, executionMs: number): void {
    const qHash = this.hashQuery(collection, filter);
    this.totalQueries++;

    // Update pattern
    const existing = this.patterns.get(qHash);
    if (existing) {
      const totalMs = existing.avgExecutionMs * existing.frequency + executionMs;
      existing.frequency += 1;
      existing.avgExecutionMs = totalMs / existing.frequency;
      existing.lastAccessed = Date.now();
      if (this.currentRoute) existing.navigationContexts.add(this.currentRoute);
    } else {
      const navContexts = new Set<string>();
      if (this.currentRoute) navContexts.add(this.currentRoute);
      this.patterns.set(qHash, {
        queryHash: qHash,
        collection,
        filter: { ...filter },
        frequency: 1,
        lastAccessed: Date.now(),
        avgExecutionMs: executionMs,
        navigationContexts: navContexts,
      });
    }

    // Track transitions
    const prev = this.queryHistory[this.queryHistory.length - 1];
    if (prev !== undefined) {
      let transitions = this.transitionMatrix.get(prev);
      if (!transitions) {
        transitions = new Map();
        this.transitionMatrix.set(prev, transitions);
      }
      transitions.set(qHash, (transitions.get(qHash) ?? 0) + 1);
    }

    this.queryHistory.push(qHash);

    // Track route → query association
    if (this.currentRoute) {
      let routeQueries = this.routeQueryMap.get(this.currentRoute);
      if (!routeQueries) {
        routeQueries = new Map();
        this.routeQueryMap.set(this.currentRoute, routeQueries);
      }
      routeQueries.set(qHash, (routeQueries.get(qHash) ?? 0) + 1);
    }

    // Enforce memory budget
    if (this.patterns.size > this.config.memoryBudget) {
      this.evictLeastValuable();
    }
  }

  /** Set current navigation context (route/page change). */
  setNavigationContext(context: NavigationContext): void {
    this.currentRoute = context.route;
    this.navigationHistory.push(context);

    if (this.navigationHistory.length > this.config.maxNavigationHistory) {
      this.navigationHistory.shift();
    }
  }

  // ── Prediction ──────────────────────────────────────────

  /** Predict next queries with adaptive weighted scoring. */
  predict(count?: number): PredictionResult[] {
    const max = count ?? this.config.maxPredictions;
    const lastQuery = this.queryHistory[this.queryHistory.length - 1];
    const now = Date.now();

    const scored: PredictionResult[] = [];
    const maxFreq = Math.max(1, ...Array.from(this.patterns.values()).map((p) => p.frequency));

    for (const pattern of this.patterns.values()) {
      // 1. Frequency score
      const freqScore = pattern.frequency / maxFreq;

      // 2. Recency score (exponential decay over 5 minutes)
      const ageSec = (now - pattern.lastAccessed) / 1000;
      const recencyScore = Math.exp(-ageSec / 300);

      // 3. Transition score (Markov)
      let transitionScore = 0;
      if (lastQuery && this.transitionMatrix.has(lastQuery)) {
        const transitions = this.transitionMatrix.get(lastQuery)!;
        const total = Array.from(transitions.values()).reduce((sum, v) => sum + v, 0);
        const transCount = transitions.get(pattern.queryHash) ?? 0;
        transitionScore = total > 0 ? transCount / total : 0;
      }

      // 4. Navigation context score
      let navigationScore = 0;
      if (this.currentRoute && this.routeQueryMap.has(this.currentRoute)) {
        const routeQueries = this.routeQueryMap.get(this.currentRoute)!;
        const routeTotal = Array.from(routeQueries.values()).reduce((sum, v) => sum + v, 0);
        const queryCount = routeQueries.get(pattern.queryHash) ?? 0;
        navigationScore = routeTotal > 0 ? queryCount / routeTotal : 0;
      }

      // Weighted combination
      const confidence =
        freqScore * this.weights.frequency +
        recencyScore * this.weights.recency +
        transitionScore * this.weights.transition +
        navigationScore * this.weights.navigation;

      scored.push({
        queryHash: pattern.queryHash,
        confidence,
        pattern,
      });
    }

    this.totalPredictions += Math.min(scored.length, max);

    return scored.sort((a, b) => b.confidence - a.confidence).slice(0, max);
  }

  // ── Feedback & Adaptation ───────────────────────────────

  /** Report whether a prediction was accurate (the query was actually executed). */
  reportAccuracy(_queryHash: string, wasAccurate: boolean): void {
    this.predictionFeedback.push({
      predicted: wasAccurate,
      timestamp: Date.now(),
    });

    if (wasAccurate) this.correctPredictions++;

    // Adapt weights every 20 feedbacks
    if (this.predictionFeedback.length % 20 === 0) {
      this.adaptWeights();
    }
  }

  /** Get current adaptive weights. */
  getWeights(): { frequency: number; recency: number; transition: number; navigation: number } {
    return { ...this.weights };
  }

  // ── Session Stats ───────────────────────────────────────

  /** Get statistics for the current session. */
  getSessionStats(): SessionStats {
    const accuracy =
      this.totalPredictions > 0 ? this.correctPredictions / this.totalPredictions : 0;

    return {
      queryCount: this.totalQueries,
      uniqueQueries: this.patterns.size,
      avgAccuracy: accuracy,
      durationMs: Date.now() - this.sessionStart,
      topPredictions: this.predict(5),
    };
  }

  /** Reset session (keeps learned patterns). */
  resetSession(): void {
    this.sessionStart = Date.now();
    this.totalQueries = 0;
    this.correctPredictions = 0;
    this.totalPredictions = 0;
    this.predictionFeedback = [];
    this.queryHistory = [];
    this.navigationHistory = [];
  }

  /** Full reset — clears all learned data. */
  reset(): void {
    this.patterns.clear();
    this.transitionMatrix.clear();
    this.routeQueryMap.clear();
    this.resetSession();
    this.weights = {
      frequency: this.config.frequencyWeight,
      recency: this.config.recencyWeight,
      transition: this.config.transitionWeight,
      navigation: this.config.navigationWeight,
    };
  }

  // ── Private ─────────────────────────────────────────────

  private hashQuery(collection: string, filter: Record<string, unknown>): string {
    const sortedFilter = JSON.stringify(filter, Object.keys(filter).sort());
    return `${collection}:${sortedFilter}`;
  }

  private evictLeastValuable(): void {
    let leastHash = '';
    let leastScore = Infinity;

    for (const [hash, pattern] of this.patterns) {
      const score =
        pattern.frequency * 0.5 + (1 - (Date.now() - pattern.lastAccessed) / 600_000) * 0.5;
      if (score < leastScore) {
        leastScore = score;
        leastHash = hash;
      }
    }

    if (leastHash) {
      this.patterns.delete(leastHash);
      this.transitionMatrix.delete(leastHash);
    }
  }

  private adaptWeights(): void {
    // Simple adaptation: boost weights for signals that correlate with accuracy
    const recent = this.predictionFeedback.slice(-20);
    const recentAccuracy = recent.filter((f) => f.predicted).length / Math.max(1, recent.length);

    if (recentAccuracy < 0.3) {
      // Low accuracy → boost transition and navigation (context-dependent signals)
      this.weights.transition = Math.min(0.5, this.weights.transition + 0.02);
      this.weights.navigation = Math.min(0.4, this.weights.navigation + 0.02);
      this.weights.frequency = Math.max(0.1, this.weights.frequency - 0.02);
      this.weights.recency = Math.max(0.1, this.weights.recency - 0.02);
    } else if (recentAccuracy > 0.7) {
      // High accuracy → keep current weights (minor normalization)
    }

    // Normalize to sum to 1.0
    const total =
      this.weights.frequency +
      this.weights.recency +
      this.weights.transition +
      this.weights.navigation;
    if (total > 0) {
      this.weights.frequency /= total;
      this.weights.recency /= total;
      this.weights.transition /= total;
      this.weights.navigation /= total;
    }
  }
}

/**
 * Create an AdaptiveLearningModel.
 */
export function createAdaptiveLearningModel(config?: AdaptiveModelConfig): AdaptiveLearningModel {
  return new AdaptiveLearningModel(config);
}
