import type { Collection, Document } from '@pocket/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePocket } from './context.js';
import type {
  UseDocumentOptions,
  UseDocumentResult,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from './types.js';

/**
 * Hook to get a collection
 */
export function useCollection<T extends Document>(name: string): Collection<T> | null {
  const { collection, isReady } = usePocket();

  if (!isReady) return null;
  return collection<T>(name);
}

/**
 * Hook to fetch a single document by ID
 */
export function useDocument<T extends Document>(
  collectionName: string,
  id: string | null | undefined,
  options: UseDocumentOptions = {}
): UseDocumentResult<T> {
  const { collection: getCollection, isReady } = usePocket();
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(!options.skip && !!id);
  const [error, setError] = useState<Error | null>(null);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  const fetchDocument = useCallback(async () => {
    if (!isReady || !id || options.skip) {
      setIsLoading(false);
      return;
    }

    const col = getCollection<T>(collectionName);
    if (!col) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const doc = await col.get(id);
      setData(doc);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch document'));
    } finally {
      setIsLoading(false);
    }
  }, [isReady, id, collectionName, getCollection, options.skip]);

  // Initial fetch
  useEffect(() => {
    void fetchDocument();
  }, [fetchDocument]);

  // Subscribe to changes
  useEffect(() => {
    if (!isReady || !id || options.skip) return;

    const col = getCollection<T>(collectionName);
    if (!col) return;

    const subscription = col.observeById(id).subscribe((doc) => {
      setData(doc);
    });

    subscriptionRef.current = subscription;

    return () => {
      subscription.unsubscribe();
      subscriptionRef.current = null;
    };
  }, [isReady, id, collectionName, getCollection, options.skip]);

  // Update function
  const update = useCallback(
    async (changes: Partial<T>): Promise<T | null> => {
      if (!isReady || !id) return null;

      const col = getCollection<T>(collectionName);
      if (!col) return null;

      try {
        const updated = await col.update(id, changes);
        setData(updated);
        return updated;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to update document'));
        return null;
      }
    },
    [isReady, id, collectionName, getCollection]
  );

  // Remove function
  const remove = useCallback(async (): Promise<void> => {
    if (!isReady || !id) return;

    const col = getCollection<T>(collectionName);
    if (!col) return;

    try {
      await col.delete(id);
      setData(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to delete document'));
    }
  }, [isReady, id, collectionName, getCollection]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchDocument,
    update,
    remove,
  };
}

/**
 * Hook to query documents
 */
export function useQuery<T extends Document>(
  collectionName: string,
  filter?: Partial<T>,
  options: UseQueryOptions<T> = {}
): UseQueryResult<T> {
  const { collection: getCollection, isReady } = usePocket();
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [count, setCount] = useState(0);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  const executeQuery = useCallback(async () => {
    if (!isReady) {
      setIsLoading(false);
      return;
    }

    const col = getCollection<T>(collectionName);
    if (!col) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let query = col.find(filter);

      if (options.sortBy) {
        query = query.sort(options.sortBy, options.sortDirection ?? 'asc');
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      if (options.skip) {
        query = query.skip(options.skip);
      }

      const results = await query.exec();
      setData(results);
      setCount(results.length);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to execute query'));
    } finally {
      setIsLoading(false);
    }
  }, [isReady, collectionName, getCollection, filter, options]);

  // Initial query
  useEffect(() => {
    void executeQuery();
  }, [executeQuery]);

  // Subscribe to changes
  useEffect(() => {
    if (!isReady) return;

    const col = getCollection<T>(collectionName);
    if (!col) return;

    // Subscribe to collection changes and re-query
    const subscription = col.changes().subscribe(() => {
      void executeQuery();
    });

    subscriptionRef.current = subscription;

    return () => {
      subscription.unsubscribe();
      subscriptionRef.current = null;
    };
  }, [isReady, collectionName, getCollection, executeQuery]);

  return {
    data,
    isLoading,
    error,
    count,
    refetch: executeQuery,
    isEmpty: data.length === 0,
  };
}

/**
 * Hook for mutations (insert, update, delete)
 */
export function useMutation<T extends Document>(collectionName: string): UseMutationResult<T> {
  const { collection: getCollection, isReady } = usePocket();
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const insert = useCallback(
    async (doc: Omit<T, '_id' | '_rev' | '_updatedAt'>): Promise<T> => {
      if (!isReady) {
        throw new Error('Pocket is not ready');
      }

      const col = getCollection<T>(collectionName);
      if (!col) {
        throw new Error(`Collection "${collectionName}" not found`);
      }

      setIsMutating(true);
      setError(null);

      try {
        const inserted = await col.insert(doc as T);
        return inserted;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to insert document');
        setError(error);
        throw error;
      } finally {
        setIsMutating(false);
      }
    },
    [isReady, collectionName, getCollection]
  );

  const update = useCallback(
    async (id: string, changes: Partial<T>): Promise<T> => {
      if (!isReady) {
        throw new Error('Pocket is not ready');
      }

      const col = getCollection<T>(collectionName);
      if (!col) {
        throw new Error(`Collection "${collectionName}" not found`);
      }

      setIsMutating(true);
      setError(null);

      try {
        const updated = await col.update(id, changes);
        return updated;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to update document');
        setError(error);
        throw error;
      } finally {
        setIsMutating(false);
      }
    },
    [isReady, collectionName, getCollection]
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (!isReady) {
        throw new Error('Pocket is not ready');
      }

      const col = getCollection<T>(collectionName);
      if (!col) {
        throw new Error(`Collection "${collectionName}" not found`);
      }

      setIsMutating(true);
      setError(null);

      try {
        await col.delete(id);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to delete document');
        setError(error);
        throw error;
      } finally {
        setIsMutating(false);
      }
    },
    [isReady, collectionName, getCollection]
  );

  return {
    insert,
    update,
    remove,
    isMutating,
    error,
  };
}

/**
 * Hook to count documents
 */
export function useCount<T extends Document>(
  collectionName: string,
  filter?: Partial<T>
): { count: number; isLoading: boolean; error: Error | null } {
  const { collection: getCollection, isReady } = usePocket();
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!isReady) {
      setIsLoading(false);
      return;
    }

    const col = getCollection<T>(collectionName);
    if (!col) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    col
      .count(filter)
      .then((c) => {
        setCount(c);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error('Failed to count'));
      })
      .finally(() => {
        setIsLoading(false);
      });

    // Subscribe to changes
    const subscription = col.changes().subscribe(() => {
      col
        .count(filter)
        .then((c) => setCount(c))
        .catch(() => {});
    });

    return () => subscription.unsubscribe();
  }, [isReady, collectionName, getCollection, filter]);

  return { count, isLoading, error };
}

/**
 * Hook to observe all documents in a collection
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function useAll<T extends Document>(
  collectionName: string
): { data: T[]; isLoading: boolean; error: Error | null } {
  const { collection: getCollection, isReady } = usePocket();
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!isReady) {
      setIsLoading(false);
      return;
    }

    const col = getCollection<T>(collectionName);
    if (!col) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    col
      .getAll()
      .then((docs) => {
        setData(docs);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error('Failed to fetch'));
      })
      .finally(() => {
        setIsLoading(false);
      });

    // Subscribe to changes
    const subscription = col.changes().subscribe(() => {
      col
        .getAll()
        .then((docs) => setData(docs))
        .catch(() => {});
    });

    return () => subscription.unsubscribe();
  }, [isReady, collectionName, getCollection]);

  return { data, isLoading, error };
}
