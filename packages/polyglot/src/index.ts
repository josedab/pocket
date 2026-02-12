/**
 * @pocket/polyglot - Cross-Database Polyglot Queries for Pocket
 *
 * @example
 * ```typescript
 * import { createMemoryAdapter, createQueryFederation } from '@pocket/polyglot';
 *
 * // Create adapters
 * const usersDb = createMemoryAdapter('users-db');
 * const ordersDb = createMemoryAdapter('orders-db');
 *
 * // Create federation
 * const federation = createQueryFederation({ queryTimeout: 5000 });
 * federation.registerAdapter(usersDb);
 * federation.registerAdapter(ordersDb);
 *
 * // Connect adapters
 * await usersDb.connect();
 * await ordersDb.connect();
 *
 * // Insert data
 * await usersDb.execute({ source: 'users', operation: 'insert', data: { id: 1, name: 'Alice' } });
 * await ordersDb.execute({ source: 'orders', operation: 'insert', data: { id: 1, userId: 1, total: 99 } });
 *
 * // Cross-adapter join
 * const result = await federation.execute({
 *   source: 'users',
 *   operation: 'select',
 *   join: {
 *     targetAdapter: 'orders-db',
 *     targetCollection: 'orders',
 *     localField: 'id',
 *     foreignField: 'userId',
 *     type: 'inner',
 *   },
 * });
 *
 * console.log(result.data); // [{ id: 1, name: 'Alice', userId: 1, total: 99 }]
 * ```
 */

// Types
export type {
  AdapterConfig,
  AdapterType,
  DatabaseAdapter,
  FederationConfig,
  JoinSpec,
  PolyglotQuery,
  PolyglotResult,
  QueryPlan,
  QueryStep,
} from './types.js';

export { DEFAULT_FEDERATION_CONFIG } from './types.js';

// Memory Adapter
export { MemoryAdapter, createMemoryAdapter } from './memory-adapter.js';

// Query Federation
export { QueryFederation, createQueryFederation } from './query-federation.js';
