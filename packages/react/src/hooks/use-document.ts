import type { Document } from '@pocket/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCollection } from '../context/provider.js';

/**
 * Document hook result
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
 * Document hook options
 */
export interface UseDocumentOptions {
  /** Disable the query */
  enabled?: boolean;
}

/**
 * Hook to get a single document by ID with live updates
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
 * Hook to get a single document by filter
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
