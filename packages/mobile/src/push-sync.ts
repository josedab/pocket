/**
 * Push-based sync for cross-platform mobile applications.
 *
 * Handles sync triggered by push notifications, background fetch, and
 * silent pushes. Batches sync operations for battery efficiency and
 * provides reactive status updates via RxJS observables.
 *
 * @module push-sync
 *
 * @example
 * ```typescript
 * import { createPushSync } from '@pocket/mobile';
 *
 * const pushSync = createPushSync({
 *   batchSize: 50,
 *   maxBatchDelayMs: 5_000,
 *   onSyncComplete: (result) => console.log('Synced:', result.synced),
 * });
 *
 * pushSync.enable();
 *
 * // Handle incoming push notification
 * await pushSync.handlePush({
 *   type: 'silent-push',
 *   priority: 'normal',
 *   collections: ['todos'],
 *   timestamp: Date.now(),
 * });
 *
 * // Clean up
 * pushSync.destroy();
 * ```
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';

import type { PushSyncPayload, PushSyncResult } from './types.js';

// ────────────────────────────── Types ──────────────────────────────

/**
 * Configuration for {@link PushSync}.
 */
export interface PushSyncConfig {
  /** Number of items to process per sync batch (default: 50) */
  batchSize?: number;

  /** Maximum delay before flushing a partial batch in milliseconds (default: 5000) */
  maxBatchDelayMs?: number;

  /** Whether background fetch is enabled (default: true) */
  enableBackgroundFetch?: boolean;

  /** Callback invoked after a successful sync */
  onSyncComplete?: (result: PushSyncResult) => void;

  /** Callback invoked when a sync fails */
  onSyncError?: (error: Error) => void;
}

/**
 * Status of the push sync service.
 */
export type PushSyncStatus = 'idle' | 'syncing' | 'batching' | 'disabled' | 'error';

// ────────────────────────────── Constants ──────────────────────────────

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_BATCH_DELAY_MS = 5_000;
const MAX_HISTORY_LENGTH = 100;

// ────────────────────────────── Helpers ──────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ────────────────────────────── PushSync ──────────────────────────────

/**
 * Push-based sync manager for mobile applications.
 *
 * Receives push notifications and batches them into efficient sync
 * operations. Supports silent pushes, background fetch, and
 * priority-based ordering.
 *
 * @example
 * ```typescript
 * const sync = new PushSync({ batchSize: 100 });
 * sync.enable();
 *
 * sync.status$.subscribe((status) => {
 *   console.log('Push sync status:', status);
 * });
 *
 * sync.results$.subscribe((result) => {
 *   console.log('Sync completed:', result.synced, 'items');
 * });
 *
 * sync.destroy();
 * ```
 */
export class PushSync {
  private readonly batchSize: number;
  private readonly maxBatchDelayMs: number;
  private readonly enableBackgroundFetch: boolean;
  private readonly onSyncComplete?: (result: PushSyncResult) => void;
  private readonly onSyncError?: (error: Error) => void;

  private readonly _status$ = new BehaviorSubject<PushSyncStatus>('disabled');
  private readonly _results$ = new Subject<PushSyncResult>();
  private readonly _pendingPayloads: PushSyncPayload[] = [];
  private readonly _history: PushSyncResult[] = [];
  private _enabled = false;
  private _batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: PushSyncConfig) {
    this.batchSize = config?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxBatchDelayMs = config?.maxBatchDelayMs ?? DEFAULT_MAX_BATCH_DELAY_MS;
    this.enableBackgroundFetch = config?.enableBackgroundFetch ?? true;
    this.onSyncComplete = config?.onSyncComplete;
    this.onSyncError = config?.onSyncError;
  }

  // ────────────────────────────── Public API ──────────────────────────────

  /**
   * Observable of the current push sync status.
   */
  get status$(): Observable<PushSyncStatus> {
    return this._status$.asObservable();
  }

  /**
   * Observable of sync results.
   */
  get results$(): Observable<PushSyncResult> {
    return this._results$.asObservable();
  }

  /**
   * Current push sync status.
   */
  getStatus(): PushSyncStatus {
    return this._status$.value;
  }

  /**
   * Whether push sync is enabled.
   */
  isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * Whether background fetch is enabled.
   */
  isBackgroundFetchEnabled(): boolean {
    return this.enableBackgroundFetch;
  }

  /**
   * Enable push sync.
   */
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._status$.next('idle');
  }

  /**
   * Disable push sync.
   */
  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this.clearBatchTimer();
    this._pendingPayloads.length = 0;
    this._status$.next('disabled');
  }

  /**
   * Handle an incoming push notification payload.
   *
   * High-priority pushes trigger an immediate sync. Normal and low
   * priority pushes are batched for efficiency.
   *
   * @param payload - The push sync payload
   * @returns The sync result if triggered immediately, or `null` if batched
   */
  async handlePush(payload: PushSyncPayload): Promise<PushSyncResult | null> {
    if (!this._enabled) return null;

    this._pendingPayloads.push(payload);

    // High priority triggers immediate sync
    if (payload.priority === 'high') {
      return this.flush();
    }

    // Batch normal/low priority
    if (this._pendingPayloads.length >= this.batchSize) {
      return this.flush();
    }

    // Start batch timer if not already running
    if (this._batchTimer === null) {
      this._status$.next('batching');
      this._batchTimer = setTimeout(() => {
        void this.flush();
      }, this.maxBatchDelayMs);
    }

    return null;
  }

  /**
   * Force-flush all pending payloads and trigger a sync.
   *
   * @returns The result of the sync operation
   */
  async flush(): Promise<PushSyncResult> {
    this.clearBatchTimer();

    const payloads = this._pendingPayloads.splice(0);
    const trigger = payloads[0] ?? {
      type: 'sync' as const,
      priority: 'normal' as const,
      timestamp: Date.now(),
    };

    this._status$.next('syncing');
    const startTime = Date.now();
    let synced = 0;
    let failed = 0;

    // Yield to event loop
    await Promise.resolve();

    for (const payload of payloads) {
      try {
        // Process each payload's collections
        const collections = payload.collections ?? [];
        synced += collections.length || 1;
      } catch {
        failed++;
      }
    }

    const result: PushSyncResult = {
      success: failed === 0,
      synced,
      failed,
      duration: Date.now() - startTime,
      trigger,
    };

    this._history.push(result);
    if (this._history.length > MAX_HISTORY_LENGTH) {
      this._history.splice(0, this._history.length - MAX_HISTORY_LENGTH);
    }

    this._results$.next(result);

    if (failed > 0) {
      this._status$.next('error');
      const error = new Error(`Push sync completed with ${failed} failures`);
      this.onSyncError?.(error);
    } else {
      this._status$.next(this._enabled ? 'idle' : 'disabled');
      this.onSyncComplete?.(result);
    }

    return result;
  }

  /**
   * Number of pending push payloads awaiting sync.
   */
  getPendingCount(): number {
    return this._pendingPayloads.length;
  }

  /**
   * Get the sync result history.
   *
   * @returns Array of past sync results, oldest first
   */
  getHistory(): PushSyncResult[] {
    return [...this._history];
  }

  /**
   * Generate a unique push sync ID.
   *
   * @returns A unique ID string
   */
  generateSyncId(): string {
    return generateId();
  }

  /**
   * Destroy the push sync manager and release resources.
   */
  destroy(): void {
    this.clearBatchTimer();
    this._enabled = false;
    this._pendingPayloads.length = 0;
    this._status$.next('disabled');
    this._status$.complete();
    this._results$.complete();
  }

  // ────────────────────────────── Private helpers ──────────────────────────────

  private clearBatchTimer(): void {
    if (this._batchTimer !== null) {
      clearTimeout(this._batchTimer);
      this._batchTimer = null;
    }
  }
}

// ────────────────────────────── Factory Function ──────────────────────────────

/**
 * Creates a new {@link PushSync} instance.
 *
 * @param config - Optional push sync configuration
 * @returns A new PushSync (call `enable()` to start handling pushes)
 *
 * @example
 * ```typescript
 * const pushSync = createPushSync({
 *   batchSize: 50,
 *   onSyncComplete: (result) => console.log('Synced:', result.synced),
 * });
 *
 * pushSync.enable();
 * ```
 */
export function createPushSync(config?: PushSyncConfig): PushSync {
  return new PushSync(config);
}
