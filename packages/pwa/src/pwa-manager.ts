import type { Observable } from 'rxjs';
import { OfflineQueue } from './offline-queue.js';
import { SyncStatusTracker } from './sync-status-tracker.js';
import type { OnlineProvider } from './sync-status-tracker.js';
import type {
  PWAConfig,
  PWAStats,
  SyncStatus,
  OfflineQueueItem,
} from './types.js';

const DEFAULT_CONFIG: PWAConfig = {
  cacheName: 'pocket-pwa-cache',
  cacheStrategy: 'cache-first',
  syncOnReconnect: true,
  maxOfflineQueueSize: 1000,
  backgroundSyncTag: 'pocket-sync',
};

export class PWAManager {
  private readonly config: PWAConfig;
  private readonly offlineQueue: OfflineQueue;
  private readonly syncTracker: SyncStatusTracker;
  private readonly cachedCollections = new Set<string>();
  private started = false;

  constructor(config: PWAConfig, provider?: OnlineProvider) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.offlineQueue = new OfflineQueue(this.config);
    this.syncTracker = new SyncStatusTracker(this.config, provider);
  }

  get status$(): Observable<SyncStatus> {
    return this.syncTracker.status$;
  }

  get queue$(): Observable<OfflineQueueItem[]> {
    return this.offlineQueue.queue$;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.syncTracker.start();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.syncTracker.stop();
  }

  getStatus(): SyncStatus {
    return this.syncTracker.getStatus();
  }

  getStats(): PWAStats {
    return this.syncTracker.getStats(
      this.offlineQueue.size,
      [...this.cachedCollections],
    );
  }

  enqueueOfflineWrite(
    item: Omit<OfflineQueueItem, 'id' | 'timestamp' | 'retryCount'>,
  ): OfflineQueueItem {
    this.cachedCollections.add(item.collection);
    return this.offlineQueue.enqueue(item);
  }

  async drainQueue(
    processor: (item: OfflineQueueItem) => Promise<boolean>,
  ): Promise<{ processed: number; failed: number }> {
    this.syncTracker.setStatus('syncing');
    try {
      const result = await this.offlineQueue.drain(processor);
      this.syncTracker.setStatus('online');
      return result;
    } catch {
      this.syncTracker.setStatus('error');
      return { processed: 0, failed: 0 };
    }
  }

  destroy(): void {
    this.stop();
    this.offlineQueue.destroy();
    this.syncTracker.destroy();
  }
}

export function createPWAManager(
  config: PWAConfig,
  provider?: OnlineProvider,
): PWAManager {
  return new PWAManager(config, provider);
}
