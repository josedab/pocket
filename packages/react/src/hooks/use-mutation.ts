/**
 * React hooks for performing database mutations (insert, update, delete).
 *
 * These hooks provide a React-friendly API for modifying Pocket collections
 * with automatic loading state management and error handling.
 *
 * @module hooks/use-mutation
 * @see {@link useMutation} - Basic mutation hook
 * @see {@link useOptimisticMutation} - Mutation hook with optimistic updates
 */

import type { Document, DocumentUpdate, NewDocument } from '@pocket/core';
import { useCallback, useRef, useState } from 'react';
import { useCollection } from '../context/provider.js';

/**
 * Result returned by mutation hooks.
 *
 * Contains mutation functions for CRUD operations, plus loading and error state.
 *
 * @typeParam T - The document type being mutated
 */
export interface MutationResult<T extends Document> {
  /** Insert a new document */
  insert: (doc: NewDocument<T>) => Promise<T>;
  /** Insert multiple documents */
  insertMany: (docs: NewDocument<T>[]) => Promise<T[]>;
  /** Update a document by ID */
  update: (id: string, changes: DocumentUpdate<T>) => Promise<T>;
  /** Upsert a document */
  upsert: (id: string, doc: NewDocument<T> | DocumentUpdate<T>) => Promise<T>;
  /** Delete a document by ID */
  remove: (id: string) => Promise<void>;
  /** Delete multiple documents */
  removeMany: (ids: string[]) => Promise<void>;
  /** Whether a mutation is in progress */
  isLoading: boolean;
  /** Any error from the last mutation */
  error: Error | null;
  /** Reset error state */
  resetError: () => void;
}

/**
 * Configuration options for mutation hooks.
 */
export interface UseMutationOptions {
  /** Callback on successful mutation */
  onSuccess?: (result: unknown) => void;
  /** Callback on mutation error */
  onError?: (error: Error) => void;
}

/**
 * React hook for performing database mutations (CRUD operations).
 *
 * Provides functions for insert, update, upsert, and delete operations
 * with automatic loading state and error handling.
 *
 * @typeParam T - The document type being mutated
 * @param collectionName - The name of the collection to mutate
 * @param options - Optional callbacks for success/error handling
 * @returns A {@link MutationResult} with mutation functions and state
 *
 * @example
 * ```tsx
 * function TodoForm() {
 *   const { insert, isLoading, error } = useMutation<Todo>('todos', {
 *     onSuccess: () => console.log('Todo created!'),
 *     onError: (err) => console.error('Failed:', err.message),
 *   });
 *
 *   const handleSubmit = async (title: string) => {
 *     await insert({ title, completed: false });
 *   };
 *
 *   return (
 *     <form onSubmit={...}>
 *       <input disabled={isLoading} />
 *       {error && <span>{error.message}</span>}
 *     </form>
 *   );
 * }
 *
 * // Update and delete
 * function TodoItem({ todo }: { todo: Todo }) {
 *   const { update, remove } = useMutation<Todo>('todos');
 *
 *   return (
 *     <div>
 *       <input
 *         type="checkbox"
 *         checked={todo.completed}
 *         onChange={() => update(todo._id, { completed: !todo.completed })}
 *       />
 *       <button onClick={() => remove(todo._id)}>Delete</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @see {@link useOptimisticMutation} for optimistic UI updates
 * @see {@link useLiveQuery} for reading data with live updates
 */
export function useMutation<T extends Document>(
  collectionName: string,
  options: UseMutationOptions = {}
): MutationResult<T> {
  const { onSuccess, onError } = options;

  const collection = useCollection<T>(collectionName);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);

  // Wrapper to handle loading/error state
  const withMutation = useCallback(
    async <R>(fn: () => Promise<R>): Promise<R> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await fn();

        if (mountedRef.current) {
          setIsLoading(false);
          onSuccess?.(result);
        }

        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

        if (mountedRef.current) {
          setError(error);
          setIsLoading(false);
          onError?.(error);
        }

        throw error;
      }
    },
    [onSuccess, onError]
  );

  // Insert a new document
  const insert = useCallback(
    (doc: NewDocument<T>): Promise<T> => {
      return withMutation(() => collection.insert(doc));
    },
    [collection, withMutation]
  );

  // Insert multiple documents
  const insertMany = useCallback(
    (docs: NewDocument<T>[]): Promise<T[]> => {
      return withMutation(() => collection.insertMany(docs));
    },
    [collection, withMutation]
  );

  // Update a document
  const update = useCallback(
    (id: string, changes: DocumentUpdate<T>): Promise<T> => {
      return withMutation(() => collection.update(id, changes));
    },
    [collection, withMutation]
  );

  // Upsert a document
  const upsert = useCallback(
    (id: string, doc: NewDocument<T> | DocumentUpdate<T>): Promise<T> => {
      return withMutation(() => collection.upsert(id, doc));
    },
    [collection, withMutation]
  );

  // Delete a document
  const remove = useCallback(
    (id: string): Promise<void> => {
      return withMutation(() => collection.delete(id));
    },
    [collection, withMutation]
  );

  // Delete multiple documents
  const removeMany = useCallback(
    (ids: string[]): Promise<void> => {
      return withMutation(() => collection.deleteMany(ids));
    },
    [collection, withMutation]
  );

  // Reset error state
  const resetError = useCallback(() => {
    setError(null);
  }, []);

  return {
    insert,
    insertMany,
    update,
    upsert,
    remove,
    removeMany,
    isLoading,
    error,
    resetError,
  };
}

/**
 * Options for optimistic mutation hooks.
 *
 * Extends {@link UseMutationOptions} with optimistic update configuration.
 *
 * @typeParam T - The document type being mutated
 */
export interface OptimisticMutationOptions<T extends Document> extends UseMutationOptions {
  /** Function to update local data optimistically */
  optimisticUpdate?: (data: T[], mutation: OptimisticMutation<T>) => T[];
  /** Current data (for optimistic updates) */
  currentData?: T[];
  /** Setter for current data (for optimistic updates) */
  setCurrentData?: (data: T[]) => void;
}

/**
 * Discriminated union representing the type of optimistic mutation.
 *
 * @typeParam T - The document type being mutated
 */
export type OptimisticMutation<T extends Document> =
  | { type: 'insert'; doc: T }
  | { type: 'update'; id: string; changes: DocumentUpdate<T> }
  | { type: 'delete'; id: string };

/**
 * React hook for mutations with optimistic UI updates.
 *
 * Applies changes to local state immediately before the database operation
 * completes, providing a snappier user experience. Automatically rolls back
 * if the operation fails.
 *
 * @typeParam T - The document type being mutated
 * @param collectionName - The name of the collection to mutate
 * @param options - Configuration including the optimistic update function
 * @returns A {@link MutationResult} plus a `rollback` function
 *
 * @example
 * ```tsx
 * function OptimisticTodoList() {
 *   const { data, setData } = useLiveQuery<Todo>('todos');
 *
 *   const { insert, update, remove, rollback } = useOptimisticMutation<Todo>(
 *     'todos',
 *     {
 *       currentData: data,
 *       setCurrentData: setData,
 *       optimisticUpdate: (data, mutation) => {
 *         switch (mutation.type) {
 *           case 'insert':
 *             return [...data, mutation.doc];
 *           case 'update':
 *             return data.map((d) =>
 *               d._id === mutation.id ? { ...d, ...mutation.changes } : d
 *             );
 *           case 'delete':
 *             return data.filter((d) => d._id !== mutation.id);
 *         }
 *       },
 *       onError: () => {
 *         // Manual rollback if needed (automatic on error)
 *         toast.error('Operation failed, rolling back...');
 *       },
 *     }
 *   );
 *
 *   // Clicking instantly updates the UI, even before the DB confirms
 *   return (
 *     <ul>
 *       {data.map((todo) => (
 *         <li key={todo._id}>
 *           <input
 *             type="checkbox"
 *             checked={todo.completed}
 *             onChange={() => update(todo._id, { completed: !todo.completed })}
 *           />
 *           {todo.title}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useOptimisticMutation<T extends Document>(
  collectionName: string,
  options: OptimisticMutationOptions<T> = {}
): MutationResult<T> & {
  /** Manually rollback the last optimistic update */
  rollback: () => void;
} {
  const { optimisticUpdate, currentData, setCurrentData, ...mutationOptions } = options;

  const baseMutation = useMutation<T>(collectionName, mutationOptions);
  const previousDataRef = useRef<T[] | null>(null);

  // Apply optimistic update
  const applyOptimistic = useCallback(
    (mutation: OptimisticMutation<T>) => {
      if (!optimisticUpdate || !currentData || !setCurrentData) return;

      previousDataRef.current = currentData;
      const newData = optimisticUpdate(currentData, mutation);
      setCurrentData(newData);
    },
    [optimisticUpdate, currentData, setCurrentData]
  );

  // Rollback optimistic update
  const rollback = useCallback(() => {
    if (previousDataRef.current && setCurrentData) {
      setCurrentData(previousDataRef.current);
      previousDataRef.current = null;
    }
  }, [setCurrentData]);

  // Wrap mutations with optimistic updates
  const insert = useCallback(
    async (doc: NewDocument<T>): Promise<T> => {
      // Create temporary document for optimistic update
      const tempDoc = { ...doc, _id: `temp_${Date.now()}` } as T;
      applyOptimistic({ type: 'insert', doc: tempDoc });

      try {
        return await baseMutation.insert(doc);
      } catch (err) {
        rollback();
        throw err;
      }
    },
    [baseMutation, applyOptimistic, rollback]
  );

  const update = useCallback(
    async (id: string, changes: DocumentUpdate<T>): Promise<T> => {
      applyOptimistic({ type: 'update', id, changes });

      try {
        return await baseMutation.update(id, changes);
      } catch (err) {
        rollback();
        throw err;
      }
    },
    [baseMutation, applyOptimistic, rollback]
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      applyOptimistic({ type: 'delete', id });

      try {
        await baseMutation.remove(id);
        return;
      } catch (err) {
        rollback();
        throw err;
      }
    },
    [baseMutation, applyOptimistic, rollback]
  );

  return {
    ...baseMutation,
    insert,
    update,
    remove,
    rollback,
  };
}
