/**
 * Presence update throttle for collaboration.
 *
 * Prevents flooding by throttling cursor/selection/typing updates
 * to a configurable rate, batching rapid updates and dropping
 * intermediate positions.
 *
 * @module presence-throttle
 */

import type { CollabCursor, CollabSelection } from './types.js';

/** Throttle configuration */
export interface PresenceThrottleConfig {
  /** Minimum interval between cursor updates in ms (default: 50) */
  readonly cursorIntervalMs?: number;
  /** Minimum interval between selection updates in ms (default: 100) */
  readonly selectionIntervalMs?: number;
  /** Minimum interval between typing indicator updates in ms (default: 300) */
  readonly typingIntervalMs?: number;
}

/**
 * Throttles presence updates to prevent flooding.
 *
 * @example
 * ```typescript
 * const throttle = new PresenceThrottle({ cursorIntervalMs: 50 });
 *
 * // In rapid mousemove handler:
 * const shouldSend = throttle.shouldSendCursor('user-1');
 * if (shouldSend) {
 *   transport.send(cursorUpdate);
 *   throttle.recordCursorSent('user-1');
 * }
 * ```
 */
export class PresenceThrottle {
  private readonly config: Required<PresenceThrottleConfig>;
  private readonly lastCursor = new Map<string, number>();
  private readonly lastSelection = new Map<string, number>();
  private readonly lastTyping = new Map<string, number>();
  private readonly pendingCursors = new Map<string, CollabCursor>();
  private readonly pendingSelections = new Map<string, CollabSelection>();
  private stats = { cursorsSent: 0, cursorsDropped: 0, selectionsSent: 0, selectionsDropped: 0 };

  constructor(config: PresenceThrottleConfig = {}) {
    this.config = {
      cursorIntervalMs: config.cursorIntervalMs ?? 50,
      selectionIntervalMs: config.selectionIntervalMs ?? 100,
      typingIntervalMs: config.typingIntervalMs ?? 300,
    };
  }

  /** Check if a cursor update should be sent now */
  shouldSendCursor(userId: string): boolean {
    const last = this.lastCursor.get(userId) ?? 0;
    return Date.now() - last >= this.config.cursorIntervalMs;
  }

  /** Record that a cursor update was sent */
  recordCursorSent(userId: string): void {
    this.lastCursor.set(userId, Date.now());
    this.pendingCursors.delete(userId);
    this.stats.cursorsSent++;
  }

  /** Queue a cursor update (will be sent when throttle allows) */
  queueCursor(userId: string, cursor: CollabCursor): CollabCursor | null {
    if (this.shouldSendCursor(userId)) {
      this.recordCursorSent(userId);
      return cursor;
    }
    this.pendingCursors.set(userId, cursor);
    this.stats.cursorsDropped++;
    return null;
  }

  /** Get the latest pending cursor for a user (if any) */
  getPendingCursor(userId: string): CollabCursor | undefined {
    return this.pendingCursors.get(userId);
  }

  /** Check if a selection update should be sent now */
  shouldSendSelection(userId: string): boolean {
    const last = this.lastSelection.get(userId) ?? 0;
    return Date.now() - last >= this.config.selectionIntervalMs;
  }

  /** Record that a selection update was sent */
  recordSelectionSent(userId: string): void {
    this.lastSelection.set(userId, Date.now());
    this.pendingSelections.delete(userId);
    this.stats.selectionsSent++;
  }

  /** Queue a selection update */
  queueSelection(userId: string, selection: CollabSelection): CollabSelection | null {
    if (this.shouldSendSelection(userId)) {
      this.recordSelectionSent(userId);
      return selection;
    }
    this.pendingSelections.set(userId, selection);
    this.stats.selectionsDropped++;
    return null;
  }

  /** Check if a typing indicator should be sent now */
  shouldSendTyping(userId: string): boolean {
    const last = this.lastTyping.get(userId) ?? 0;
    return Date.now() - last >= this.config.typingIntervalMs;
  }

  /** Record that a typing indicator was sent */
  recordTypingSent(userId: string): void {
    this.lastTyping.set(userId, Date.now());
  }

  /** Flush all pending updates (returns what should be sent) */
  flushPending(): { cursors: CollabCursor[]; selections: CollabSelection[] } {
    const now = Date.now();
    const cursors: CollabCursor[] = [];
    const selections: CollabSelection[] = [];

    for (const [userId, cursor] of this.pendingCursors) {
      const last = this.lastCursor.get(userId) ?? 0;
      if (now - last >= this.config.cursorIntervalMs) {
        cursors.push(cursor);
        this.lastCursor.set(userId, now);
      }
    }
    for (const c of cursors) this.pendingCursors.delete(c.userId);

    for (const [userId, sel] of this.pendingSelections) {
      const last = this.lastSelection.get(userId) ?? 0;
      if (now - last >= this.config.selectionIntervalMs) {
        selections.push(sel);
        this.lastSelection.set(userId, now);
      }
    }
    for (const s of selections) this.pendingSelections.delete(s.userId);

    return { cursors, selections };
  }

  /** Get throttle statistics */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /** Reset all state */
  reset(): void {
    this.lastCursor.clear();
    this.lastSelection.clear();
    this.lastTyping.clear();
    this.pendingCursors.clear();
    this.pendingSelections.clear();
    this.stats = { cursorsSent: 0, cursorsDropped: 0, selectionsSent: 0, selectionsDropped: 0 };
  }
}

/** Factory function */
export function createPresenceThrottle(config?: PresenceThrottleConfig): PresenceThrottle {
  return new PresenceThrottle(config);
}
