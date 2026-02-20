import { BehaviorSubject, Observable } from 'rxjs';
import type { SyncStatus, PWAConfig, PWAStats } from './types.js';

export interface OnlineProvider {
  isOnline(): boolean;
  addOnlineListener(callback: () => void): () => void;
  addOfflineListener(callback: () => void): () => void;
}

const defaultOnlineProvider: OnlineProvider = {
  isOnline: () =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  addOnlineListener(callback: () => void): () => void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', callback);
      return () => window.removeEventListener('online', callback);
    }
    return () => {};
  },
  addOfflineListener(callback: () => void): () => void {
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', callback);
      return () => window.removeEventListener('offline', callback);
    }
    return () => {};
  },
};

export class SyncStatusTracker {
  private readonly statusSubject: BehaviorSubject<SyncStatus>;
  private readonly provider: OnlineProvider;
  private removeOnlineListener: (() => void) | null = null;
  private removeOfflineListener: (() => void) | null = null;
  private lastSyncTimestamp: number | null = null;
  private started = false;

  constructor(
    _config?: PWAConfig,
    provider?: OnlineProvider,
  ) {
    this.provider = provider ?? defaultOnlineProvider;
    const initial: SyncStatus = this.provider.isOnline() ? 'online' : 'offline';
    this.statusSubject = new BehaviorSubject<SyncStatus>(initial);
  }

  get status$(): Observable<SyncStatus> {
    return this.statusSubject.asObservable();
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.removeOnlineListener = this.provider.addOnlineListener(() => {
      this.statusSubject.next('online');
    });
    this.removeOfflineListener = this.provider.addOfflineListener(() => {
      this.statusSubject.next('offline');
    });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.removeOnlineListener?.();
    this.removeOfflineListener?.();
    this.removeOnlineListener = null;
    this.removeOfflineListener = null;
  }

  isOnline(): boolean {
    return this.provider.isOnline();
  }

  getStatus(): SyncStatus {
    return this.statusSubject.getValue();
  }

  setStatus(status: SyncStatus): void {
    this.statusSubject.next(status);
    if (status === 'online') {
      this.lastSyncTimestamp = Date.now();
    }
  }

  getStats(offlineQueueSize: number, cachedCollections: string[]): PWAStats {
    return {
      offlineQueueSize,
      cachedCollections,
      lastSyncTimestamp: this.lastSyncTimestamp,
      isOnline: this.isOnline(),
    };
  }

  destroy(): void {
    this.stop();
    this.statusSubject.complete();
  }
}

export function createSyncStatusTracker(
  config?: PWAConfig,
  provider?: OnlineProvider,
): SyncStatusTracker {
  return new SyncStatusTracker(config, provider);
}
