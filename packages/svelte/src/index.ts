/**
 * @pocket/svelte - Svelte stores for Pocket database
 *
 * This package provides reactive Svelte stores for interacting with
 * Pocket databases. It follows Svelte store patterns and integrates
 * seamlessly with Svelte's reactivity system.
 *
 * @example Basic setup
 * ```svelte
 * <!-- App.svelte -->
 * <script>
 * import { setPocketContext } from '@pocket/svelte';
 * import { Database } from '@pocket/core';
 *
 * const db = Database.create({ name: 'my-app' });
 * setPocketContext(db);
 * </script>
 *
 * <TodoList />
 * ```
 *
 * @example Using stores
 * ```svelte
 * <!-- TodoList.svelte -->
 * <script>
 * import { createLiveQuery, createMutation } from '@pocket/svelte';
 *
 * const todos = createLiveQuery('todos');
 * const { insert, update, remove } = createMutation('todos');
 * </script>
 *
 * {#if $todos.isLoading}
 *   <p>Loading...</p>
 * {:else}
 *   <ul>
 *     {#each $todos as todo}
 *       <li>
 *         <input
 *           type="checkbox"
 *           checked={todo.completed}
 *           on:change={() => update(todo._id, { completed: !todo.completed })}
 *         />
 *         {todo.title}
 *         <button on:click={() => remove(todo._id)}>Delete</button>
 *       </li>
 *     {/each}
 *   </ul>
 * {/if}
 * ```
 *
 * @module @pocket/svelte
 */

// Context & Provider
export {
  getCollection,
  getDatabase,
  getDatabaseStore,
  getErrorStore,
  getPocketContext,
  getReadyStore,
  setPocketContext,
  type PocketContextValue,
} from './context/provider.js';

// Stores
export {
  createDocument,
  createFindOne,
  createLiveQuery,
  createMutation,
  createOnlineStatus,
  createOptimisticMutation,
  createQuery,
  createReactiveDocument,
  createReactiveQuery,
  createSyncStatus,
  type CreateDocumentOptions,
  type CreateLiveQueryOptions,
  type CreateMutationOptions,
  type CreateOptimisticMutationOptions,
  type CreateSyncStatusOptions,
  type DocumentStore,
  type LiveQueryStore,
  type MutationStore,
  type OptimisticMutation,
  type SyncEngine,
  type SyncStats,
  type SyncStatus,
  type SyncStatusStore,
} from './stores/index.js';
