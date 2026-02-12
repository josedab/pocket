/**
 * Cursor and selection overlay tracking for collaborative editing.
 *
 * Provides component-ready data structures for rendering remote user
 * cursors and selections. Handles deterministic color assignment,
 * cursor smoothing/interpolation, and throttled updates.
 *
 * @example
 * ```typescript
 * import { createCursorOverlay } from '@pocket/collaboration';
 *
 * const overlay = createCursorOverlay({
 *   localUserId: 'user-1',
 *   throttleMs: 50,
 *   smoothingEnabled: true,
 * });
 *
 * overlay.updateRemoteCursor({
 *   userId: 'user-2',
 *   name: 'Alice',
 *   position: { line: 10, column: 5 },
 * });
 *
 * overlay.cursors$.subscribe(cursors => {
 *   // Render cursor decorations in the editor
 *   cursors.forEach(c => console.log(`${c.name} at ${c.position.line}:${c.position.column}`));
 * });
 *
 * overlay.destroy();
 * ```
 *
 * @module @pocket/collaboration/cursor-overlay
 */

import { BehaviorSubject, Observable, Subject, throttleTime } from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export interface CursorPosition {
  line: number;
  column: number;
}

export interface SelectionRange {
  start: CursorPosition;
  end: CursorPosition;
}

export interface RemoteCursor {
  userId: string;
  name: string;
  color: string;
  position: CursorPosition;
  selection?: SelectionRange;
  lastUpdated: number;
}

export interface RemoteCursorInput {
  userId: string;
  name: string;
  color?: string;
  position: CursorPosition;
  selection?: SelectionRange;
}

export interface CursorOverlayConfig {
  /** Local user ID (cursors from this user are ignored). */
  localUserId: string;
  /** Minimum interval in ms between emitted cursor updates (default: 50). */
  throttleMs?: number;
  /** Enable cursor position smoothing/interpolation (default: false). */
  smoothingEnabled?: boolean;
  /** Smoothing factor between 0 and 1 — higher means snappier (default: 0.6). */
  smoothingFactor?: number;
  /** Time in ms before a stale cursor is removed (default: 30000). */
  staleTimeoutMs?: number;
}

export type CursorEventType = 'cursor-updated' | 'cursor-removed' | 'selection-updated';

export interface CursorEvent {
  type: CursorEventType;
  userId: string;
  timestamp: number;
}

// ── Deterministic color assignment ─────────────────────────

const CURSOR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#FF8A65', '#81C784', '#64B5F6', '#BA68C8',
];

function assignColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length]!;
}

// ── Position interpolation ─────────────────────────────────

function interpolatePosition(
  current: CursorPosition,
  target: CursorPosition,
  factor: number,
): CursorPosition {
  return {
    line: Math.round(current.line + (target.line - current.line) * factor),
    column: Math.round(current.column + (target.column - current.column) * factor),
  };
}

// ── CursorOverlay ──────────────────────────────────────────

/**
 * CursorOverlay — tracks remote user cursors and selections.
 *
 * Emits component-ready data via `cursors$` with throttling and
 * optional position interpolation for smooth animations.
 */
export class CursorOverlay {
  private readonly config: Required<CursorOverlayConfig>;
  private readonly cursorsSubject: BehaviorSubject<Map<string, RemoteCursor>>;
  private readonly eventsSubject: Subject<CursorEvent>;
  private readonly updateSubject: Subject<RemoteCursorInput>;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(config: CursorOverlayConfig) {
    this.config = {
      localUserId: config.localUserId,
      throttleMs: config.throttleMs ?? 50,
      smoothingEnabled: config.smoothingEnabled ?? false,
      smoothingFactor: config.smoothingFactor ?? 0.6,
      staleTimeoutMs: config.staleTimeoutMs ?? 30_000,
    };

    this.cursorsSubject = new BehaviorSubject<Map<string, RemoteCursor>>(new Map());
    this.eventsSubject = new Subject<CursorEvent>();
    this.updateSubject = new Subject<RemoteCursorInput>();

    // Throttle incoming updates to reduce bandwidth and re-renders
    this.updateSubject
      .pipe(throttleTime(this.config.throttleMs))
      .subscribe((input) => {
        this.applyUpdate(input);
      });

    this.startStaleCheck();
  }

  // ── Observables ────────────────────────────────────────

  /** Reactive stream of all remote cursors. */
  get cursors$(): Observable<RemoteCursor[]> {
    return new Observable<RemoteCursor[]>((subscriber) => {
      const sub = this.cursorsSubject.subscribe((map) => {
        subscriber.next(Array.from(map.values()));
      });
      return () => sub.unsubscribe();
    });
  }

  /** Reactive stream of cursor events. */
  get events$(): Observable<CursorEvent> {
    return this.eventsSubject.asObservable();
  }

  // ── Cursor updates ─────────────────────────────────────

  /**
   * Update or create a remote cursor position.
   * Updates are throttled according to `throttleMs`.
   */
  updateRemoteCursor(input: RemoteCursorInput): void {
    if (this.destroyed) return;
    if (input.userId === this.config.localUserId) return;

    this.updateSubject.next(input);
  }

  /**
   * Update the selection range for a remote user.
   */
  updateRemoteSelection(userId: string, selection: SelectionRange | undefined): void {
    if (this.destroyed) return;
    if (userId === this.config.localUserId) return;

    const cursors = new Map(this.cursorsSubject.getValue());
    const existing = cursors.get(userId);
    if (!existing) return;

    cursors.set(userId, {
      ...existing,
      selection,
      lastUpdated: Date.now(),
    });

    this.cursorsSubject.next(cursors);
    this.emitEvent('selection-updated', userId);
  }

  /**
   * Remove a remote cursor (e.g. when a user disconnects).
   */
  removeCursor(userId: string): void {
    if (this.destroyed) return;

    const cursors = new Map(this.cursorsSubject.getValue());
    if (cursors.delete(userId)) {
      this.cursorsSubject.next(cursors);
      this.emitEvent('cursor-removed', userId);
    }
  }

  // ── Queries ────────────────────────────────────────────

  /** Get all active remote cursors. */
  getCursors(): RemoteCursor[] {
    return Array.from(this.cursorsSubject.getValue().values());
  }

  /** Get a single cursor by user ID. */
  getCursor(userId: string): RemoteCursor | undefined {
    return this.cursorsSubject.getValue().get(userId);
  }

  /** Get the deterministic color assigned to a user. */
  getColorForUser(userId: string): string {
    return assignColor(userId);
  }

  // ── Lifecycle ──────────────────────────────────────────

  /** Tear down timers and complete streams. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }

    this.updateSubject.complete();
    this.eventsSubject.complete();
    this.cursorsSubject.complete();
  }

  // ── Private ────────────────────────────────────────────

  private applyUpdate(input: RemoteCursorInput): void {
    const cursors = new Map(this.cursorsSubject.getValue());
    const existing = cursors.get(input.userId);
    const color = input.color ?? existing?.color ?? assignColor(input.userId);

    let position = input.position;
    if (this.config.smoothingEnabled && existing) {
      position = interpolatePosition(existing.position, input.position, this.config.smoothingFactor);
    }

    cursors.set(input.userId, {
      userId: input.userId,
      name: input.name,
      color,
      position,
      selection: input.selection ?? existing?.selection,
      lastUpdated: Date.now(),
    });

    this.cursorsSubject.next(cursors);
    this.emitEvent('cursor-updated', input.userId);
  }

  private startStaleCheck(): void {
    this.staleTimer = setInterval(() => {
      const now = Date.now();
      const cursors = new Map(this.cursorsSubject.getValue());
      let changed = false;

      for (const [userId, cursor] of cursors) {
        if (now - cursor.lastUpdated > this.config.staleTimeoutMs) {
          cursors.delete(userId);
          changed = true;
          this.emitEvent('cursor-removed', userId);
        }
      }

      if (changed) {
        this.cursorsSubject.next(cursors);
      }
    }, this.config.staleTimeoutMs / 2);
  }

  private emitEvent(type: CursorEventType, userId: string): void {
    this.eventsSubject.next({
      type,
      userId,
      timestamp: Date.now(),
    });
  }
}

/**
 * Create a new CursorOverlay instance.
 */
export function createCursorOverlay(config: CursorOverlayConfig): CursorOverlay {
  return new CursorOverlay(config);
}
