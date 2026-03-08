/**
 * @pocket/computed — Reactive computed collections for Pocket databases.
 *
 * Derive and maintain materialized views from source collections with
 * automatic invalidation, incremental recomputation, and cross-collection
 * joins.
 *
 * @example
 * ```ts
 * import { createComputedManager, join, aggregate } from '@pocket/computed';
 *
 * const manager = createComputedManager();
 * manager.registerSource(usersSource);
 * manager.registerSource(ordersSource);
 *
 * // Cross-collection join
 * const userOrders = manager.addComputed({
 *   name: 'user-orders',
 *   sources: ['users', 'orders'],
 *   compute: join({ leftSource: 'users', rightSource: 'orders', leftKey: 'id', rightKey: 'userId', type: 'inner' }),
 * });
 *
 * // Aggregation
 * const stats = manager.addComputed({
 *   name: 'stats',
 *   sources: ['orders'],
 *   compute: aggregate({ source: 'orders', groupBy: 'status', aggregations: [{ field: '*', operation: 'count', alias: 'total' }] }),
 * });
 *
 * userOrders.documents$.subscribe(docs => console.log('Joined:', docs));
 * ```
 *
 * @module @pocket/computed
 */

// Types
export type {
  AggregationConfig,
  AggregationField,
  ComputeContext,
  ComputeFunction,
  ComputedCollectionConfig,
  ComputedCollectionState,
  ComputedEvent,
  DocumentMap,
  JoinConfig,
  SourceChange,
  SourceCollection,
} from './types.js';

// Computed Collection
export {
  ComputedCollection,
  createComputedCollection,
} from './computed-collection.js';

// Computed Manager
export {
  ComputedManager,
  createComputedManager,
} from './computed-manager.js';
export type { ComputedManagerState } from './computed-manager.js';

// Operators
export {
  aggregate,
  filter,
  join,
  pipe,
  sort,
  transform,
  union,
} from './operators.js';
