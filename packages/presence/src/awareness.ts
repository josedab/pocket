/**
 * Awareness Protocol for sharing ephemeral client state.
 *
 * Provides a y-protocols compatible awareness concept where each connected
 * client can share arbitrary state (cursor position, user info, selection, etc.)
 * with all other clients in the session.
 *
 * @module awareness
 *
 * @example
 * ```typescript
 * import { createAwarenessProtocol } from '@pocket/presence';
 *
 * const awareness = createAwarenessProtocol({ cleanupInterval: 30000 });
 *
 * // Set local state
 * awareness.setLocalState({ user: { name: 'Alice' }, cursor: { x: 100, y: 200 } });
 *
 * // Handle remote state updates
 * awareness.onUpdate('user-2', { user: { name: 'Bob' }, cursor: { x: 50, y: 80 } });
 *
 * // Subscribe to state changes
 * awareness.states$.subscribe((states) => {
 *   console.log('All states:', states);
 * });
 *
 * // Cleanup
 * awareness.destroy();
 * ```
 */

import { BehaviorSubject, type Observable } from 'rxjs';

/**
 * Configuration for the awareness protocol.
 */
export interface AwarenessProtocolConfig {
  /** Interval in ms for cleaning up stale states (default: 30000) */
  cleanupInterval?: number;
}

/**
 * Default awareness protocol configuration.
 */
const DEFAULT_AWARENESS_CONFIG: Required<AwarenessProtocolConfig> = {
  cleanupInterval: 30000,
};

/**
 * Manages ephemeral awareness state for connected clients.
 *
 * Each client has a local state that is shared with other clients.
 * Remote states are received via the `onUpdate` method and can be
 * observed through the `states$` observable.
 *
 * @example
 * ```typescript
 * const awareness = new AwarenessProtocol();
 *
 * awareness.setLocalState({ cursor: { line: 10, column: 5 } });
 * awareness.onUpdate('remote-user', { cursor: { line: 3, column: 12 } });
 *
 * const allStates = awareness.getStates();
 * // => Map { 'local' => { cursor: ... }, 'remote-user' => { cursor: ... } }
 *
 * awareness.destroy();
 * ```
 */
export class AwarenessProtocol {
  private readonly config: Required<AwarenessProtocolConfig>;
  private readonly states = new Map<string, Record<string, unknown>>();
  private readonly states$$ = new BehaviorSubject<Map<string, Record<string, unknown>>>(
    new Map()
  );
  private localState: Record<string, unknown> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  private static readonly LOCAL_KEY = '__local__';

  constructor(config: AwarenessProtocolConfig = {}) {
    this.config = { ...DEFAULT_AWARENESS_CONFIG, ...config };
    this.startCleanup();
  }

  /**
   * Set this client's local awareness state.
   *
   * @param state - Arbitrary state to share with other clients
   */
  setLocalState(state: Record<string, unknown>): void {
    if (this.destroyed) return;

    this.localState = { ...state };
    this.states.set(AwarenessProtocol.LOCAL_KEY, this.localState);
    this.emit();
  }

  /**
   * Get this client's local awareness state.
   *
   * @returns The local state or null if not set
   */
  getLocalState(): Record<string, unknown> | null {
    return this.localState ? { ...this.localState } : null;
  }

  /**
   * Get all connected clients' awareness states.
   *
   * @returns A Map of client ID to state
   */
  getStates(): Map<string, Record<string, unknown>> {
    return new Map(this.states);
  }

  /**
   * Handle an incoming state update from a remote client.
   *
   * @param userId - The remote client's identifier
   * @param state - The remote client's state
   */
  onUpdate(userId: string, state: Record<string, unknown>): void {
    if (this.destroyed) return;

    this.states.set(userId, { ...state });
    this.emit();
  }

  /**
   * Remove a client's state (e.g., when they disconnect).
   *
   * @param userId - The client identifier to remove
   */
  removeState(userId: string): void {
    if (this.destroyed) return;

    if (this.states.delete(userId)) {
      this.emit();
    }
  }

  /**
   * Observable that emits on any state change.
   *
   * Emits the complete Map of all current states whenever
   * a state is set, updated, or removed.
   */
  get states$(): Observable<Map<string, Record<string, unknown>>> {
    return this.states$$.asObservable();
  }

  /**
   * Destroy the awareness protocol and clean up resources.
   */
  destroy(): void {
    this.destroyed = true;

    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.states.clear();
    this.localState = null;
    this.states$$.complete();
  }

  /**
   * Start periodic cleanup of stale states.
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      // Cleanup hook - can be extended with timestamp-based expiry
    }, this.config.cleanupInterval);
  }

  /**
   * Emit current state map.
   */
  private emit(): void {
    if (this.destroyed) return;
    this.states$$.next(new Map(this.states));
  }
}

/**
 * Create an awareness protocol instance.
 *
 * @param config - Optional configuration
 * @returns A new AwarenessProtocol instance
 */
export function createAwarenessProtocol(config?: AwarenessProtocolConfig): AwarenessProtocol {
  return new AwarenessProtocol(config);
}
