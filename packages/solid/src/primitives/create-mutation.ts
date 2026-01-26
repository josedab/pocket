import type { Document, DocumentUpdate, NewDocument } from '@pocket/core';
import { createSignal, type Accessor } from 'solid-js';
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
  isLoading: Accessor<boolean>;
  /** Any error from the last mutation */
  error: Accessor<Error | null>;
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
 * Create mutation functions for document operations.
 *
 * @param collectionName - Name of the collection
 * @param options - Mutation options
 *
 * @example Basic usage
 * ```tsx
 * import { createMutation } from '@pocket/solid';
 *
 * function TodoForm() {
 *   const { insert, isLoading, error } = createMutation<Todo>('todos');
 *   const [title, setTitle] = createSignal('');
 *
 *   const handleSubmit = async (e: Event) => {
 *     e.preventDefault();
 *     await insert({ title: title(), completed: false });
 *     setTitle('');
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <input
 *         value={title()}
 *         onInput={(e) => setTitle(e.target.value)}
 *         disabled={isLoading()}
 *       />
 *       <button type="submit" disabled={isLoading()}>
 *         Add Todo
 *       </button>
 *     </form>
 *   );
 * }
 * ```
 */
export function createMutation<T extends Document>(
  collectionName: string,
  options: CreateMutationOptions = {}
): MutationResult<T> {
  const { onSuccess, onError } = options;

  const collection = useCollection<T>(collectionName);

  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  // Wrapper to handle loading/error state
  const withMutation = async <R>(fn: () => Promise<R>): Promise<R> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await fn();
      setIsLoading(false);
      onSuccess?.(result);
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setIsLoading(false);
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
    setError(null);
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
export interface CreateOptimisticMutationOptions<T extends Document> extends CreateMutationOptions {
  /** Function to update local data optimistically */
  optimisticUpdate?: (data: T[], mutation: OptimisticMutation<T>) => T[];
  /** Current data accessor */
  data?: Accessor<T[]>;
  /** Setter for current data */
  setData?: (data: T[]) => void;
}

/**
 * Create mutation functions with optimistic updates.
 *
 * @param collectionName - Name of the collection
 * @param options - Optimistic mutation options
 *
 * @example
 * ```tsx
 * const { data: todos, setData } = createLiveQuery<Todo>('todos');
 *
 * const { insert, update, remove, rollback } = createOptimisticMutation<Todo>('todos', {
 *   data: todos,
 *   setData: (newData) => { /* update local state *\/ },
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
 * ```
 */
export function createOptimisticMutation<T extends Document>(
  collectionName: string,
  options: CreateOptimisticMutationOptions<T> = {}
): MutationResult<T> & { rollback: () => void } {
  const { optimisticUpdate, data, setData, ...mutationOptions } = options;

  const baseMutation = createMutation<T>(collectionName, mutationOptions);
  let previousData: T[] | null = null;

  const applyOptimistic = (mutation: OptimisticMutation<T>) => {
    if (!optimisticUpdate || !data || !setData) return;

    previousData = [...data()];
    setData(optimisticUpdate(data(), mutation));
  };

  const rollback = () => {
    if (previousData && setData) {
      setData(previousData);
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
