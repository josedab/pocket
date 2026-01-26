import type { Document } from '@pocket/core';
import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import { useCollection } from '../context/provider.js';

/**
 * Document result
 */
export interface DocumentResult<T extends Document> {
  /** The document data (call to get value) */
  data: Accessor<T | null>;
  /** Whether the document is loading */
  isLoading: Accessor<boolean>;
  /** Any error that occurred */
  error: Accessor<Error | null>;
  /** Force refresh the document */
  refresh: () => void;
}

/**
 * Document options
 */
export interface CreateDocumentOptions {
  /** Disable the query */
  enabled?: boolean | Accessor<boolean>;
}

/**
 * Create a single document observer by ID.
 *
 * @param collectionName - Name of the collection
 * @param documentId - The document ID (can be reactive)
 * @param options - Options
 *
 * @example
 * ```tsx
 * import { createDocument } from '@pocket/solid';
 *
 * function UserProfile(props: { userId: string }) {
 *   const { data: user, isLoading, error } = createDocument<User>('users', () => props.userId);
 *
 *   return (
 *     <Show when={!isLoading()} fallback={<p>Loading...</p>}>
 *       <Show when={user()} fallback={<p>User not found</p>}>
 *         {(u) => (
 *           <>
 *             <h1>{u().name}</h1>
 *             <p>{u().email}</p>
 *           </>
 *         )}
 *       </Show>
 *     </Show>
 *   );
 * }
 * ```
 */
export function createDocument<T extends Document>(
  collectionName: string,
  documentId: string | null | Accessor<string | null>,
  options: CreateDocumentOptions = {}
): DocumentResult<T> {
  const { enabled = true } = options;

  const collection = useCollection<T>(collectionName);

  const [data, setData] = createSignal<T | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<Error | null>(null);

  let subscription: { unsubscribe: () => void } | null = null;

  const getDocId = () => {
    if (typeof documentId === 'function') return documentId();
    return documentId;
  };

  const isEnabled = () => {
    if (typeof enabled === 'boolean') return enabled;
    return enabled();
  };

  const subscribe = () => {
    // Clean up previous subscription
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }

    const id = getDocId();

    if (!isEnabled() || !id) {
      setData(() => null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // Subscribe to document changes
    subscription = collection.observeById(id).subscribe({
      next: (doc: T | null) => {
        setData(() => doc);
        setIsLoading(false);
        setError(null);
      },
      error: (err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      },
    });
  };

  const refresh = () => {
    const id = getDocId();

    if (!isEnabled() || !id) return;

    setIsLoading(true);

    collection
      .get(id)
      .then((doc: T | null) => {
        setData(() => doc);
        setIsLoading(false);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });
  };

  // Start subscription
  createEffect(() => {
    // Track reactive dependencies
    getDocId();
    isEnabled();
    subscribe();
  });

  // Cleanup on unmount
  onCleanup(() => {
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }
  });

  return {
    data,
    isLoading,
    error,
    refresh,
  };
}

/**
 * Create a single document observer by filter.
 *
 * @param collectionName - Name of the collection
 * @param filter - Filter object (can be reactive)
 * @param options - Options
 *
 * @example
 * ```tsx
 * const { data: admin } = createFindOne<User>('users', { role: 'admin' });
 * ```
 */
export function createFindOne<T extends Document>(
  collectionName: string,
  filter: Partial<T> | Accessor<Partial<T>>,
  options: CreateDocumentOptions = {}
): DocumentResult<T> {
  const { enabled = true } = options;

  const collection = useCollection<T>(collectionName);

  const [data, setData] = createSignal<T | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<Error | null>(null);

  let subscription: { unsubscribe: () => void } | null = null;

  const getFilter = () => {
    if (typeof filter === 'function') return filter();
    return filter;
  };

  const isEnabled = () => {
    if (typeof enabled === 'boolean') return enabled;
    return enabled();
  };

  const fetchOne = () => {
    if (!isEnabled()) {
      setData(() => null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    collection
      .findOne(getFilter())
      .then((doc: T | null) => {
        setData(() => doc);
        setIsLoading(false);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });
  };

  const subscribe = () => {
    // Clean up previous subscription
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }

    if (!isEnabled()) {
      setData(() => null);
      setIsLoading(false);
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

  // Start subscription
  createEffect(() => {
    // Track reactive dependencies
    getFilter();
    isEnabled();
    subscribe();
  });

  // Cleanup on unmount
  onCleanup(() => {
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }
  });

  return {
    data,
    isLoading,
    error,
    refresh,
  };
}
