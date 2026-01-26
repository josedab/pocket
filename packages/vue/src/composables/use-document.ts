import type { Document } from '@pocket/core';
import { computed, onMounted, onUnmounted, ref, type Ref, watch } from 'vue';
import { useCollection } from '../context/provider.js';

/**
 * Document result
 */
export interface DocumentResult<T extends Document> {
  /** The document data */
  data: Ref<T | null>;
  /** Whether the document is loading */
  isLoading: Ref<boolean>;
  /** Any error that occurred */
  error: Ref<Error | null>;
  /** Force refresh the document */
  refresh: () => void;
}

/**
 * Document options
 */
export interface UseDocumentOptions {
  /** Disable the query */
  enabled?: boolean | Ref<boolean>;
}

/**
 * Composable to get a single document by ID with live updates.
 *
 * @param collectionName - Name of the collection
 * @param documentId - The document ID (can be reactive)
 * @param options - Options
 *
 * @example
 * ```vue
 * <script setup>
 * import { useDocument } from '@pocket/vue';
 *
 * const props = defineProps<{ userId: string }>();
 *
 * const { data: user, isLoading, error } = useDocument<User>('users', props.userId);
 * </script>
 *
 * <template>
 *   <div v-if="isLoading">Loading...</div>
 *   <div v-else-if="error">Error: {{ error.message }}</div>
 *   <div v-else-if="user">
 *     <h1>{{ user.name }}</h1>
 *     <p>{{ user.email }}</p>
 *   </div>
 *   <div v-else>User not found</div>
 * </template>
 * ```
 *
 * @example With reactive ID
 * ```vue
 * <script setup>
 * import { ref } from 'vue';
 * import { useDocument } from '@pocket/vue';
 *
 * const selectedId = ref<string | null>(null);
 *
 * const { data: selectedUser } = useDocument<User>(
 *   'users',
 *   computed(() => selectedId.value),
 *   { enabled: computed(() => !!selectedId.value) }
 * );
 * </script>
 * ```
 */
export function useDocument<T extends Document>(
  collectionName: string,
  documentId: string | null | Ref<string | null>,
  options: UseDocumentOptions = {}
): DocumentResult<T> {
  const { enabled = true } = options;

  const collection = useCollection<T>(collectionName);

  const data = ref<T | null>(null) as Ref<T | null>;
  const isLoading = ref(true);
  const error = ref<Error | null>(null);

  let subscription: { unsubscribe: () => void } | null = null;
  let mounted = true;

  const docId = computed(() => {
    if (typeof documentId === 'string' || documentId === null) return documentId;
    return documentId.value;
  });

  const isEnabled = computed(() => {
    if (typeof enabled === 'boolean') return enabled;
    return enabled.value;
  });

  const subscribe = () => {
    // Clean up previous subscription
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }

    const id = docId.value;

    if (!isEnabled.value || !id) {
      data.value = null;
      isLoading.value = false;
      return;
    }

    isLoading.value = true;

    // Subscribe to document changes
    subscription = collection.observeById(id).subscribe({
      next: (doc: T | null) => {
        if (mounted) {
          data.value = doc;
          isLoading.value = false;
          error.value = null;
        }
      },
      error: (err: unknown) => {
        if (mounted) {
          error.value = err instanceof Error ? err : new Error(String(err));
          isLoading.value = false;
        }
      },
    });
  };

  const refresh = () => {
    const id = docId.value;

    if (!isEnabled.value || !id) return;

    isLoading.value = true;

    collection
      .get(id)
      .then((doc: T | null) => {
        if (mounted) {
          data.value = doc;
          isLoading.value = false;
          error.value = null;
        }
      })
      .catch((err: unknown) => {
        if (mounted) {
          error.value = err instanceof Error ? err : new Error(String(err));
          isLoading.value = false;
        }
      });
  };

  onMounted(() => {
    mounted = true;
    subscribe();
  });

  onUnmounted(() => {
    mounted = false;
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }
  });

  // Watch for ID and enabled changes
  watch([docId, isEnabled], () => {
    subscribe();
  });

  return {
    data,
    isLoading,
    error,
    refresh,
  };
}

/**
 * Composable to find a single document by filter.
 *
 * @param collectionName - Name of the collection
 * @param filter - Filter object (can be reactive)
 * @param options - Options
 *
 * @example
 * ```vue
 * <script setup>
 * import { useFindOne } from '@pocket/vue';
 *
 * const { data: admin } = useFindOne<User>('users', { role: 'admin' });
 * </script>
 * ```
 */
export function useFindOne<T extends Document>(
  collectionName: string,
  filter: Partial<T> | Ref<Partial<T>>,
  options: UseDocumentOptions = {}
): DocumentResult<T> {
  const { enabled = true } = options;

  const collection = useCollection<T>(collectionName);

  const data = ref<T | null>(null) as Ref<T | null>;
  const isLoading = ref(true);
  const error = ref<Error | null>(null);

  let subscription: { unsubscribe: () => void } | null = null;
  let mounted = true;

  const filterValue = computed(() => {
    if ('value' in filter) return filter.value;
    return filter;
  });

  const filterKey = computed(() => JSON.stringify(filterValue.value));

  const isEnabled = computed(() => {
    if (typeof enabled === 'boolean') return enabled;
    return enabled.value;
  });

  const fetchOne = () => {
    if (!isEnabled.value) {
      data.value = null;
      isLoading.value = false;
      return;
    }

    isLoading.value = true;

    collection
      .findOne(filterValue.value)
      .then((doc: T | null) => {
        if (mounted) {
          data.value = doc;
          isLoading.value = false;
          error.value = null;
        }
      })
      .catch((err: unknown) => {
        if (mounted) {
          error.value = err instanceof Error ? err : new Error(String(err));
          isLoading.value = false;
        }
      });
  };

  const subscribe = () => {
    // Clean up previous subscription
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }

    if (!isEnabled.value) {
      data.value = null;
      isLoading.value = false;
      return;
    }

    // Initial fetch
    fetchOne();

    // Subscribe to changes
    subscription = collection.changes().subscribe({
      next: () => {
        if (mounted) {
          fetchOne();
        }
      },
    });
  };

  const refresh = () => {
    fetchOne();
  };

  onMounted(() => {
    mounted = true;
    subscribe();
  });

  onUnmounted(() => {
    mounted = false;
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }
  });

  // Watch for filter and enabled changes
  watch([filterKey, isEnabled], () => {
    subscribe();
  });

  return {
    data,
    isLoading,
    error,
    refresh,
  };
}
