/**
 * Adaptive Query Threshold Engine
 *
 * Automatically determines when to offload queries to the WASM engine
 * or Web Worker based on dataset size, query complexity, and historical
 * performance metrics. Uses exponential moving averages for smooth adaptation.
 *
 * @module @pocket/wasm-engine/adaptive
 */

import type { Observable } from 'rxjs';
import { BehaviorSubject } from 'rxjs';
import type { FilterCondition, FilterGroup, QueryPlan } from './types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdaptiveConfig {
  /** Initial document count threshold for WASM offloading. */
  readonly initialWasmThreshold?: number;
  /** Initial document count threshold for Worker offloading. */
  readonly initialWorkerThreshold?: number;
  /** Learning rate for exponential moving average (0-1). */
  readonly learningRate?: number;
  /** Minimum samples before adapting thresholds. */
  readonly minSamples?: number;
  /** Target latency in ms — engine is switched when exceeding this. */
  readonly targetLatencyMs?: number;
  /** Maximum complexity score before forcing offload. */
  readonly maxComplexity?: number;
}

export type EngineDecision = 'js-main' | 'wasm-main' | 'wasm-worker';

export interface QueryMetric {
  readonly engine: EngineDecision;
  readonly documentCount: number;
  readonly complexityScore: number;
  readonly executionTimeMs: number;
  readonly timestamp: number;
}

export interface AdaptiveState {
  readonly wasmThreshold: number;
  readonly workerThreshold: number;
  readonly totalQueries: number;
  readonly avgJsTimeMs: number;
  readonly avgWasmTimeMs: number;
  readonly avgWorkerTimeMs: number;
  readonly lastDecision: EngineDecision;
}

// ─── Query Complexity Scoring ─────────────────────────────────────────────────

/** Compute a complexity score for a query plan (higher = more complex). */
export function computeQueryComplexity(plan: QueryPlan): number {
  let score = 1;

  // Filter complexity
  if (plan.filter) {
    score += computeFilterComplexity(plan.filter);
  }

  // Sort complexity
  if (plan.sort && plan.sort.length > 0) {
    score += plan.sort.length * 2;
  }

  // Aggregation adds complexity
  if (plan.groupBy && plan.groupBy.aggregates.length > 0) {
    score += plan.groupBy.aggregates.length * 3;
  }

  // Projection has minimal cost
  if (plan.projection) {
    score += 0.5;
  }

  return score;
}

function computeFilterComplexity(filter: FilterCondition | FilterGroup): number {
  if ('operator' in filter) {
    // Single condition
    const opCost: Record<string, number> = {
      eq: 1,
      ne: 1,
      gt: 1,
      gte: 1,
      lt: 1,
      lte: 1,
      in: 2,
      nin: 2,
      contains: 3,
      startsWith: 2,
      endsWith: 3,
      exists: 1,
      regex: 5,
    };
    return opCost[filter.operator] ?? 1;
  }

  // Filter group (AND/OR)
  const groupFilter = filter;
  if (groupFilter.conditions) {
    const conditionsComplexity = groupFilter.conditions.reduce(
      (sum, c) => sum + computeFilterComplexity(c),
      0
    );
    // OR is more expensive than AND (can't short-circuit as easily)
    const multiplier = groupFilter.logic === 'or' ? 1.5 : 1;
    return conditionsComplexity * multiplier;
  }

  return 1;
}

// ─── Adaptive Threshold Engine ────────────────────────────────────────────────

export class AdaptiveThresholdEngine {
  private readonly config: Required<AdaptiveConfig>;
  private readonly stateSubject: BehaviorSubject<AdaptiveState>;
  private readonly metrics: QueryMetric[] = [];

  // Exponential moving averages
  private emaJs = 0;
  private emaWasm = 0;
  private emaWorker = 0;
  private sampleCount = 0;

  constructor(config?: AdaptiveConfig) {
    this.config = {
      initialWasmThreshold: config?.initialWasmThreshold ?? 500,
      initialWorkerThreshold: config?.initialWorkerThreshold ?? 10000,
      learningRate: config?.learningRate ?? 0.1,
      minSamples: config?.minSamples ?? 20,
      targetLatencyMs: config?.targetLatencyMs ?? 16, // 60fps budget
      maxComplexity: config?.maxComplexity ?? 15,
    };

    this.stateSubject = new BehaviorSubject<AdaptiveState>({
      wasmThreshold: this.config.initialWasmThreshold,
      workerThreshold: this.config.initialWorkerThreshold,
      totalQueries: 0,
      avgJsTimeMs: 0,
      avgWasmTimeMs: 0,
      avgWorkerTimeMs: 0,
      lastDecision: 'js-main',
    });
  }

  /** Observable of adaptive state changes. */
  get state$(): Observable<AdaptiveState> {
    return this.stateSubject.asObservable();
  }

  /** Current state snapshot. */
  get state(): AdaptiveState {
    return this.stateSubject.getValue();
  }

  /**
   * Decide which engine to use for a given query.
   */
  decide(documentCount: number, plan: QueryPlan): EngineDecision {
    const complexity = computeQueryComplexity(plan);
    const current = this.stateSubject.getValue();

    // Force offload for very complex queries
    if (complexity >= this.config.maxComplexity) {
      return 'wasm-worker';
    }

    // Weighted score: document count * complexity
    const workScore = documentCount * complexity;

    if (workScore >= current.workerThreshold * 5) {
      return 'wasm-worker';
    }

    if (workScore >= current.wasmThreshold * complexity || documentCount >= current.wasmThreshold) {
      // If dataset is large enough for worker, prefer that
      if (documentCount >= current.workerThreshold) {
        return 'wasm-worker';
      }
      return 'wasm-main';
    }

    return 'js-main';
  }

  /**
   * Record a query execution result for threshold adaptation.
   */
  recordMetric(metric: QueryMetric): void {
    this.metrics.push(metric);
    this.sampleCount++;

    // Keep only recent metrics (sliding window)
    if (this.metrics.length > 500) {
      this.metrics.shift();
    }

    // Update EMAs
    const lr = this.config.learningRate;
    switch (metric.engine) {
      case 'js-main':
        this.emaJs =
          this.emaJs === 0
            ? metric.executionTimeMs
            : this.emaJs * (1 - lr) + metric.executionTimeMs * lr;
        break;
      case 'wasm-main':
        this.emaWasm =
          this.emaWasm === 0
            ? metric.executionTimeMs
            : this.emaWasm * (1 - lr) + metric.executionTimeMs * lr;
        break;
      case 'wasm-worker':
        this.emaWorker =
          this.emaWorker === 0
            ? metric.executionTimeMs
            : this.emaWorker * (1 - lr) + metric.executionTimeMs * lr;
        break;
    }

    // Adapt thresholds after enough samples
    if (this.sampleCount >= this.config.minSamples) {
      this.adaptThresholds();
    }

    this.stateSubject.next({
      ...this.stateSubject.getValue(),
      totalQueries: this.sampleCount,
      avgJsTimeMs: Math.round(this.emaJs * 100) / 100,
      avgWasmTimeMs: Math.round(this.emaWasm * 100) / 100,
      avgWorkerTimeMs: Math.round(this.emaWorker * 100) / 100,
      lastDecision: metric.engine,
    });
  }

  private adaptThresholds(): void {
    const current = this.stateSubject.getValue();
    const target = this.config.targetLatencyMs;
    let newWasmThreshold = current.wasmThreshold;
    let newWorkerThreshold = current.workerThreshold;

    // If JS is fast enough for current threshold, raise it
    if (this.emaJs < target && this.emaJs > 0) {
      newWasmThreshold = Math.min(newWasmThreshold * 1.1, 50000);
    }

    // If JS is too slow, lower WASM threshold
    if (this.emaJs > target * 2 && this.emaJs > 0) {
      newWasmThreshold = Math.max(newWasmThreshold * 0.9, 100);
    }

    // If WASM on main thread is blocking, lower worker threshold
    if (this.emaWasm > target && this.emaWasm > 0) {
      newWorkerThreshold = Math.max(newWorkerThreshold * 0.9, 1000);
    }

    // If worker overhead is too high for small datasets, raise worker threshold
    if (this.emaWorker > this.emaWasm * 1.5 && this.emaWasm > 0) {
      newWorkerThreshold = Math.min(newWorkerThreshold * 1.1, 100000);
    }

    this.stateSubject.next({
      ...this.stateSubject.getValue(),
      wasmThreshold: Math.round(newWasmThreshold),
      workerThreshold: Math.round(newWorkerThreshold),
    });
  }

  /** Reset all metrics and thresholds. */
  reset(): void {
    this.metrics.length = 0;
    this.sampleCount = 0;
    this.emaJs = 0;
    this.emaWasm = 0;
    this.emaWorker = 0;
    this.stateSubject.next({
      wasmThreshold: this.config.initialWasmThreshold,
      workerThreshold: this.config.initialWorkerThreshold,
      totalQueries: 0,
      avgJsTimeMs: 0,
      avgWasmTimeMs: 0,
      avgWorkerTimeMs: 0,
      lastDecision: 'js-main',
    });
  }

  destroy(): void {
    this.stateSubject.complete();
  }
}

export function createAdaptiveThresholdEngine(config?: AdaptiveConfig): AdaptiveThresholdEngine {
  return new AdaptiveThresholdEngine(config);
}
