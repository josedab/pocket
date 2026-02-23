import { BehaviorSubject, Observable } from 'rxjs';
import type { OfflineQueueItem } from './types.js';
import type { OfflineQueue } from './offline-queue.js';

const DEFAULT_SYNC_TAG = 'pocket-background-sync';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MIN_RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface BackgroundSyncConfig {
  syncTag?: string;
  maxRetries?: number;
  minRetryIntervalMs?: number;
  onSync?: (items: OfflineQueueItem[]) => Promise<void>;
}

export interface SyncRegistration {
  tag: string;
  registeredAt: number;
  lastAttempt?: number;
  status: 'pending' | 'syncing' | 'completed' | 'failed';
}

export interface BackgroundSyncStats {
  registrations: number;
  pendingItems: number;
  lastSyncAt: number | null;
  failedAttempts: number;
}

export interface ServiceWorkerProvider {
  ready: Promise<{ sync: { register(tag: string): Promise<void> } }>;
}

export class BackgroundSyncManager {
  private readonly config: Required<Omit<BackgroundSyncConfig, 'onSync'>> & Pick<BackgroundSyncConfig, 'onSync'>;
  private readonly queue: OfflineQueue;
  private readonly swProvider: ServiceWorkerProvider | null;
  private readonly registrationSubject: BehaviorSubject<SyncRegistration | null>;
  private registration: SyncRegistration | null = null;
  private failedAttempts = 0;
  private lastSyncAt: number | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(
    config: BackgroundSyncConfig,
    queue: OfflineQueue,
    swProvider?: ServiceWorkerProvider,
  ) {
    this.config = {
      syncTag: config.syncTag ?? DEFAULT_SYNC_TAG,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      minRetryIntervalMs: config.minRetryIntervalMs ?? DEFAULT_MIN_RETRY_INTERVAL_MS,
      onSync: config.onSync,
    };
    this.queue = queue;
    this.swProvider = swProvider ?? this.getDefaultProvider();
    this.registrationSubject = new BehaviorSubject<SyncRegistration | null>(null);
  }

  get status$(): Observable<SyncRegistration | null> {
    return this.registrationSubject.asObservable();
  }

  async register(): Promise<void> {
    if (this.disposed) return;

    const tag = this.config.syncTag;
    this.registration = {
      tag,
      registeredAt: Date.now(),
      status: 'pending',
    };
    this.emitRegistration();

    if (this.swProvider) {
      try {
        const sw = await this.swProvider.ready;
        await sw.sync.register(tag);
        return;
      } catch {
        // SW sync not available, fall through to fallback
      }
    }

    this.startFallback();
  }

  unregister(): void {
    this.stopFallback();
    this.registration = null;
    this.emitRegistration();
  }

  async triggerSync(): Promise<{ processed: number; failed: number }> {
    if (this.disposed) return { processed: 0, failed: 0 };
    return this.performSync();
  }

  async handleSyncEvent(_event: { tag: string }): Promise<void> {
    if (_event.tag !== this.config.syncTag) return;
    await this.performSync();
  }

  getRegistration(): SyncRegistration | null {
    return this.registration ? { ...this.registration } : null;
  }

  getStats(): BackgroundSyncStats {
    return {
      registrations: this.registration ? 1 : 0,
      pendingItems: this.queue.size,
      lastSyncAt: this.lastSyncAt,
      failedAttempts: this.failedAttempts,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.stopFallback();
    this.registration = null;
    this.registrationSubject.complete();
  }

  private async performSync(): Promise<{ processed: number; failed: number }> {
    if (!this.registration) {
      this.registration = {
        tag: this.config.syncTag,
        registeredAt: Date.now(),
        status: 'syncing',
      };
    }

    this.registration.status = 'syncing';
    this.registration.lastAttempt = Date.now();
    this.emitRegistration();

    try {
      if (this.config.onSync && this.queue.size > 0) {
        // Collect current items for the onSync callback
        const items: OfflineQueueItem[] = [];
        await this.queue.drain(async (item) => {
          items.push(item);
          return true;
        });
        await this.config.onSync(items);
      } else {
        // Default: drain with a pass-through processor
        await this.queue.drain(async () => true);
      }

      const result = { processed: this.queue.size === 0 ? 1 : 0, failed: 0 };
      this.registration.status = 'completed';
      this.lastSyncAt = Date.now();
      this.emitRegistration();
      return { processed: result.processed, failed: 0 };
    } catch {
      this.failedAttempts++;
      this.registration.status = 'failed';
      this.emitRegistration();

      if (this.failedAttempts >= this.config.maxRetries) {
        this.stopFallback();
      }

      return { processed: 0, failed: 1 };
    }
  }

  private startFallback(): void {
    if (this.fallbackTimer) return;
    this.fallbackTimer = setInterval(() => {
      if (!this.disposed && this.queue.size > 0) {
        void this.performSync();
      }
    }, this.config.minRetryIntervalMs);
  }

  private stopFallback(): void {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  private emitRegistration(): void {
    if (!this.disposed) {
      this.registrationSubject.next(
        this.registration ? { ...this.registration } : null,
      );
    }
  }

  private getDefaultProvider(): ServiceWorkerProvider | null {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      return navigator.serviceWorker as unknown as ServiceWorkerProvider;
    }
    return null;
  }
}

export function createBackgroundSync(
  config: BackgroundSyncConfig,
  queue: OfflineQueue,
  swProvider?: ServiceWorkerProvider,
): BackgroundSyncManager {
  return new BackgroundSyncManager(config, queue, swProvider);
}
