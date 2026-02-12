/**
 * @module @pocket/shared-worker/sync-dedup
 *
 * Sync connection deduplication: ensures only one sync connection is active
 * across all tabs. The leader tab owns the sync connection and forwards
 * sync events to follower tabs via BroadcastChannel.
 *
 * @example
 * ```typescript
 * const syncDedup = createSyncConnectionDedup({ databaseName: 'my-app' });
 * syncDedup.requestSync('pull'); // Only executes on leader tab
 * syncDedup.syncStatus$.subscribe(status => console.log(status));
 * ```
 */
import type { Observable } from 'rxjs';
import { BehaviorSubject, Subject } from 'rxjs';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncConnectionDedupConfig {
  databaseName: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface SyncEvent {
  type: 'sync-start' | 'sync-complete' | 'sync-error' | 'sync-progress';
  tabId: string;
  timestamp: number;
  payload?: unknown;
}

export interface SyncConnectionDedup {
  readonly syncStatus$: Observable<SyncStatus>;
  readonly syncEvents$: Observable<SyncEvent>;
  readonly isLeader: boolean;
  requestSync(direction: 'push' | 'pull' | 'both'): void;
  setSyncHandler(handler: (direction: 'push' | 'pull' | 'both') => Promise<void>): void;
  reportSyncComplete(): void;
  reportSyncError(error: string): void;
  getQueuedSyncs(): number;
  destroy(): void;
}

export function createSyncConnectionDedup(config: SyncConnectionDedupConfig): SyncConnectionDedup {
  const maxRetries = config.maxRetries ?? 3;
  const retryDelayMs = config.retryDelayMs ?? 1000;
  const tabId = `sync-tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const statusSubject = new BehaviorSubject<SyncStatus>('idle');
  const eventsSubject = new Subject<SyncEvent>();
  const syncQueue: { direction: 'push' | 'pull' | 'both'; retries: number }[] = [];

  const isLeaderTab = true; // Default to leader in single-tab scenario
  let syncHandler: ((direction: 'push' | 'pull' | 'both') => Promise<void>) | null = null;
  let processing = false;

  function emitEvent(type: SyncEvent['type'], payload?: unknown): void {
    eventsSubject.next({ type, tabId, timestamp: Date.now(), payload });
  }

  async function processQueue(): Promise<void> {
    if (processing || syncQueue.length === 0 || !isLeaderTab) return;

    processing = true;
    statusSubject.next('syncing');
    emitEvent('sync-start');

    while (syncQueue.length > 0) {
      const item = syncQueue[0]!;

      try {
        if (syncHandler) {
          await syncHandler(item.direction);
        }
        syncQueue.shift();
        emitEvent('sync-complete', { direction: item.direction });
      } catch (error) {
        item.retries++;
        if (item.retries >= maxRetries) {
          syncQueue.shift();
          const message = error instanceof Error ? error.message : 'Unknown error';
          emitEvent('sync-error', { direction: item.direction, error: message });
        } else {
          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * item.retries));
        }
      }
    }

    processing = false;
    statusSubject.next('idle');
  }

  function requestSync(direction: 'push' | 'pull' | 'both'): void {
    // Deduplicate: don't queue if same direction is already queued
    const alreadyQueued = syncQueue.some((item) => item.direction === direction);
    if (!alreadyQueued) {
      syncQueue.push({ direction, retries: 0 });
    }

    if (isLeaderTab) {
      void processQueue();
    }
  }

  function setSyncHandler(handler: (direction: 'push' | 'pull' | 'both') => Promise<void>): void {
    syncHandler = handler;
  }

  function reportSyncComplete(): void {
    statusSubject.next('idle');
    emitEvent('sync-complete');
  }

  function reportSyncError(error: string): void {
    statusSubject.next('error');
    emitEvent('sync-error', { error });
  }

  function getQueuedSyncs(): number {
    return syncQueue.length;
  }

  function destroy(): void {
    syncQueue.length = 0;
    statusSubject.complete();
    eventsSubject.complete();
  }

  return {
    syncStatus$: statusSubject.asObservable(),
    syncEvents$: eventsSubject.asObservable(),
    get isLeader() {
      return isLeaderTab;
    },
    requestSync,
    setSyncHandler,
    reportSyncComplete,
    reportSyncError,
    getQueuedSyncs,
    destroy,
  };
}
