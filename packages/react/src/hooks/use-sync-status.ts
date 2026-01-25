/**
 * React hooks for monitoring and controlling sync status.
 *
 * @module hooks/use-sync-status
 * @see {@link useSyncStatus} - Full sync status and controls
 * @see {@link useOnlineStatus} - Simple online/offline detection
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Observable } from 'rxjs';

/**
 * Possible states of the sync engine.
 *
 * - `'idle'` - Not currently syncing
 * - `'syncing'` - Actively syncing data
 * - `'error'` - Sync encountered an error
 * - `'offline'` - Device is offline
 */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

/**
 * Statistics about sync operations.
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
 * Sync engine interface for integration with @pocket/sync.
 *
 * This interface defines the contract that sync engines must implement
 * to work with {@link useSyncStatus}.
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
 * Result returned by {@link useSyncStatus}.
 *
 * Contains sync state, statistics, and control functions.
 */
export interface SyncStatusResult {
  /** Current sync status */
  status: SyncStatus;
  /** Whether online */
  isOnline: boolean;
  /** Whether currently syncing */
  isSyncing: boolean;
  /** Sync statistics */
  stats: SyncStats;
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
  error: Error | null;
}

/**
 * Configuration options for {@link useSyncStatus}.
 */
export interface UseSyncStatusOptions {
  /** Auto-start syncing */
  autoStart?: boolean;
}

/**
 * React hook to track and control sync status.
 *
 * Provides real-time sync state, statistics, and control functions.
 * Automatically tracks browser online/offline status.
 *
 * @param syncEngine - The sync engine instance from @pocket/sync, or `null` if not available
 * @param options - Optional configuration (autoStart, etc.)
 * @returns A {@link SyncStatusResult} with status, stats, and control functions
 *
 * @example
 * ```tsx
 * function SyncIndicator() {
 *   const { status, isSyncing, stats, forceSync } = useSyncStatus(syncEngine);
 *
 *   return (
 *     <div>
 *       <span className={`status-${status}`}>
 *         {isSyncing ? 'Syncing...' : status}
 *       </span>
 *       <span>Last sync: {stats.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleString() : 'Never'}</span>
 *       <button onClick={forceSync} disabled={isSyncing}>
 *         Sync Now
 *       </button>
 *     </div>
 *   );
 * }
 *
 * // Manual sync control
 * function SyncControls() {
 *   const { start, stop, push, pull, isOnline, error } = useSyncStatus(
 *     syncEngine,
 *     { autoStart: false }
 *   );
 *
 *   return (
 *     <div>
 *       <button onClick={start}>Start Sync</button>
 *       <button onClick={stop}>Stop Sync</button>
 *       <button onClick={push} disabled={!isOnline}>Push</button>
 *       <button onClick={pull} disabled={!isOnline}>Pull</button>
 *       {error && <span className="error">{error.message}</span>}
 *     </div>
 *   );
 * }
 * ```
 *
 * @see {@link useOnlineStatus} for simple online/offline detection
 */
export function useSyncStatus(
  syncEngine: SyncEngine | null,
  options: UseSyncStatusOptions = {}
): SyncStatusResult {
  const { autoStart = true } = options;

  const [status, setStatus] = useState<SyncStatus>('idle');
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [stats, setStats] = useState<SyncStats>({
    pushCount: 0,
    pullCount: 0,
    conflictCount: 0,
    lastSyncAt: null,
    lastError: null,
  });
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);

  // Track online status
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Subscribe to sync engine
  useEffect(() => {
    mountedRef.current = true;

    if (!syncEngine) return;

    // Subscribe to status
    const statusSub = syncEngine.getStatus().subscribe({
      next: (s: SyncStatus) => {
        if (mountedRef.current) {
          setStatus(s);
          if (s === 'error') {
            setError(stats.lastError);
          } else {
            setError(null);
          }
        }
      },
    });

    // Subscribe to stats
    const statsSub = syncEngine.getStats().subscribe({
      next: (s: SyncStats) => {
        if (mountedRef.current) {
          setStats(s);
        }
      },
    });

    // Auto-start if enabled
    if (autoStart) {
      syncEngine.start().catch((err: unknown) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setStatus('error');
        }
      });
    }

    return () => {
      mountedRef.current = false;
      statusSub.unsubscribe();
      statsSub.unsubscribe();
    };
  }, [syncEngine, autoStart, stats.lastError]);

  // Actions
  const forceSync = useCallback(async () => {
    if (!syncEngine) return;
    try {
      setError(null);
      await syncEngine.forceSync();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }, [syncEngine]);

  const push = useCallback(async () => {
    if (!syncEngine) return;
    try {
      setError(null);
      await syncEngine.push();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }, [syncEngine]);

  const pull = useCallback(async () => {
    if (!syncEngine) return;
    try {
      setError(null);
      await syncEngine.pull();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }, [syncEngine]);

  const start = useCallback(async () => {
    if (!syncEngine) return;
    try {
      setError(null);
      await syncEngine.start();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }, [syncEngine]);

  const stop = useCallback(async () => {
    if (!syncEngine) return;
    try {
      await syncEngine.stop();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }, [syncEngine]);

  return {
    status,
    isOnline,
    isSyncing: status === 'syncing',
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
 * React hook to track browser online/offline status.
 *
 * A lightweight alternative to {@link useSyncStatus} when you only need
 * to know if the device is online.
 *
 * @returns `true` if the browser is online, `false` if offline
 *
 * @example
 * ```tsx
 * function OnlineIndicator() {
 *   const isOnline = useOnlineStatus();
 *
 *   return (
 *     <span className={isOnline ? 'online' : 'offline'}>
 *       {isOnline ? '🟢 Online' : '🔴 Offline'}
 *     </span>
 *   );
 * }
 *
 * // Disable actions when offline
 * function SubmitButton() {
 *   const isOnline = useOnlineStatus();
 *
 *   return (
 *     <button disabled={!isOnline}>
 *       {isOnline ? 'Submit' : 'Offline - Cannot Submit'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
