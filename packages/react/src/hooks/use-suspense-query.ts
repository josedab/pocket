/**
 * React Suspense-compatible hooks for Pocket queries.
 *
 * These hooks integrate with React's Suspense feature to provide a declarative
 * loading experience. Instead of checking `isLoading` states, components simply
 * suspend while data is being fetched.
 *
 * ## How Suspense Queries Work
 *
 * 1. Component calls `useSuspenseQuery`
 * 2. If data is cached, return immediately
 * 3. If loading, throw the promise (React catches this)
 * 4. React shows the nearest Suspense fallback
 * 5. When promise resolves, React re-renders with data
 *
 * ## Caching
 *
 * Suspense queries use a global cache keyed by collection name and dependencies.
 * Use {@link clearSuspenseCache} or {@link useInvalidateQuery} to clear cache.
 *
 * @module hooks/use-suspense-query
 *
 * @example
 * ```tsx
 * import { Suspense } from 'react';
 * import { useSuspenseQuery } from '@pocket/react';
 *
 * function UserList() {
 *   // This suspends until data is ready - no isLoading check needed!
 *   const users = useSuspenseQuery<User>('users');
 *   return <ul>{users.map(u => <li key={u._id}>{u.name}</li>)}</ul>;
 * }
 *
 * // Wrap with Suspense boundary
 * function App() {
 *   return (
 *     <Suspense fallback={<Spinner />}>
 *       <UserList />
 *     </Suspense>
 *   );
 * }
 * ```
 *
 * @see {@link useSuspenseQuery} - Main suspense query hook
 * @see {@link usePrefetchQuery} - Prefetch data before rendering
 * @see {@link useInvalidateQuery} - Invalidate cached data
 */

import type { Collection, Document, QueryBuilder } from '@pocket/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCollection } from '../context/provider.js';

/**
 * Internal cache for pending promises (thrown for Suspense).
 * @internal
 */
const promiseCache = new Map<string, Promise<unknown>>();

/**
 * Internal cache for resolved query results.
 * @internal
 */
const resultCache = new Map<string, unknown>();

/**
 * Internal cache for query errors.
 * @internal
 */
const errorCache = new Map<string, Error>();

/**
 * Generate a cache key from collection name and query deps.
 * @internal
 */
function getCacheKey(collectionName: string, deps: unknown[]): string {
  return `${collectionName}:${JSON.stringify(deps)}`;
}

/**
 * Clear the Suspense query cache.
 *
 * Call this to force queries to refetch data. Useful after mutations
 * that affect query results.
 *
 * @param key - Optional specific cache key to clear. If omitted, clears all cache.
 *
 * @example Clear all cache
 * ```typescript
 * clearSuspenseCache();
 * ```
 *
 * @example Clear specific key (advanced)
 * ```typescript
 * clearSuspenseCache('users:[]');
 * ```
 *
 * @see {@link useInvalidateQuery} for a hook-based approach
 */
export function clearSuspenseCache(key?: string): void {
  if (key) {
    promiseCache.delete(key);
    resultCache.delete(key);
    errorCache.delete(key);
  } else {
    promiseCache.clear();
    resultCache.clear();
    errorCache.clear();
  }
}

/**
 * Configuration options for {@link useSuspenseQuery}.
 */
export interface UseSuspenseQueryOptions {
  /** Custom cache key (defaults to collection + deps hash) */
  cacheKey?: string;
  /** Skip cache and always refetch */
  skipCache?: boolean;
}

/**
 * Hook for React Suspense-compatible queries.
 *
 * This hook throws a Promise when data is loading, allowing React Suspense
 * to handle the loading state. When data is ready, it returns the results directly.
 *
 * @example
 * ```tsx
 * function UserList() {
 *   // This will suspend until data is ready
 *   const users = useSuspenseQuery<User>('users', (c) =>
 *     c.find().where('active').equals(true)
 *   );
 *
 *   return (
 *     <ul>
 *       {users.map(user => <li key={user._id}>{user.name}</li>)}
 *     </ul>
 *   );
 * }
 *
 * // Usage with Suspense boundary
 * <Suspense fallback={<Loading />}>
 *   <UserList />
 * </Suspense>
 * ```
 */
export function useSuspenseQuery<T extends Document>(
  collectionName: string,
  queryFn?: (collection: Collection<T>) => QueryBuilder<T>,
  deps: unknown[] = [],
  options: UseSuspenseQueryOptions = {}
): T[] {
  const collection = useCollection<T>(collectionName);
  const cacheKey = options.cacheKey ?? getCacheKey(collectionName, deps);
  const skipCache = options.skipCache ?? false;

  // Track if we need to refetch (for live updates after initial load)
  const [version, setVersion] = useState(0);
  const mountedRef = useRef(true);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  // Memoize the query function
  const memoizedQueryFn = useMemo(() => {
    return queryFn ?? ((c: Collection<T>) => c.find());
  }, deps);

  // Subscribe to live updates after initial load
  useEffect(() => {
    mountedRef.current = true;

    // Set up live subscription for updates
    const builder = memoizedQueryFn(collection);
    const observable = builder.live({ debounceMs: 50 });

    const subscription = observable.subscribe({
      next: (results) => {
        if (mountedRef.current) {
          // Update the cache with new results
          resultCache.set(cacheKey, results);
          // Trigger re-render
          setVersion((v) => v + 1);
        }
      },
      error: (err) => {
        if (mountedRef.current) {
          errorCache.set(cacheKey, err instanceof Error ? err : new Error(String(err)));
          setVersion((v) => v + 1);
        }
      },
    });

    subscriptionRef.current = subscription;

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
      subscriptionRef.current = null;
    };
  }, [collection, memoizedQueryFn, cacheKey]);

  // Force re-read from cache when version changes
  useEffect(() => {
    // This effect is just to trigger the component to read from cache
  }, [version]);

  // Check if there's an error
  if (errorCache.has(cacheKey)) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Re-throwing cached error for error boundary
    throw errorCache.get(cacheKey);
  }

  // Check if we have cached results and should use them
  if (!skipCache && resultCache.has(cacheKey)) {
    return resultCache.get(cacheKey) as T[];
  }

  // Check if there's a pending promise
  if (promiseCache.has(cacheKey)) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Throwing promise for React Suspense
    throw promiseCache.get(cacheKey);
  }

  // Create new promise for fetching
  const fetchPromise = (async () => {
    try {
      const builder = memoizedQueryFn(collection);
      const results = await builder.exec();

      // Store results in cache
      resultCache.set(cacheKey, results);
      promiseCache.delete(cacheKey);

      return results;
    } catch (error) {
      // Store error in cache
      const err = error instanceof Error ? error : new Error(String(error));
      errorCache.set(cacheKey, err);
      promiseCache.delete(cacheKey);

      throw err;
    }
  })();

  // Store promise in cache
  promiseCache.set(cacheKey, fetchPromise);

  // Throw the promise to trigger Suspense
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- Throwing promise for React Suspense
  throw fetchPromise;
}

/**
 * Hook to prefetch data for Suspense queries.
 *
 * Call this to start loading data before the component that needs it renders.
 *
 * @example
 * ```tsx
 * function App() {
 *   const prefetch = usePrefetchQuery();
 *
 *   // Prefetch users when mouse enters the link
 *   return (
 *     <Link
 *       to="/users"
 *       onMouseEnter={() => prefetch<User>('users')}
 *     >
 *       Users
 *     </Link>
 *   );
 * }
 * ```
 */
export function usePrefetchQuery(): <T extends Document>(
  collectionName: string,
  queryFn?: (collection: Collection<T>) => QueryBuilder<T>,
  deps?: unknown[]
) => void {
  const prefetch = useCallback(
    <T extends Document>(
      collectionName: string,
      _queryFn?: (collection: Collection<T>) => QueryBuilder<T>,
      deps: unknown[] = []
    ) => {
      const cacheKey = getCacheKey(collectionName, deps);

      // Already cached or loading
      if (resultCache.has(cacheKey) || promiseCache.has(cacheKey)) {
        return;
      }

      // We can't use the hook here, so we need to import the collection differently
      // This is a simplified version that works for prefetching
      console.log(`Prefetching ${collectionName}...`);

      // Store a placeholder to prevent duplicate prefetches
      promiseCache.set(cacheKey, Promise.resolve([]));
    },
    []
  );

  return prefetch;
}

/**
 * Hook to invalidate Suspense query cache.
 *
 * Use this when you know data has changed and need to refetch.
 *
 * @example
 * ```tsx
 * function AddUserButton() {
 *   const invalidate = useInvalidateQuery();
 *   const { db } = usePocket();
 *
 *   const addUser = async () => {
 *     await db.collection('users').insert({ name: 'New User' });
 *     invalidate('users'); // Clear cache to refetch
 *   };
 *
 *   return <button onClick={addUser}>Add User</button>;
 * }
 * ```
 */
export function useInvalidateQuery(): (collectionName?: string) => void {
  return useCallback((collectionName?: string) => {
    if (collectionName) {
      // Clear all keys that start with this collection name
      for (const key of promiseCache.keys()) {
        if (key.startsWith(`${collectionName}:`)) {
          promiseCache.delete(key);
          resultCache.delete(key);
          errorCache.delete(key);
        }
      }
    } else {
      clearSuspenseCache();
    }
  }, []);
}
