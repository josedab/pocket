/**
 * Types for the WebAssembly-accelerated query engine.
 *
 * Defines the interface contract that both the JS fallback engine and the
 * Wasm-compiled engine must satisfy, enabling transparent swapping.
 */

/** Supported comparison operators for filter evaluation. */
export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'exists'
  | 'regex';

/** A single filter condition against a document field. */
export interface FilterCondition {
  readonly field: string;
  readonly operator: FilterOperator;
  readonly value: unknown;
}

/** Logical combination of filter conditions. */
export interface FilterGroup {
  readonly logic: 'and' | 'or';
  readonly conditions: readonly (FilterCondition | FilterGroup)[];
}

/** Sort direction. */
export type SortDirection = 'asc' | 'desc';

/** A single sort instruction. */
export interface SortClause {
  readonly field: string;
  readonly direction: SortDirection;
}

/** Aggregation function types. */
export type AggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max';

/** A single aggregation operation. */
export interface AggregateClause {
  readonly function: AggregateFunction;
  readonly field?: string;
  readonly alias: string;
}

/** Group-by specification for aggregations. */
export interface GroupByClause {
  readonly fields: readonly string[];
  readonly aggregates: readonly AggregateClause[];
}

/** Field projection (include/exclude). */
export interface Projection {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

/** Complete query plan passed to the engine for execution. */
export interface QueryPlan {
  readonly filter?: FilterCondition | FilterGroup;
  readonly sort?: readonly SortClause[];
  readonly skip?: number;
  readonly limit?: number;
  readonly projection?: Projection;
  readonly groupBy?: GroupByClause;
}

/** Result of a query execution with timing metadata. */
export interface QueryResult<T = Record<string, unknown>> {
  readonly documents: readonly T[];
  readonly totalMatched: number;
  readonly executionTimeMs: number;
  readonly engine: 'wasm' | 'js';
}

/** Result of an aggregation query. */
export interface AggregateResult {
  readonly groups: readonly Record<string, unknown>[];
  readonly executionTimeMs: number;
  readonly engine: 'wasm' | 'js';
}

/** Performance metrics snapshot from the engine. */
export interface EngineMetrics {
  readonly queriesExecuted: number;
  readonly totalExecutionTimeMs: number;
  readonly avgExecutionTimeMs: number;
  readonly wasmAvailable: boolean;
  readonly workerActive: boolean;
  readonly cacheHitRate: number;
}

/** Configuration for the Wasm query engine. */
export interface WasmEngineConfig {
  /** Whether to attempt loading the Wasm module. Defaults to true. */
  readonly enableWasm?: boolean;
  /** Whether to offload queries to a Web Worker. Defaults to true. */
  readonly enableWorker?: boolean;
  /** URL to the Wasm binary. If omitted, uses the bundled JS fallback. */
  readonly wasmUrl?: string;
  /** Maximum documents before auto-offloading to worker. Defaults to 10000. */
  readonly workerThreshold?: number;
  /** Maximum entries in the query result cache. Defaults to 100. */
  readonly cacheSize?: number;
  /** Cache TTL in milliseconds. Defaults to 5000. */
  readonly cacheTtlMs?: number;
}

/**
 * The core query engine interface.
 *
 * Both the JS fallback and the Wasm-compiled engine implement this,
 * allowing the orchestrator to transparently switch between them.
 */
export interface QueryEngine {
  /** Execute a query plan against a document set. */
  execute<T extends Record<string, unknown>>(
    documents: readonly T[],
    plan: QueryPlan
  ): QueryResult<T>;

  /** Run an aggregation over a document set. */
  aggregate(
    documents: readonly Record<string, unknown>[],
    groupBy: GroupByClause,
    filter?: FilterCondition | FilterGroup
  ): AggregateResult;
}

/** Message types for communicating with the query worker. */
export type WorkerRequestType = 'execute' | 'aggregate' | 'ping';

export interface WorkerRequest {
  readonly id: string;
  readonly type: WorkerRequestType;
  readonly documents: readonly Record<string, unknown>[];
  readonly plan?: QueryPlan;
  readonly groupBy?: GroupByClause;
  readonly filter?: FilterCondition | FilterGroup;
}

export interface WorkerResponse {
  readonly id: string;
  readonly type: 'result' | 'error';
  readonly result?: QueryResult | AggregateResult;
  readonly error?: string;
}
