/**
 * React bindings for Pocket - the local-first database.
 *
 * This package provides React hooks and components for integrating Pocket
 * with React applications. All hooks support live updates through RxJS
 * observables, automatically re-rendering components when data changes.
 *
 * ## Quick Start
 *
 * ```tsx
 * import { PocketProvider, useLiveQuery, useMutation } from '@pocket/react';
 * import { Database } from '@pocket/core';
 *
 * // 1. Create your database
 * const db = Database.create({ name: 'my-app' });
 *
 * // 2. Wrap your app with PocketProvider
 * function App() {
 *   return (
 *     <PocketProvider database={db}>
 *       <TodoList />
 *     </PocketProvider>
 *   );
 * }
 *
 * // 3. Use hooks in your components
 * function TodoList() {
 *   const { data: todos, isLoading } = useLiveQuery<Todo>('todos');
 *   const { insert, remove } = useMutation<Todo>('todos');
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return (
 *     <ul>
 *       {todos.map(todo => (
 *         <li key={todo._id}>
 *           {todo.title}
 *           <button onClick={() => remove(todo._id)}>Delete</button>
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 *
 * ## Available Hooks
 *
 * - {@link useLiveQuery} - Subscribe to query results with live updates
 * - {@link useQuery} - Simplified query hook with filter object
 * - {@link useDocument} - Fetch a single document by ID
 * - {@link useFindOne} - Find a single document by filter
 * - {@link useMutation} - Perform insert/update/delete operations
 * - {@link useOptimisticMutation} - Mutations with optimistic UI updates
 * - {@link useSyncStatus} - Monitor and control sync engine
 * - {@link useOnlineStatus} - Track browser online/offline state
 * - {@link useSuspenseQuery} - React Suspense-compatible queries
 *
 * @packageDocumentation
 * @module @pocket/react
 */

// Context
export * from './context/provider.js';

// Hooks
export * from './hooks/index.js';

// React Server Components Bridge
export {
  createHydrationPayload,
  createServerPocket,
  createSuspenseResource,
  serverQuery,
  validateHydrationPayload,
} from './rsc-bridge.js';
export type {
  HydrationPayload,
  ServerDatabase,
  ServerPocketConfig,
  ServerQueryResult,
  SuspenseConfig,
} from './rsc-bridge.js';
