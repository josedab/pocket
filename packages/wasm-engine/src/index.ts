export type {
  AggregateClause,
  AggregateFunction,
  AggregateResult,
  EngineMetrics,
  FilterCondition,
  FilterGroup,
  FilterOperator,
  GroupByClause,
  Projection,
  QueryEngine,
  QueryPlan,
  QueryResult,
  SortClause,
  SortDirection,
  WasmEngineConfig,
  WorkerRequest,
  WorkerRequestType,
  WorkerResponse,
} from './types.js';

export { JsQueryEngine, createJsQueryEngine } from './js-engine.js';

export { QueryCache, createQueryCache } from './query-cache.js';

export {
  WorkerOffloader,
  createWorkerOffloader,
  generateWorkerScript,
} from './worker-offloader.js';

export { WasmQueryOrchestrator, createWasmEngine } from './wasm-engine.js';

export { isWasmSupported, loadWasmModule } from './wasm-bindings.js';
