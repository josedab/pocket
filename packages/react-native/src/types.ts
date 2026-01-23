import type { Collection, Database, Document } from '@pocket/core';

/**
 * React Native storage configuration
 */
export interface ReactNativeStorageConfig {
  /** Storage type to use */
  type: 'async-storage' | 'mmkv' | 'sqlite' | 'file-system';
  /** Storage name/path */
  name: string;
  /** Encryption key (for encrypted storage) */
  encryptionKey?: string;
  /** Custom async storage instance */
  asyncStorage?: AsyncStorageInterface;
  /** Custom MMKV instance */
  mmkvInstance?: MMKVInterface;
}

/**
 * AsyncStorage interface (compatible with @react-native-async-storage/async-storage)
 */
export interface AsyncStorageInterface {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<readonly [string, string | null][]>;
  multiSet(keyValuePairs: readonly [string, string][]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

/**
 * MMKV interface (compatible with react-native-mmkv)
 */
export interface MMKVInterface {
  getString(key: string): string | undefined;
  set(key: string, value: string | number | boolean): void;
  delete(key: string): void;
  getAllKeys(): string[];
  contains(key: string): boolean;
  clearAll(): void;
}

/**
 * App state for React Native
 */
export type AppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

/**
 * Network state
 */
export interface NetworkState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  type: string;
}

/**
 * Pocket React Native configuration
 */
export interface PocketReactNativeConfig {
  /** Database name */
  name: string;
  /** Storage configuration */
  storage: ReactNativeStorageConfig;
  /** Sync configuration */
  sync?: {
    /** Sync server URL */
    serverUrl: string;
    /** Auth token provider */
    getAuthToken?: () => Promise<string | null>;
    /** Sync when app becomes active */
    syncOnActive?: boolean;
    /** Background sync interval (ms) */
    backgroundSyncInterval?: number;
  };
  /** Auto-persist on background */
  persistOnBackground?: boolean;
  /** Debug mode */
  debug?: boolean;
}

/**
 * Pocket React Native context value
 */
export interface PocketReactNativeContextValue {
  /** Database instance */
  database: Database | null;
  /** Is database ready */
  isReady: boolean;
  /** Is syncing */
  isSyncing: boolean;
  /** Is online */
  isOnline: boolean;
  /** App state */
  appState: AppState;
  /** Last sync timestamp */
  lastSyncAt: number | null;
  /** Sync error */
  syncError: Error | null;
  /** Trigger manual sync */
  sync: () => Promise<void>;
  /** Get a collection */
  collection: <T extends Document>(name: string) => Collection<T> | null;
}

/**
 * Hook options for useDocument
 */
export interface UseDocumentOptions {
  /** Suspend while loading */
  suspense?: boolean;
  /** Skip initial fetch */
  skip?: boolean;
}

/**
 * Hook options for useQuery
 */
export interface UseQueryOptions<T extends Document> {
  /** Sort field */
  sortBy?: keyof T & string;
  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
  /** Limit results */
  limit?: number;
  /** Skip (offset) */
  skip?: number;
  /** Suspense mode */
  suspense?: boolean;
}

/**
 * Hook result for useDocument
 */
export interface UseDocumentResult<T extends Document> {
  /** Document data */
  data: T | null;
  /** Is loading */
  isLoading: boolean;
  /** Error */
  error: Error | null;
  /** Refetch */
  refetch: () => Promise<void>;
  /** Update document */
  update: (changes: Partial<T>) => Promise<T | null>;
  /** Delete document */
  remove: () => Promise<void>;
}

/**
 * Hook result for useQuery
 */
export interface UseQueryResult<T extends Document> {
  /** Query results */
  data: T[];
  /** Is loading */
  isLoading: boolean;
  /** Error */
  error: Error | null;
  /** Total count */
  count: number;
  /** Refetch */
  refetch: () => Promise<void>;
  /** Is empty */
  isEmpty: boolean;
}

/**
 * Hook result for useMutation
 */
export interface UseMutationResult<T extends Document> {
  /** Insert a document */
  insert: (doc: Omit<T, '_id' | '_rev' | '_updatedAt'>) => Promise<T>;
  /** Update a document */
  update: (id: string, changes: Partial<T>) => Promise<T>;
  /** Delete a document */
  remove: (id: string) => Promise<void>;
  /** Is mutating */
  isMutating: boolean;
  /** Mutation error */
  error: Error | null;
}
