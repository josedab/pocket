export { createIncrementalAggregation } from './aggregation.js';
export { createDependencyGraph } from './dependency-graph.js';
export { createViewEngine } from './view-engine.js';

export type {
  AggregateOp,
  ChangeEvent,
  DependencyGraph,
  IncrementalAggregation,
  MaterializedView,
  ViewDefinition,
  ViewManagerConfig,
  ViewState,
} from './types.js';

export type { AggregationConfig } from './aggregation.js';

// Live views with Observable integration
export { createLiveView } from './live-view.js';
export type { AggregateResult, GroupedResult, LiveView, LiveViewConfig } from './live-view.js';

// LRU cache for view eviction
export { createViewCache } from './lru-cache.js';
export type { ViewCache, ViewCacheConfig, ViewCacheStats } from './lru-cache.js';

// Materialized view manager
export { createMaterializedViewManager } from './materialized-view-manager.js';
export type {
  ManagedView,
  MaterializedViewManager,
  ViewManagerConfig as MvManagerConfig,
  ViewDefinition as MvViewDefinition,
  ViewAggregation,
  ViewManagerStats,
  ViewResult,
} from './materialized-view-manager.js';

// View DSL
export { ViewDefinitionBuilder, defineView } from './view-dsl.js';
export type {
  DslViewAggregation,
  ViewColumn,
  ViewDefinitionConfig,
  ViewFilter,
  ViewGroupBy,
  ViewJoin,
  ViewSort,
} from './view-dsl.js';

// Incremental Engine
export { IncrementalEngine, createIncrementalEngine } from './incremental-engine.js';
export type {
  DeltaChange,
  IncrementalEngineConfig,
  IncrementalViewResult,
} from './incremental-engine.js';
