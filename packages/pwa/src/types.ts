export type CacheStrategy = 'cache-first' | 'network-first' | 'stale-while-revalidate';

export type SyncStatus = 'online' | 'offline' | 'syncing' | 'error';

export interface PWAConfig {
  cacheName?: string;
  cacheStrategy?: CacheStrategy;
  syncOnReconnect?: boolean;
  maxOfflineQueueSize?: number;
  backgroundSyncTag?: string;
}

export interface OfflineQueueItem {
  id: string;
  collection: string;
  operation: 'create' | 'update' | 'delete';
  data: unknown;
  timestamp: number;
  retryCount: number;
}

export interface PWAStats {
  offlineQueueSize: number;
  cachedCollections: string[];
  lastSyncTimestamp: number | null;
  isOnline: boolean;
}
