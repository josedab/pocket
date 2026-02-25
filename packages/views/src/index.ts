// Types
export type { ViewDefinition, ViewDelta, ViewEvent, ViewState, ViewStats } from './types.js';

// Filter Evaluator
export { evaluateFilter, getNestedValue } from './filter-evaluator.js';

// Materialized View
export { MaterializedView } from './materialized-view.js';

// View Manager
export { ViewManager, createViewManager } from './view-manager.js';

// Plugin
export { createViewPlugin } from './view-plugin.js';

// Computed View
export { ComputedView, createComputedView } from './computed-view.js';
export type {
  AggregationSpec,
  AggregationType,
  ComputedRow,
  ComputedViewDefinition,
  ComputedViewStats,
} from './computed-view.js';
