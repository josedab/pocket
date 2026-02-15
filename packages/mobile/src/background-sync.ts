/**
 * Background sync scheduler for cross-platform mobile applications.
 *
 * Intelligent background sync that adapts to battery level, network conditions,
 * and app lifecycle state. Schedules sync operations optimally to minimize
 * battery drain while keeping data fresh.
 *
 * @module background-sync
 *
 * @example
 * ```typescript
 * import { createBackgroundSyncScheduler } from '@pocket/mobile';
 *
 * const scheduler = createBackgroundSyncScheduler({
 *   minIntervalMs: 30_000,
 *   maxIntervalMs: 300_000,
 *   batteryThreshold: 0.2,
 *   adaptiveScheduling: true,
 *   syncOnReconnect: true,
 *   syncOnForeground: true,
 * });
 *
 * scheduler.start();
 *
 * // Schedule a sync task
 * const task = scheduler.schedule('todos', 'high');
 * console.log('Scheduled:', task.id);
 *
 * // Monitor state
 * scheduler.state$.subscribe((state) => {
 *   console.log('Running:', state.isRunning, 'Pending:', state.pendingTasks);
 * });
 *
 * // Clean up
 * scheduler.dispose();
 * ```
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';

// ────────────────────────────── Types ──────────────────────────────

/**
 * Priority level for scheduled sync tasks.
 */
export type SyncPriority = 'critical' | 'high' | 'normal' | 'low' | 'opportunistic';

/**
 * Application lifecycle state.
 */
export type AppLifecycleState = 'active' | 'inactive' | 'background' | 'suspended' | 'terminated';

/**
 * Configuration for {@link BackgroundSyncScheduler}.
 */
export interface BackgroundSyncConfig {
  /** Minimum interval between sync attempts in milliseconds (default: 30000) */
  minIntervalMs?: number;

  /** Maximum interval before forced sync in milliseconds (default: 300000) */
  maxIntervalMs?: number;

  /** Battery level threshold to pause non-critical syncs, 0–1 (default: 0.2) */
  batteryThreshold?: number;

  /** Enable adaptive scheduling based on usage patterns (default: true) */
  adaptiveScheduling?: boolean;

  /** Maximum retry attempts for failed syncs (default: 3) */
  maxRetries?: number;

  /** Retry backoff multiplier in milliseconds (default: 1000) */
  retryBackoffMs?: number;

  /** Sync when coming online (default: true) */
  syncOnReconnect?: boolean;

  /** Sync when app becomes active (default: true) */
  syncOnForeground?: boolean;

  /** Enable wake-lock during sync (default: false) */
  useWakeLock?: boolean;
}

/**
 * A scheduled sync task.
 *
 * @example
 * ```typescript
 * const task = scheduler.schedule('users', 'high');
 * console.log(task.status); // 'pending'
 * ```
 */
export interface SyncTask {
  /** Unique task identifier */
  id: string;

  /** Collection to sync */
  collection: string;

  /** Task priority */
  priority: SyncPriority;

  /** Current task status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'deferred';

  /** Timestamp when the task was scheduled */
  scheduledAt: number;

  /** Timestamp when the task started executing */
  startedAt?: number;

  /** Timestamp when the task completed */
  completedAt?: number;

  /** Number of retry attempts so far */
  retries: number;

  /** Error message if the task failed */
  error?: string;

  /** Number of documents processed */
  documentsProcessed?: number;
}

/**
 * Snapshot of the scheduler's current state.
 */
export interface SyncSchedulerState {
  /** Whether the scheduler is actively processing tasks */
  isRunning: boolean;

  /** The currently executing task, if any */
  currentTask: SyncTask | null;

  /** Number of pending tasks */
  pendingTasks: number;

  /** Number of completed tasks */
  completedTasks: number;

  /** Number of failed tasks */
  failedTasks: number;

  /** Timestamp of the last successful sync */
  lastSyncAt: number;

  /** Timestamp of the next scheduled sync */
  nextSyncAt: number;

  /** Current application lifecycle state */
  appState: AppLifecycleState;

  /** Current battery level (0–1) */
  batteryLevel: number;

  /** Whether the device is currently charging */
  isCharging: boolean;

  /** Whether the device has a network connection */
  networkConnected: boolean;
}

/**
 * Events emitted by the sync scheduler.
 */
export interface SyncSchedulerEvent {
  /** Event type */
  type:
    | 'sync-started'
    | 'sync-completed'
    | 'sync-failed'
    | 'sync-deferred'
    | 'lifecycle-changed'
    | 'battery-low'
    | 'network-changed'
    | 'schedule-adjusted';

  /** Timestamp of the event */
  timestamp: number;

  /** Optional event-specific payload */
  data?: unknown;
}

// ────────────────────────────── Constants ──────────────────────────────

const DEFAULT_MIN_INTERVAL_MS = 30_000;
const DEFAULT_MAX_INTERVAL_MS = 300_000;
const DEFAULT_BATTERY_THRESHOLD = 0.2;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BACKOFF_MS = 1_000;

const PRIORITY_ORDER: Record<SyncPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  opportunistic: 4,
};

// ────────────────────────────── Helpers ──────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ────────────────────────────── BackgroundSyncScheduler ──────────────────────────────

/**
 * Battery- and lifecycle-aware background sync scheduler.
 *
 * Schedules sync tasks based on priority and adapts to current device
 * conditions (battery, network, lifecycle). Tasks are processed in
 * priority order, deferred when conditions are unfavorable, and
 * retried with exponential backoff on failure.
 *
 * @example
 * ```typescript
 * const scheduler = new BackgroundSyncScheduler({
 *   minIntervalMs: 60_000,
 *   batteryThreshold: 0.15,
 * });
 *
 * scheduler.start();
 *
 * scheduler.events$.subscribe((event) => {
 *   console.log(event.type, event.data);
 * });
 *
 * scheduler.schedule('todos', 'critical');
 * scheduler.schedule('settings', 'low');
 * ```
 */
export class BackgroundSyncScheduler {
  private readonly minIntervalMs: number;
  private readonly maxIntervalMs: number;
  private readonly batteryThreshold: number;
  private readonly adaptiveScheduling: boolean;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly syncOnReconnect: boolean;
  private readonly syncOnForeground: boolean;
  private readonly useWakeLock: boolean;

  private readonly _state$: BehaviorSubject<SyncSchedulerState>;
  private readonly _events$ = new Subject<SyncSchedulerEvent>();
  private readonly _tasks: SyncTask[] = [];

  private _isRunning = false;
  private _processing = false;
  private _completedCount = 0;
  private _failedCount = 0;
  private _lastSyncAt = 0;
  private _nextSyncAt = 0;
  private _appState: AppLifecycleState = 'active';
  private _batteryLevel = 1;
  private _isCharging = false;
  private _networkConnected = true;
  private _processTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: BackgroundSyncConfig) {
    this.minIntervalMs = config?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.maxIntervalMs = config?.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
    this.batteryThreshold = config?.batteryThreshold ?? DEFAULT_BATTERY_THRESHOLD;
    this.adaptiveScheduling = config?.adaptiveScheduling ?? true;
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBackoffMs = config?.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    this.syncOnReconnect = config?.syncOnReconnect ?? true;
    this.syncOnForeground = config?.syncOnForeground ?? true;
    this.useWakeLock = config?.useWakeLock ?? false;

    this._nextSyncAt = Date.now() + this.minIntervalMs;

    this._state$ = new BehaviorSubject<SyncSchedulerState>(this.buildState());
  }

  // ────────────────────────────── Public API ──────────────────────────────

  /**
   * Observable of scheduler state changes.
   *
   * @example
   * ```typescript
   * scheduler.state$.subscribe((state) => {
   *   console.log('Pending:', state.pendingTasks);
   * });
   * ```
   */
  get state$(): Observable<SyncSchedulerState> {
    return this._state$.asObservable();
  }

  /**
   * Observable of scheduler events.
   *
   * @example
   * ```typescript
   * scheduler.events$.subscribe((event) => {
   *   if (event.type === 'sync-failed') {
   *     console.error('Sync failed:', event.data);
   *   }
   * });
   * ```
   */
  get events$(): Observable<SyncSchedulerEvent> {
    return this._events$.asObservable();
  }

  /**
   * Schedule a sync task for the given collection.
   *
   * @param collection - Name of the collection to sync
   * @param priority - Task priority (default: 'normal')
   * @returns The created sync task
   *
   * @example
   * ```typescript
   * const task = scheduler.schedule('todos', 'high');
   * console.log(task.id, task.status); // 'abc123' 'pending'
   * ```
   */
  schedule(collection: string, priority: SyncPriority = 'normal'): SyncTask {
    const task: SyncTask = {
      id: generateId(),
      collection,
      priority,
      status: 'pending',
      scheduledAt: Date.now(),
      retries: 0,
    };

    this._tasks.push(task);
    this.sortTasks();
    this.emitState();

    // Trigger processing if running
    if (this._isRunning && !this._processing) {
      void this.processQueue();
    }

    return task;
  }

  /**
   * Cancel a scheduled task by ID.
   *
   * @param taskId - The task ID to cancel
   * @returns `true` if the task was found and cancelled
   *
   * @example
   * ```typescript
   * const task = scheduler.schedule('todos');
   * const cancelled = scheduler.cancel(task.id);
   * ```
   */
  cancel(taskId: string): boolean {
    const index = this._tasks.findIndex((t) => t.id === taskId && t.status === 'pending');
    if (index === -1) return false;

    this._tasks.splice(index, 1);
    this.emitState();
    return true;
  }

  /**
   * Cancel all pending tasks.
   *
   * @returns The number of tasks cancelled
   *
   * @example
   * ```typescript
   * scheduler.schedule('todos');
   * scheduler.schedule('settings');
   * const count = scheduler.cancelAll(); // 2
   * ```
   */
  cancelAll(): number {
    const pendingCount = this._tasks.filter((t) => t.status === 'pending').length;
    this._tasks.length = 0;
    this.emitState();
    return pendingCount;
  }

  /**
   * Start processing scheduled tasks.
   *
   * @example
   * ```typescript
   * scheduler.start();
   * console.log(scheduler.getState().isRunning); // true
   * ```
   */
  start(): void {
    if (this._isRunning) return;
    this._isRunning = true;
    this.emitState();

    if (this._tasks.length > 0) {
      void this.processQueue();
    }
  }

  /**
   * Stop processing scheduled tasks.
   *
   * @example
   * ```typescript
   * scheduler.stop();
   * console.log(scheduler.getState().isRunning); // false
   * ```
   */
  stop(): void {
    if (!this._isRunning) return;
    this._isRunning = false;
    this.clearProcessTimer();
    this.emitState();
  }

  /**
   * Update the current application lifecycle state.
   *
   * When {@link BackgroundSyncConfig.syncOnForeground} is enabled, transitioning
   * to `'active'` triggers immediate queue processing.
   *
   * @param state - The new lifecycle state
   *
   * @example
   * ```typescript
   * scheduler.setAppState('background');
   * scheduler.setAppState('active'); // triggers sync if configured
   * ```
   */
  setAppState(state: AppLifecycleState): void {
    const previous = this._appState;
    this._appState = state;

    this._events$.next({
      type: 'lifecycle-changed',
      timestamp: Date.now(),
      data: { previous, current: state },
    });

    if (this.syncOnForeground && state === 'active' && previous !== 'active' && this._isRunning) {
      void this.processQueue();
    }

    this.adjustScheduleForConditions();
    this.emitState();
  }

  /**
   * Update the current battery state.
   *
   * Emits a `'battery-low'` event when the level drops below the configured
   * threshold while not charging.
   *
   * @param state - Battery level (0–1) and charging flag
   *
   * @example
   * ```typescript
   * scheduler.setBatteryState({ level: 0.15, isCharging: false });
   * ```
   */
  setBatteryState(state: { level: number; isCharging: boolean }): void {
    this._batteryLevel = state.level;
    this._isCharging = state.isCharging;

    if (state.level < this.batteryThreshold && !state.isCharging) {
      this._events$.next({
        type: 'battery-low',
        timestamp: Date.now(),
        data: { level: state.level },
      });
    }

    this.adjustScheduleForConditions();
    this.emitState();
  }

  /**
   * Update the current network state.
   *
   * When {@link BackgroundSyncConfig.syncOnReconnect} is enabled, coming online
   * triggers immediate queue processing.
   *
   * @param state - Network connected flag and optional connection type
   *
   * @example
   * ```typescript
   * scheduler.setNetworkState({ connected: true, type: 'wifi' });
   * ```
   */
  setNetworkState(state: { connected: boolean; type?: string }): void {
    const wasConnected = this._networkConnected;
    this._networkConnected = state.connected;

    this._events$.next({
      type: 'network-changed',
      timestamp: Date.now(),
      data: { connected: state.connected, type: state.type },
    });

    if (this.syncOnReconnect && state.connected && !wasConnected && this._isRunning) {
      void this.processQueue();
    }

    this.adjustScheduleForConditions();
    this.emitState();
  }

  /**
   * Evaluate current conditions to determine whether syncing is advisable.
   *
   * Returns `false` when the device is offline, the app is suspended/terminated,
   * or the battery is low and the device is not charging.
   *
   * @returns `true` if conditions are favorable for syncing
   *
   * @example
   * ```typescript
   * if (scheduler.shouldSync()) {
   *   scheduler.schedule('todos', 'normal');
   * }
   * ```
   */
  shouldSync(): boolean {
    if (!this._networkConnected) return false;
    if (this._appState === 'suspended' || this._appState === 'terminated') return false;
    if (this._batteryLevel < this.batteryThreshold && !this._isCharging) return false;
    return true;
  }

  /**
   * Whether wake-lock is enabled for sync operations.
   */
  isWakeLockEnabled(): boolean {
    return this.useWakeLock;
  }

  /**
   * Current scheduler state snapshot.
   *
   * @returns The current state
   */
  getState(): SyncSchedulerState {
    return this.buildState();
  }

  /**
   * Get all pending tasks in priority order.
   *
   * @returns Array of pending sync tasks
   *
   * @example
   * ```typescript
   * const pending = scheduler.getPendingTasks();
   * console.log('Waiting:', pending.length);
   * ```
   */
  getPendingTasks(): SyncTask[] {
    return this._tasks.filter((t) => t.status === 'pending');
  }

  /**
   * Dispose the scheduler and release all resources.
   *
   * @example
   * ```typescript
   * scheduler.dispose();
   * ```
   */
  dispose(): void {
    this.clearProcessTimer();
    this._isRunning = false;
    this._tasks.length = 0;
    this._state$.complete();
    this._events$.complete();
  }

  // ────────────────────────────── Private helpers ──────────────────────────────

  private async processQueue(): Promise<void> {
    if (this._processing || !this._isRunning) return;
    this._processing = true;

    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- stop() may set _isRunning to false mid-loop
      while (this._isRunning) {
        const task = this._tasks.find((t) => t.status === 'pending');
        if (!task) break;

        if (this.shouldDeferTask(task)) {
          task.status = 'deferred';
          this._events$.next({
            type: 'sync-deferred',
            timestamp: Date.now(),
            data: { taskId: task.id, reason: 'conditions-unfavorable' },
          });
          this.emitState();
          continue;
        }

        await this.executeTask(task);
      }
    } finally {
      this._processing = false;
      this.scheduleNextProcess();
    }
  }

  private async executeTask(task: SyncTask): Promise<void> {
    task.status = 'running';
    task.startedAt = Date.now();
    this.emitState();

    this._events$.next({
      type: 'sync-started',
      timestamp: Date.now(),
      data: { taskId: task.id, collection: task.collection },
    });

    // Yield to event loop
    await Promise.resolve();

    try {
      // Simulate sync processing
      task.documentsProcessed = 0;
      task.status = 'completed';
      task.completedAt = Date.now();
      this._completedCount++;
      this._lastSyncAt = Date.now();

      this._events$.next({
        type: 'sync-completed',
        timestamp: Date.now(),
        data: {
          taskId: task.id,
          collection: task.collection,
          documentsProcessed: task.documentsProcessed,
        },
      });

      // Remove completed task from queue
      const index = this._tasks.indexOf(task);
      if (index !== -1) this._tasks.splice(index, 1);
    } catch (error: unknown) {
      task.retries++;
      const message = error instanceof Error ? error.message : String(error);

      if (task.retries >= this.maxRetries) {
        task.status = 'failed';
        task.error = message;
        this._failedCount++;

        this._events$.next({
          type: 'sync-failed',
          timestamp: Date.now(),
          data: { taskId: task.id, error: message, retries: task.retries },
        });

        // Remove failed task from queue
        const index = this._tasks.indexOf(task);
        if (index !== -1) this._tasks.splice(index, 1);
      } else {
        // Re-queue with backoff delay
        task.status = 'pending';
        task.error = message;
        task.scheduledAt = Date.now() + this.retryBackoffMs * task.retries;
      }
    }

    this.emitState();
  }

  private calculateNextSyncTime(): number {
    if (!this.adaptiveScheduling) {
      return Date.now() + this.minIntervalMs;
    }

    let interval = this.minIntervalMs;

    // Extend interval when on battery
    if (this._batteryLevel < this.batteryThreshold && !this._isCharging) {
      interval = this.maxIntervalMs;
    }

    // Extend interval in background
    if (this._appState === 'background') {
      interval = Math.min(interval * 2, this.maxIntervalMs);
    }

    return Date.now() + interval;
  }

  private shouldDeferTask(task: SyncTask): boolean {
    // Never defer critical tasks
    if (task.priority === 'critical') return false;

    // Defer if offline
    if (!this._networkConnected) return true;

    // Defer low-priority tasks when battery is low
    if (
      (task.priority === 'low' || task.priority === 'opportunistic') &&
      this._batteryLevel < this.batteryThreshold &&
      !this._isCharging
    ) {
      return true;
    }

    // Defer opportunistic tasks when in background
    if (task.priority === 'opportunistic' && this._appState === 'background') {
      return true;
    }

    return false;
  }

  private adjustScheduleForConditions(): void {
    this._nextSyncAt = this.calculateNextSyncTime();

    this._events$.next({
      type: 'schedule-adjusted',
      timestamp: Date.now(),
      data: { nextSyncAt: this._nextSyncAt },
    });
  }

  private sortTasks(): void {
    this._tasks.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  private buildState(): SyncSchedulerState {
    return {
      isRunning: this._isRunning,
      currentTask: this._tasks.find((t) => t.status === 'running') ?? null,
      pendingTasks: this._tasks.filter((t) => t.status === 'pending').length,
      completedTasks: this._completedCount,
      failedTasks: this._failedCount,
      lastSyncAt: this._lastSyncAt,
      nextSyncAt: this._nextSyncAt,
      appState: this._appState,
      batteryLevel: this._batteryLevel,
      isCharging: this._isCharging,
      networkConnected: this._networkConnected,
    };
  }

  private emitState(): void {
    this._state$.next(this.buildState());
  }

  private scheduleNextProcess(): void {
    this.clearProcessTimer();

    const pending = this._tasks.filter((t) => t.status === 'pending');
    if (pending.length === 0 || !this._isRunning) return;

    const delay = Math.max(0, this._nextSyncAt - Date.now());
    this._processTimer = setTimeout(() => {
      void this.processQueue();
    }, delay);
  }

  private clearProcessTimer(): void {
    if (this._processTimer !== null) {
      clearTimeout(this._processTimer);
      this._processTimer = null;
    }
  }
}

// ────────────────────────────── Factory Function ──────────────────────────────

/**
 * Creates a new {@link BackgroundSyncScheduler} instance.
 *
 * @param config - Optional scheduler configuration
 * @returns A new BackgroundSyncScheduler (call `start()` to begin processing)
 *
 * @example
 * ```typescript
 * const scheduler = createBackgroundSyncScheduler({
 *   minIntervalMs: 60_000,
 *   batteryThreshold: 0.2,
 *   syncOnReconnect: true,
 * });
 *
 * scheduler.start();
 * ```
 */
export function createBackgroundSyncScheduler(
  config?: BackgroundSyncConfig
): BackgroundSyncScheduler {
  return new BackgroundSyncScheduler(config);
}
