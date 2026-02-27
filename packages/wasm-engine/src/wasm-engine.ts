/**
 * Wasm Engine Orchestrator — the main entry point.
 *
 * Composes the JS fallback engine, optional Wasm module, worker
 * offloader, and query cache into a single unified API.
 */

import { BehaviorSubject } from 'rxjs';
import { JsQueryEngine } from './js-engine.js';
import { QueryCache } from './query-cache.js';
import type {
  AggregateResult,
  EngineMetrics,
  FilterCondition,
  FilterGroup,
  GroupByClause,
  QueryEngine,
  QueryPlan,
  QueryResult,
  WasmEngineConfig,
} from './types.js';
import { isWasmSupported, loadWasmModule } from './wasm-bindings.js';
import { WorkerOffloader, generateWorkerScript } from './worker-offloader.js';

const DEFAULT_CONFIG: Required<WasmEngineConfig> = {
  enableWasm: true,
  enableWorker: true,
  wasmUrl: '',
  workerThreshold: 10_000,
  cacheSize: 100,
  cacheTtlMs: 5000,
};

/**
 * The main Wasm-accelerated query engine.
 *
 * Usage:
 * ```ts
 * const engine = createWasmEngine({ enableWorker: true });
 * await engine.initialize();
 *
 * const result = await engine.execute(documents, {
 *   filter: { field: 'status', operator: 'eq', value: 'active' },
 *   sort: [{ field: 'createdAt', direction: 'desc' }],
 *   limit: 50,
 * });
 * ```
 */
export class WasmQueryOrchestrator {
  private readonly config: Required<WasmEngineConfig>;
  private readonly jsEngine: JsQueryEngine;
  private readonly cache: QueryCache<QueryResult | AggregateResult>;
  private offloader: WorkerOffloader | null = null;
  private wasmLoaded = false;
  private queriesExecuted = 0;
  private totalExecutionTimeMs = 0;
  private readonly metrics$: BehaviorSubject<EngineMetrics>;

  constructor(config: WasmEngineConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.jsEngine = new JsQueryEngine();
    this.cache = new QueryCache(this.config.cacheSize, this.config.cacheTtlMs);
    this.metrics$ = new BehaviorSubject<EngineMetrics>(this.buildMetrics());
  }

  private wasmEngine: QueryEngine | null = null;

  /** Initialize the engine: attempt Wasm load and Worker creation. */
  async initialize(): Promise<void> {
    // Attempt Wasm loading
    if (this.config.enableWasm && this.config.wasmUrl && isWasmSupported()) {
      try {
        this.wasmEngine = await loadWasmModule(this.config.wasmUrl);
        this.wasmLoaded = true;
      } catch {
        // Fall back to JS engine silently
        this.wasmEngine = null;
        this.wasmLoaded = false;
      }
    }

    // Set up worker offloader
    if (this.config.enableWorker) {
      this.offloader = new WorkerOffloader(this.jsEngine, this.config.workerThreshold);
      try {
        const script = generateWorkerScript();
        this.offloader.initWorker(script);
      } catch {
        this.offloader = null;
      }
    }

    this.emitMetrics();
  }

  /**
   * Execute a query plan against a document set.
   *
   * Automatically uses Wasm if available, offloads to Worker for
   * large datasets, and checks the cache first.
   */
  async execute<T extends Record<string, unknown>>(
    documents: readonly T[],
    plan: QueryPlan
  ): Promise<QueryResult<T>> {
    // Check cache
    const cacheKey = QueryCache.buildKey(plan, documents.length);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached as QueryResult<T>;
    }

    let result: QueryResult<T>;

    if (this.wasmEngine) {
      // Use the Wasm engine directly
      result = this.wasmEngine.execute(documents, plan);
    } else if (this.offloader?.isWorkerActive && documents.length >= this.config.workerThreshold) {
      result = await this.offloader.execute(documents, plan);
    } else {
      result = this.jsEngine.execute(documents, plan);
    }

    this.cache.set(cacheKey, result);
    this.queriesExecuted++;
    this.totalExecutionTimeMs += result.executionTimeMs;
    this.emitMetrics();

    return result;
  }

  /** Run an aggregation query. */
  async aggregate(
    documents: readonly Record<string, unknown>[],
    groupBy: GroupByClause,
    filter?: FilterCondition | FilterGroup
  ): Promise<AggregateResult> {
    const cacheKey = QueryCache.buildKey({ groupBy, filter }, documents.length);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached as AggregateResult;
    }

    let result: AggregateResult;

    if (this.wasmEngine) {
      result = this.wasmEngine.aggregate(documents, groupBy, filter);
    } else if (this.offloader?.isWorkerActive && documents.length >= this.config.workerThreshold) {
      result = await this.offloader.aggregate(documents, groupBy, filter);
    } else {
      result = this.jsEngine.aggregate(documents, groupBy, filter);
    }

    this.cache.set(cacheKey, result);
    this.queriesExecuted++;
    this.totalExecutionTimeMs += result.executionTimeMs;
    this.emitMetrics();

    return result;
  }

  /** Invalidate the query cache (call after data mutations). */
  invalidateCache(): void {
    this.cache.clear();
  }

  /** Observable of engine performance metrics. */
  get metrics() {
    return this.metrics$.asObservable();
  }

  /** Current snapshot of engine metrics. */
  getMetrics(): EngineMetrics {
    return this.buildMetrics();
  }

  /** Whether the Wasm module was successfully loaded. */
  get isWasmAvailable(): boolean {
    return this.wasmLoaded;
  }

  /** Whether queries are being offloaded to a Worker. */
  get isWorkerActive(): boolean {
    return this.offloader?.isWorkerActive ?? false;
  }

  /** Shut down the engine, terminating worker and clearing cache. */
  destroy(): void {
    this.offloader?.destroy();
    this.cache.clear();
    this.metrics$.complete();
  }

  private buildMetrics(): EngineMetrics {
    return {
      queriesExecuted: this.queriesExecuted,
      totalExecutionTimeMs: this.totalExecutionTimeMs,
      avgExecutionTimeMs:
        this.queriesExecuted > 0 ? this.totalExecutionTimeMs / this.queriesExecuted : 0,
      wasmAvailable: this.wasmLoaded,
      workerActive: this.offloader?.isWorkerActive ?? false,
      cacheHitRate: this.cache.hitRate,
    };
  }

  private emitMetrics(): void {
    this.metrics$.next(this.buildMetrics());
  }
}

export function createWasmEngine(config?: WasmEngineConfig): WasmQueryOrchestrator {
  return new WasmQueryOrchestrator(config);
}
