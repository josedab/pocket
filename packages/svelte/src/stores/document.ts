import type { Document } from '@pocket/core';
import { readable, writable, type Readable } from 'svelte/store';
import { getCollection } from '../context/provider.js';

/**
 * Document store value
 */
export interface DocumentStore<T extends Document> extends Readable<T | null> {
  /** Whether the document is loading */
  isLoading: Readable<boolean>;
  /** Any error that occurred */
  error: Readable<Error | null>;
  /** Force refresh the document */
  refresh: () => void;
}

/**
 * Document store options
 */
export interface CreateDocumentOptions {
  /** Initial enabled state */
  enabled?: boolean;
}

/**
 * Create a store for a single document by ID with live updates.
 *
 * @param collectionName - Name of the collection
 * @param documentId - The document ID
 * @param options - Options
 *
 * @example
 * ```svelte
 * <script>
 * import { createDocument } from '@pocket/svelte';
 *
 * export let userId;
 *
 * $: user = createDocument('users', userId);
 * </script>
 *
 * {#if $user.isLoading}
 *   <p>Loading...</p>
 * {:else if $user.error}
 *   <p>Error: {$user.error.message}</p>
 * {:else if $user}
 *   <h1>{$user.name}</h1>
 *   <p>{$user.email}</p>
 * {:else}
 *   <p>User not found</p>
 * {/if}
 * ```
 */
export function createDocument<T extends Document>(
  collectionName: string,
  documentId: string | null,
  options: CreateDocumentOptions = {}
): DocumentStore<T> {
  const { enabled = true } = options;

  const collection = getCollection<T>(collectionName);

  const data = writable<T | null>(null);
  const isLoading = writable(true);
  const error = writable<Error | null>(null);

  let subscription: { unsubscribe: () => void } | null = null;

  const subscribe = () => {
    // Clean up previous subscription
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }

    if (!enabled || !documentId) {
      data.set(null);
      isLoading.set(false);
      return;
    }

    isLoading.set(true);

    // Subscribe to document changes
    subscription = collection.observeById(documentId).subscribe({
      next: (doc: T | null) => {
        data.set(doc);
        isLoading.set(false);
        error.set(null);
      },
      error: (err: unknown) => {
        error.set(err instanceof Error ? err : new Error(String(err)));
        isLoading.set(false);
      },
    });
  };

  const refresh = () => {
    if (!enabled || !documentId) return;

    isLoading.set(true);

    collection
      .get(documentId)
      .then((doc: T | null) => {
        data.set(doc);
        isLoading.set(false);
        error.set(null);
      })
      .catch((err: unknown) => {
        error.set(err instanceof Error ? err : new Error(String(err)));
        isLoading.set(false);
      });
  };

  // Start the subscription
  subscribe();

  // Create the store
  const store: DocumentStore<T> = {
    subscribe: data.subscribe,
    isLoading: { subscribe: isLoading.subscribe },
    error: { subscribe: error.subscribe },
    refresh,
  };

  return store;
}

/**
 * Create a store to find a single document by filter.
 *
 * @param collectionName - Name of the collection
 * @param filter - Filter object
 * @param options - Options
 *
 * @example
 * ```svelte
 * <script>
 * import { createFindOne } from '@pocket/svelte';
 *
 * const admin = createFindOne('users', { role: 'admin' });
 * </script>
 * ```
 */
export function createFindOne<T extends Document>(
  collectionName: string,
  filter: Partial<T>,
  options: CreateDocumentOptions = {}
): DocumentStore<T> {
  const { enabled = true } = options;

  const collection = getCollection<T>(collectionName);

  const data = writable<T | null>(null);
  const isLoading = writable(true);
  const error = writable<Error | null>(null);

  let subscription: { unsubscribe: () => void } | null = null;

  const fetchOne = () => {
    if (!enabled) {
      data.set(null);
      isLoading.set(false);
      return;
    }

    isLoading.set(true);

    collection
      .findOne(filter)
      .then((doc: T | null) => {
        data.set(doc);
        isLoading.set(false);
        error.set(null);
      })
      .catch((err: unknown) => {
        error.set(err instanceof Error ? err : new Error(String(err)));
        isLoading.set(false);
      });
  };

  const subscribe = () => {
    // Clean up previous subscription
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }

    if (!enabled) {
      data.set(null);
      isLoading.set(false);
      return;
    }

    // Initial fetch
    fetchOne();

    // Subscribe to changes
    subscription = collection.changes().subscribe({
      next: () => {
        fetchOne();
      },
    });
  };

  const refresh = () => {
    fetchOne();
  };

  // Start the subscription
  subscribe();

  // Create the store
  const store: DocumentStore<T> = {
    subscribe: data.subscribe,
    isLoading: { subscribe: isLoading.subscribe },
    error: { subscribe: error.subscribe },
    refresh,
  };

  return store;
}

/**
 * Create a reactive document store that responds to ID changes.
 *
 * @param collectionName - Name of the collection
 * @param idStore - A store containing the document ID
 *
 * @example
 * ```svelte
 * <script>
 * import { writable } from 'svelte/store';
 * import { createReactiveDocument } from '@pocket/svelte';
 *
 * const selectedId = writable(null);
 * const selectedUser = createReactiveDocument('users', selectedId);
 * </script>
 * ```
 */
/**
 * Reactive document state
 */
export interface ReactiveDocumentState<T extends Document> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
}

export function createReactiveDocument<T extends Document>(
  collectionName: string,
  idStore: Readable<string | null>
): Readable<ReactiveDocumentState<T>> {
  const collection = getCollection<T>(collectionName);

  const initialState: ReactiveDocumentState<T> = {
    data: null,
    isLoading: true,
    error: null,
  };

  return readable<ReactiveDocumentState<T>>(initialState, (set) => {
    let subscription: { unsubscribe: () => void } | null = null;

    const unsubscribeId = idStore.subscribe((id) => {
      // Clean up previous subscription
      if (subscription) {
        subscription.unsubscribe();
        subscription = null;
      }

      if (!id) {
        set({ data: null, isLoading: false, error: null });
        return;
      }

      set({ data: null, isLoading: true, error: null });

      // Subscribe to document changes
      subscription = collection.observeById(id).subscribe({
        next: (doc: T | null) => {
          set({ data: doc, isLoading: false, error: null });
        },
        error: (err: unknown) => {
          set({
            data: null,
            isLoading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        },
      });
    });

    return () => {
      unsubscribeId();
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  });
}
