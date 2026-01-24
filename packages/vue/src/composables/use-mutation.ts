import type { Document, DocumentUpdate, NewDocument } from '@pocket/core';
import { ref, type Ref } from 'vue';
import { useCollection } from '../context/provider.js';

/**
 * Mutation result
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
  isLoading: Ref<boolean>;
  /** Any error from the last mutation */
  error: Ref<Error | null>;
  /** Reset error state */
  resetError: () => void;
}

/**
 * Mutation options
 */
export interface UseMutationOptions {
  /** Callback on successful mutation */
  onSuccess?: (result: unknown) => void;
  /** Callback on mutation error */
  onError?: (error: Error) => void;
}

/**
 * Composable for document mutations (insert, update, delete).
 *
 * @param collectionName - Name of the collection
 * @param options - Mutation options
 *
 * @example Basic usage
 * ```vue
 * <script setup>
 * import { useMutation } from '@pocket/vue';
 *
 * const { insert, update, remove, isLoading, error } = useMutation<Todo>('todos');
 *
 * const addTodo = async (title: string) => {
 *   await insert({ title, completed: false });
 * };
 *
 * const toggleTodo = async (todo: Todo) => {
 *   await update(todo._id, { completed: !todo.completed });
 * };
 *
 * const deleteTodo = async (id: string) => {
 *   await remove(id);
 * };
 * </script>
 * ```
 *
 * @example With callbacks
 * ```vue
 * <script setup>
 * import { useMutation } from '@pocket/vue';
 * import { useToast } from './composables/toast';
 *
 * const toast = useToast();
 *
 * const { insert, isLoading } = useMutation<Todo>('todos', {
 *   onSuccess: () => toast.success('Todo added!'),
 *   onError: (error) => toast.error(error.message),
 * });
 * </script>
 * ```
 */
export function useMutation<T extends Document>(
  collectionName: string,
  options: UseMutationOptions = {}
): MutationResult<T> {
  const { onSuccess, onError } = options;

  const collection = useCollection<T>(collectionName);

  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  // Wrapper to handle loading/error state
  const withMutation = async <R>(fn: () => Promise<R>): Promise<R> => {
    isLoading.value = true;
    error.value = null;

    try {
      const result = await fn();
      isLoading.value = false;
      onSuccess?.(result);
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      error.value = e;
      isLoading.value = false;
      onError?.(e);
      throw e;
    }
  };

  const insert = (doc: NewDocument<T>): Promise<T> => {
    return withMutation(() => collection.insert(doc));
  };

  const insertMany = (docs: NewDocument<T>[]): Promise<T[]> => {
    return withMutation(() => collection.insertMany(docs));
  };

  const update = (id: string, changes: DocumentUpdate<T>): Promise<T> => {
    return withMutation(() => collection.update(id, changes));
  };

  const upsert = (id: string, doc: NewDocument<T> | DocumentUpdate<T>): Promise<T> => {
    return withMutation(() => collection.upsert(id, doc));
  };

  const remove = (id: string): Promise<void> => {
    return withMutation(() => collection.delete(id));
  };

  const removeMany = (ids: string[]): Promise<void> => {
    return withMutation(() => collection.deleteMany(ids));
  };

  const resetError = () => {
    error.value = null;
  };

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
 * Optimistic mutation type
 */
export type OptimisticMutation<T extends Document> =
  | { type: 'insert'; doc: T }
  | { type: 'update'; id: string; changes: DocumentUpdate<T> }
  | { type: 'delete'; id: string };

/**
 * Optimistic mutation options
 */
export interface UseOptimisticMutationOptions<T extends Document> extends UseMutationOptions {
  /** Function to update local data optimistically */
  optimisticUpdate?: (data: T[], mutation: OptimisticMutation<T>) => T[];
  /** Current data (for optimistic updates) */
  currentData?: Ref<T[]>;
}

/**
 * Composable for mutations with optimistic updates.
 *
 * @param collectionName - Name of the collection
 * @param options - Optimistic mutation options
 *
 * @example
 * ```vue
 * <script setup>
 * import { useLiveQuery, useOptimisticMutation } from '@pocket/vue';
 *
 * const { data: todos } = useLiveQuery<Todo>('todos');
 *
 * const { insert, update, remove, rollback } = useOptimisticMutation<Todo>('todos', {
 *   currentData: todos,
 *   optimisticUpdate: (data, mutation) => {
 *     if (mutation.type === 'insert') {
 *       return [...data, mutation.doc];
 *     }
 *     if (mutation.type === 'update') {
 *       return data.map(d => d._id === mutation.id ? { ...d, ...mutation.changes } : d);
 *     }
 *     if (mutation.type === 'delete') {
 *       return data.filter(d => d._id !== mutation.id);
 *     }
 *     return data;
 *   },
 * });
 * </script>
 * ```
 */
export function useOptimisticMutation<T extends Document>(
  collectionName: string,
  options: UseOptimisticMutationOptions<T> = {}
): MutationResult<T> & { rollback: () => void } {
  const { optimisticUpdate, currentData, ...mutationOptions } = options;

  const baseMutation = useMutation<T>(collectionName, mutationOptions);
  let previousData: T[] | null = null;

  const applyOptimistic = (mutation: OptimisticMutation<T>) => {
    if (!optimisticUpdate || !currentData) return;

    previousData = [...currentData.value];
    currentData.value = optimisticUpdate(currentData.value, mutation);
  };

  const rollback = () => {
    if (previousData && currentData) {
      currentData.value = previousData;
      previousData = null;
    }
  };

  const insert = async (doc: NewDocument<T>): Promise<T> => {
    const tempDoc = { ...doc, _id: `temp_${Date.now()}` } as T;
    applyOptimistic({ type: 'insert', doc: tempDoc });

    try {
      return await baseMutation.insert(doc);
    } catch (err) {
      rollback();
      throw err;
    }
  };

  const update = async (id: string, changes: DocumentUpdate<T>): Promise<T> => {
    applyOptimistic({ type: 'update', id, changes });

    try {
      return await baseMutation.update(id, changes);
    } catch (err) {
      rollback();
      throw err;
    }
  };

  const remove = async (id: string): Promise<void> => {
    applyOptimistic({ type: 'delete', id });

    try {
      await baseMutation.remove(id);
    } catch (err) {
      rollback();
      throw err;
    }
  };

  return {
    ...baseMutation,
    insert,
    update,
    remove,
    rollback,
  };
}
