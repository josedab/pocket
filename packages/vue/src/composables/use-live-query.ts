import type { Collection, Document, QueryBuilder } from '@pocket/core';
import { computed, onMounted, onUnmounted, ref, type Ref, watch } from 'vue';
import { useCollection } from '../context/provider.js';

/**
 * Live query result
 */
export interface LiveQueryResult<T extends Document> {
  /** The query results */
  data: Ref<T[]>;
  /** Whether the initial query is loading */
  isLoading: Ref<boolean>;
  /** Any error that occurred */
  error: Ref<Error | null>;
  /** Force refresh the query */
  refresh: () => void;
}

/**
 * Live query options
 */
export interface UseLiveQueryOptions {
  /** Debounce updates (ms) */
  debounceMs?: number;
  /** Disable the query */
  enabled?: boolean | Ref<boolean>;
  /** Use EventReduce optimization */
  useEventReduce?: boolean;
}

/**
 * Composable for live updating queries.
 *
 * Returns reactive data that automatically updates when the underlying
 * collection changes.
 *
 * @param collectionName - Name of the collection to query
 * @param queryFn - Optional function to build the query
 * @param options - Query options
 *
 * @example Basic usage
 * ```vue
 * <script setup>
 * import { useLiveQuery } from '@pocket/vue';
 *
 * const { data: todos, isLoading, error } = useLiveQuery<Todo>('todos');
 * </script>
 *
 * <template>
 *   <div v-if="isLoading">Loading...</div>
 *   <div v-else-if="error">Error: {{ error.message }}</div>
 *   <ul v-else>
 *     <li v-for="todo in todos" :key="todo._id">{{ todo.title }}</li>
 *   </ul>
 * </template>
 * ```
 *
 * @example With query builder
 * ```vue
 * <script setup>
 * import { useLiveQuery } from '@pocket/vue';
 *
 * const { data: activeTodos } = useLiveQuery<Todo>(
 *   'todos',
 *   (c) => c.find().where('completed').equals(false).orderBy('priority', 'desc')
 * );
 * </script>
 * ```
 *
 * @example Conditional query
 * ```vue
 * <script setup>
 * import { ref } from 'vue';
 * import { useLiveQuery } from '@pocket/vue';
 *
 * const showCompleted = ref(false);
 *
 * const { data: todos } = useLiveQuery<Todo>(
 *   'todos',
 *   (c) => c.find({ completed: showCompleted.value }),
 *   { enabled: true }
 * );
 * </script>
 * ```
 */
export function useLiveQuery<T extends Document>(
  collectionName: string,
  queryFn?: (collection: Collection<T>) => QueryBuilder<T>,
  options: UseLiveQueryOptions = {}
): LiveQueryResult<T> {
  const { debounceMs = 0, enabled = true, useEventReduce = true } = options;

  const collection = useCollection<T>(collectionName);

  const data = ref<T[]>([]) as Ref<T[]>;
  const isLoading = ref(true);
  const error = ref<Error | null>(null);

  let subscription: { unsubscribe: () => void } | null = null;
  let mounted = true;

  const isEnabled = computed(() => {
    if (typeof enabled === 'boolean') return enabled;
    return enabled.value;
  });

  const executeQuery = () => {
    if (!isEnabled.value) {
      data.value = [];
      isLoading.value = false;
      return;
    }

    isLoading.value = true;

    // Clean up previous subscription
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }

    // Build the query
    const builder = queryFn ? queryFn(collection) : collection.find();
    const observable = builder.live({
      debounceMs,
      useEventReduce,
    });

    // Subscribe to updates
    subscription = observable.subscribe({
      next: (results: T[]) => {
        if (mounted) {
          data.value = results;
          isLoading.value = false;
          error.value = null;
        }
      },
      error: (err: unknown) => {
        if (mounted) {
          error.value = err instanceof Error ? err : new Error(String(err));
          isLoading.value = false;
        }
      },
    });
  };

  const refresh = () => {
    if (!isEnabled.value) return;

    isLoading.value = true;

    const builder = queryFn ? queryFn(collection) : collection.find();
    builder
      .exec()
      .then((results: T[]) => {
        if (mounted) {
          data.value = results;
          isLoading.value = false;
          error.value = null;
        }
      })
      .catch((err: unknown) => {
        if (mounted) {
          error.value = err instanceof Error ? err : new Error(String(err));
          isLoading.value = false;
        }
      });
  };

  onMounted(() => {
    mounted = true;
    executeQuery();
  });

  onUnmounted(() => {
    mounted = false;
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }
  });

  // Watch for enabled changes
  watch(isEnabled, (newEnabled) => {
    if (newEnabled) {
      executeQuery();
    } else {
      if (subscription) {
        subscription.unsubscribe();
        subscription = null;
      }
      data.value = [];
      isLoading.value = false;
    }
  });

  return {
    data,
    isLoading,
    error,
    refresh,
  };
}

/**
 * Simplified live query composable with just collection name and filter.
 *
 * @param collectionName - Name of the collection to query
 * @param filter - Optional filter object
 * @param options - Query options
 *
 * @example
 * ```vue
 * <script setup>
 * import { useQuery } from '@pocket/vue';
 *
 * const { data: activeTodos } = useQuery<Todo>('todos', { completed: false });
 * </script>
 * ```
 */
export function useQuery<T extends Document>(
  collectionName: string,
  filter?: Partial<T> | Ref<Partial<T>>,
  options: UseLiveQueryOptions = {}
): LiveQueryResult<T> {
  const filterValue = computed(() => {
    if (!filter) return undefined;
    if ('value' in filter) return filter.value;
    return filter;
  });

  return useLiveQuery<T>(collectionName, (c) => c.find(filterValue.value), options);
}
