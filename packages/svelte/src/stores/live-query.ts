import type { Collection, Document, QueryBuilder } from '@pocket/core';
import { readable, writable, type Readable } from 'svelte/store';
import { getCollection } from '../context/provider.js';

/**
 * Live query store value
 */
export interface LiveQueryStore<T extends Document> extends Readable<T[]> {
  /** Whether the initial query is loading */
  isLoading: Readable<boolean>;
  /** Any error that occurred */
  error: Readable<Error | null>;
  /** Force refresh the query */
  refresh: () => void;
}

/**
 * Live query options
 */
export interface CreateLiveQueryOptions {
  /** Debounce updates (ms) */
  debounceMs?: number;
  /** Initial enabled state */
  enabled?: boolean;
  /** Use EventReduce optimization */
  useEventReduce?: boolean;
}

/**
 * Create a live query store.
 *
 * Returns a Svelte store that automatically updates when the underlying
 * collection changes.
 *
 * @param collectionName - Name of the collection to query
 * @param queryFn - Optional function to build the query
 * @param options - Query options
 *
 * @example Basic usage
 * ```svelte
 * <script>
 * import { createLiveQuery } from '@pocket/svelte';
 *
 * const todos = createLiveQuery('todos');
 * </script>
 *
 * {#if $todos.isLoading}
 *   <p>Loading...</p>
 * {:else if $todos.error}
 *   <p>Error: {$todos.error.message}</p>
 * {:else}
 *   <ul>
 *     {#each $todos as todo}
 *       <li>{todo.title}</li>
 *     {/each}
 *   </ul>
 * {/if}
 * ```
 *
 * @example With query builder
 * ```svelte
 * <script>
 * import { createLiveQuery } from '@pocket/svelte';
 *
 * const activeTodos = createLiveQuery(
 *   'todos',
 *   (c) => c.find().where('completed').equals(false).orderBy('priority', 'desc')
 * );
 * </script>
 * ```
 */
export function createLiveQuery<T extends Document>(
  collectionName: string,
  queryFn?: (collection: Collection<T>) => QueryBuilder<T>,
  options: CreateLiveQueryOptions = {}
): LiveQueryStore<T> {
  const { debounceMs = 0, enabled = true, useEventReduce = true } = options;

  const collection = getCollection<T>(collectionName);

  const data = writable<T[]>([]);
  const isLoading = writable(true);
  const error = writable<Error | null>(null);

  let subscription: { unsubscribe: () => void } | null = null;
  const isEnabled = enabled;

  const subscribe = () => {
    // Clean up previous subscription
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }

    if (!isEnabled) {
      data.set([]);
      isLoading.set(false);
      return;
    }

    isLoading.set(true);

    // Build the query
    const builder = queryFn ? queryFn(collection) : collection.find();
    const observable = builder.live({
      debounceMs,
      useEventReduce,
    });

    // Subscribe to updates
    subscription = observable.subscribe({
      next: (results: T[]) => {
        data.set(results);
        isLoading.set(false);
        error.set(null);
      },
      error: (err: unknown) => {
        error.set(err instanceof Error ? err : new Error(String(err)));
        isLoading.set(false);
      },
    });
  };

  const refresh = () => {
    if (!isEnabled) return;

    isLoading.set(true);

    const builder = queryFn ? queryFn(collection) : collection.find();
    builder
      .exec()
      .then((results: T[]) => {
        data.set(results);
        isLoading.set(false);
        error.set(null);
      })
      .catch((err: unknown) => {
        error.set(err instanceof Error ? err : new Error(String(err)));
        isLoading.set(false);
      });
  };

  // Start the subscription
  subscribe();

  // Create the store
  const store: LiveQueryStore<T> = {
    subscribe: data.subscribe,
    isLoading: { subscribe: isLoading.subscribe },
    error: { subscribe: error.subscribe },
    refresh,
  };

  return store;
}

/**
 * Create a simple query store with just filter.
 *
 * @param collectionName - Name of the collection to query
 * @param filter - Optional filter object
 * @param options - Query options
 *
 * @example
 * ```svelte
 * <script>
 * import { createQuery } from '@pocket/svelte';
 *
 * const activeTodos = createQuery('todos', { completed: false });
 * </script>
 * ```
 */
export function createQuery<T extends Document>(
  collectionName: string,
  filter?: Partial<T>,
  options: CreateLiveQueryOptions = {}
): LiveQueryStore<T> {
  return createLiveQuery<T>(collectionName, (c) => c.find(filter), options);
}

/**
 * Reactive query state
 */
export interface ReactiveQueryState<T extends Document> {
  data: T[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Create a reactive live query that responds to external state.
 *
 * @param collectionName - Name of the collection to query
 * @param filterStore - A store containing the filter
 * @param options - Query options
 *
 * @example
 * ```svelte
 * <script>
 * import { writable, derived } from 'svelte/store';
 * import { createReactiveQuery } from '@pocket/svelte';
 *
 * const showCompleted = writable(false);
 * const filter = derived(showCompleted, (show) => ({ completed: show }));
 *
 * const todos = createReactiveQuery('todos', filter);
 * </script>
 * ```
 */
export function createReactiveQuery<T extends Document>(
  collectionName: string,
  filterStore: Readable<Partial<T> | undefined>,
  options: CreateLiveQueryOptions = {}
): Readable<ReactiveQueryState<T>> {
  const { debounceMs = 0, useEventReduce = true } = options;

  const collection = getCollection<T>(collectionName);

  const initialState: ReactiveQueryState<T> = {
    data: [],
    isLoading: true,
    error: null,
  };

  return readable<ReactiveQueryState<T>>(initialState, (set) => {
    let subscription: { unsubscribe: () => void } | null = null;

    const unsubscribeFilter = filterStore.subscribe((filter) => {
      // Clean up previous subscription
      if (subscription) {
        subscription.unsubscribe();
        subscription = null;
      }

      set({ data: [], isLoading: true, error: null });

      // Build the query
      const builder = collection.find(filter);
      const observable = builder.live({
        debounceMs,
        useEventReduce,
      });

      // Subscribe to updates
      subscription = observable.subscribe({
        next: (results: T[]) => {
          set({ data: results, isLoading: false, error: null });
        },
        error: (err: unknown) => {
          set({
            data: [],
            isLoading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        },
      });
    });

    return () => {
      unsubscribeFilter();
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  });
}
