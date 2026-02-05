/**
 * CollaborationManager - Unified real-time collaboration coordinator.
 *
 * Combines CRDTs, presence awareness, and undo/redo into a single
 * high-level API for building collaborative features.
 */

import { BehaviorSubject, Subject, takeUntil, type Observable, map, distinctUntilChanged } from 'rxjs';
import type { NodeId, CRDTOperation } from './types.js';
import { LamportClock } from './clock.js';

export interface CollaborationConfig {
  /** Unique node identifier for this client */
  nodeId: NodeId;
  /** Display name for presence */
  displayName: string;
  /** Maximum undo history size */
  maxUndoHistory?: number;
  /** Presence heartbeat interval in ms */
  presenceIntervalMs?: number;
  /** Auto-save interval in ms (0 to disable) */
  autoSaveIntervalMs?: number;
  /** Color for user cursor/selection */
  userColor?: string;
}

export interface CollaboratorInfo {
  nodeId: NodeId;
  displayName: string;
  color: string;
  cursor?: CursorPosition;
  selection?: SelectionRange;
  lastActiveAt: number;
  isOnline: boolean;
}

export interface CursorPosition {
  /** Document/collection ID context */
  documentId?: string;
  /** Field path within document */
  fieldPath?: string;
  /** Character offset for text fields */
  offset?: number;
  /** Line number for multiline content */
  line?: number;
  /** Column number */
  column?: number;
}

export interface SelectionRange {
  start: CursorPosition;
  end: CursorPosition;
}

export interface UndoEntry {
  id: string;
  operations: CRDTOperation[];
  inverseOperations: CRDTOperation[];
  timestamp: number;
  description?: string;
}

export type CollaborationStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface CollaborationManagerEvent {
  type: 'collaborator-joined' | 'collaborator-left' | 'cursor-moved' | 'selection-changed' | 'operation-applied' | 'conflict-resolved' | 'undo' | 'redo';
  nodeId: NodeId;
  timestamp: number;
  data?: unknown;
}

const DEFAULT_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F0B27A', '#82E0AA',
];

export class CollaborationManager {
  private readonly config: Required<CollaborationConfig>;
  private readonly clock: LamportClock;
  private readonly destroy$ = new Subject<void>();
  private readonly status$ = new BehaviorSubject<CollaborationStatus>('disconnected');
  private readonly collaborators$ = new BehaviorSubject<Map<NodeId, CollaboratorInfo>>(new Map());
  private readonly events$ = new Subject<CollaborationManagerEvent>();
  private readonly pendingOperations$ = new BehaviorSubject<CRDTOperation[]>([]);

  private readonly undoStack: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];
  private readonly undoRedo$ = new BehaviorSubject<{ canUndo: boolean; canRedo: boolean }>({ canUndo: false, canRedo: false });

  private presenceInterval: ReturnType<typeof setInterval> | null = null;
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;
  private operationBuffer: CRDTOperation[] = [];
  private colorIndex = 0;

  constructor(config: CollaborationConfig) {
    this.config = {
      nodeId: config.nodeId,
      displayName: config.displayName,
      maxUndoHistory: config.maxUndoHistory ?? 100,
      presenceIntervalMs: config.presenceIntervalMs ?? 5_000,
      autoSaveIntervalMs: config.autoSaveIntervalMs ?? 0,
      userColor: config.userColor ?? this.assignColor(),
    };
    this.clock = new LamportClock(config.nodeId);
  }

  /**
   * Start the collaboration session.
   */
  start(): void {
    if (this.status$.getValue() !== 'disconnected') return;

    this.status$.next('connecting');

    // Register self as collaborator
    const self: CollaboratorInfo = {
      nodeId: this.config.nodeId,
      displayName: this.config.displayName,
      color: this.config.userColor,
      lastActiveAt: Date.now(),
      isOnline: true,
    };

    const collaborators = new Map(this.collaborators$.getValue());
    collaborators.set(this.config.nodeId, self);
    this.collaborators$.next(collaborators);

    // Start presence heartbeat
    this.presenceInterval = setInterval(() => {
      this.broadcastPresence();
    }, this.config.presenceIntervalMs);

    // Start auto-save if configured
    if (this.config.autoSaveIntervalMs > 0) {
      this.autoSaveInterval = setInterval(() => {
        this.flushOperations();
      }, this.config.autoSaveIntervalMs);
    }

    this.status$.next('connected');
  }

  /**
   * Stop the collaboration session.
   */
  stop(): void {
    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
      this.presenceInterval = null;
    }

    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    // Mark self as offline
    this.updateCollaborator(this.config.nodeId, { isOnline: false });
    this.status$.next('disconnected');
  }

  /**
   * Apply a local operation and track for undo.
   */
  applyOperation(operation: CRDTOperation, description?: string): void {
    this.clock.tick();
    this.operationBuffer.push(operation);

    // Create undo entry
    const inverseOp = this.createInverseOperation(operation);
    const entry: UndoEntry = {
      id: `undo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      operations: [operation],
      inverseOperations: inverseOp ? [inverseOp] : [],
      timestamp: Date.now(),
      description,
    };

    this.undoStack.push(entry);
    if (this.undoStack.length > this.config.maxUndoHistory) {
      this.undoStack.shift();
    }

    // Clear redo stack on new operation
    this.redoStack.length = 0;
    this.updateUndoRedoState();

    this.pendingOperations$.next([...this.operationBuffer]);

    this.emitEvent({
      type: 'operation-applied',
      nodeId: this.config.nodeId,
      timestamp: Date.now(),
      data: operation,
    });
  }

  /**
   * Undo the last operation.
   */
  undo(): UndoEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;

    this.redoStack.push(entry);

    for (const op of entry.inverseOperations) {
      this.operationBuffer.push(op);
    }

    this.pendingOperations$.next([...this.operationBuffer]);
    this.updateUndoRedoState();

    this.emitEvent({
      type: 'undo',
      nodeId: this.config.nodeId,
      timestamp: Date.now(),
      data: entry,
    });

    return entry;
  }

  /**
   * Redo the last undone operation.
   */
  redo(): UndoEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;

    this.undoStack.push(entry);

    for (const op of entry.operations) {
      this.operationBuffer.push(op);
    }

    this.pendingOperations$.next([...this.operationBuffer]);
    this.updateUndoRedoState();

    this.emitEvent({
      type: 'redo',
      nodeId: this.config.nodeId,
      timestamp: Date.now(),
      data: entry,
    });

    return entry;
  }

  /**
   * Update local cursor position and broadcast to collaborators.
   */
  updateCursor(cursor: CursorPosition): void {
    this.updateCollaborator(this.config.nodeId, { cursor });
    this.emitEvent({
      type: 'cursor-moved',
      nodeId: this.config.nodeId,
      timestamp: Date.now(),
      data: cursor,
    });
  }

  /**
   * Update local selection and broadcast.
   */
  updateSelection(selection: SelectionRange | undefined): void {
    this.updateCollaborator(this.config.nodeId, { selection });
    this.emitEvent({
      type: 'selection-changed',
      nodeId: this.config.nodeId,
      timestamp: Date.now(),
      data: selection,
    });
  }

  /**
   * Handle a remote collaborator joining.
   */
  handleRemoteJoin(info: CollaboratorInfo): void {
    const collaborators = new Map(this.collaborators$.getValue());
    const existing = collaborators.get(info.nodeId);

    collaborators.set(info.nodeId, {
      ...info,
      color: existing?.color ?? info.color ?? this.assignColor(),
      isOnline: true,
      lastActiveAt: Date.now(),
    });
    this.collaborators$.next(collaborators);

    this.emitEvent({
      type: 'collaborator-joined',
      nodeId: info.nodeId,
      timestamp: Date.now(),
      data: info,
    });
  }

  /**
   * Handle a remote collaborator leaving.
   */
  handleRemoteLeave(nodeId: NodeId): void {
    this.updateCollaborator(nodeId, { isOnline: false });
    this.emitEvent({
      type: 'collaborator-left',
      nodeId,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle remote operations from other collaborators.
   */
  handleRemoteOperations(nodeId: NodeId, operations: CRDTOperation[]): void {
    this.clock.tick();
    for (const op of operations) {
      this.emitEvent({
        type: 'operation-applied',
        nodeId,
        timestamp: Date.now(),
        data: op,
      });
    }
  }

  /**
   * Get observable of collaboration status.
   */
  getStatus(): Observable<CollaborationStatus> {
    return this.status$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get observable of active collaborators.
   */
  getCollaborators(): Observable<CollaboratorInfo[]> {
    return this.collaborators$.asObservable().pipe(
      map((m) => Array.from(m.values()).filter((c) => c.isOnline)),
      takeUntil(this.destroy$)
    );
  }

  /**
   * Get observable of a specific collaborator's cursor.
   */
  getCollaboratorCursor(nodeId: NodeId): Observable<CursorPosition | undefined> {
    return this.collaborators$.asObservable().pipe(
      map((m) => m.get(nodeId)?.cursor),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    );
  }

  /**
   * Get the collaborator count (online only).
   */
  getCollaboratorCount(): Observable<number> {
    return this.collaborators$.asObservable().pipe(
      map((m) => Array.from(m.values()).filter((c) => c.isOnline).length),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    );
  }

  /**
   * Get observable of collaboration events.
   */
  getEvents(): Observable<CollaborationManagerEvent> {
    return this.events$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get observable of undo/redo state.
   */
  getUndoRedoState(): Observable<{ canUndo: boolean; canRedo: boolean }> {
    return this.undoRedo$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get pending operations buffer.
   */
  getPendingOperations(): Observable<CRDTOperation[]> {
    return this.pendingOperations$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Flush buffered operations (marks them as sent).
   */
  flushOperations(): CRDTOperation[] {
    const ops = [...this.operationBuffer];
    this.operationBuffer = [];
    this.pendingOperations$.next([]);
    return ops;
  }

  /**
   * Get the current Lamport counter value.
   */
  getCurrentTimestamp(): number {
    return this.clock.getCounter();
  }

  /**
   * Destroy the collaboration manager and release all resources.
   */
  destroy(): void {
    this.stop();
    this.destroy$.next();
    this.destroy$.complete();
    this.status$.complete();
    this.collaborators$.complete();
    this.events$.complete();
    this.pendingOperations$.complete();
    this.undoRedo$.complete();
  }

  private broadcastPresence(): void {
    this.updateCollaborator(this.config.nodeId, {
      lastActiveAt: Date.now(),
      isOnline: true,
    });
  }

  private updateCollaborator(nodeId: NodeId, update: Partial<CollaboratorInfo>): void {
    const collaborators = new Map(this.collaborators$.getValue());
    const existing = collaborators.get(nodeId);
    if (existing) {
      collaborators.set(nodeId, { ...existing, ...update });
      this.collaborators$.next(collaborators);
    }
  }

  private emitEvent(event: CollaborationManagerEvent): void {
    this.events$.next(event);
  }

  private updateUndoRedoState(): void {
    this.undoRedo$.next({
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  private createInverseOperation(operation: CRDTOperation): CRDTOperation | null {
    switch (operation.type) {
      case 'insert':
        return { ...operation, type: 'delete' };
      case 'delete':
        return { ...operation, type: 'insert' };
      default:
        return null;
    }
  }

  private assignColor(): string {
    const color = DEFAULT_COLORS[this.colorIndex % DEFAULT_COLORS.length]!;
    this.colorIndex++;
    return color;
  }
}

export function createCollaborationManager(config: CollaborationConfig): CollaborationManager {
  return new CollaborationManager(config);
}
