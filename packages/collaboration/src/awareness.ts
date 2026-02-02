/**
 * Awareness protocol for user presence and collaborative state.
 *
 * Tracks cursor positions, selections, typing indicators, and custom
 * state across all participants in a session. Automatically removes
 * inactive peers after a configurable timeout.
 */

import { BehaviorSubject, type Observable } from 'rxjs';

const DEFAULT_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#FF8A65', '#81C784', '#64B5F6', '#BA68C8',
];

export interface AwarenessState {
  userId: string;
  name: string;
  color: string;
  cursor?: { line: number; column: number };
  selection?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  isTyping?: boolean;
  lastActive: number;
  customState?: Record<string, unknown>;
}

export interface AwarenessConfig {
  /** Unique identifier for the local user */
  localUserId: string;
  /** Display name for the local user */
  localUserName: string;
  /** Color assigned to the local user (auto-assigned if omitted) */
  localUserColor?: string;
  /** Time in ms before a peer is considered inactive (default: 30000) */
  inactivityTimeoutMs?: number;
  /** Minimum interval in ms between state broadcasts (default: 100) */
  broadcastIntervalMs?: number;
}

type StateChangeCallback = (states: Map<string, AwarenessState>) => void;

/**
 * AwarenessProtocol — tracks presence and ephemeral state for all peers.
 *
 * Provides reactive streams, convenience cursor/selection/typing setters,
 * and automatic cleanup of stale peers.
 */
export class AwarenessProtocol {
  private readonly config: Required<AwarenessConfig>;
  private readonly statesSubject: BehaviorSubject<Map<string, AwarenessState>>;
  private readonly callbacks = new Set<StateChangeCallback>();
  private inactivityTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(config: AwarenessConfig) {
    const color = config.localUserColor ?? assignColor(config.localUserId);

    this.config = {
      localUserId: config.localUserId,
      localUserName: config.localUserName,
      localUserColor: color,
      inactivityTimeoutMs: config.inactivityTimeoutMs ?? 30_000,
      broadcastIntervalMs: config.broadcastIntervalMs ?? 100,
    };

    const initial = new Map<string, AwarenessState>();
    initial.set(this.config.localUserId, {
      userId: this.config.localUserId,
      name: this.config.localUserName,
      color,
      lastActive: Date.now(),
    });

    this.statesSubject = new BehaviorSubject(initial);
    this.startInactivityCheck();
  }

  // ── Observables ──────────────────────────────────────────

  /** Reactive stream of all awareness states. */
  get states$(): Observable<Map<string, AwarenessState>> {
    return this.statesSubject.asObservable();
  }

  // ── Getters ──────────────────────────────────────────────

  /** Return the local user's awareness state. */
  getLocalState(): AwarenessState {
    return this.statesSubject.getValue().get(this.config.localUserId)!;
  }

  /** Return all peer states (including local). */
  getStates(): Map<string, AwarenessState> {
    return new Map(this.statesSubject.getValue());
  }

  /** Return states of users active within the inactivity window. */
  getActiveUsers(): AwarenessState[] {
    const now = Date.now();
    const result: AwarenessState[] = [];
    for (const state of this.statesSubject.getValue().values()) {
      if (now - state.lastActive <= this.config.inactivityTimeoutMs) {
        result.push(state);
      }
    }
    return result;
  }

  // ── Setters ──────────────────────────────────────────────

  /** Merge partial updates into the local user's state. */
  setLocalState(state: Partial<AwarenessState>): void {
    if (this.destroyed) return;

    const states = new Map(this.statesSubject.getValue());
    const current = states.get(this.config.localUserId)!;
    states.set(this.config.localUserId, {
      ...current,
      ...state,
      userId: this.config.localUserId,
      lastActive: Date.now(),
    });

    this.publishStates(states);
  }

  /** Convenience: update the local cursor position. */
  setCursor(line: number, column: number): void {
    this.setLocalState({ cursor: { line, column } });
  }

  /** Convenience: update the local selection range. */
  setSelection(
    start: { line: number; column: number },
    end: { line: number; column: number },
  ): void {
    this.setLocalState({ selection: { start, end } });
  }

  /** Convenience: update the local typing indicator. */
  setTyping(isTyping: boolean): void {
    this.setLocalState({ isTyping });
  }

  // ── Remote state ingestion ──────────────────────────────

  /**
   * Apply a remote peer's state update.
   * Typically called when the transport delivers an awareness message.
   */
  applyRemoteState(state: AwarenessState): void {
    if (this.destroyed) return;
    if (state.userId === this.config.localUserId) return;

    const states = new Map(this.statesSubject.getValue());
    states.set(state.userId, { ...state, lastActive: Date.now() });
    this.publishStates(states);
  }

  /**
   * Remove a remote peer (e.g. on explicit leave).
   */
  removeRemoteUser(userId: string): void {
    if (this.destroyed) return;
    if (userId === this.config.localUserId) return;

    const states = new Map(this.statesSubject.getValue());
    if (states.delete(userId)) {
      this.publishStates(states);
    }
  }

  // ── Callbacks ────────────────────────────────────────────

  /** Register a state-change listener. Returns an unsubscribe function. */
  onStateChange(callback: StateChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  // ── Lifecycle ────────────────────────────────────────────

  /** Tear down timers and complete streams. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }

    this.callbacks.clear();
    this.statesSubject.complete();
  }

  // ── Private ──────────────────────────────────────────────

  private publishStates(states: Map<string, AwarenessState>): void {
    this.statesSubject.next(states);
    for (const cb of this.callbacks) {
      cb(states);
    }
  }

  private startInactivityCheck(): void {
    this.inactivityTimer = setInterval(() => {
      const now = Date.now();
      const states = new Map(this.statesSubject.getValue());
      let changed = false;

      for (const [id, state] of states) {
        // Never evict the local user
        if (id === this.config.localUserId) continue;
        if (now - state.lastActive > this.config.inactivityTimeoutMs) {
          states.delete(id);
          changed = true;
        }
      }

      if (changed) {
        this.publishStates(states);
      }
    }, this.config.inactivityTimeoutMs / 2);
  }
}

/**
 * Deterministic color assignment from the default palette.
 */
function assignColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length]!;
}

/**
 * Create a new AwarenessProtocol instance.
 */
export function createAwarenessProtocol(config: AwarenessConfig): AwarenessProtocol {
  return new AwarenessProtocol(config);
}
