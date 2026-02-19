/**
 * @pocket/query-builder - Programmatic Query Builder for Pocket
 *
 * This package provides a type-safe fluent API for constructing database
 * queries against Pocket collections. It includes query building, optimization,
 * and serialization capabilities.
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                        Client Application                           │
 * └───────────────────────────────┬─────────────────────────────────────┘
 *                                 │
 *                                 ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                        QueryBuilder                                 │
 * │                                                                      │
 * │  ┌──────────────┐  ┌─────────────────┐  ┌───────────────────────┐  │
 * │  │ Fluent API   │  │ QueryOptimizer  │  │ QuerySerializer       │  │
 * │  │ (build)      │  │ (analyze)       │  │ (toSQL, toCode)       │  │
 * │  └──────────────┘  └─────────────────┘  └───────────────────────┘  │
 * │                                                                      │
 * │                         QueryPlan                                    │
 * │                    (intermediate repr)                                │
 * └─────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createQueryBuilder } from '@pocket/query-builder';
 *
 * const plan = createQueryBuilder('users')
 *   .select('name', 'email')
 *   .where('status', 'eq', 'active')
 *   .where('age', 'gte', 18)
 *   .orderBy('name', 'asc')
 *   .limit(10)
 *   .build();
 * ```
 *
 * ## Complex Queries
 *
 * ```typescript
 * const plan = createQueryBuilder('products')
 *   .select('name', 'price', 'category')
 *   .where('price', 'gte', 10)
 *   .or()
 *     .where('category', 'eq', 'featured')
 *     .where('rating', 'gte', 4.5)
 *   .endGroup()
 *   .orderBy('price', 'desc')
 *   .limit(20)
 *   .build();
 * ```
 *
 * ## Query Optimization
 *
 * ```typescript
 * import { createQueryOptimizer } from '@pocket/query-builder';
 *
 * const optimizer = createQueryOptimizer();
 * const result = optimizer.analyze(plan);
 * console.log(result.suggestions);
 * console.log(result.indexRecommendations);
 * ```
 *
 * ## Serialization
 *
 * ```typescript
 * import { createQuerySerializer } from '@pocket/query-builder';
 *
 * const serializer = createQuerySerializer();
 * console.log(serializer.toSQL(plan));
 * console.log(serializer.toCode(plan));
 * console.log(serializer.toReadable(plan));
 * ```
 *
 * @packageDocumentation
 * @module @pocket/query-builder
 *
 * @see {@link QueryBuilder} for the main query builder class
 * @see {@link QueryOptimizer} for query optimization
 * @see {@link QuerySerializer} for serialization formats
 * @see {@link QueryPlan} for the intermediate representation
 */

// Types
export type {
  AggregateClause,
  AggregateFunction,
  FilterCondition,
  FilterOperator,
  LogicalGroup,
  LogicalOperator,
  PaginationClause,
  QueryExplanation,
  QueryPlan,
  SelectClause,
  SortClause,
  SortDirection,
} from './types.js';

// Query Builder
export { QueryBuilder, createQueryBuilder } from './query-builder.js';

// Query Optimizer
export {
  QueryOptimizer,
  createQueryOptimizer,
  type IndexSuggestion,
  type OptimizationResult,
} from './query-optimizer.js';

// Query Serializer
export { QuerySerializer, createQuerySerializer } from './query-serializer.js';

// Visual Query Builder
export { VisualQueryModel, createVisualQueryModel } from './visual-query-model.js';

// Code Generation
export { QueryCodeGenerator, createQueryCodeGenerator } from './code-generator.js';

// Query Templates
export { QueryTemplateRegistry, createQueryTemplateRegistry } from './query-template.js';
export type { QueryTemplate, TemplateParam } from './query-template.js';

// Visual Builder (no-code query construction)
export { OPERATORS_BY_TYPE, VisualBuilder, createVisualBuilder } from './visual-builder.js';
export type {
  FieldSchema,
  VisualAggregateNode,
  VisualBuilderEvent,
  VisualBuilderState,
  VisualFilterNode,
  VisualSortNode,
} from './visual-builder.js';

// React Query Builder (visual component models)
export { ReactQueryBuilder, createReactQueryBuilder } from './react-query-builder.js';
export type {
  AggregateRowModel,
  DragItem,
  DropZone,
  FilterRowModel,
  QueryBuilderUIConfig,
  QueryBuilderUIEvent,
  QueryBuilderUIState,
  SortRowModel,
} from './react-query-builder.js';

// Query Preview Engine (live result previews)
export { QueryPreviewEngine, createQueryPreviewEngine } from './query-preview.js';
export type {
  PerformanceEstimate,
  PreviewConfig,
  PreviewDataProvider,
  PreviewResult,
} from './query-preview.js';
