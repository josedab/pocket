/**
 * App lifecycle manager for cross-platform mobile applications.
 *
 * Manages database and sync behavior across mobile app lifecycle states.
 * Handles state persistence on background, data warming on foreground,
 * and graceful cleanup on termination.
 *
 * @module app-lifecycle
 *
 * @example
 * ```typescript
 * import { createAppLifecycleManager } from '@pocket/mobile';
 *
 * const lifecycle = createAppLifecycleManager({
 *   persistOnBackground: true,
 *   warmOnForeground: true,
 *   preloadCollections: ['todos', 'settings'],
 *   backgroundTaskTimeoutMs: 25_000,
 * });
 *
 * lifecycle.registerHook('backgrounded', async () => {
 *   await saveStateToDisk();
 * }, { priority: 10, description: 'Persist state' });
 *
 * lifecycle.registerHook('resuming', async () => {
 *   await warmCaches();
 * }, { priority: 5, description: 'Warm caches' });
 *
 * await lifecycle.transitionTo('active');
 *
 * // Clean up
 * lifecycle.dispose();
 * ```
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';

// ────────────────────────────── Types ──────────────────────────────

/**
 * Phases of the application lifecycle.
 */
export type LifecyclePhase =
  | 'boot'
  | 'ready'
  | 'active'
  | 'pausing'
  | 'backgrounded'
  | 'resuming'
  | 'terminating';

/**
 * A registered lifecycle hook.
 *
 * @example
 * ```typescript
 * const hookId = lifecycle.registerHook('backgrounded', async () => {
 *   await persistState();
 * }, { priority: 10 });
 * ```
 */
export interface LifecycleHook {
  /** Unique hook identifier */
  id: string;

  /** Phase this hook executes in */
  phase: LifecyclePhase;

  /** Handler function invoked during the phase transition */
  handler: () => void | Promise<void>;

  /** Execution priority (lower runs first) */
  priority: number;

  /** Human-readable description of the hook */
  description?: string;
}

/**
 * Configuration for {@link AppLifecycleManager}.
 */
export interface LifecycleConfig {
  /** Persist state on background (default: true) */
  persistOnBackground?: boolean;

  /** Warm caches on foreground (default: true) */
  warmOnForeground?: boolean;

  /** Collections to preload on boot */
  preloadCollections?: string[];

  /** Maximum time for background tasks in milliseconds (default: 25000) */
  backgroundTaskTimeoutMs?: number;

  /** Enable state restoration (default: true) */
  enableStateRestoration?: boolean;
}

/**
 * Snapshot of the lifecycle manager's current state.
 */
export interface LifecycleState {
  /** Current lifecycle phase */
  currentPhase: LifecyclePhase;

  /** Timestamp of last transition to active */
  lastActiveAt: number;

  /** Timestamp of last transition to backgrounded */
  lastBackgroundedAt: number;

  /** Timestamp when the manager booted */
  bootedAt: number;

  /** Total time spent in the active phase (ms) */
  totalActiveTime: number;

  /** Number of times the app has been backgrounded */
  backgroundTransitions: number;

  /** Number of registered hooks */
  registeredHooks: number;
}

/**
 * Events emitted by the lifecycle manager.
 */
export interface LifecycleEvent {
  /** Event type */
  type:
    | 'phase-changed'
    | 'hook-executed'
    | 'hook-failed'
    | 'state-persisted'
    | 'state-restored'
    | 'timeout-warning';

  /** Phase associated with this event */
  phase: LifecyclePhase;

  /** Timestamp of the event */
  timestamp: number;

  /** Optional event-specific payload */
  data?: unknown;
}

// ────────────────────────────── Constants ──────────────────────────────

const DEFAULT_BACKGROUND_TASK_TIMEOUT_MS = 25_000;

// ────────────────────────────── Helpers ──────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ────────────────────────────── AppLifecycleManager ──────────────────────────────

/**
 * Manages application lifecycle transitions and associated hooks.
 *
 * Tracks lifecycle phases, executes registered hooks in priority order
 * during transitions, and maintains timing statistics for active and
 * backgrounded durations.
 *
 * @example
 * ```typescript
 * const manager = new AppLifecycleManager({
 *   persistOnBackground: true,
 *   warmOnForeground: true,
 * });
 *
 * manager.registerHook('backgrounded', async () => {
 *   await saveState();
 * }, { priority: 0, description: 'Save state' });
 *
 * manager.events$.subscribe((event) => {
 *   console.log(event.type, event.phase);
 * });
 *
 * await manager.transitionTo('active');
 * ```
 */
export class AppLifecycleManager {
  private readonly persistOnBackground: boolean;
  private readonly warmOnForeground: boolean;
  private readonly preloadCollections: string[];
  private readonly backgroundTaskTimeoutMs: number;
  private readonly enableStateRestoration: boolean;

  private readonly _state$: BehaviorSubject<LifecycleState>;
  private readonly _events$ = new Subject<LifecycleEvent>();
  private readonly _hooks: LifecycleHook[] = [];

  private _currentPhase: LifecyclePhase = 'boot';
  private _lastActiveAt = 0;
  private _lastBackgroundedAt = 0;
  private _bootedAt: number;
  private _totalActiveTime = 0;
  private _backgroundTransitions = 0;
  private _activeStartedAt = 0;

  constructor(config?: LifecycleConfig) {
    this.persistOnBackground = config?.persistOnBackground ?? true;
    this.warmOnForeground = config?.warmOnForeground ?? true;
    this.preloadCollections = config?.preloadCollections ?? [];
    this.backgroundTaskTimeoutMs =
      config?.backgroundTaskTimeoutMs ?? DEFAULT_BACKGROUND_TASK_TIMEOUT_MS;
    this.enableStateRestoration = config?.enableStateRestoration ?? true;

    this._bootedAt = Date.now();

    this._state$ = new BehaviorSubject<LifecycleState>(this.buildState());
  }

  // ────────────────────────────── Public API ──────────────────────────────

  /**
   * Observable of lifecycle state changes.
   *
   * @example
   * ```typescript
   * lifecycle.state$.subscribe((state) => {
   *   console.log('Phase:', state.currentPhase);
   * });
   * ```
   */
  get state$(): Observable<LifecycleState> {
    return this._state$.asObservable();
  }

  /**
   * Observable of lifecycle events.
   *
   * @example
   * ```typescript
   * lifecycle.events$.subscribe((event) => {
   *   if (event.type === 'hook-failed') {
   *     console.error('Hook failed in phase:', event.phase, event.data);
   *   }
   * });
   * ```
   */
  get events$(): Observable<LifecycleEvent> {
    return this._events$.asObservable();
  }

  /**
   * Register a hook to be executed during a lifecycle phase transition.
   *
   * Hooks are executed in ascending priority order (lower values run first).
   *
   * @param phase - The lifecycle phase to attach the hook to
   * @param handler - The handler function to invoke
   * @param options - Optional priority and description
   * @returns The unique hook ID
   *
   * @example
   * ```typescript
   * const hookId = lifecycle.registerHook('backgrounded', async () => {
   *   await database.flush();
   * }, { priority: 0, description: 'Flush database' });
   * ```
   */
  registerHook(
    phase: LifecyclePhase,
    handler: () => void | Promise<void>,
    options?: { priority?: number; description?: string }
  ): string {
    const hook: LifecycleHook = {
      id: generateId(),
      phase,
      handler,
      priority: options?.priority ?? 100,
      description: options?.description,
    };

    this._hooks.push(hook);
    this.emitState();
    return hook.id;
  }

  /**
   * Remove a previously registered hook.
   *
   * @param hookId - The hook ID to remove
   * @returns `true` if the hook was found and removed
   *
   * @example
   * ```typescript
   * const hookId = lifecycle.registerHook('active', () => {});
   * lifecycle.removeHook(hookId); // true
   * ```
   */
  removeHook(hookId: string): boolean {
    const index = this._hooks.findIndex((h) => h.id === hookId);
    if (index === -1) return false;

    this._hooks.splice(index, 1);
    this.emitState();
    return true;
  }

  /**
   * Transition to a new lifecycle phase.
   *
   * Executes all hooks registered for the target phase in priority order.
   * Emits a `'phase-changed'` event after all hooks have been processed.
   *
   * @param phase - The target lifecycle phase
   *
   * @example
   * ```typescript
   * await lifecycle.transitionTo('active');
   * console.log(lifecycle.getCurrentPhase()); // 'active'
   * ```
   */
  async transitionTo(phase: LifecyclePhase): Promise<void> {
    const previous = this._currentPhase;
    this._currentPhase = phase;

    // Track active time
    if (previous === 'active' && phase !== 'active') {
      this.updateActiveTime();
    }

    if (phase === 'active') {
      this._lastActiveAt = Date.now();
      this._activeStartedAt = Date.now();
    }

    if (phase === 'backgrounded') {
      this._lastBackgroundedAt = Date.now();
      this._backgroundTransitions++;
    }

    // Execute hooks for this phase with timeout for background tasks
    if (phase === 'backgrounded' && this.persistOnBackground) {
      const timeout = new Promise<void>((_, reject) => {
        setTimeout(() => {
          this._events$.next({
            type: 'timeout-warning',
            phase,
            timestamp: Date.now(),
            data: { timeoutMs: this.backgroundTaskTimeoutMs },
          });
          reject(new Error('Background task timeout'));
        }, this.backgroundTaskTimeoutMs);
      });

      try {
        await Promise.race([this.executeHooks(phase), timeout]);
      } catch {
        // Timeout — hooks may still be running but we proceed
      }
    } else {
      await this.executeHooks(phase);
    }

    // Emit state-persisted / state-restored events as appropriate
    if (phase === 'backgrounded' && this.persistOnBackground) {
      this._events$.next({
        type: 'state-persisted',
        phase,
        timestamp: Date.now(),
      });
    }

    if (phase === 'active' && previous === 'resuming' && this.enableStateRestoration) {
      this._events$.next({
        type: 'state-restored',
        phase,
        timestamp: Date.now(),
      });
    }

    this._events$.next({
      type: 'phase-changed',
      phase,
      timestamp: Date.now(),
      data: { previous, current: phase },
    });

    this.emitState();
  }

  /**
   * Get the current lifecycle phase.
   *
   * @returns The current phase
   */
  getCurrentPhase(): LifecyclePhase {
    return this._currentPhase;
  }

  /**
   * Whether foreground cache warming is enabled.
   */
  isWarmOnForeground(): boolean {
    return this.warmOnForeground;
  }

  /**
   * Collections configured for preloading on boot.
   *
   * @returns Array of collection names
   */
  getPreloadCollections(): string[] {
    return [...this.preloadCollections];
  }

  /**
   * Get the time elapsed since the app was last active.
   *
   * @returns Milliseconds since last active, or `0` if currently active
   *
   * @example
   * ```typescript
   * const elapsed = lifecycle.getTimeSinceLastActive();
   * if (elapsed > 300_000) {
   *   console.log('App was inactive for over 5 minutes');
   * }
   * ```
   */
  getTimeSinceLastActive(): number {
    if (this._currentPhase === 'active') return 0;
    if (this._lastActiveAt === 0) return 0;
    return Date.now() - this._lastActiveAt;
  }

  /**
   * Current lifecycle state snapshot.
   *
   * @returns The current state
   */
  getState(): LifecycleState {
    return this.buildState();
  }

  /**
   * Dispose the manager and release all resources.
   *
   * @example
   * ```typescript
   * lifecycle.dispose();
   * ```
   */
  dispose(): void {
    this._hooks.length = 0;
    this._state$.complete();
    this._events$.complete();
  }

  // ────────────────────────────── Private helpers ──────────────────────────────

  private async executeHooks(phase: LifecyclePhase): Promise<void> {
    const hooks = this._hooks
      .filter((h) => h.phase === phase)
      .sort((a, b) => a.priority - b.priority);

    for (const hook of hooks) {
      try {
        await hook.handler();

        this._events$.next({
          type: 'hook-executed',
          phase,
          timestamp: Date.now(),
          data: { hookId: hook.id, description: hook.description },
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        this._events$.next({
          type: 'hook-failed',
          phase,
          timestamp: Date.now(),
          data: { hookId: hook.id, description: hook.description, error: message },
        });
      }
    }
  }

  private updateActiveTime(): void {
    if (this._activeStartedAt > 0) {
      this._totalActiveTime += Date.now() - this._activeStartedAt;
      this._activeStartedAt = 0;
    }
  }

  private buildState(): LifecycleState {
    return {
      currentPhase: this._currentPhase,
      lastActiveAt: this._lastActiveAt,
      lastBackgroundedAt: this._lastBackgroundedAt,
      bootedAt: this._bootedAt,
      totalActiveTime: this._totalActiveTime,
      backgroundTransitions: this._backgroundTransitions,
      registeredHooks: this._hooks.length,
    };
  }

  private emitState(): void {
    this._state$.next(this.buildState());
  }
}

// ────────────────────────────── Factory Function ──────────────────────────────

/**
 * Creates a new {@link AppLifecycleManager} instance.
 *
 * @param config - Optional lifecycle manager configuration
 * @returns A new AppLifecycleManager
 *
 * @example
 * ```typescript
 * const lifecycle = createAppLifecycleManager({
 *   persistOnBackground: true,
 *   warmOnForeground: true,
 *   preloadCollections: ['todos'],
 * });
 *
 * await lifecycle.transitionTo('active');
 * ```
 */
export function createAppLifecycleManager(config?: LifecycleConfig): AppLifecycleManager {
  return new AppLifecycleManager(config);
}
