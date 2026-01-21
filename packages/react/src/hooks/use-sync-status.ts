import { useCallback, useEffect, useRef, useState } from 'react';
import type { Observable } from 'rxjs';

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
 * Sync status options
 */
export interface UseSyncStatusOptions {
  /** Auto-start syncing */
  autoStart?: boolean;
}

/**
 * Hook to track sync status
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
 * Hook to track online status only
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
