/**
 * React hooks for fetching single documents with live updates.
 *
 * @module hooks/use-document
 * @see {@link useDocument} - Fetch by ID
 * @see {@link useFindOne} - Fetch by filter
 */

import type { Document } from '@pocket/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCollection } from '../context/provider.js';

/**
 * Result returned by single document hooks.
 *
 * @typeParam T - The document type
 */
export interface DocumentResult<T extends Document> {
  /** The document data */
  data: T | null;
  /** Whether the document is loading */
  isLoading: boolean;
  /** Any error that occurred */
  error: Error | null;
  /** Force refresh the document */
  refresh: () => void;
}

/**
 * Configuration options for document hooks.
 */
export interface UseDocumentOptions {
  /** Disable the query */
  enabled?: boolean;
}

/**
 * React hook to fetch and subscribe to a single document by ID.
 *
 * Automatically updates when the document changes in the database.
 * Pass `null` as the document ID to disable the subscription.
 *
 * @typeParam T - The document type
 * @param collectionName - The name of the collection
 * @param documentId - The document ID to fetch, or `null` to disable
 * @param options - Optional configuration
 * @returns A {@link DocumentResult} with the document, loading state, and refresh function
 *
 * @example
 * ```tsx
 * // Basic usage
 * function UserProfile({ userId }: { userId: string }) {
 *   const { data: user, isLoading, error } = useDocument<User>('users', userId);
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <Error message={error.message} />;
 *   if (!user) return <NotFound />;
 *
 *   return <h1>{user.name}</h1>;
 * }
 *
 * // Conditionally enabled
 * function MaybeUser({ userId }: { userId: string | null }) {
 *   const { data } = useDocument<User>(
 *     'users',
 *     userId, // null disables the subscription
 *     { enabled: !!userId }
 *   );
 *   return data ? <UserCard user={data} /> : null;
 * }
 * ```
 *
 * @see {@link useFindOne} for finding by filter instead of ID
 * @see {@link useLiveQuery} for multiple document queries
 */
export function useDocument<T extends Document>(
  collectionName: string,
  documentId: string | null,
  options: UseDocumentOptions = {}
): DocumentResult<T> {
  const { enabled = true } = options;

  const collection = useCollection<T>(collectionName);

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);

  // Refresh function
  const refresh = useCallback(() => {
    if (!enabled || !documentId) return;

    setIsLoading(true);

    collection
      .get(documentId)
      .then((doc) => {
        if (mountedRef.current) {
          setData(doc);
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
  }, [collection, documentId, enabled]);

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled || !documentId) {
      setData(null);
      setIsLoading(false);
      return;
    }

    // Subscribe to document changes
    const subscription = collection.observeById(documentId).subscribe({
      next: (doc) => {
        if (mountedRef.current) {
          setData(doc);
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

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [collection, documentId, enabled]);

  return {
    data,
    isLoading,
    error,
    refresh,
  };
}

/**
 * React hook to find a single document matching a filter.
 *
 * Subscribes to collection changes and re-queries when data changes.
 * Returns the first document matching the filter, or `null` if none match.
 *
 * @typeParam T - The document type
 * @param collectionName - The name of the collection
 * @param filter - Filter object to match the document
 * @param options - Optional configuration
 * @returns A {@link DocumentResult} with the document, loading state, and refresh function
 *
 * @example
 * ```tsx
 * // Find user by email
 * function UserByEmail({ email }: { email: string }) {
 *   const { data: user, isLoading } = useFindOne<User>('users', { email });
 *
 *   if (isLoading) return <Spinner />;
 *   if (!user) return <div>User not found</div>;
 *
 *   return <UserProfile user={user} />;
 * }
 *
 * // Find active subscription
 * function ActiveSubscription({ userId }: { userId: string }) {
 *   const { data: subscription } = useFindOne<Subscription>(
 *     'subscriptions',
 *     { userId, status: 'active' }
 *   );
 *
 *   return subscription
 *     ? <SubscriptionCard subscription={subscription} />
 *     : <UpgradePrompt />;
 * }
 * ```
 *
 * @see {@link useDocument} for fetching by ID
 * @see {@link useLiveQuery} for multiple document queries
 */
export function useFindOne<T extends Document>(
  collectionName: string,
  filter: Partial<T>,
  options: UseDocumentOptions = {}
): DocumentResult<T> {
  const { enabled = true } = options;

  const collection = useCollection<T>(collectionName);

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const filterKey = JSON.stringify(filter);

  // Refresh function
  const refresh = useCallback(() => {
    if (!enabled) return;

    setIsLoading(true);

    collection
      .findOne(filter)
      .then((doc) => {
        if (mountedRef.current) {
          setData(doc);
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
  }, [collection, filterKey, enabled]);

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      setData(null);
      setIsLoading(false);
      return;
    }

    // Initial fetch
    refresh();

    // Subscribe to collection changes to update when matches change
    const subscription = collection.changes().subscribe({
      next: () => {
        // Re-query when any change occurs
        if (mountedRef.current) {
          refresh();
        }
      },
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [collection, filterKey, enabled, refresh]);

  return {
    data,
    isLoading,
    error,
    refresh,
  };
}
