import type { Observable } from 'rxjs';
import { writable, type Readable } from 'svelte/store';

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
 * Sync status store
 */
export interface SyncStatusStore {
  /** Current sync status */
  status: Readable<SyncStatus>;
  /** Whether online */
  isOnline: Readable<boolean>;
  /** Whether currently syncing */
  isSyncing: Readable<boolean>;
  /** Sync statistics */
  stats: Readable<SyncStats>;
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
  error: Readable<Error | null>;
  /** Cleanup function */
  destroy: () => void;
}

/**
 * Sync status options
 */
export interface CreateSyncStatusOptions {
  /** Auto-start syncing */
  autoStart?: boolean;
}

/**
 * Create a sync status store.
 *
 * @param syncEngine - The sync engine instance
 * @param options - Options
 *
 * @example
 * ```svelte
 * <script>
 * import { createSyncStatus } from '@pocket/svelte';
 * import { onDestroy } from 'svelte';
 *
 * const syncEngine = // get from your app setup
 *
 * const { status, isOnline, isSyncing, stats, forceSync, destroy } = createSyncStatus(syncEngine);
 *
 * onDestroy(destroy);
 * </script>
 *
 * <div>
 *   {#if !$isOnline}
 *     <span>Offline</span>
 *   {:else if $isSyncing}
 *     <span>Syncing...</span>
 *   {:else}
 *     <span>Synced</span>
 *   {/if}
 *   <button on:click={forceSync}>Sync Now</button>
 * </div>
 * ```
 */
export function createSyncStatus(
  syncEngine: SyncEngine | null,
  options: CreateSyncStatusOptions = {}
): SyncStatusStore {
  const { autoStart = true } = options;

  const status = writable<SyncStatus>('idle');
  const isOnline = writable(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const isSyncing = writable(false);
  const stats = writable<SyncStats>({
    pushCount: 0,
    pullCount: 0,
    conflictCount: 0,
    lastSyncAt: null,
    lastError: null,
  });
  const error = writable<Error | null>(null);

  let statusSub: { unsubscribe: () => void } | null = null;
  let statsSub: { unsubscribe: () => void } | null = null;

  // Online/offline handlers
  const handleOnline = () => isOnline.set(true);
  const handleOffline = () => isOnline.set(false);

  // Setup listeners
  const setup = () => {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    if (!syncEngine) return;

    // Subscribe to status
    statusSub = syncEngine.getStatus().subscribe({
      next: (s: SyncStatus) => {
        status.set(s);
        isSyncing.set(s === 'syncing');
        if (s === 'error') {
          let lastError: Error | null = null;
          stats.subscribe((st) => (lastError = st.lastError))();
          error.set(lastError);
        } else {
          error.set(null);
        }
      },
    });

    // Subscribe to stats
    statsSub = syncEngine.getStats().subscribe({
      next: (s: SyncStats) => {
        stats.set(s);
      },
    });

    // Auto-start if enabled
    if (autoStart) {
      syncEngine.start().catch((err: unknown) => {
        error.set(err instanceof Error ? err : new Error(String(err)));
        status.set('error');
      });
    }
  };

  // Cleanup
  const destroy = () => {
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
  };

  // Actions
  const forceSync = async () => {
    if (!syncEngine) return;
    try {
      error.set(null);
      await syncEngine.forceSync();
    } catch (err) {
      error.set(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const push = async () => {
    if (!syncEngine) return;
    try {
      error.set(null);
      await syncEngine.push();
    } catch (err) {
      error.set(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const pull = async () => {
    if (!syncEngine) return;
    try {
      error.set(null);
      await syncEngine.pull();
    } catch (err) {
      error.set(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const start = async () => {
    if (!syncEngine) return;
    try {
      error.set(null);
      await syncEngine.start();
    } catch (err) {
      error.set(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const stop = async () => {
    if (!syncEngine) return;
    try {
      await syncEngine.stop();
    } catch (err) {
      error.set(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  // Initialize
  setup();

  return {
    status: { subscribe: status.subscribe },
    isOnline: { subscribe: isOnline.subscribe },
    isSyncing: { subscribe: isSyncing.subscribe },
    stats: { subscribe: stats.subscribe },
    forceSync,
    push,
    pull,
    start,
    stop,
    error: { subscribe: error.subscribe },
    destroy,
  };
}

/**
 * Create a simple online status store.
 *
 * @example
 * ```svelte
 * <script>
 * import { createOnlineStatus } from '@pocket/svelte';
 * import { onDestroy } from 'svelte';
 *
 * const { isOnline, destroy } = createOnlineStatus();
 *
 * onDestroy(destroy);
 * </script>
 *
 * {#if !$isOnline}
 *   <span>You are offline</span>
 * {/if}
 * ```
 */
export function createOnlineStatus(): { isOnline: Readable<boolean>; destroy: () => void } {
  const isOnline = writable(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const handleOnline = () => isOnline.set(true);
  const handleOffline = () => isOnline.set(false);

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  const destroy = () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
  };

  return {
    isOnline: { subscribe: isOnline.subscribe },
    destroy,
  };
}
