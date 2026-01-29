/**
 * Observable and reactive utilities module.
 *
 * This module provides the reactive foundation for Pocket's live queries
 * and real-time updates. It includes:
 *
 * - {@link LiveQuery}: Reactive queries that auto-update on data changes
 * - {@link ObservableValue}: Synchronous value with reactive subscription
 * - {@link ObservableAsync}: Async value with loading/error state tracking
 * - EventReduce algorithm for efficient incremental query updates
 * - Utility functions: {@link debounce}, {@link throttle}, {@link createDeferred}
 *
 * ## Architecture
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────┐
 * │                    Collection Changes                        │
 * │               (insert, update, delete)                       │
 * └────────────────────────┬─────────────────────────────────────┘
 *                          │
 *                          ▼
 * ┌──────────────────────────────────────────────────────────────┐
 * │                      LiveQuery                               │
 * │  ┌─────────────────┐     ┌────────────────────────────────┐ │
 * │  │ Query Executor  │     │        EventReduce             │ │
 * │  │ (initial fetch) │     │   (incremental updates)        │ │
 * │  └────────┬────────┘     └───────────────┬────────────────┘ │
 * │           │                              │                   │
 * │           └──────────┬───────────────────┘                   │
 * │                      ▼                                       │
 * │           ┌─────────────────────┐                            │
 * │           │   BehaviorSubject   │                            │
 * │           │   (cached results)  │                            │
 * │           └──────────┬──────────┘                            │
 * └──────────────────────┼───────────────────────────────────────┘
 *                        │
 *                        ▼
 * ┌──────────────────────────────────────────────────────────────┐
 * │                   Subscribers                                 │
 * │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │
 * │  │ React Hooks  │  │ Vanilla JS   │  │  Framework X       │  │
 * │  │ useLiveQuery │  │ .subscribe() │  │   integration      │  │
 * │  └──────────────┘  └──────────────┘  └────────────────────┘  │
 * └──────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## EventReduce Optimization
 *
 * Instead of re-executing queries on every change, EventReduce analyzes
 * change events to determine the minimal update needed:
 *
 * | Event Type | Action | Performance |
 * |------------|--------|-------------|
 * | Insert (matches filter) | Insert at sorted position | O(log n) |
 * | Update (no sort change) | Update in place | O(1) |
 * | Update (sort changed) | Move to new position | O(log n) |
 * | Delete (not at limit) | Remove from results | O(1) |
 * | Delete (at limit) | Re-execute query | O(query) |
 *
 * @example Using LiveQuery directly
 * ```typescript
 * import { LiveQuery } from '@pocket/core';
 *
 * const liveQuery = new LiveQuery(
 *   { filter: { active: true }, sort: [{ field: 'name', direction: 'asc' }] },
 *   () => collection.find({ active: true }).exec(),
 *   collection.changes$,
 *   { debounceMs: 50 }
 * );
 *
 * await liveQuery.start();
 *
 * liveQuery.observable().subscribe(docs => {
 *   console.log('Active documents:', docs);
 * });
 * ```
 *
 * @example Using ObservableValue for state
 * ```typescript
 * import { ObservableValue } from '@pocket/core';
 *
 * const currentUser = new ObservableValue<User | null>(null);
 *
 * // Set user on login
 * currentUser.value = { id: '1', name: 'Alice' };
 *
 * // Subscribe to changes
 * currentUser.subscribe(user => {
 *   updateHeader(user);
 * });
 * ```
 *
 * @module observable
 *
 * @see {@link LiveQuery} for reactive queries
 * @see {@link reduceEvent} for the EventReduce algorithm
 * @see {@link ObservableValue} for reactive values
 */
export * from './event-reduce.js';
export * from './live-query.js';
export * from './observable.js';
