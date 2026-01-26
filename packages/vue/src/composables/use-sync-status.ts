import type { Observable } from 'rxjs';
import { onMounted, onUnmounted, ref, type Ref } from 'vue';

/**
 * Sync status
 */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

/**
 * Sync statistics
 */
export interface SyncStats {
  /** Number of documents pushed */
  pushCount: number;
  /** Number of documents pulled */
  pullCount: number;
  /** Number of conflicts resolved */
  conflictCount: number;
  /** Last sync timestamp */
  lastSyncAt: number | null;
  /** Last error */
  lastError: Error | null;
}

/**
 * Sync engine interface (matches @pocket/sync)
 */
export interface SyncEngine {
  start(): Promise<void>;
  stop(): Promise<void>;
  forceSync(): Promise<void>;
  push(): Promise<void>;
  pull(): Promise<void>;
  getStatus(): Observable<SyncStatus>;
  getStats(): Observable<SyncStats>;
}

/**
 * Sync status result
 */
export interface SyncStatusResult {
  /** Current sync status */
  status: Ref<SyncStatus>;
  /** Whether online */
  isOnline: Ref<boolean>;
  /** Whether currently syncing */
  isSyncing: Ref<boolean>;
  /** Sync statistics */
  stats: Ref<SyncStats>;
  /** Force sync */
  forceSync: () => Promise<void>;
  /** Push changes */
  push: () => Promise<void>;
  /** Pull changes */
  pull: () => Promise<void>;
  /** Start syncing */
  start: () => Promise<void>;
  /** Stop syncing */
  stop: () => Promise<void>;
  /** Any error */
  error: Ref<Error | null>;
}

/**
 * Sync status options
 */
export interface UseSyncStatusOptions {
  /** Auto-start syncing */
  autoStart?: boolean;
}

/**
 * Composable to track sync status.
 *
 * @param syncEngine - The sync engine instance
 * @param options - Options
 *
 * @example
 * ```vue
 * <script setup>
 * import { useSyncStatus } from '@pocket/vue';
 *
 * const syncEngine = // get from your app setup
 *
 * const { status, isOnline, isSyncing, stats, forceSync } = useSyncStatus(syncEngine);
 * </script>
 *
 * <template>
 *   <div>
 *     <span v-if="!isOnline">Offline</span>
 *     <span v-else-if="isSyncing">Syncing...</span>
 *     <span v-else>Synced</span>
 *     <button @click="forceSync">Sync Now</button>
 *   </div>
 * </template>
 * ```
 */
export function useSyncStatus(
  syncEngine: SyncEngine | null,
  options: UseSyncStatusOptions = {}
): SyncStatusResult {
  const { autoStart = true } = options;

  const status = ref<SyncStatus>('idle');
  const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const isSyncing = ref(false);
  const stats = ref<SyncStats>({
    pushCount: 0,
    pullCount: 0,
    conflictCount: 0,
    lastSyncAt: null,
    lastError: null,
  });
  const error = ref<Error | null>(null);

  let mounted = true;
  let statusSub: { unsubscribe: () => void } | null = null;
  let statsSub: { unsubscribe: () => void } | null = null;

  // Track online status
  const handleOnline = () => {
    isOnline.value = true;
  };
  const handleOffline = () => {
    isOnline.value = false;
  };

  onMounted(() => {
    mounted = true;

    // Online/offline listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    if (!syncEngine) return;

    // Subscribe to status
    statusSub = syncEngine.getStatus().subscribe({
      next: (s: SyncStatus) => {
        if (mounted) {
          status.value = s;
          isSyncing.value = s === 'syncing';
          if (s === 'error') {
            error.value = stats.value.lastError;
          } else {
            error.value = null;
          }
        }
      },
    });

    // Subscribe to stats
    statsSub = syncEngine.getStats().subscribe({
      next: (s: SyncStats) => {
        if (mounted) {
          stats.value = s;
        }
      },
    });

    // Auto-start if enabled
    if (autoStart) {
      syncEngine.start().catch((err: unknown) => {
        if (mounted) {
          error.value = err instanceof Error ? err : new Error(String(err));
          status.value = 'error';
        }
      });
    }
  });

  onUnmounted(() => {
    mounted = false;

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }

    if (statusSub) {
      statusSub.unsubscribe();
    }
    if (statsSub) {
      statsSub.unsubscribe();
    }
  });

  const forceSync = async () => {
    if (!syncEngine) return;
    try {
      error.value = null;
      await syncEngine.forceSync();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      throw err;
    }
  };

  const push = async () => {
    if (!syncEngine) return;
    try {
      error.value = null;
      await syncEngine.push();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      throw err;
    }
  };

  const pull = async () => {
    if (!syncEngine) return;
    try {
      error.value = null;
      await syncEngine.pull();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      throw err;
    }
  };

  const start = async () => {
    if (!syncEngine) return;
    try {
      error.value = null;
      await syncEngine.start();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      throw err;
    }
  };

  const stop = async () => {
    if (!syncEngine) return;
    try {
      await syncEngine.stop();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      throw err;
    }
  };

  return {
    status,
    isOnline,
    isSyncing,
    stats,
    forceSync,
    push,
    pull,
    start,
    stop,
    error,
  };
}

/**
 * Composable to track online status only.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useOnlineStatus } from '@pocket/vue';
 *
 * const isOnline = useOnlineStatus();
 * </script>
 *
 * <template>
 *   <span v-if="!isOnline">You are offline</span>
 * </template>
 * ```
 */
export function useOnlineStatus(): Ref<boolean> {
  const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const handleOnline = () => {
    isOnline.value = true;
  };
  const handleOffline = () => {
    isOnline.value = false;
  };

  onMounted(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }
  });

  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
  });

  return isOnline;
}
