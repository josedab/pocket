/**
 * @packageDocumentation
 *
 * # Pocket React Integration
 *
 * React hooks and components for building reactive, offline-first UIs
 * with Pocket database.
 *
 * ## Installation
 *
 * React bindings are included in the main `pocket` package:
 *
 * ```bash
 * npm install pocket
 * ```
 *
 * ## Quick Start
 *
 * ```tsx
 * import { createDatabase, createIndexedDBStorage } from 'pocket';
 * import { PocketProvider, useLiveQuery, useMutation } from 'pocket/react';
 *
 * // Create database outside component
 * const db = await createDatabase({
 *   name: 'my-app',
 *   storage: createIndexedDBStorage(),
 * });
 *
 * // Wrap your app with PocketProvider
 * function App() {
 *   return (
 *     <PocketProvider database={db}>
 *       <TodoList />
 *     </PocketProvider>
 *   );
 * }
 *
 * // Use hooks in your components
 * function TodoList() {
 *   // Live query - automatically updates when data changes
 *   const { data: todos, isLoading, error } = useLiveQuery('todos', {
 *     filter: { completed: false },
 *     sort: { createdAt: -1 }
 *   });
 *
 *   // Mutations for modifying data
 *   const { insert, update, remove } = useMutation('todos');
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *
 *   return (
 *     <ul>
 *       {todos.map(todo => (
 *         <li key={todo._id}>
 *           <span>{todo.title}</span>
 *           <button onClick={() => update(todo._id, { completed: true })}>
 *             Complete
 *           </button>
 *           <button onClick={() => remove(todo._id)}>
 *             Delete
 *           </button>
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 *
 * ## Available Hooks
 *
 * | Hook | Description |
 * |------|-------------|
 * | {@link useLiveQuery} | Subscribe to a reactive query |
 * | {@link useMutation} | Get insert/update/delete functions |
 * | {@link useDocument} | Fetch a single document by ID |
 * | {@link useFindOne} | Find a single document matching a query |
 * | {@link useCollection} | Get a collection instance |
 * | {@link useDatabase} | Get the database instance |
 * | {@link useSyncStatus} | Monitor sync engine status |
 * | {@link useOnlineStatus} | Monitor browser online/offline state |
 * | {@link useOptimisticMutation} | Mutations with optimistic updates |
 *
 * ## Example: Optimistic Updates
 *
 * ```tsx
 * function TodoItem({ todo }) {
 *   const { mutate, isLoading } = useOptimisticMutation('todos', {
 *     // Immediately show the optimistic result
 *     optimisticUpdate: (oldData) =>
 *       oldData.map(t => t._id === todo._id ? { ...t, completed: true } : t),
 *     // Roll back if the mutation fails
 *     rollbackOnError: true
 *   });
 *
 *   return (
 *     <button
 *       disabled={isLoading}
 *       onClick={() => mutate({ id: todo._id, data: { completed: true } })}
 *     >
 *       {isLoading ? 'Completing...' : 'Complete'}
 *     </button>
 *   );
 * }
 * ```
 *
 * ## Example: With Sync Status
 *
 * ```tsx
 * function SyncIndicator() {
 *   const { status, lastSyncAt, error } = useSyncStatus();
 *
 *   if (status === 'syncing') return <Spinner />;
 *   if (status === 'error') return <ErrorIcon title={error?.message} />;
 *   if (status === 'offline') return <OfflineIcon />;
 *
 *   return <SyncedIcon />;
 * }
 * ```
 *
 * @module pocket/react
 *
 * @see {@link PocketProvider} for the context provider
 * @see {@link useLiveQuery} for reactive queries
 * @see {@link useMutation} for data mutations
 */

export {
  // Context
  PocketProvider,
  useCollection,
  useDatabase,
  useDocument,
  useFindOne,
  // Hooks
  useLiveQuery,
  useMutation,
  useOnlineStatus,
  useOptimisticMutation,
  usePocketContext,
  useQuery,
  useSyncStatus,
  type DocumentResult,
  type LiveQueryResult,
  type MutationResult,
  type OptimisticMutation,
  type OptimisticMutationOptions,
  type PocketContextValue,
  type PocketProviderProps,
  type SyncEngine as SyncEngineInterface,
  type SyncStatusResult,
  type UseDocumentOptions,
  type UseLiveQueryOptions,
  type UseMutationOptions,
  type UseSyncStatusOptions,
} from '@pocket/react';
