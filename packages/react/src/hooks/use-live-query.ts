/**
 * React hooks for live/reactive database queries.
 *
 * These hooks provide real-time data synchronization between Pocket collections
 * and React components. When underlying data changes, components automatically
 * re-render with the latest results.
 *
 * @module hooks/use-live-query
 * @see {@link useLiveQuery} - Full-featured live query hook
 * @see {@link useQuery} - Simplified filter-based query hook
 */

import type { Collection, Document, QueryBuilder } from '@pocket/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCollection } from '../context/provider.js';

/**
 * Result returned by live query hooks.
 *
 * @typeParam T - The document type being queried
 */
export interface LiveQueryResult<T extends Document> {
  /** The query results */
  data: T[];
  /** Whether the initial query is loading */
  isLoading: boolean;
  /** Any error that occurred */
  error: Error | null;
  /** Force refresh the query */
  refresh: () => void;
}

/**
 * Configuration options for live query hooks.
 */
export interface UseLiveQueryOptions {
  /** Debounce updates (ms) */
  debounceMs?: number;
  /** Disable the query */
  enabled?: boolean;
  /** Use EventReduce optimization */
  useEventReduce?: boolean;
}

/**
 * React hook for live/reactive database queries.
 *
 * Subscribes to a Pocket collection query and automatically updates
 * when underlying data changes. Uses the EventReduce algorithm for
 * efficient incremental updates.
 *
 * @typeParam T - The document type being queried
 * @param collectionName - The name of the collection to query
 * @param queryFn - Function that builds the query using the QueryBuilder API.
 *                  Receives the collection and should return a QueryBuilder.
 *                  Defaults to returning all documents.
 * @param deps - Dependency array for memoizing the query function.
 *               Re-subscribes when deps change (similar to useEffect).
 * @param options - Configuration options for debouncing, enabling, etc.
 * @returns A {@link LiveQueryResult} with data, loading state, error, and refresh function
 *
 * @example
 * ```tsx
 * // Basic usage - get all todos
 * function TodoList() {
 *   const { data: todos, isLoading } = useLiveQuery<Todo>('todos');
 *
 *   if (isLoading) return <Spinner />;
 *   return <ul>{todos.map(t => <li key={t._id}>{t.title}</li>)}</ul>;
 * }
 *
 * // With query builder
 * function ActiveTodos() {
 *   const { data, error, refresh } = useLiveQuery<Todo>(
 *     'todos',
 *     (c) => c.find({ completed: false }).sort({ createdAt: 'desc' }).limit(10),
 *     [], // deps - resubscribe when these change
 *     { debounceMs: 100 } // debounce rapid updates
 *   );
 *
 *   if (error) return <Error message={error.message} />;
 *   return <TodoItems items={data} onRefresh={refresh} />;
 * }
 *
 * // Dynamic query based on props
 * function UserTodos({ userId }: { userId: string }) {
 *   const { data } = useLiveQuery<Todo>(
 *     'todos',
 *     (c) => c.find({ userId }),
 *     [userId] // Re-subscribe when userId changes
 *   );
 *   return <TodoList todos={data} />;
 * }
 * ```
 *
 * @see {@link useQuery} for a simpler filter-based API
 * @see {@link useDocument} for single document queries
 */
export function useLiveQuery<T extends Document>(
  collectionName: string,
  queryFn?: (collection: Collection<T>) => QueryBuilder<T>,
  deps: unknown[] = [],
  options: UseLiveQueryOptions = {}
): LiveQueryResult<T> {
  const { debounceMs = 0, enabled = true, useEventReduce = true } = options;

  const collection = useCollection<T>(collectionName);

  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const mountedRef = useRef(true);

  // Memoize the query function to avoid unnecessary re-subscriptions
  const memoizedQueryFn = useMemo(() => {
    return queryFn ?? ((c: Collection<T>) => c.find());
  }, deps);

  // Refresh function
  const refresh = useCallback(() => {
    if (!enabled) return;

    setIsLoading(true);

    const builder = memoizedQueryFn(collection);
    builder
      .exec()
      .then((results) => {
        if (mountedRef.current) {
          setData(results);
          setIsLoading(false);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      });
  }, [collection, memoizedQueryFn, enabled]);

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      setData([]);
      setIsLoading(false);
      return;
    }

    // Create live query
    const builder = memoizedQueryFn(collection);
    const observable = builder.live({
      debounceMs,
      useEventReduce,
    });

    // Subscribe to updates
    const subscription = observable.subscribe({
      next: (results) => {
        if (mountedRef.current) {
          setData(results);
          setIsLoading(false);
          setError(null);
        }
      },
      error: (err) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      },
    });

    subscriptionRef.current = subscription;

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
      subscriptionRef.current = null;
    };
  }, [collection, memoizedQueryFn, debounceMs, useEventReduce, enabled]);

  return {
    data,
    isLoading,
    error,
    refresh,
  };
}

/**
 * Simplified live query hook using a filter object.
 *
 * A convenience wrapper around {@link useLiveQuery} for simple filter-based
 * queries. For more complex queries (sorting, pagination, projection),
 * use {@link useLiveQuery} with a query builder function.
 *
 * @typeParam T - The document type being queried
 * @param collectionName - The name of the collection to query
 * @param filter - Optional filter object to match documents
 * @param options - Configuration options
 * @returns A {@link LiveQueryResult} with data, loading state, error, and refresh function
 *
 * @example
 * ```tsx
 * // Get all active users
 * const { data: activeUsers } = useQuery<User>('users', { status: 'active' });
 *
 * // Get all documents (no filter)
 * const { data: allTodos } = useQuery<Todo>('todos');
 *
 * // With options
 * const { data } = useQuery<Product>(
 *   'products',
 *   { category: 'electronics' },
 *   { debounceMs: 200, enabled: isVisible }
 * );
 * ```
 */
export function useQuery<T extends Document>(
  collectionName: string,
  filter?: Partial<T>,
  options: UseLiveQueryOptions = {}
): LiveQueryResult<T> {
  return useLiveQuery<T>(
    collectionName,
    (c) => c.find(filter),
    filter ? [JSON.stringify(filter)] : [],
    options
  );
}
