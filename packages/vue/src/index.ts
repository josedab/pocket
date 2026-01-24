/**
 * @pocket/vue - Vue composables for Pocket database
 *
 * This package provides reactive Vue composables for interacting with
 * Pocket databases. It follows Vue 3 Composition API patterns and
 * integrates seamlessly with Vue's reactivity system.
 *
 * @example Basic setup
 * ```vue
 * <!-- App.vue -->
 * <script setup>
 * import { providePocket } from '@pocket/vue';
 * import { Database } from '@pocket/core';
 *
 * const db = Database.create({ name: 'my-app' });
 * providePocket(db);
 * </script>
 *
 * <template>
 *   <TodoList />
 * </template>
 * ```
 *
 * @example Using composables
 * ```vue
 * <!-- TodoList.vue -->
 * <script setup>
 * import { useLiveQuery, useMutation } from '@pocket/vue';
 *
 * interface Todo {
 *   _id: string;
 *   title: string;
 *   completed: boolean;
 * }
 *
 * const { data: todos, isLoading } = useLiveQuery<Todo>('todos');
 * const { insert, update, remove } = useMutation<Todo>('todos');
 * </script>
 *
 * <template>
 *   <div v-if="isLoading">Loading...</div>
 *   <ul v-else>
 *     <li v-for="todo in todos" :key="todo._id">
 *       <input
 *         type="checkbox"
 *         :checked="todo.completed"
 *         @change="update(todo._id, { completed: !todo.completed })"
 *       />
 *       {{ todo.title }}
 *       <button @click="remove(todo._id)">Delete</button>
 *     </li>
 *   </ul>
 * </template>
 * ```
 *
 * @module @pocket/vue
 */

// Context & Provider
export {
  PocketKey,
  createPocketPlugin,
  providePocket,
  useCollection,
  useDatabase,
  usePocketContext,
  usePocketReady,
  type PocketContextValue,
} from './context/provider.js';

// Composables
export {
  useDocument,
  useFindOne,
  useLiveQuery,
  useMutation,
  useOnlineStatus,
  useOptimisticMutation,
  useQuery,
  useSyncStatus,
  type DocumentResult,
  type LiveQueryResult,
  type MutationResult,
  type OptimisticMutation,
  type SyncEngine,
  type SyncStats,
  type SyncStatus,
  type SyncStatusResult,
  type UseDocumentOptions,
  type UseLiveQueryOptions,
  type UseMutationOptions,
  type UseOptimisticMutationOptions,
  type UseSyncStatusOptions,
} from './composables/index.js';
