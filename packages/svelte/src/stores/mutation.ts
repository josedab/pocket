import type { Document, DocumentUpdate, NewDocument } from '@pocket/core';
import { writable, type Readable } from 'svelte/store';
import { getCollection } from '../context/provider.js';

/**
 * Mutation store value
 */
export interface MutationStore<T extends Document> {
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
  isLoading: Readable<boolean>;
  /** Any error from the last mutation */
  error: Readable<Error | null>;
  /** Reset error state */
  resetError: () => void;
}

/**
 * Mutation options
 */
export interface CreateMutationOptions {
  /** Callback on successful mutation */
  onSuccess?: (result: unknown) => void;
  /** Callback on mutation error */
  onError?: (error: Error) => void;
}

/**
 * Create a mutation store for document operations.
 *
 * @param collectionName - Name of the collection
 * @param options - Mutation options
 *
 * @example Basic usage
 * ```svelte
 * <script>
 * import { createMutation } from '@pocket/svelte';
 *
 * const { insert, update, remove, isLoading, error } = createMutation('todos');
 *
 * async function addTodo(title) {
 *   await insert({ title, completed: false });
 * }
 *
 * async function toggleTodo(todo) {
 *   await update(todo._id, { completed: !todo.completed });
 * }
 *
 * async function deleteTodo(id) {
 *   await remove(id);
 * }
 * </script>
 * ```
 *
 * @example With callbacks
 * ```svelte
 * <script>
 * import { createMutation } from '@pocket/svelte';
 *
 * const { insert } = createMutation('todos', {
 *   onSuccess: () => console.log('Todo added!'),
 *   onError: (error) => console.error(error.message),
 * });
 * </script>
 * ```
 */
export function createMutation<T extends Document>(
  collectionName: string,
  options: CreateMutationOptions = {}
): MutationStore<T> {
  const { onSuccess, onError } = options;

  const collection = getCollection<T>(collectionName);

  const isLoading = writable(false);
  const error = writable<Error | null>(null);

  // Wrapper to handle loading/error state
  const withMutation = async <R>(fn: () => Promise<R>): Promise<R> => {
    isLoading.set(true);
    error.set(null);

    try {
      const result = await fn();
      isLoading.set(false);
      onSuccess?.(result);
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      error.set(e);
      isLoading.set(false);
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
    error.set(null);
  };

  return {
    insert,
    insertMany,
    update,
    upsert,
    remove,
    removeMany,
    isLoading: { subscribe: isLoading.subscribe },
    error: { subscribe: error.subscribe },
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
export interface CreateOptimisticMutationOptions<T extends Document> extends CreateMutationOptions {
  /** Function to update local data optimistically */
  optimisticUpdate?: (data: T[], mutation: OptimisticMutation<T>) => T[];
  /** Writable store for current data */
  dataStore?: {
    update: (updater: (data: T[]) => T[]) => void;
    subscribe: (fn: (data: T[]) => void) => () => void;
  };
}

/**
 * Create a mutation store with optimistic updates.
 *
 * @param collectionName - Name of the collection
 * @param options - Optimistic mutation options
 *
 * @example
 * ```svelte
 * <script>
 * import { writable } from 'svelte/store';
 * import { createLiveQuery, createOptimisticMutation } from '@pocket/svelte';
 *
 * const todos = createLiveQuery('todos');
 * const todosStore = writable([]);
 *
 * todos.subscribe(data => todosStore.set(data));
 *
 * const { insert, update, remove, rollback } = createOptimisticMutation('todos', {
 *   dataStore: todosStore,
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
export function createOptimisticMutation<T extends Document>(
  collectionName: string,
  options: CreateOptimisticMutationOptions<T> = {}
): MutationStore<T> & { rollback: () => void } {
  const { optimisticUpdate, dataStore, ...mutationOptions } = options;

  const baseMutation = createMutation<T>(collectionName, mutationOptions);
  let previousData: T[] | null = null;

  const applyOptimistic = (mutation: OptimisticMutation<T>) => {
    if (!optimisticUpdate || !dataStore) return;

    let currentData: T[] = [];
    dataStore.subscribe((data) => (currentData = data))();

    previousData = [...currentData];
    dataStore.update((data) => optimisticUpdate(data, mutation));
  };

  const rollback = () => {
    if (previousData && dataStore) {
      dataStore.update(() => previousData!);
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
