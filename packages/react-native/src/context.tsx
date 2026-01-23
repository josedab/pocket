import type { Collection, Database, Document } from '@pocket/core';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  AppState,
  NetworkState,
  PocketReactNativeConfig,
  PocketReactNativeContextValue,
} from './types.js';

/**
 * Pocket React Native Context
 */
const PocketContext = createContext<PocketReactNativeContextValue | null>(null);

/**
 * Props for PocketProvider
 */
export interface PocketProviderProps {
  /** Pocket configuration */
  config: PocketReactNativeConfig;
  /** Database instance (if pre-created) */
  database?: Database;
  /** Children */
  children: ReactNode;
  /** App state change handler (for React Native) */
  onAppStateChange?: (callback: (state: AppState) => void) => () => void;
  /** Network state handler (for React Native) */
  onNetworkChange?: (callback: (state: NetworkState) => void) => () => void;
}

/**
 * Pocket Provider component for React Native
 */
export function PocketProvider({
  config,
  database: providedDatabase,
  children,
  onAppStateChange,
  onNetworkChange,
}: PocketProviderProps): React.JSX.Element {
  const [database, setDatabase] = useState<Database | null>(providedDatabase ?? null);
  const [isReady, setIsReady] = useState(!!providedDatabase);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [appState, setAppState] = useState<AppState>('active');
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<Error | null>(null);

  // Initialize database
  useEffect(() => {
    if (providedDatabase) {
      setDatabase(providedDatabase);
      setIsReady(true);
      return;
    }

    // Database initialization would happen here
    // For now, we expect the database to be provided
    if (config.debug) {
      console.log('[Pocket] Waiting for database initialization...');
    }
  }, [providedDatabase, config.debug]);

  // Handle app state changes
  useEffect(() => {
    if (!onAppStateChange) return;

    const unsubscribe = onAppStateChange((state) => {
      setAppState(state);

      if (config.debug) {
        console.log('[Pocket] App state changed:', state);
      }

      // Sync when app becomes active
      if (state === 'active' && config.sync?.syncOnActive && database) {
        void performSync();
      }

      // Persist on background
      if (state === 'background' && config.persistOnBackground && database) {
        if (config.debug) {
          console.log('[Pocket] Persisting data on background...');
        }
        // Persistence would happen here if needed
      }
    });

    return unsubscribe;
  }, [onAppStateChange, database, config]);

  // Handle network changes
  useEffect(() => {
    if (!onNetworkChange) return;

    const unsubscribe = onNetworkChange((state) => {
      setIsOnline(state.isConnected ?? false);

      if (config.debug) {
        console.log('[Pocket] Network state changed:', state);
      }

      // Sync when coming back online
      if (state.isConnected && config.sync?.serverUrl && database) {
        void performSync();
      }
    });

    return unsubscribe;
  }, [onNetworkChange, database, config]);

  // Sync function
  const performSync = useCallback(async () => {
    if (!database || !config.sync?.serverUrl || isSyncing) {
      return;
    }

    setIsSyncing(true);
    setSyncError(null);

    try {
      if (config.debug) {
        console.log('[Pocket] Starting sync...');
      }

      // Sync would be performed here using the sync package
      // For now, we just update the timestamp
      setLastSyncAt(Date.now());

      if (config.debug) {
        console.log('[Pocket] Sync completed');
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Sync failed');
      setSyncError(err);

      if (config.debug) {
        console.error('[Pocket] Sync error:', err);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [database, config, isSyncing]);

  // Get collection helper
  const getCollection = useCallback(
    <T extends Document>(name: string): Collection<T> | null => {
      if (!database) return null;
      return database.collection<T>(name);
    },
    [database]
  );

  // Context value
  const contextValue = useMemo<PocketReactNativeContextValue>(
    () => ({
      database,
      isReady,
      isSyncing,
      isOnline,
      appState,
      lastSyncAt,
      syncError,
      sync: performSync,
      collection: getCollection,
    }),
    [
      database,
      isReady,
      isSyncing,
      isOnline,
      appState,
      lastSyncAt,
      syncError,
      performSync,
      getCollection,
    ]
  );

  return <PocketContext.Provider value={contextValue}>{children}</PocketContext.Provider>;
}

/**
 * Hook to access Pocket context
 */
export function usePocket(): PocketReactNativeContextValue {
  const context = useContext(PocketContext);

  if (!context) {
    throw new Error('usePocket must be used within a PocketProvider');
  }

  return context;
}

/**
 * Hook to check if Pocket is ready
 */
export function usePocketReady(): boolean {
  const { isReady } = usePocket();
  return isReady;
}

/**
 * Hook to get sync status
 */
export function usePocketSync(): {
  isSyncing: boolean;
  lastSyncAt: number | null;
  syncError: Error | null;
  sync: () => Promise<void>;
} {
  const { isSyncing, lastSyncAt, syncError, sync } = usePocket();
  return { isSyncing, lastSyncAt, syncError, sync };
}

/**
 * Hook to get network status
 */
export function usePocketOnline(): boolean {
  const { isOnline } = usePocket();
  return isOnline;
}

/**
 * Hook to get app state
 */
export function usePocketAppState(): AppState {
  const { appState } = usePocket();
  return appState;
}
