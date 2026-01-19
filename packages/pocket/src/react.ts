/**
 * Pocket React integration
 *
 * @example
 * ```tsx
 * import { PocketProvider, useLiveQuery, useMutation } from 'pocket/react';
 *
 * function App() {
 *   return (
 *     <PocketProvider database={db}>
 *       <TodoList />
 *     </PocketProvider>
 *   );
 * }
 *
 * function TodoList() {
 *   const { data: todos, isLoading } = useLiveQuery('todos');
 *   const { insert } = useMutation('todos');
 *
 *   if (isLoading) return <div>Loading...</div>;
 *
 *   return (
 *     <ul>
 *       {todos.map(todo => <li key={todo._id}>{todo.title}</li>)}
 *     </ul>
 *   );
 * }
 * ```
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
