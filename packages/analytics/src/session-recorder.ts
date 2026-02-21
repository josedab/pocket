/**
 * SessionRecorder - Lightweight session recording for offline-first analytics.
 *
 * Captures user interaction events (clicks, navigations, form inputs)
 * and stores them locally. Supports session replay, heatmap data extraction,
 * and privacy-safe recording with configurable field masking.
 *
 * @module session-recorder
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

/** Type of recorded interaction event */
export type InteractionType =
  | 'click'
  | 'navigation'
  | 'input'
  | 'scroll'
  | 'resize'
  | 'visibility'
  | 'error'
  | 'custom';

/** A single recorded interaction event */
export interface InteractionEvent {
  readonly type: InteractionType;
  readonly timestamp: number;
  readonly sessionId: string;
  /** CSS selector or element identifier */
  readonly target?: string;
  /** Page or route path */
  readonly path?: string;
  /** Coordinates for click/scroll events */
  readonly position?: { readonly x: number; readonly y: number };
  /** Viewport dimensions at event time */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Custom event data */
  readonly data?: Record<string, unknown>;
  /** Duration for timed events (ms) */
  readonly durationMs?: number;
}

/** Session recording configuration */
export interface SessionRecorderConfig {
  /** Maximum events per session before auto-flush */
  readonly maxEventsPerSession?: number;
  /** Auto-flush interval in milliseconds */
  readonly flushIntervalMs?: number;
  /** CSS selectors to mask (privacy) */
  readonly maskSelectors?: readonly string[];
  /** Whether to record scroll events */
  readonly recordScroll?: boolean;
  /** Whether to record input events */
  readonly recordInput?: boolean;
  /** Maximum session duration in ms (auto-split after this) */
  readonly maxSessionDurationMs?: number;
  /** Custom session ID generator */
  readonly generateSessionId?: () => string;
}

/** A complete recorded session */
export interface RecordedSession {
  readonly sessionId: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly eventCount: number;
  readonly events: readonly InteractionEvent[];
  readonly durationMs: number;
  /** Page paths visited during session */
  readonly pagesVisited: readonly string[];
  /** Heatmap data: { path -> click positions } */
  readonly heatmapData: Record<string, Array<{ x: number; y: number; count: number }>>;
}

/** Session recorder status */
export interface RecorderStatus {
  readonly isRecording: boolean;
  readonly currentSessionId: string | null;
  readonly eventsCaptured: number;
  readonly sessionsStored: number;
  readonly storageUsedBytes: number;
}

const DEFAULT_MAX_EVENTS = 5000;
const DEFAULT_FLUSH_INTERVAL = 30_000;
const DEFAULT_MAX_SESSION_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Records user interaction sessions for offline-first analytics.
 *
 * @example
 * ```typescript
 * import { createSessionRecorder } from '@pocket/analytics';
 *
 * const recorder = createSessionRecorder({
 *   maskSelectors: ['input[type="password"]', '.sensitive'],
 *   recordScroll: true,
 * });
 *
 * recorder.startSession();
 *
 * // Record interactions
 * recorder.recordClick('button.submit', { x: 100, y: 200 });
 * recorder.recordNavigation('/dashboard');
 *
 * // Get session replay data
 * const session = recorder.getCurrentSession();
 *
 * // Export heatmap data
 * const heatmap = recorder.getHeatmapData('/dashboard');
 * ```
 */
export class SessionRecorder {
  private readonly config: Required<SessionRecorderConfig>;
  private readonly sessions = new Map<string, SessionData>();
  private readonly status$$: BehaviorSubject<RecorderStatus>;
  private readonly events$$ = new Subject<InteractionEvent>();
  private readonly destroy$ = new Subject<void>();
  private currentSessionId: string | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SessionRecorderConfig = {}) {
    this.config = {
      maxEventsPerSession: config.maxEventsPerSession ?? DEFAULT_MAX_EVENTS,
      flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL,
      maskSelectors: config.maskSelectors ?? [],
      recordScroll: config.recordScroll ?? false,
      recordInput: config.recordInput ?? false,
      maxSessionDurationMs: config.maxSessionDurationMs ?? DEFAULT_MAX_SESSION_DURATION,
      generateSessionId: config.generateSessionId ?? defaultSessionId,
    };
    this.status$$ = new BehaviorSubject<RecorderStatus>(this.buildStatus());
  }

  /** Live event stream */
  get interactionEvents$(): Observable<InteractionEvent> {
    return this.events$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Status stream */
  get recorderStatus$(): Observable<RecorderStatus> {
    return this.status$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Start a new recording session */
  startSession(): string {
    const sessionId = this.config.generateSessionId();
    this.currentSessionId = sessionId;
    this.sessions.set(sessionId, {
      sessionId,
      startedAt: Date.now(),
      endedAt: null,
      events: [],
      pagesVisited: [],
      clickPositions: new Map(),
    });

    this.flushTimer = setInterval(() => {
      this.checkSessionDuration();
    }, this.config.flushIntervalMs);

    this.updateStatus();
    return sessionId;
  }

  /** Stop the current recording session */
  stopSession(): RecordedSession | null {
    if (!this.currentSessionId) return null;
    const session = this.sessions.get(this.currentSessionId);
    if (!session) return null;

    session.endedAt = Date.now();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    const recorded = this.buildRecordedSession(session);
    this.currentSessionId = null;
    this.updateStatus();
    return recorded;
  }

  /** Record a click interaction */
  recordClick(target: string, position?: { x: number; y: number }, path?: string): void {
    if (this.isMasked(target)) return;
    this.addEvent({
      type: 'click',
      timestamp: Date.now(),
      sessionId: this.currentSessionId ?? '',
      target,
      position,
      path,
    });
  }

  /** Record a page navigation */
  recordNavigation(path: string): void {
    const session = this.getCurrentSessionData();
    if (session && !session.pagesVisited.includes(path)) {
      session.pagesVisited.push(path);
    }
    this.addEvent({
      type: 'navigation',
      timestamp: Date.now(),
      sessionId: this.currentSessionId ?? '',
      path,
    });
  }

  /** Record a custom event */
  recordCustom(name: string, data?: Record<string, unknown>): void {
    this.addEvent({
      type: 'custom',
      timestamp: Date.now(),
      sessionId: this.currentSessionId ?? '',
      data: { name, ...data },
    });
  }

  /** Record a scroll event */
  recordScroll(position: { x: number; y: number }, path?: string): void {
    if (!this.config.recordScroll) return;
    this.addEvent({
      type: 'scroll',
      timestamp: Date.now(),
      sessionId: this.currentSessionId ?? '',
      position,
      path,
    });
  }

  /** Record an error event */
  recordError(message: string, data?: Record<string, unknown>): void {
    this.addEvent({
      type: 'error',
      timestamp: Date.now(),
      sessionId: this.currentSessionId ?? '',
      data: { message, ...data },
    });
  }

  /** Get the current session's recorded data */
  getCurrentSession(): RecordedSession | null {
    const session = this.getCurrentSessionData();
    return session ? this.buildRecordedSession(session) : null;
  }

  /** Get a stored session by ID */
  getSession(sessionId: string): RecordedSession | null {
    const session = this.sessions.get(sessionId);
    return session ? this.buildRecordedSession(session) : null;
  }

  /** Get all stored session IDs */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** Get heatmap data for a specific page path across all sessions */
  getHeatmapData(path: string): Array<{ x: number; y: number; count: number }> {
    const positionMap = new Map<string, { x: number; y: number; count: number }>();

    for (const session of this.sessions.values()) {
      for (const event of session.events) {
        if (event.type === 'click' && event.path === path && event.position) {
          // Bucket positions to 10px grid
          const bx = Math.round(event.position.x / 10) * 10;
          const by = Math.round(event.position.y / 10) * 10;
          const key = `${bx},${by}`;
          const existing = positionMap.get(key);
          if (existing) {
            existing.count++;
          } else {
            positionMap.set(key, { x: bx, y: by, count: 1 });
          }
        }
      }
    }

    return Array.from(positionMap.values()).sort((a, b) => b.count - a.count);
  }

  /** Get current status */
  getStatus(): RecorderStatus {
    return this.buildStatus();
  }

  /** Destroy the recorder */
  destroy(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.destroy$.next();
    this.destroy$.complete();
    this.status$$.complete();
    this.events$$.complete();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private getCurrentSessionData(): SessionData | undefined {
    return this.currentSessionId ? this.sessions.get(this.currentSessionId) : undefined;
  }

  private addEvent(event: InteractionEvent): void {
    const session = this.getCurrentSessionData();
    if (!session) return;

    if (session.events.length >= this.config.maxEventsPerSession) return;

    session.events.push(event);
    this.events$$.next(event);
    this.updateStatus();
  }

  private isMasked(target: string): boolean {
    return this.config.maskSelectors.some((sel) => target.includes(sel));
  }

  private checkSessionDuration(): void {
    const session = this.getCurrentSessionData();
    if (!session) return;

    const duration = Date.now() - session.startedAt;
    if (duration >= this.config.maxSessionDurationMs) {
      this.stopSession();
      this.startSession();
    }
  }

  private buildRecordedSession(session: SessionData): RecordedSession {
    const endedAt = session.endedAt ?? Date.now();
    return {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      eventCount: session.events.length,
      events: session.events,
      durationMs: endedAt - session.startedAt,
      pagesVisited: session.pagesVisited,
      heatmapData: this.buildSessionHeatmap(session),
    };
  }

  private buildSessionHeatmap(
    session: SessionData,
  ): Record<string, Array<{ x: number; y: number; count: number }>> {
    const pathMap = new Map<string, Map<string, { x: number; y: number; count: number }>>();

    for (const event of session.events) {
      if (event.type === 'click' && event.path && event.position) {
        let posMap = pathMap.get(event.path);
        if (!posMap) {
          posMap = new Map();
          pathMap.set(event.path, posMap);
        }
        const bx = Math.round(event.position.x / 10) * 10;
        const by = Math.round(event.position.y / 10) * 10;
        const key = `${bx},${by}`;
        const existing = posMap.get(key);
        if (existing) existing.count++;
        else posMap.set(key, { x: bx, y: by, count: 1 });
      }
    }

    const result: Record<string, Array<{ x: number; y: number; count: number }>> = {};
    for (const [path, posMap] of pathMap) {
      result[path] = Array.from(posMap.values());
    }
    return result;
  }

  private updateStatus(): void {
    this.status$$.next(this.buildStatus());
  }

  private buildStatus(): RecorderStatus {
    const currentSession = this.getCurrentSessionData();
    let totalBytes = 0;
    for (const session of this.sessions.values()) {
      totalBytes += session.events.length * 200; // rough estimate per event
    }
    return {
      isRecording: !!this.currentSessionId,
      currentSessionId: this.currentSessionId,
      eventsCaptured: currentSession?.events.length ?? 0,
      sessionsStored: this.sessions.size,
      storageUsedBytes: totalBytes,
    };
  }
}

interface SessionData {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  events: InteractionEvent[];
  pagesVisited: string[];
  clickPositions: Map<string, { x: number; y: number; count: number }>;
}

function defaultSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Factory function to create a SessionRecorder */
export function createSessionRecorder(config?: SessionRecorderConfig): SessionRecorder {
  return new SessionRecorder(config);
}
