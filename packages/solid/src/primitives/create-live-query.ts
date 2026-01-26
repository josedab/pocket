import type { Collection, Document, QueryBuilder } from '@pocket/core';
import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import { useCollection } from '../context/provider.js';

/**
 * Live query result
 */
export interface LiveQueryResult<T extends Document> {
  /** The query results (call to get value) */
  data: Accessor<T[]>;
  /** Whether the initial query is loading */
  isLoading: Accessor<boolean>;
  /** Any error that occurred */
  error: Accessor<Error | null>;
  /** Force refresh the query */
  refresh: () => void;
}

/**
 * Live query options
 */
export interface CreateLiveQueryOptions {
  /** Debounce updates (ms) */
  debounceMs?: number;
  /** Disable the query */
  enabled?: boolean | Accessor<boolean>;
  /** Use EventReduce optimization */
  useEventReduce?: boolean;
}

/**
 * Create a live query that automatically updates.
 *
 * Returns reactive accessors that update when the underlying collection changes.
 *
 * @param collectionName - Name of the collection to query
 * @param queryFn - Optional function to build the query
 * @param options - Query options
 *
 * @example Basic usage
 * ```tsx
 * import { createLiveQuery } from '@pocket/solid';
 * import { For, Show } from 'solid-js';
 *
 * function TodoList() {
 *   const { data, isLoading, error } = createLiveQuery<Todo>('todos');
 *
 *   return (
 *     <Show when={!isLoading()} fallback={<p>Loading...</p>}>
 *       <Show when={!error()} fallback={<p>Error: {error()?.message}</p>}>
 *         <ul>
 *           <For each={data()}>
 *             {(todo) => <li>{todo.title}</li>}
 *           </For>
 *         </ul>
 *       </Show>
 *     </Show>
 *   );
 * }
 * ```
 *
 * @example With query builder
 * ```tsx
 * const { data: activeTodos } = createLiveQuery<Todo>(
 *   'todos',
 *   (c) => c.find().where('completed').equals(false).orderBy('priority', 'desc')
 * );
 * ```
 *
 * @example Conditional query
 * ```tsx
 * const [showCompleted, setShowCompleted] = createSignal(false);
 *
 * const { data: todos } = createLiveQuery<Todo>(
 *   'todos',
 *   (c) => c.find({ completed: showCompleted() }),
 *   { enabled: true }
 * );
 * ```
 */
export function createLiveQuery<T extends Document>(
  collectionName: string,
  queryFn?: (collection: Collection<T>) => QueryBuilder<T>,
  options: CreateLiveQueryOptions = {}
): LiveQueryResult<T> {
  const { debounceMs = 0, enabled = true, useEventReduce = true } = options;

  const collection = useCollection<T>(collectionName);

  const [data, setData] = createSignal<T[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<Error | null>(null);

  let subscription: { unsubscribe: () => void } | null = null;

  const isEnabled = () => {
    if (typeof enabled === 'boolean') return enabled;
    return enabled();
  };

  const executeQuery = () => {
    // Clean up previous subscription
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }

    if (!isEnabled()) {
      setData([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // Build the query
    const builder = queryFn ? queryFn(collection) : collection.find();
    const observable = builder.live({
      debounceMs,
      useEventReduce,
    });

    // Subscribe to updates
    subscription = observable.subscribe({
      next: (results: T[]) => {
        setData(results);
        setIsLoading(false);
        setError(null);
      },
      error: (err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      },
    });
  };

  const refresh = () => {
    if (!isEnabled()) return;

    setIsLoading(true);

    const builder = queryFn ? queryFn(collection) : collection.find();
    builder
      .exec()
      .then((results: T[]) => {
        setData(results);
        setIsLoading(false);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });
  };

  // Start the query
  createEffect(() => {
    executeQuery();
  });

  // Cleanup on unmount
  onCleanup(() => {
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
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
 * Simplified live query with just filter.
 *
 * @param collectionName - Name of the collection to query
 * @param filter - Optional filter object or accessor
 * @param options - Query options
 *
 * @example
 * ```tsx
 * const { data: activeTodos } = createQuery<Todo>('todos', { completed: false });
 * ```
 */
export function createQuery<T extends Document>(
  collectionName: string,
  filter?: Partial<T> | Accessor<Partial<T>>,
  options: CreateLiveQueryOptions = {}
): LiveQueryResult<T> {
  const getFilter = () => {
    if (!filter) return undefined;
    if (typeof filter === 'function') return filter();
    return filter;
  };

  return createLiveQuery<T>(collectionName, (c) => c.find(getFilter()), options);
}
