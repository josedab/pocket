/**
 * @pocket/solid - SolidJS primitives for Pocket database
 *
 * This package provides reactive SolidJS primitives for interacting with
 * Pocket databases. It follows SolidJS patterns and integrates seamlessly
 * with Solid's fine-grained reactivity system.
 *
 * @example Basic setup
 * ```tsx
 * // App.tsx
 * import { PocketProvider } from '@pocket/solid';
 * import { Database } from '@pocket/core';
 *
 * const db = Database.create({ name: 'my-app' });
 *
 * function App() {
 *   return (
 *     <PocketProvider database={db}>
 *       <TodoList />
 *     </PocketProvider>
 *   );
 * }
 * ```
 *
 * @example Using primitives
 * ```tsx
 * // TodoList.tsx
 * import { createLiveQuery, createMutation } from '@pocket/solid';
 * import { For, Show } from 'solid-js';
 *
 * interface Todo {
 *   _id: string;
 *   title: string;
 *   completed: boolean;
 * }
 *
 * function TodoList() {
 *   const { data: todos, isLoading } = createLiveQuery<Todo>('todos');
 *   const { insert, update, remove } = createMutation<Todo>('todos');
 *
 *   return (
 *     <Show when={!isLoading()} fallback={<p>Loading...</p>}>
 *       <ul>
 *         <For each={todos()}>
 *           {(todo) => (
 *             <li>
 *               <input
 *                 type="checkbox"
 *                 checked={todo.completed}
 *                 onChange={() => update(todo._id, { completed: !todo.completed })}
 *               />
 *               {todo.title}
 *               <button onClick={() => remove(todo._id)}>Delete</button>
 *             </li>
 *           )}
 *         </For>
 *       </ul>
 *     </Show>
 *   );
 * }
 * ```
 *
 * @module @pocket/solid
 */

// Context & Provider
export {
  PocketProvider,
  useCollection,
  useDatabase,
  usePocketContext,
  usePocketReady,
  type PocketContextValue,
  type PocketProviderProps,
} from './context/provider.js';

// Primitives
export {
  createDocument,
  createFindOne,
  createLiveQuery,
  createMutation,
  createOnlineStatus,
  createOptimisticMutation,
  createQuery,
  createSyncStatus,
  type CreateDocumentOptions,
  type CreateLiveQueryOptions,
  type CreateMutationOptions,
  type CreateOptimisticMutationOptions,
  type CreateSyncStatusOptions,
  type DocumentResult,
  type LiveQueryResult,
  type MutationResult,
  type OptimisticMutation,
  type SyncEngine,
  type SyncStats,
  type SyncStatus,
  type SyncStatusResult,
} from './primitives/index.js';
