import type { Collection, Document, QueryBuilder } from '@pocket/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCollection } from '../context/provider.js';

/**
 * Live query result
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
 * Live query options
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
 * Hook for live updating queries
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
 * Simplified live query hook with just collection name and filter
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
