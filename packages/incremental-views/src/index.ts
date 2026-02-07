export { createViewEngine } from './view-engine.js';
export { createIncrementalAggregation } from './aggregation.js';
export { createDependencyGraph } from './dependency-graph.js';

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
