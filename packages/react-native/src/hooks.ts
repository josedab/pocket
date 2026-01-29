/**
 * React Native hooks for Pocket database operations.
 *
 * This module provides hooks optimized for React Native applications,
 * with support for reactive updates, loading states, and error handling.
 *
 * ## Available Hooks
 *
 * | Hook | Purpose |
 * |------|---------|
 * | {@link useCollection} | Access a collection directly |
 * | {@link useDocument} | Fetch and observe a single document |
 * | {@link useQuery} | Query multiple documents with filters |
 * | {@link useMutation} | Insert, update, and delete documents |
 * | {@link useCount} | Count documents with optional filter |
 * | {@link useAll} | Observe all documents in a collection |
 *
 * ## Usage Pattern
 *
 * All data hooks return an object with:
 * - `data` - The fetched data
 * - `isLoading` - Loading state
 * - `error` - Error if the operation failed
 *
 * Mutation hooks return functions for each operation type.
 *
 * @module hooks
 *
 * @example Complete CRUD example
 * ```tsx
 * function TodoScreen() {
 *   // Query all incomplete todos
 *   const { data: todos, isLoading } = useQuery<Todo>(
 *     'todos',
 *     { completed: false },
 *     { sortBy: 'createdAt', sortDirection: 'desc' }
 *   );
 *
 *   // Mutations
 *   const { insert, update, remove } = useMutation<Todo>('todos');
 *
 *   const addTodo = async (title: string) => {
 *     await insert({ title, completed: false, createdAt: Date.now() });
 *   };
 *
 *   const toggleTodo = async (id: string, completed: boolean) => {
 *     await update(id, { completed: !completed });
 *   };
 *
 *   if (isLoading) return <ActivityIndicator />;
 *
 *   return (
 *     <View>
 *       {todos.map(todo => (
 *         <TouchableOpacity
 *           key={todo._id}
 *           onPress={() => toggleTodo(todo._id, todo.completed)}
 *         >
 *           <Text>{todo.title}</Text>
 *         </TouchableOpacity>
 *       ))}
 *     </View>
 *   );
 * }
 * ```
 */

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
 * Hook to get a collection directly.
 *
 * Use this when you need direct access to the collection API
 * for advanced operations not covered by other hooks.
 *
 * @typeParam T - The document type
 * @param name - The collection name
 * @returns The collection instance, or null if Pocket is not ready
 *
 * @example
 * ```tsx
 * function AdvancedComponent() {
 *   const todos = useCollection<Todo>('todos');
 *
 *   const bulkInsert = async (items: Todo[]) => {
 *     if (!todos) return;
 *     await todos.bulkInsert(items);
 *   };
 *
 *   return <Button onPress={() => bulkInsert(items)} title="Import" />;
 * }
 * ```
 */
export function useCollection<T extends Document>(name: string): Collection<T> | null {
  const { collection, isReady } = usePocket();

  if (!isReady) return null;
  return collection<T>(name);
}

/**
 * Hook to fetch and observe a single document by ID.
 *
 * Automatically subscribes to changes and re-renders when the document
 * is updated. Returns update and remove functions for mutations.
 *
 * @typeParam T - The document type
 * @param collectionName - The collection to query
 * @param id - The document ID to fetch (or null/undefined to skip)
 * @param options - Optional configuration
 * @returns Object with data, loading state, error, and mutation functions
 *
 * @example Basic usage
 * ```tsx
 * function TodoDetail({ todoId }: { todoId: string }) {
 *   const { data: todo, isLoading, update, remove } = useDocument<Todo>('todos', todoId);
 *
 *   if (isLoading) return <ActivityIndicator />;
 *   if (!todo) return <Text>Not found</Text>;
 *
 *   return (
 *     <View>
 *       <Text>{todo.title}</Text>
 *       <Button
 *         title="Toggle"
 *         onPress={() => update({ completed: !todo.completed })}
 *       />
 *       <Button title="Delete" onPress={remove} />
 *     </View>
 *   );
 * }
 * ```
 *
 * @example Skip fetching conditionally
 * ```tsx
 * const { data } = useDocument<Todo>('todos', selectedId, {
 *   skip: !selectedId // Don't fetch until an ID is selected
 * });
 * ```
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
 * Hook to query documents with filtering, sorting, and pagination.
 *
 * Automatically re-executes the query when the collection changes,
 * providing reactive updates to your UI.
 *
 * @typeParam T - The document type
 * @param collectionName - The collection to query
 * @param filter - Optional filter to apply
 * @param options - Sorting, pagination, and other options
 * @returns Object with data array, count, loading state, and error
 *
 * @example Query with filter
 * ```tsx
 * function IncompleteTodos() {
 *   const { data: todos, isLoading, isEmpty } = useQuery<Todo>(
 *     'todos',
 *     { completed: false }
 *   );
 *
 *   if (isLoading) return <ActivityIndicator />;
 *   if (isEmpty) return <Text>All done!</Text>;
 *
 *   return <FlatList data={todos} renderItem={...} />;
 * }
 * ```
 *
 * @example With sorting and pagination
 * ```tsx
 * const { data, refetch } = useQuery<Todo>('todos', undefined, {
 *   sortBy: 'createdAt',
 *   sortDirection: 'desc',
 *   limit: 20,
 *   skip: page * 20
 * });
 * ```
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
 * Hook for document mutations (insert, update, delete).
 *
 * Returns functions for each mutation type along with loading
 * and error state. All mutations are async and return the result.
 *
 * @typeParam T - The document type
 * @param collectionName - The collection to mutate
 * @returns Object with insert, update, remove functions and state
 *
 * @example Basic CRUD operations
 * ```tsx
 * function TodoForm() {
 *   const { insert, update, remove, isMutating, error } = useMutation<Todo>('todos');
 *   const [title, setTitle] = useState('');
 *
 *   const handleAdd = async () => {
 *     try {
 *       await insert({ title, completed: false });
 *       setTitle('');
 *     } catch (err) {
 *       Alert.alert('Error', 'Failed to add todo');
 *     }
 *   };
 *
 *   return (
 *     <View>
 *       <TextInput value={title} onChangeText={setTitle} />
 *       <Button
 *         title={isMutating ? 'Adding...' : 'Add'}
 *         onPress={handleAdd}
 *         disabled={isMutating}
 *       />
 *       {error && <Text style={{ color: 'red' }}>{error.message}</Text>}
 *     </View>
 *   );
 * }
 * ```
 *
 * @example Updating a document
 * ```tsx
 * const { update } = useMutation<Todo>('todos');
 *
 * // Partial updates - only specified fields are changed
 * await update(todo._id, { completed: true });
 * await update(todo._id, { title: 'New title', priority: 'high' });
 * ```
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
 * Hook to count documents in a collection.
 *
 * Automatically updates when documents are added or removed.
 * Useful for showing counts in badges or headers.
 *
 * @typeParam T - The document type
 * @param collectionName - The collection to count
 * @param filter - Optional filter to apply
 * @returns Object with count, loading state, and error
 *
 * @example Show unread count
 * ```tsx
 * function NotificationBadge() {
 *   const { count, isLoading } = useCount<Notification>(
 *     'notifications',
 *     { read: false }
 *   );
 *
 *   if (isLoading || count === 0) return null;
 *
 *   return (
 *     <View style={styles.badge}>
 *       <Text style={styles.badgeText}>{count}</Text>
 *     </View>
 *   );
 * }
 * ```
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
 * Hook to observe all documents in a collection.
 *
 * Similar to useQuery without filters. Automatically updates
 * when any document in the collection changes.
 *
 * @typeParam T - The document type
 * @param collectionName - The collection to observe
 * @returns Object with data array, loading state, and error
 *
 * @example Simple list
 * ```tsx
 * function CategoryList() {
 *   const { data: categories, isLoading, error } = useAll<Category>('categories');
 *
 *   if (isLoading) return <ActivityIndicator />;
 *   if (error) return <Text>Error: {error.message}</Text>;
 *
 *   return (
 *     <ScrollView>
 *       {categories.map(cat => (
 *         <Text key={cat._id}>{cat.name}</Text>
 *       ))}
 *     </ScrollView>
 *   );
 * }
 * ```
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
