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
