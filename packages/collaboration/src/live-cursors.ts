/**
 * Live Cursor Manager — high-level integration of real-time collaboration
 * cursors, selections, and presence awareness across connected clients.
 *
 * Wraps the lower-level CursorOverlay with transport-layer integration,
 * user awareness tracking, and activity indicators.
 *
 * @example
 * ```typescript
 * import { createLiveCursorManager } from '@pocket/collaboration';
 *
 * const liveCursors = createLiveCursorManager({
 *   userId: 'user-1',
 *   userName: 'Alice',
 *   transport: myTransport,
 *   broadcastIntervalMs: 50,
 * });
 *
 * await liveCursors.start();
 *
 * // Track local cursor position
 * liveCursors.updateLocalCursor({ line: 10, column: 5 });
 * liveCursors.updateLocalSelection({ start: { line: 10, column: 5 }, end: { line: 10, column: 20 } });
 *
 * // Observe remote cursors
 * liveCursors.cursors$.subscribe(cursors => renderCursors(cursors));
 * liveCursors.presence$.subscribe(users => renderPresenceBar(users));
 *
 * // Cleanup
 * liveCursors.stop();
 * ```
 *
 * @module @pocket/collaboration
 */

import { BehaviorSubject, Subject, type Subscription, interval } from 'rxjs';
import { takeUntil, throttleTime } from 'rxjs/operators';
import type { CursorPosition, SelectionRange } from './cursor-overlay.js';
import type { CollabMessage, CollabTransport } from './types.js';

// ── Types ─────────────────────────────────────────────────

export interface LiveCursorConfig {
  /** Local user ID */
  userId: string;
  /** Local user display name */
  userName: string;
  /** Local user color (auto-assigned if omitted) */
  userColor?: string;
  /** Transport layer for sending/receiving cursor updates */
  transport: CollabTransport;
  /** How often to broadcast local cursor position (ms, default: 50) */
  broadcastIntervalMs?: number;
  /** Time before a remote cursor is considered stale (ms, default: 10000) */
  staleCursorTimeoutMs?: number;
  /** Time before a user is considered idle (ms, default: 30000) */
  idleTimeoutMs?: number;
  /** Heartbeat interval for presence (ms, default: 5000) */
  heartbeatIntervalMs?: number;
}

export interface LiveCursor {
  userId: string;
  userName: string;
  color: string;
  position: CursorPosition | null;
  selection: SelectionRange | null;
  lastUpdated: number;
  isIdle: boolean;
}

export interface PresenceUser {
  userId: string;
  userName: string;
  color: string;
  status: 'active' | 'idle' | 'offline';
  joinedAt: number;
  lastSeenAt: number;
  currentDocument?: string;
}

export interface LiveCursorState {
  connected: boolean;
  localCursor: CursorPosition | null;
  localSelection: SelectionRange | null;
  remoteCursors: LiveCursor[];
  presenceUsers: PresenceUser[];
  activeCursorCount: number;
}

export type LiveCursorEvent =
  | { type: 'user_joined'; user: PresenceUser }
  | { type: 'user_left'; userId: string }
  | { type: 'user_idle'; userId: string }
  | { type: 'user_active'; userId: string }
  | { type: 'cursor_updated'; userId: string; position: CursorPosition }
  | { type: 'selection_updated'; userId: string; selection: SelectionRange };

// ── Cursor Colors ─────────────────────────────────────────

const CURSOR_PALETTE = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FFEAA7',
  '#DDA0DD',
  '#98D8C8',
  '#F7DC6F',
  '#FF8A65',
  '#81C784',
  '#64B5F6',
  '#BA68C8',
];

function autoColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return CURSOR_PALETTE[Math.abs(hash) % CURSOR_PALETTE.length]!;
}

// ── Live Cursor Manager ───────────────────────────────────

interface CursorMessage {
  type: 'cursor' | 'selection' | 'presence' | 'heartbeat' | 'leave';
  userId: string;
  userName: string;
  color: string;
  position?: CursorPosition;
  selection?: SelectionRange;
  document?: string;
  timestamp: number;
}

/**
 * Manages real-time cursor and presence state across connected clients.
 */
export class LiveCursorManager {
  private readonly config: Required<LiveCursorConfig>;
  private readonly remoteCursors = new Map<string, LiveCursor>();
  private readonly presenceUsers = new Map<string, PresenceUser>();
  private readonly events$$ = new Subject<LiveCursorEvent>();
  private readonly state$$: BehaviorSubject<LiveCursorState>;
  private readonly destroy$ = new Subject<void>();
  private readonly localCursorUpdates$$ = new Subject<CursorMessage>();

  private localCursor: CursorPosition | null = null;
  private localSelection: SelectionRange | null = null;
  private connected = false;
  private subscriptions: Subscription[] = [];
  private staleCheckInterval: Subscription | null = null;

  readonly events$ = this.events$$.asObservable();

  constructor(config: LiveCursorConfig) {
    this.config = {
      userId: config.userId,
      userName: config.userName,
      userColor: config.userColor ?? autoColor(config.userId),
      transport: config.transport,
      broadcastIntervalMs: config.broadcastIntervalMs ?? 50,
      staleCursorTimeoutMs: config.staleCursorTimeoutMs ?? 10_000,
      idleTimeoutMs: config.idleTimeoutMs ?? 30_000,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 5_000,
    };

    this.state$$ = new BehaviorSubject<LiveCursorState>(this.buildState());
  }

  get cursors$() {
    return new BehaviorSubject(this.getRemoteCursors()).asObservable();
  }

  get presence$() {
    return new BehaviorSubject(this.getPresenceUsers()).asObservable();
  }

  get state$() {
    return this.state$$.asObservable();
  }

  /** Start listening for and broadcasting cursor updates */
  async start(): Promise<void> {
    if (this.connected) return;

    // Listen for incoming messages via callback
    const unsubscribe = this.config.transport.onMessage((msg: CollabMessage) => {
      if (
        (msg.type === 'cursor' || msg.type === 'selection' || msg.type === 'heartbeat') &&
        msg.payload
      ) {
        this.handleRemoteMessage(msg.payload as CursorMessage);
      }
    });
    // Store unsubscribe as a pseudo-subscription
    this.subscriptions.push({ unsubscribe } as Subscription);

    // Broadcast local cursor updates (throttled)
    const broadcastSub = this.localCursorUpdates$$
      .pipe(throttleTime(this.config.broadcastIntervalMs), takeUntil(this.destroy$))
      .subscribe((msg) => {
        const msgType =
          msg.type === 'selection' ? 'selection' : msg.type === 'cursor' ? 'cursor' : 'heartbeat';
        this.config.transport.send({
          type: msgType,
          sessionId: '',
          userId: this.config.userId,
          payload: msg,
          timestamp: Date.now(),
        });
      });
    this.subscriptions.push(broadcastSub);

    // Heartbeat for presence
    const heartbeatSub = interval(this.config.heartbeatIntervalMs)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.broadcastPresence();
        this.cleanStaleEntries();
      });
    this.subscriptions.push(heartbeatSub);

    // Stale cursor cleanup
    this.staleCheckInterval = interval(this.config.staleCursorTimeoutMs / 2)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.cleanStaleEntries());

    this.connected = true;

    // Announce presence
    this.broadcastPresence();
    this.emitState();
  }

  /** Stop broadcasting and listening */
  stop(): void {
    if (!this.connected) return;

    // Announce departure
    this.config.transport.send({
      type: 'leave',
      sessionId: '',
      userId: this.config.userId,
      payload: {
        type: 'leave',
        userId: this.config.userId,
        userName: this.config.userName,
        color: this.config.userColor,
        timestamp: Date.now(),
      } satisfies CursorMessage,
      timestamp: Date.now(),
    });

    for (const sub of this.subscriptions) sub.unsubscribe();
    this.subscriptions = [];
    this.staleCheckInterval?.unsubscribe();
    this.connected = false;
    this.emitState();
  }

  /** Update local cursor position */
  updateLocalCursor(position: CursorPosition): void {
    this.localCursor = position;
    this.localCursorUpdates$$.next({
      type: 'cursor',
      userId: this.config.userId,
      userName: this.config.userName,
      color: this.config.userColor,
      position,
      timestamp: Date.now(),
    });
    this.emitState();
  }

  /** Update local selection */
  updateLocalSelection(selection: SelectionRange | null): void {
    this.localSelection = selection;
    if (selection) {
      this.localCursorUpdates$$.next({
        type: 'selection',
        userId: this.config.userId,
        userName: this.config.userName,
        color: this.config.userColor,
        selection,
        timestamp: Date.now(),
      });
    }
    this.emitState();
  }

  /** Get all remote cursors */
  getRemoteCursors(): LiveCursor[] {
    return Array.from(this.remoteCursors.values());
  }

  /** Get all presence users */
  getPresenceUsers(): PresenceUser[] {
    return Array.from(this.presenceUsers.values());
  }

  /** Destroy the manager */
  destroy(): void {
    this.stop();
    this.destroy$.next();
    this.destroy$.complete();
    this.events$$.complete();
    this.state$$.complete();
  }

  // ── Internals ─────────────────────────────────────────

  private handleRemoteMessage(msg: CursorMessage): void {
    if (msg.userId === this.config.userId) return;

    switch (msg.type) {
      case 'cursor':
        this.updateRemoteCursor(msg);
        break;
      case 'selection':
        this.updateRemoteSelection(msg);
        break;
      case 'presence':
      case 'heartbeat':
        this.updatePresence(msg);
        break;
      case 'leave':
        this.removeUser(msg.userId);
        break;
    }

    this.emitState();
  }

  private updateRemoteCursor(msg: CursorMessage): void {
    const existing = this.remoteCursors.get(msg.userId);
    const cursor: LiveCursor = {
      userId: msg.userId,
      userName: msg.userName,
      color: msg.color ?? autoColor(msg.userId),
      position: msg.position ?? null,
      selection: existing?.selection ?? null,
      lastUpdated: Date.now(),
      isIdle: false,
    };
    this.remoteCursors.set(msg.userId, cursor);
    this.updatePresenceActivity(msg.userId, msg.userName, msg.color);

    if (msg.position) {
      this.events$$.next({ type: 'cursor_updated', userId: msg.userId, position: msg.position });
    }
  }

  private updateRemoteSelection(msg: CursorMessage): void {
    const existing = this.remoteCursors.get(msg.userId);
    if (existing && msg.selection) {
      existing.selection = msg.selection;
      existing.lastUpdated = Date.now();
      existing.isIdle = false;
      this.events$$.next({
        type: 'selection_updated',
        userId: msg.userId,
        selection: msg.selection,
      });
    }
  }

  private updatePresence(msg: CursorMessage): void {
    const existing = this.presenceUsers.get(msg.userId);
    if (existing) {
      existing.lastSeenAt = Date.now();
      existing.status = 'active';
      existing.currentDocument = msg.document;
    } else {
      const user: PresenceUser = {
        userId: msg.userId,
        userName: msg.userName,
        color: msg.color ?? autoColor(msg.userId),
        status: 'active',
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
        currentDocument: msg.document,
      };
      this.presenceUsers.set(msg.userId, user);
      this.events$$.next({ type: 'user_joined', user });
    }
  }

  private updatePresenceActivity(userId: string, userName: string, color: string): void {
    if (!this.presenceUsers.has(userId)) {
      const user: PresenceUser = {
        userId,
        userName,
        color: color ?? autoColor(userId),
        status: 'active',
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      this.presenceUsers.set(userId, user);
      this.events$$.next({ type: 'user_joined', user });
    } else {
      const user = this.presenceUsers.get(userId)!;
      user.lastSeenAt = Date.now();
      if (user.status === 'idle') {
        user.status = 'active';
        this.events$$.next({ type: 'user_active', userId });
      }
    }
  }

  private removeUser(userId: string): void {
    this.remoteCursors.delete(userId);
    this.presenceUsers.delete(userId);
    this.events$$.next({ type: 'user_left', userId });
  }

  private broadcastPresence(): void {
    this.config.transport.send({
      type: 'heartbeat',
      sessionId: '',
      userId: this.config.userId,
      payload: {
        type: 'heartbeat',
        userId: this.config.userId,
        userName: this.config.userName,
        color: this.config.userColor,
        timestamp: Date.now(),
      } satisfies CursorMessage,
      timestamp: Date.now(),
    });
  }

  private cleanStaleEntries(): void {
    const now = Date.now();

    for (const [userId, cursor] of this.remoteCursors) {
      if (now - cursor.lastUpdated > this.config.staleCursorTimeoutMs) {
        this.remoteCursors.delete(userId);
      } else if (now - cursor.lastUpdated > this.config.idleTimeoutMs && !cursor.isIdle) {
        cursor.isIdle = true;
        const user = this.presenceUsers.get(userId);
        if (user && user.status !== 'idle') {
          user.status = 'idle';
          this.events$$.next({ type: 'user_idle', userId });
        }
      }
    }

    for (const [userId, user] of this.presenceUsers) {
      if (now - user.lastSeenAt > this.config.staleCursorTimeoutMs * 2) {
        this.presenceUsers.delete(userId);
        this.remoteCursors.delete(userId);
        this.events$$.next({ type: 'user_left', userId });
      }
    }
  }

  private buildState(): LiveCursorState {
    return {
      connected: this.connected,
      localCursor: this.localCursor,
      localSelection: this.localSelection,
      remoteCursors: this.getRemoteCursors(),
      presenceUsers: this.getPresenceUsers(),
      activeCursorCount: this.remoteCursors.size,
    };
  }

  private emitState(): void {
    this.state$$.next(this.buildState());
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create a live cursor manager for real-time collaboration */
export function createLiveCursorManager(config: LiveCursorConfig): LiveCursorManager {
  return new LiveCursorManager(config);
}
