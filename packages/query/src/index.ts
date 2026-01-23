/**
 * @pocket/query - Query subscriptions language for Pocket
 *
 * @example
 * ```typescript
 * import {
 *   query,
 *   createQuerySubscriptionManager,
 *   createUseQueryHook,
 *   createUseLiveQueryHook,
 * } from '@pocket/query';
 *
 * // Build queries with fluent API
 * const todoQuery = query('todos')
 *   .eq('completed', false)
 *   .orderBy('createdAt', 'desc')
 *   .limit(10)
 *   .live()
 *   .build();
 *
 * // Complex queries
 * const advancedQuery = query('users')
 *   .gt('age', 18)
 *   .in('role', ['admin', 'moderator'])
 *   .or(q => q
 *     .eq('verified', true)
 *     .gt('reputation', 100)
 *   )
 *   .orderBy('createdAt', 'desc')
 *   .limit(20)
 *   .select('id', 'name', 'email', 'role')
 *   .count()
 *   .build();
 *
 * // Create subscription manager
 * const manager = createQuerySubscriptionManager<Todo>();
 * manager.setData(todos);
 *
 * // Execute one-shot query
 * const result = manager.execute(todoQuery);
 *
 * // Subscribe to live updates
 * const subscription = manager.subscribe(todoQuery);
 * subscription.result.subscribe(result => {
 *   console.log('Updated results:', result.data);
 * });
 *
 * // React integration
 * const useQuery = createUseQueryHook(React);
 * const useLiveQuery = createUseLiveQueryHook(React);
 *
 * function TodoList() {
 *   const { data, loading, refresh, hasMore, loadMore } = useLiveQuery(
 *     manager,
 *     todoQuery
 *   );
 *
 *   if (loading) return <div>Loading...</div>;
 *
 *   return (
 *     <ul>
 *       {data.map(todo => (
 *         <li key={todo.id}>{todo.text}</li>
 *       ))}
 *       {hasMore && <button onClick={loadMore}>Load More</button>}
 *     </ul>
 *   );
 * }
 * ```
 */

// Types
export type {
  AggregationSpec,
  AggregationType,
  ComputedFieldSpec,
  Condition,
  FieldCondition,
  JoinSpec,
  LogicalCondition,
  LogicalOperator,
  PaginationSpec,
  ProjectionSpec,
  QueryBuilderConfig,
  QueryCacheEntry,
  QueryDefinition,
  QueryOperator,
  QueryOptions,
  QueryResult,
  QuerySubscriptionEvent,
  SortDirection,
  SortSpec,
} from './types.js';

// Query Builder
export { QueryBuilder, hashQuery, parseQuery, query, serializeQuery } from './query-builder.js';

// Query Executor
export { QueryExecutor, createQueryExecutor, executeQuery } from './query-executor.js';

// Query Subscription
export type { QuerySubscriptionConfig } from './query-subscription.js';

export {
  QuerySubscription,
  QuerySubscriptionManager,
  createQuerySubscription,
  createQuerySubscriptionManager,
} from './query-subscription.js';

// Hooks
export type { ReactHooks, UseLiveQueryReturn, UseQueryReturn } from './hooks.js';

export {
  createUseLiveQueryHook,
  createUseQueryDataHook,
  createUseQueryEventsHook,
  createUseQueryHook,
  createUseQuerySubscriptionHook,
} from './hooks.js';
