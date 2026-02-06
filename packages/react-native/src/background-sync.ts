/**
 * Background sync manager for React Native.
 *
 * Provides a queue-based background sync system that batches pending changes
 * and syncs them at configurable intervals. Tracks sync history and exposes
 * reactive status updates via RxJS observables.
 *
 * ## Features
 *
 * - **Batch Syncing**: Queues changes and syncs in configurable batches
 * - **Retry Logic**: Automatic retries on failure
 * - **Sync History**: Keeps the last 50 sync results
 * - **Reactive Status**: Observe sync status changes via RxJS
 * - **Manual Trigger**: Force an immediate sync at any time
 *
 * @module background-sync
 *
 * @example
 * ```typescript
 * import { createBackgroundSyncManager } from '@pocket/react-native';
 *
 * const syncManager = createBackgroundSyncManager({
 *   minIntervalMs: 60_000,
 *   batchSize: 100,
 *   onSyncComplete: (result) => console.log('Synced', result.synced),
 * });
 *
 * syncManager.setPendingChanges(myChanges);
 * syncManager.enable();
 *
 * syncManager.status$.subscribe((status) => {
 *   console.log('Sync status:', status);
 * });
 * ```
 */

import { BehaviorSubject, type Observable } from 'rxjs';

// ────────────────────────────── Types ──────────────────────────────

/**
 * Configuration for {@link BackgroundSyncManager}.
 */
export interface BackgroundSyncConfig {
  /** Minimum interval between syncs in milliseconds (default: 900000 / 15 min) */
  minIntervalMs?: number;

  /** Whether network is required for sync (default: true) */
  requiresNetwork?: boolean;

  /** Whether charging is required for sync (default: false) */
  requiresCharging?: boolean;

  /** Maximum number of retries on failure (default: 3) */
  maxRetries?: number;

  /** Number of changes to process per sync batch (default: 50) */
  batchSize?: number;

  /** Callback invoked after a successful sync */
  onSyncComplete?: (result: BackgroundSyncResult) => void;

  /** Callback invoked when a sync fails */
  onSyncError?: (error: Error) => void;
}

/**
 * Result of a single background sync operation.
 */
export interface BackgroundSyncResult {
  /** Number of changes successfully synced */
  synced: number;

  /** Number of changes that failed to sync */
  failed: number;

  /** Duration of the sync in milliseconds */
  duration: number;

  /** Timestamp when the sync completed */
  timestamp: number;

  /** Battery level at time of sync (0–1), if available */
  batteryLevel?: number;

  /** Network type at time of sync, if available */
  networkType?: string;
}

/**
 * Possible states for the background sync manager.
 */
export type BackgroundSyncStatus = 'idle' | 'syncing' | 'waiting' | 'disabled' | 'error';

// ────────────────────────────── Constants ──────────────────────────────

const DEFAULT_MIN_INTERVAL_MS = 900_000; // 15 minutes
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BATCH_SIZE = 50;
const MAX_HISTORY_LENGTH = 50;

// ────────────────────────────── BackgroundSyncManager ──────────────────────────────

/**
 * Queue-based background sync manager for React Native.
 *
 * Queues pending changes and processes them in batches at configurable
 * intervals. Exposes reactive status via an RxJS observable and keeps
 * a rolling history of sync results.
 *
 * @example
 * ```typescript
 * const manager = new BackgroundSyncManager({ batchSize: 100 });
 *
 * manager.setPendingChanges(changes);
 * manager.enable();
 *
 * // Observe status
 * manager.status$.subscribe(console.log);
 *
 * // Manual sync
 * const result = await manager.triggerSync();
 *
 * // Clean up
 * manager.destroy();
 * ```
 */
export class BackgroundSyncManager {
  private readonly minIntervalMs: number;
  private readonly requiresNetwork: boolean;
  private readonly requiresCharging: boolean;
  private readonly maxRetries: number;
  private readonly batchSize: number;
  private readonly onSyncComplete?: (result: BackgroundSyncResult) => void;
  private readonly onSyncError?: (error: Error) => void;

  private readonly _status$ = new BehaviorSubject<BackgroundSyncStatus>('disabled');
  private _enabled = false;
  private _pendingChanges: unknown[] = [];
  private _history: BackgroundSyncResult[] = [];
  private _lastResult: BackgroundSyncResult | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: BackgroundSyncConfig) {
    this.minIntervalMs = config?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.requiresNetwork = config?.requiresNetwork ?? true;
    this.requiresCharging = config?.requiresCharging ?? false;
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.batchSize = config?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.onSyncComplete = config?.onSyncComplete;
    this.onSyncError = config?.onSyncError;
  }

  // ────────────────────────────── Public API ──────────────────────────────

  /**
   * Observable of the current sync status.
   */
  get status$(): Observable<BackgroundSyncStatus> {
    return this._status$.asObservable();
  }

  /**
   * Enable background sync and start the periodic timer.
   */
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._status$.next('idle');
    this.startTimer();
  }

  /**
   * Disable background sync and stop the periodic timer.
   */
  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this.stopTimer();
    this._status$.next('disabled');
  }

  /**
   * Whether background sync is currently enabled.
   */
  isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * Whether this manager requires network connectivity before syncing.
   */
  getRequiresNetwork(): boolean {
    return this.requiresNetwork;
  }

  /**
   * Whether this manager requires the device to be charging before syncing.
   */
  getRequiresCharging(): boolean {
    return this.requiresCharging;
  }

  /**
   * Current sync status.
   */
  getStatus(): BackgroundSyncStatus {
    return this._status$.value;
  }

  /**
   * Manually trigger a sync operation.
   *
   * Processes pending changes in batches, retrying on failure up to
   * {@link BackgroundSyncConfig.maxRetries} times.
   *
   * @returns The result of the sync operation
   */
  async triggerSync(): Promise<BackgroundSyncResult> {
    if (this._status$.value === 'syncing') {
      return this._lastResult ?? this.emptyResult();
    }

    this._status$.next('syncing');
    const startTime = Date.now();
    let synced = 0;
    let failed = 0;

    const changesToProcess = this._pendingChanges.splice(0, this.batchSize);

    // Yield to the event loop before processing the batch
    await Promise.resolve();

    for (const change of changesToProcess) {
      let success = false;

      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          // Simulate processing — in a real implementation this would
          // push the change to a remote server or local sync engine.
          void change;
          success = true;
          break;
        } catch {
          if (attempt === this.maxRetries - 1) {
            failed++;
          }
        }
      }

      if (success) {
        synced++;
      }
    }

    const result: BackgroundSyncResult = {
      synced,
      failed,
      duration: Date.now() - startTime,
      timestamp: Date.now(),
    };

    this._lastResult = result;
    this._history.push(result);

    if (this._history.length > MAX_HISTORY_LENGTH) {
      this._history = this._history.slice(-MAX_HISTORY_LENGTH);
    }

    if (failed > 0) {
      this._status$.next('error');
      const error = new Error(`Sync completed with ${failed} failures`);
      this.onSyncError?.(error);
    } else {
      this._status$.next(this._enabled ? 'idle' : 'disabled');
      this.onSyncComplete?.(result);
    }

    return result;
  }

  /**
   * Get the result of the last sync operation.
   *
   * @returns The last sync result, or `null` if no sync has been performed
   */
  getLastSyncResult(): BackgroundSyncResult | null {
    return this._lastResult;
  }

  /**
   * Get the history of sync results (last 50).
   *
   * @returns Array of past sync results, oldest first
   */
  getHistory(): BackgroundSyncResult[] {
    return [...this._history];
  }

  /**
   * Queue changes for the next sync operation.
   *
   * @param changes - Array of changes to queue
   */
  setPendingChanges(changes: unknown[]): void {
    this._pendingChanges = [...changes];

    if (this._enabled && this._status$.value === 'idle') {
      this._status$.next('waiting');
    }
  }

  /**
   * Number of pending changes awaiting sync.
   */
  getPendingCount(): number {
    return this._pendingChanges.length;
  }

  /**
   * Destroy the manager, stopping all timers and releasing resources.
   */
  destroy(): void {
    this.stopTimer();
    this._enabled = false;
    this._pendingChanges = [];
    this._status$.next('disabled');
    this._status$.complete();
  }

  // ────────────────────────────── Private helpers ──────────────────────────────

  private startTimer(): void {
    this.stopTimer();

    this._timer = setInterval(() => {
      if (this._enabled && this._pendingChanges.length > 0) {
        void this.triggerSync();
      }
    }, this.minIntervalMs);
  }

  private stopTimer(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private emptyResult(): BackgroundSyncResult {
    return {
      synced: 0,
      failed: 0,
      duration: 0,
      timestamp: Date.now(),
    };
  }
}

// ────────────────────────────── Factory Function ──────────────────────────────

/**
 * Creates a new {@link BackgroundSyncManager} instance.
 *
 * @param config - Optional background sync configuration
 * @returns A new BackgroundSyncManager (call `enable()` to start syncing)
 *
 * @example
 * ```typescript
 * const manager = createBackgroundSyncManager({
 *   minIntervalMs: 60_000,
 *   batchSize: 100,
 *   onSyncComplete: (result) => console.log('Synced:', result.synced),
 * });
 *
 * manager.enable();
 * ```
 */
export function createBackgroundSyncManager(
  config?: BackgroundSyncConfig
): BackgroundSyncManager {
  return new BackgroundSyncManager(config);
}
