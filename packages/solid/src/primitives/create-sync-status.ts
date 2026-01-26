import type { Observable } from 'rxjs';
import { createSignal, onCleanup, onMount, type Accessor } from 'solid-js';

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
  status: Accessor<SyncStatus>;
  /** Whether online */
  isOnline: Accessor<boolean>;
  /** Whether currently syncing */
  isSyncing: Accessor<boolean>;
  /** Sync statistics */
  stats: Accessor<SyncStats>;
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
  error: Accessor<Error | null>;
}

/**
 * Sync status options
 */
export interface CreateSyncStatusOptions {
  /** Auto-start syncing */
  autoStart?: boolean;
}

/**
 * Create sync status observers.
 *
 * @param syncEngine - The sync engine instance
 * @param options - Options
 *
 * @example
 * ```tsx
 * import { createSyncStatus } from '@pocket/solid';
 *
 * function SyncIndicator() {
 *   const syncEngine = // get from your app setup
 *
 *   const { status, isOnline, isSyncing, forceSync } = createSyncStatus(syncEngine);
 *
 *   return (
 *     <div>
 *       <Show when={!isOnline()}>
 *         <span>Offline</span>
 *       </Show>
 *       <Show when={isOnline()}>
 *         <Show when={isSyncing()} fallback={<span>Synced</span>}>
 *           <span>Syncing...</span>
 *         </Show>
 *       </Show>
 *       <button onClick={forceSync}>Sync Now</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function createSyncStatus(
  syncEngine: SyncEngine | null,
  options: CreateSyncStatusOptions = {}
): SyncStatusResult {
  const { autoStart = true } = options;

  const [status, setStatus] = createSignal<SyncStatus>('idle');
  const [isOnline, setIsOnline] = createSignal(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = createSignal(false);
  const [stats, setStats] = createSignal<SyncStats>({
    pushCount: 0,
    pullCount: 0,
    conflictCount: 0,
    lastSyncAt: null,
    lastError: null,
  });
  const [error, setError] = createSignal<Error | null>(null);

  let statusSub: { unsubscribe: () => void } | null = null;
  let statsSub: { unsubscribe: () => void } | null = null;

  // Online/offline handlers
  const handleOnline = () => setIsOnline(true);
  const handleOffline = () => setIsOnline(false);

  onMount(() => {
    // Online/offline listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    if (!syncEngine) return;

    // Subscribe to status
    statusSub = syncEngine.getStatus().subscribe({
      next: (s: SyncStatus) => {
        setStatus(s);
        setIsSyncing(s === 'syncing');
        if (s === 'error') {
          setError(stats().lastError);
        } else {
          setError(null);
        }
      },
    });

    // Subscribe to stats
    statsSub = syncEngine.getStats().subscribe({
      next: (s: SyncStats) => {
        setStats(s);
      },
    });

    // Auto-start if enabled
    if (autoStart) {
      syncEngine.start().catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      });
    }
  });

  onCleanup(() => {
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
      setError(null);
      await syncEngine.forceSync();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const push = async () => {
    if (!syncEngine) return;
    try {
      setError(null);
      await syncEngine.push();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const pull = async () => {
    if (!syncEngine) return;
    try {
      setError(null);
      await syncEngine.pull();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const start = async () => {
    if (!syncEngine) return;
    try {
      setError(null);
      await syncEngine.start();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const stop = async () => {
    if (!syncEngine) return;
    try {
      await syncEngine.stop();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
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
 * Create online status observer.
 *
 * @example
 * ```tsx
 * import { createOnlineStatus } from '@pocket/solid';
 *
 * function MyComponent() {
 *   const isOnline = createOnlineStatus();
 *
 *   return (
 *     <Show when={!isOnline()}>
 *       <span>You are offline</span>
 *     </Show>
 *   );
 * }
 * ```
 */
export function createOnlineStatus(): Accessor<boolean> {
  const [isOnline, setIsOnline] = createSignal(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const handleOnline = () => setIsOnline(true);
  const handleOffline = () => setIsOnline(false);

  onMount(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }
  });

  onCleanup(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
  });

  return isOnline;
}
