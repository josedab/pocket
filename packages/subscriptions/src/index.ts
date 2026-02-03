/**
 * @pocket/subscriptions - Query subscriptions with server push for Pocket
 *
 * Provides real-time delta delivery over WebSocket, allowing clients to
 * subscribe to queries and receive incremental updates as documents change.
 *
 * @example Server-side usage
 * ```typescript
 * import { createSubscriptionServer } from '@pocket/subscriptions';
 *
 * const server = createSubscriptionServer({
 *   batchIntervalMs: 50,
 *   maxSubscriptionsPerClient: 100,
 * });
 *
 * server.setSendToClient((clientId, message) => {
 *   // Send via your WebSocket infrastructure
 *   ws.send(JSON.stringify(message));
 * });
 *
 * // Route changes to subscriptions
 * server.processChange('users', changeEvent);
 * ```
 *
 * @example Client-side usage
 * ```typescript
 * import { createSubscriptionClient } from '@pocket/subscriptions';
 *
 * const client = createSubscriptionClient();
 * client.connect(transport);
 *
 * const sub = client.subscribe({
 *   id: 'active-users',
 *   collection: 'users',
 *   filter: { status: 'active' },
 *   sort: { name: 'asc' },
 *   limit: 50,
 * });
 *
 * sub.results$.subscribe(users => {
 *   console.log('Current active users:', users);
 * });
 *
 * sub.delta$.subscribe(delta => {
 *   console.log('Delta:', delta.added.length, 'added,', delta.removed.length, 'removed');
 * });
 *
 * // Later: cleanup
 * sub.unsubscribe();
 * ```
 */

// Types
export type {
  ClientSubscription,
  SubscriptionDelta,
  SubscriptionManagerConfig,
  SubscriptionMessage,
  SubscriptionQuery,
  SubscriptionStats,
  ServerSubscriptionState,
} from './types.js';

// Re-export core types used in the API
export type { ChangeEvent, Document } from './types.js';

// Filter Matcher
export { FilterMatcher, createFilterMatcher } from './filter-matcher.js';

// Server
export {
  SubscriptionRegistry,
  createSubscriptionRegistry,
} from './server/subscription-registry.js';

export { DeltaComputer, createDeltaComputer } from './server/delta-computer.js';

export {
  SubscriptionServer,
  createSubscriptionServer,
  type SendToClient,
} from './server/subscription-server.js';

// Client
export {
  SubscriptionClient,
  createSubscriptionClient,
  type SubscriptionTransport,
} from './client/subscription-client.js';
