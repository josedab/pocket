/**
 * React hooks for Pocket database operations.
 *
 * This module provides the complete set of hooks for integrating Pocket
 * with React applications. All hooks are designed to work with React's
 * concurrent features and provide optimal re-render behavior.
 *
 * ## Hook Categories
 *
 * ### Querying Data
 * - {@link useLiveQuery} - Live queries with automatic updates
 * - {@link useQuery} - Simple filter-based queries
 * - {@link useDocument} - Single document by ID
 * - {@link useFindOne} - Single document by filter
 * - {@link useSuspenseQuery} - React Suspense integration
 *
 * ### Mutating Data
 * - {@link useMutation} - Insert, update, delete operations
 * - {@link useOptimisticMutation} - Mutations with optimistic UI
 *
 * ### Sync & Status
 * - {@link useSyncStatus} - Monitor sync engine state
 * - {@link useOnlineStatus} - Browser online/offline detection
 *
 * ## Example: Complete CRUD
 *
 * ```tsx
 * function TodoApp() {
 *   const { data: todos, isLoading } = useLiveQuery<Todo>('todos');
 *   const { insert, update, remove } = useMutation<Todo>('todos');
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return (
 *     <div>
 *       <AddTodoForm onAdd={(title) => insert({ title, completed: false })} />
 *       {todos.map(todo => (
 *         <TodoItem
 *           key={todo._id}
 *           todo={todo}
 *           onToggle={() => update(todo._id, { completed: !todo.completed })}
 *           onDelete={() => remove(todo._id)}
 *         />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 *
 * @module hooks
 */

export * from './use-document.js';
export * from './use-live-query.js';
export * from './use-mutation.js';
export * from './use-suspense-query.js';
export * from './use-sync-status.js';
