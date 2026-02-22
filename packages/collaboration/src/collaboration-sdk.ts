/**
 * CollaborationSDK — Unified entry point for real-time collaboration.
 *
 * Orchestrates CollabSession, AwarenessProtocol, CRDTDocument, and
 * ConflictResolver into a single high-level API. Enables developers
 * to add Notion/Figma-style collaboration to any Pocket collection
 * with minimal setup.
 *
 * @example
 * ```typescript
 * import { createCollaborationSDK, createMemoryTransportHub } from '@pocket/collaboration';
 *
 * const hub = createMemoryTransportHub();
 *
 * const sdk = createCollaborationSDK({
 *   sessionId: 'doc-abc',
 *   user: { id: 'user-1', name: 'Alice' },
 *   transport: hub.createTransport(),
 *   collections: ['notes', 'tasks'],
 * });
 *
 * await sdk.connect();
 *
 * // Real-time awareness
 * sdk.awareness$.subscribe((states) => {
 *   console.log('Active users:', states.size);
 * });
 *
 * // Track cursor position
 * sdk.setCursor({ line: 10, column: 5 });
 *
 * // Apply a collaborative edit
 * sdk.applyEdit('notes', 'note-1', [
 *   { type: 'set', path: 'title', value: 'Updated Title' },
 * ]);
 *
 * // Listen for remote edits
 * sdk.remoteEdits$.subscribe((edit) => {
 *   console.log(`User ${edit.userId} edited ${edit.collection}/${edit.documentId}`);
 * });
 *
 * await sdk.disconnect();
 * ```
 */

import { BehaviorSubject, Subject, type Observable, type Subscription } from 'rxjs';
import type {
  CollabSessionConfig,
  CollabSessionStatus,
  CollabTransport,
  CollabUser,
  DocumentOperation,
} from './types.js';
import { CollabSession } from './collab-session.js';
import { AwarenessProtocol, type AwarenessState } from './awareness.js';
import type { ConflictStrategy } from './conflict-resolver.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the CollaborationSDK */
export interface CollaborationSDKConfig {
  /** Unique session identifier (e.g. document ID or room ID) */
  sessionId: string;
  /** Local user info */
  user: CollabUser;
  /** Transport layer for message exchange */
  transport: CollabTransport;
  /** Collections enabled for collaboration */
  collections: string[];
  /** Conflict resolution strategy (default: 'last-write-wins') */
  conflictStrategy?: ConflictStrategy;
  /** Heartbeat interval in ms (default: 5000) */
  heartbeatIntervalMs?: number;
  /** Cursor throttle in ms (default: 50) */
  cursorThrottleMs?: number;
  /** Peer inactivity timeout in ms (default: 30000) */
  inactivityTimeoutMs?: number;
}

/** A remote edit received from another user */
export interface RemoteEdit {
  /** User who made the edit */
  userId: string;
  /** User display name */
  userName: string;
  /** Collection name */
  collection: string;
  /** Document ID */
  documentId: string;
  /** Operations applied */
  operations: DocumentOperation[];
  /** Timestamp of the edit */
  timestamp: number;
}

/** SDK lifecycle status */
export type SDKStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Summary of active collaboration state */
export interface CollaborationSnapshot {
  /** Session ID */
  sessionId: string;
  /** Local user */
  localUser: CollabUser;
  /** Current status */
  status: SDKStatus;
  /** Number of active users */
  activeUsers: number;
  /** Collections enabled for collaboration */
  collections: string[];
  /** User awareness states */
  awarenessStates: Map<string, AwarenessState>;
}

// ---------------------------------------------------------------------------
// CollaborationSDK
// ---------------------------------------------------------------------------

/**
 * High-level collaboration SDK that unifies session management,
 * awareness tracking, CRDT editing, and conflict resolution.
 */
export class CollaborationSDK {
  private readonly config: Required<CollaborationSDKConfig>;
  private session: CollabSession | undefined;
  private awareness: AwarenessProtocol | undefined;
  private readonly subscriptions: Subscription[] = [];

  private readonly statusSubject = new BehaviorSubject<SDKStatus>('disconnected');
  private readonly remoteEditsSubject = new Subject<RemoteEdit>();
  private readonly awarenessSubject = new BehaviorSubject<Map<string, AwarenessState>>(new Map());

  /** Observable of the SDK connection status */
  readonly status$: Observable<SDKStatus> = this.statusSubject.asObservable();

  /** Observable of remote edits from other users */
  readonly remoteEdits$: Observable<RemoteEdit> = this.remoteEditsSubject.asObservable();

  /** Observable of awareness states for all users */
  readonly awareness$: Observable<Map<string, AwarenessState>> =
    this.awarenessSubject.asObservable();

  constructor(config: CollaborationSDKConfig) {
    this.config = {
      sessionId: config.sessionId,
      user: config.user,
      transport: config.transport,
      collections: [...config.collections],
      conflictStrategy: config.conflictStrategy ?? 'last-write-wins',
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 5_000,
      cursorThrottleMs: config.cursorThrottleMs ?? 50,
      inactivityTimeoutMs: config.inactivityTimeoutMs ?? 30_000,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Connect to the collaboration session */
  async connect(): Promise<void> {
    if (this.statusSubject.value === 'connected') return;

    this.statusSubject.next('connecting');

    try {
      // Initialize session
      const sessionConfig: CollabSessionConfig = {
        sessionId: this.config.sessionId,
        user: this.config.user,
        transport: this.config.transport,
        heartbeatIntervalMs: this.config.heartbeatIntervalMs,
        cursorThrottleMs: this.config.cursorThrottleMs,
        inactivityTimeoutMs: this.config.inactivityTimeoutMs,
      };

      this.session = new CollabSession(sessionConfig);

      // Initialize awareness
      this.awareness = new AwarenessProtocol({
        localUserId: this.config.user.id,
        localUserName: this.config.user.name,
        localUserColor: this.config.user.color,
        inactivityTimeoutMs: this.config.inactivityTimeoutMs,
      });

      // Wire awareness updates
      const awarenessSub = this.awareness.states$.subscribe((states) => {
        this.awarenessSubject.next(states);
      });
      this.subscriptions.push(awarenessSub);

      // Wire session status
      const statusSub = this.session.status$.subscribe((status: CollabSessionStatus) => {
        if (status === 'connected') {
          this.statusSubject.next('connected');
        } else if (status === 'disconnected') {
          this.statusSubject.next('disconnected');
        }
      });
      this.subscriptions.push(statusSub);

      // Wire remote document changes
      const changesSub = this.session.changes$.subscribe((change) => {
        if (!this.config.collections.includes(change.collection)) return;

        this.remoteEditsSubject.next({
          userId: change.userId ?? 'unknown',
          userName: change.userId ?? 'Unknown',
          collection: change.collection,
          documentId: change.documentId,
          operations: change.operations,
          timestamp: change.timestamp ?? Date.now(),
        });
      });
      this.subscriptions.push(changesSub);

      await this.session.connect();
      this.statusSubject.next('connected');
    } catch {
      this.statusSubject.next('error');
    }
  }

  /** Disconnect from the session and clean up */
  async disconnect(): Promise<void> {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions.length = 0;

    this.awareness?.destroy();
    this.session?.dispose();

    this.awareness = undefined;
    this.session = undefined;

    this.statusSubject.next('disconnected');
  }

  // -----------------------------------------------------------------------
  // Awareness
  // -----------------------------------------------------------------------

  /** Update the local user's cursor position */
  setCursor(cursor: { line: number; column: number }): void {
    this.awareness?.setCursor(cursor.line, cursor.column);
    this.session?.updateCursor({
      documentId: this.config.sessionId,
      offset: cursor.line * 1000 + cursor.column,
    });
  }

  /** Update the local user's selection range */
  setSelection(selection: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  }): void {
    this.awareness?.setSelection(selection.start, selection.end);
  }

  /** Set typing indicator */
  setTyping(isTyping: boolean): void {
    this.awareness?.setTyping(isTyping);
  }

  /** Get awareness states for all users */
  getAwarenessStates(): Map<string, AwarenessState> {
    return this.awareness?.getStates() ?? new Map();
  }

  // -----------------------------------------------------------------------
  // Editing
  // -----------------------------------------------------------------------

  /**
   * Apply a collaborative edit to a document.
   *
   * @param collection - Target collection
   * @param documentId - Document ID
   * @param operations - Operations to apply
   */
  applyEdit(
    collection: string,
    documentId: string,
    operations: DocumentOperation[]
  ): void {
    if (!this.session) return;
    if (!this.config.collections.includes(collection)) return;

    this.session.broadcastChange({
      documentId,
      collection,
      operations,
    });
  }

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  /** Get current SDK status */
  getStatus(): SDKStatus {
    return this.statusSubject.value;
  }

  /** Get a snapshot of the current collaboration state */
  getSnapshot(): CollaborationSnapshot {
    const awarenessStates = this.getAwarenessStates();

    return {
      sessionId: this.config.sessionId,
      localUser: this.config.user,
      status: this.statusSubject.value,
      activeUsers: awarenessStates.size,
      collections: [...this.config.collections],
      awarenessStates,
    };
  }

  /** Get active user list (convenience) */
  getActiveUsers(): Array<{ id: string; name: string; color: string }> {
    const states = this.getAwarenessStates();
    return [...states.values()].map((s) => ({
      id: s.userId,
      name: s.name,
      color: s.color,
    }));
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a CollaborationSDK instance.
 *
 * @param config - SDK configuration
 * @returns A new CollaborationSDK
 *
 * @example
 * ```typescript
 * const sdk = createCollaborationSDK({
 *   sessionId: 'room-1',
 *   user: { id: 'u1', name: 'Alice' },
 *   transport: myTransport,
 *   collections: ['docs', 'tasks'],
 * });
 *
 * await sdk.connect();
 * ```
 */
export function createCollaborationSDK(config: CollaborationSDKConfig): CollaborationSDK {
  return new CollaborationSDK(config);
}
