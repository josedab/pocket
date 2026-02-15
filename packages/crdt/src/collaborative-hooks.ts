/**
 * Collaborative Hooks for Pocket CRDT
 *
 * Framework-agnostic reactive hooks for building collaborative UIs.
 * Returns RxJS observables that can be consumed by any framework
 * (React, Angular, Vue, Svelte, etc.).
 *
 * @example Creating a collaborative edit session
 * ```typescript
 * const session = createCollaborativeEditSession('doc-123', {
 *   nodeId: 'user-1',
 *   displayName: 'Alice',
 *   userColor: '#FF6B6B',
 * });
 *
 * // Subscribe to document state
 * session.state$.subscribe(state => {
 *   render(state.data);
 * });
 *
 * // Subscribe to presence
 * session.presence$.subscribe(presence => {
 *   showPeers(presence.peers);
 * });
 *
 * // Apply a local change
 * session.applyLocalChange({ title: 'Updated Title' });
 *
 * // Undo / redo
 * session.undo();
 * session.redo();
 *
 * session.dispose();
 * ```
 *
 * @example Tracking presence independently
 * ```typescript
 * const tracker = createPresenceTracker({
 *   nodeId: 'user-2',
 *   displayName: 'Bob',
 * });
 *
 * tracker.presence$.subscribe(p => console.log(p.peerCount));
 *
 * tracker.updateCursor({ offset: 42 });
 * tracker.addPeer({
 *   nodeId: 'user-3',
 *   displayName: 'Charlie',
 *   color: '#4ECDC4',
 *   lastActiveAt: Date.now(),
 *   isOnline: true,
 * });
 *
 * tracker.dispose();
 * ```
 *
 * @see {@link createCollaborativeEditSession} - Full session factory
 * @see {@link createPresenceTracker} - Lightweight presence factory
 */

import {
  BehaviorSubject,
  Subject,
  combineLatest,
  distinctUntilChanged,
  map,
  type Observable,
} from 'rxjs';
import { LamportClock } from './clock.js';
import type {
  CollaborationStatus,
  CollaboratorInfo,
  CursorPosition,
  SelectionRange,
} from './collaboration-manager.js';
import type { NodeId } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Snapshot of a collaborative document including data, version, and peers.
 *
 * Emitted through {@link CollaborativeEditSession.state$}.
 *
 * @typeParam T - The document data shape
 */
export interface CollaborativeDocState<T = unknown> {
  /** Unique document identifier. */
  documentId: string;
  /** Current document data. */
  data: T;
  /** Monotonically increasing version counter. */
  version: number;
  /** Currently connected collaborators. */
  collaborators: CollaboratorInfo[];
  /** Number of unsynced local changes. */
  localChanges: number;
  /** Unix timestamp of last successful sync. */
  lastSyncAt: number;
}

/**
 * Presence information for the local user and all remote peers.
 *
 * Emitted through {@link CollaborativeEditSession.presence$}.
 */
export interface PresenceState {
  /** Remote peers currently connected. */
  peers: CollaboratorInfo[];
  /** Local user identity. */
  localUser: { nodeId: NodeId; displayName: string; color: string };
  /** Current connection status. */
  connectionStatus: CollaborationStatus;
  /** Number of connected peers (excluding local user). */
  peerCount: number;
}

/**
 * A full collaborative editing session with document state, presence,
 * cursors, and undo/redo support.
 *
 * @see {@link createCollaborativeEditSession}
 */
export interface CollaborativeEditSession {
  /** Document identifier for this session. */
  documentId: string;
  /** Observable of the collaborative document state. */
  state$: Observable<CollaborativeDocState>;
  /** Observable of presence information. */
  presence$: Observable<PresenceState>;
  /** Observable of remote peer cursors with user metadata. */
  cursors$: Observable<
    { nodeId: NodeId; cursor: CursorPosition; user: { name: string; color: string } }[]
  >;
  /** Apply a local change to the document. */
  applyLocalChange: (change: Record<string, unknown>) => void;
  /** Update the local cursor position. */
  updateCursor: (cursor: CursorPosition) => void;
  /** Update the local selection (or clear with null). */
  updateSelection: (selection: SelectionRange | null) => void;
  /** Undo the last local change. Returns true if an undo was performed. */
  undo: () => boolean;
  /** Redo the last undone change. Returns true if a redo was performed. */
  redo: () => boolean;
  /** Observable indicating whether undo is available. */
  canUndo$: Observable<boolean>;
  /** Observable indicating whether redo is available. */
  canRedo$: Observable<boolean>;
  /** Dispose all resources associated with this session. */
  dispose: () => void;
}

/**
 * Configuration for creating collaborative hooks.
 */
export interface CollaborativeHooksConfig {
  /** Unique node identifier for this client. */
  nodeId: NodeId;
  /** Display name shown to other collaborators. */
  displayName: string;
  /** Optional cursor/selection colour (auto-assigned if omitted). */
  userColor?: string;
}

/**
 * A lightweight presence tracker independent of any specific document.
 *
 * @see {@link createPresenceTracker}
 */
export interface PresenceTracker {
  /** Observable of the current presence state. */
  presence$: Observable<PresenceState>;
  /** Update the local cursor position. */
  updateCursor: (cursor: CursorPosition) => void;
  /** Update the local selection (or clear with null). */
  updateSelection: (selection: SelectionRange | null) => void;
  /** Register a new remote peer. */
  addPeer: (peer: CollaboratorInfo) => void;
  /** Remove a remote peer by node ID. */
  removePeer: (nodeId: NodeId) => void;
  /** Dispose all resources. */
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// Default colour palette (matches CollaborationManager)
// ---------------------------------------------------------------------------

const DEFAULT_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FFEAA7',
  '#DDA0DD',
  '#98D8C8',
  '#F7DC6F',
  '#BB8FCE',
  '#85C1E9',
  '#F0B27A',
  '#82E0AA',
];

// ---------------------------------------------------------------------------
// createCollaborativeEditSession
// ---------------------------------------------------------------------------

/**
 * Create a full collaborative editing session.
 *
 * Returns an object whose observable properties can be subscribed to by
 * any UI framework. All state is managed internally via RxJS subjects.
 *
 * @param documentId - Unique document identifier
 * @param config - Hook configuration (node ID, display name, colour)
 * @returns A {@link CollaborativeEditSession}
 *
 * @example
 * ```typescript
 * const session = createCollaborativeEditSession('readme.md', {
 *   nodeId: 'user-1',
 *   displayName: 'Alice',
 * });
 *
 * session.state$.subscribe(s => console.log(s.version));
 * session.applyLocalChange({ body: 'new content' });
 * session.dispose();
 * ```
 */
export function createCollaborativeEditSession(
  documentId: string,
  config: CollaborativeHooksConfig
): CollaborativeEditSession {
  const clock = new LamportClock(config.nodeId);
  const userColor = config.userColor ?? DEFAULT_COLORS[0]!;

  // Internal subjects
  const data$ = new BehaviorSubject<Record<string, unknown>>({});
  const version$ = new BehaviorSubject<number>(0);
  const collaborators$ = new BehaviorSubject<CollaboratorInfo[]>([]);
  const localChanges$ = new BehaviorSubject<number>(0);
  const lastSyncAt$ = new BehaviorSubject<number>(Date.now());
  const status$ = new BehaviorSubject<CollaborationStatus>('connected');
  const cursor$ = new BehaviorSubject<CursorPosition | null>(null);
  const selection$ = new BehaviorSubject<SelectionRange | null>(null);
  const peerCursors$ = new BehaviorSubject<
    { nodeId: NodeId; cursor: CursorPosition; user: { name: string; color: string } }[]
  >([]);

  // Undo / redo stacks
  const undoStack: Record<string, unknown>[] = [];
  const redoStack: Record<string, unknown>[] = [];
  const undoRedo$ = new BehaviorSubject<{ canUndo: boolean; canRedo: boolean }>({
    canUndo: false,
    canRedo: false,
  });

  const destroy$ = new Subject<void>();

  // Derived: collaborative document state
  const state$: Observable<CollaborativeDocState> = combineLatest([
    data$,
    version$,
    collaborators$,
    localChanges$,
    lastSyncAt$,
  ]).pipe(
    map(([data, version, collaborators, localChanges, lastSyncAt]) => ({
      documentId,
      data,
      version,
      collaborators,
      localChanges,
      lastSyncAt,
    }))
  );

  // Derived: presence state
  const localUser = { nodeId: config.nodeId, displayName: config.displayName, color: userColor };

  const presence$: Observable<PresenceState> = combineLatest([collaborators$, status$]).pipe(
    map(([collaborators, connectionStatus]) => ({
      peers: collaborators,
      localUser,
      connectionStatus,
      peerCount: collaborators.length,
    })),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
  );

  // Derived: cursors
  const cursors$ = peerCursors$.asObservable();

  // Derived: canUndo / canRedo
  const canUndo$ = undoRedo$.pipe(
    map((s) => s.canUndo),
    distinctUntilChanged()
  );
  const canRedo$ = undoRedo$.pipe(
    map((s) => s.canRedo),
    distinctUntilChanged()
  );

  // Helpers
  const updateUndoRedo = (): void => {
    undoRedo$.next({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
  };

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  /**
   * Apply a local change and push it onto the undo stack.
   */
  const applyLocalChange = (change: Record<string, unknown>): void => {
    clock.tick();
    const prev = { ...data$.getValue() };
    undoStack.push(prev);
    redoStack.length = 0;

    data$.next({ ...prev, ...change });
    version$.next(version$.getValue() + 1);
    localChanges$.next(localChanges$.getValue() + 1);
    updateUndoRedo();
  };

  /**
   * Update local cursor position.
   */
  const updateCursor = (cursorPos: CursorPosition): void => {
    cursor$.next(cursorPos);
  };

  /**
   * Update local selection.
   */
  const updateSelection = (sel: SelectionRange | null): void => {
    selection$.next(sel);
  };

  /**
   * Undo the last local change.
   */
  const undo = (): boolean => {
    const prev = undoStack.pop();
    if (!prev) return false;

    redoStack.push({ ...data$.getValue() });
    data$.next(prev);
    version$.next(version$.getValue() + 1);
    updateUndoRedo();
    return true;
  };

  /**
   * Redo the last undone change.
   */
  const redo = (): boolean => {
    const next = redoStack.pop();
    if (!next) return false;

    undoStack.push({ ...data$.getValue() });
    data$.next(next);
    version$.next(version$.getValue() + 1);
    updateUndoRedo();
    return true;
  };

  /**
   * Dispose the session and release all resources.
   */
  const dispose = (): void => {
    destroy$.next();
    destroy$.complete();
    data$.complete();
    version$.complete();
    collaborators$.complete();
    localChanges$.complete();
    lastSyncAt$.complete();
    status$.complete();
    cursor$.complete();
    selection$.complete();
    peerCursors$.complete();
    undoRedo$.complete();
  };

  return {
    documentId,
    state$,
    presence$,
    cursors$,
    applyLocalChange,
    updateCursor,
    updateSelection,
    undo,
    redo,
    canUndo$,
    canRedo$,
    dispose,
  };
}

// ---------------------------------------------------------------------------
// createPresenceTracker
// ---------------------------------------------------------------------------

/**
 * Create a lightweight presence tracker.
 *
 * Useful when you need to track peer cursors and selections without
 * a full collaborative editing session (e.g. a shared whiteboard or
 * awareness-only scenario).
 *
 * @param config - Hook configuration (node ID, display name, colour)
 * @returns A {@link PresenceTracker}
 *
 * @example
 * ```typescript
 * const tracker = createPresenceTracker({
 *   nodeId: 'user-2',
 *   displayName: 'Bob',
 *   userColor: '#4ECDC4',
 * });
 *
 * tracker.presence$.subscribe(p => {
 *   console.log('Online peers:', p.peerCount);
 * });
 *
 * tracker.addPeer({
 *   nodeId: 'user-3',
 *   displayName: 'Charlie',
 *   color: '#45B7D1',
 *   lastActiveAt: Date.now(),
 *   isOnline: true,
 * });
 *
 * tracker.updateCursor({ offset: 10 });
 * tracker.dispose();
 * ```
 */
export function createPresenceTracker(config: CollaborativeHooksConfig): PresenceTracker {
  const userColor = config.userColor ?? DEFAULT_COLORS[0]!;
  const localUser = { nodeId: config.nodeId, displayName: config.displayName, color: userColor };

  const peers$ = new BehaviorSubject<Map<NodeId, CollaboratorInfo>>(new Map());
  const status$ = new BehaviorSubject<CollaborationStatus>('connected');
  const cursor$ = new BehaviorSubject<CursorPosition | null>(null);
  const selection$ = new BehaviorSubject<SelectionRange | null>(null);

  const presence$: Observable<PresenceState> = combineLatest([peers$, status$]).pipe(
    map(([peersMap, connectionStatus]) => {
      const peerList = Array.from(peersMap.values()).filter((p) => p.isOnline);
      return {
        peers: peerList,
        localUser,
        connectionStatus,
        peerCount: peerList.length,
      };
    }),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
  );

  /**
   * Update the local cursor position.
   */
  const updateCursor = (cursorPos: CursorPosition): void => {
    cursor$.next(cursorPos);
  };

  /**
   * Update the local selection.
   */
  const updateSelection = (sel: SelectionRange | null): void => {
    selection$.next(sel);
  };

  /**
   * Register a new remote peer.
   */
  const addPeer = (peer: CollaboratorInfo): void => {
    const current = new Map(peers$.getValue());
    current.set(peer.nodeId, { ...peer, isOnline: true, lastActiveAt: Date.now() });
    peers$.next(current);
  };

  /**
   * Remove a remote peer by node ID.
   */
  const removePeer = (nodeId: NodeId): void => {
    const current = new Map(peers$.getValue());
    const existing = current.get(nodeId);
    if (existing) {
      current.set(nodeId, { ...existing, isOnline: false });
      peers$.next(current);
    }
  };

  /**
   * Dispose the tracker and release all resources.
   */
  const dispose = (): void => {
    peers$.complete();
    status$.complete();
    cursor$.complete();
    selection$.complete();
  };

  return {
    presence$,
    updateCursor,
    updateSelection,
    addPeer,
    removePeer,
    dispose,
  };
}
