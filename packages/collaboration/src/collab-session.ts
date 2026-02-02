/**
 * CollabSession — manages a single collaborative editing session.
 *
 * Coordinates user presence, cursor tracking, document changes,
 * and conflict resolution within a shared session.
 */

import {
  BehaviorSubject,
  Subject,
  type Observable,
  map,
  throttleTime,
} from 'rxjs';
import type {
  CollabCursor,
  CollabEvent,
  CollabMessage,
  CollabSelection,
  CollabSessionConfig,
  CollabSessionStatus,
  CollabTransport,
  CollabUser,
  DocumentChange,
} from './types.js';

const DEFAULT_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
];

export class CollabSession {
  readonly sessionId: string;
  readonly user: CollabUser;

  private readonly config: Required<CollabSessionConfig>;
  private readonly transport: CollabTransport;
  private readonly statusSubject: BehaviorSubject<CollabSessionStatus>;
  private readonly usersSubject: BehaviorSubject<Map<string, CollabUser & { lastSeen: number }>>;
  private readonly cursorsSubject: BehaviorSubject<Map<string, CollabCursor>>;
  private readonly selectionsSubject: BehaviorSubject<Map<string, CollabSelection>>;
  private readonly eventsSubject: Subject<CollabEvent>;
  private readonly changesSubject: Subject<DocumentChange>;
  private readonly cursorOutSubject: Subject<Omit<CollabCursor, 'userId' | 'timestamp'>>;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private inactivityTimer: ReturnType<typeof setInterval> | null = null;
  private unsubTransport: (() => void) | null = null;
  private disposed = false;

  constructor(config: CollabSessionConfig) {
    this.sessionId = config.sessionId;
    this.user = {
      ...config.user,
      color: config.user.color ?? DEFAULT_COLORS[Math.abs(hashCode(config.user.id)) % DEFAULT_COLORS.length],
    };
    this.config = {
      sessionId: config.sessionId,
      user: this.user,
      transport: config.transport,
      autoReconnect: config.autoReconnect ?? true,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 5000,
      cursorThrottleMs: config.cursorThrottleMs ?? 50,
      inactivityTimeoutMs: config.inactivityTimeoutMs ?? 30000,
    };
    this.transport = config.transport;

    this.statusSubject = new BehaviorSubject<CollabSessionStatus>('idle');
    this.usersSubject = new BehaviorSubject(new Map());
    this.cursorsSubject = new BehaviorSubject(new Map());
    this.selectionsSubject = new BehaviorSubject(new Map());
    this.eventsSubject = new Subject();
    this.changesSubject = new Subject();
    this.cursorOutSubject = new Subject();

    // Throttle outgoing cursor updates
    this.cursorOutSubject
      .pipe(throttleTime(this.config.cursorThrottleMs))
      .subscribe((cursor) => {
        this.sendMessage('cursor', cursor);
      });
  }

  // ── Observables ──────────────────────────────────────────

  get status$(): Observable<CollabSessionStatus> {
    return this.statusSubject.asObservable();
  }

  get users$(): Observable<CollabUser[]> {
    return this.usersSubject.pipe(
      map((m) => Array.from(m.values()).map(({ lastSeen: _, ...u }) => u)),
    );
  }

  get cursors$(): Observable<CollabCursor[]> {
    return this.cursorsSubject.pipe(map((m) => Array.from(m.values())));
  }

  get selections$(): Observable<CollabSelection[]> {
    return this.selectionsSubject.pipe(map((m) => Array.from(m.values())));
  }

  get events$(): Observable<CollabEvent> {
    return this.eventsSubject.asObservable();
  }

  get changes$(): Observable<DocumentChange> {
    return this.changesSubject.asObservable();
  }

  get status(): CollabSessionStatus {
    return this.statusSubject.getValue();
  }

  get activeUsers(): CollabUser[] {
    return Array.from(this.usersSubject.getValue().values()).map(({ lastSeen: _, ...u }) => u);
  }

  // ── Lifecycle ────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.disposed) throw new Error('Session is disposed');

    this.statusSubject.next('connecting');

    try {
      this.unsubTransport = this.transport.onMessage((msg) => this.handleMessage(msg));
      await this.transport.connect();
      this.statusSubject.next('connected');

      this.sendMessage('join', { user: this.user });
      this.startHeartbeat();
      this.startInactivityCheck();

      this.emitEvent('user-joined', this.user.id);
    } catch (error) {
      this.statusSubject.next('disconnected');
      throw error;
    }
  }

  disconnect(): void {
    this.sendMessage('leave', { userId: this.user.id });
    this.cleanup();
    this.statusSubject.next('disconnected');
  }

  dispose(): void {
    this.cleanup();
    this.disposed = true;
    this.statusSubject.complete();
    this.eventsSubject.complete();
    this.changesSubject.complete();
    this.cursorOutSubject.complete();
  }

  // ── Cursor & Selection ───────────────────────────────────

  updateCursor(cursor: Omit<CollabCursor, 'userId' | 'timestamp'>): void {
    this.cursorOutSubject.next(cursor);
  }

  updateSelection(selection: Omit<CollabSelection, 'userId' | 'timestamp'>): void {
    this.sendMessage('selection', selection);
  }

  // ── Document Operations ──────────────────────────────────

  broadcastChange(change: Omit<DocumentChange, 'userId' | 'timestamp'>): void {
    const fullChange: DocumentChange = {
      ...change,
      userId: this.user.id,
      timestamp: Date.now(),
    };
    this.sendMessage('operation', fullChange);
    this.changesSubject.next(fullChange);
  }

  // ── Private ──────────────────────────────────────────────

  private handleMessage(message: CollabMessage): void {
    if (message.sessionId !== this.sessionId) return;
    if (message.userId === this.user.id) return;

    switch (message.type) {
      case 'join':
        this.handleUserJoin(message);
        break;
      case 'leave':
        this.handleUserLeave(message);
        break;
      case 'cursor':
        this.handleCursorUpdate(message);
        break;
      case 'selection':
        this.handleSelectionUpdate(message);
        break;
      case 'operation':
        this.handleOperation(message);
        break;
      case 'heartbeat':
        this.handleHeartbeat(message);
        break;
    }
  }

  private handleUserJoin(message: CollabMessage): void {
    const payload = message.payload as { user: CollabUser };
    const users = new Map(this.usersSubject.getValue());
    users.set(message.userId, { ...payload.user, lastSeen: Date.now() });
    this.usersSubject.next(users);
    this.emitEvent('user-joined', message.userId);
  }

  private handleUserLeave(message: CollabMessage): void {
    const users = new Map(this.usersSubject.getValue());
    users.delete(message.userId);
    this.usersSubject.next(users);

    const cursors = new Map(this.cursorsSubject.getValue());
    cursors.delete(message.userId);
    this.cursorsSubject.next(cursors);

    const selections = new Map(this.selectionsSubject.getValue());
    selections.delete(message.userId);
    this.selectionsSubject.next(selections);

    this.emitEvent('user-left', message.userId);
  }

  private handleCursorUpdate(message: CollabMessage): void {
    const payload = message.payload as Omit<CollabCursor, 'userId' | 'timestamp'>;
    const cursors = new Map(this.cursorsSubject.getValue());
    cursors.set(message.userId, {
      ...payload,
      userId: message.userId,
      timestamp: message.timestamp,
    });
    this.cursorsSubject.next(cursors);
    this.emitEvent('cursor-moved', message.userId);
    this.touchUser(message.userId);
  }

  private handleSelectionUpdate(message: CollabMessage): void {
    const payload = message.payload as Omit<CollabSelection, 'userId' | 'timestamp'>;
    const selections = new Map(this.selectionsSubject.getValue());
    selections.set(message.userId, {
      ...payload,
      userId: message.userId,
      timestamp: message.timestamp,
    });
    this.selectionsSubject.next(selections);
    this.emitEvent('selection-changed', message.userId);
    this.touchUser(message.userId);
  }

  private handleOperation(message: CollabMessage): void {
    const change = message.payload as DocumentChange;
    this.changesSubject.next(change);
    this.emitEvent('document-changed', message.userId, change);
    this.touchUser(message.userId);
  }

  private handleHeartbeat(message: CollabMessage): void {
    this.touchUser(message.userId);
  }

  private touchUser(userId: string): void {
    const users = this.usersSubject.getValue();
    const user = users.get(userId);
    if (user) {
      user.lastSeen = Date.now();
    }
  }

  private sendMessage(type: CollabMessage['type'], payload: unknown): void {
    if (this.status !== 'connected') return;
    this.transport.send({
      type,
      sessionId: this.sessionId,
      userId: this.user.id,
      payload,
      timestamp: Date.now(),
    });
  }

  private emitEvent(type: CollabEvent['type'], userId: string, data?: unknown): void {
    this.eventsSubject.next({
      type,
      userId,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      data,
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendMessage('heartbeat', null);
    }, this.config.heartbeatIntervalMs);
  }

  private startInactivityCheck(): void {
    this.inactivityTimer = setInterval(() => {
      const now = Date.now();
      const users = new Map(this.usersSubject.getValue());
      let changed = false;

      for (const [id, user] of users) {
        if (now - user.lastSeen > this.config.inactivityTimeoutMs) {
          users.delete(id);
          changed = true;
          this.emitEvent('user-left', id);
        }
      }

      if (changed) this.usersSubject.next(users);
    }, this.config.inactivityTimeoutMs / 2);
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (this.unsubTransport) {
      this.unsubTransport();
      this.unsubTransport = null;
    }
    this.transport.disconnect();
  }
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

/**
 * Create a new CollabSession.
 */
export function createCollabSession(config: CollabSessionConfig): CollabSession {
  return new CollabSession(config);
}
