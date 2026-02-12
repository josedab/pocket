/**
 * Collaborative Canvas Engine — conflict-free multiplayer drawing surface.
 *
 * Provides a CRDT-backed canvas where multiple users can simultaneously
 * add, move, and edit shapes with live cursor presence. Uses operation-based
 * CRDTs for conflict-free merge and integrates with Pocket's collaboration
 * transport layer.
 *
 * @module @pocket/collaboration
 */

import {
  BehaviorSubject,
  Subject,
  type Observable,
  throttleTime,
} from 'rxjs';
import type { CollabTransport, CollabMessage, CollabUser } from './types.js';

// ── Canvas Types ──────────────────────────────────────────

export type ShapeType = 'rectangle' | 'ellipse' | 'line' | 'path' | 'text' | 'image' | 'group';

export interface Point {
  x: number;
  y: number;
}

export interface CanvasShape {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** SVG path data for freehand drawings */
  pathData?: string;
  /** Text content for text shapes */
  text?: string;
  /** Image source URL */
  src?: string;
  /** Child shape IDs for groups */
  children?: string[];
  style: ShapeStyle;
  /** ID of the user who created this shape */
  createdBy: string;
  /** Lamport timestamp for ordering */
  lamport: number;
  locked: boolean;
}

export interface ShapeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  fontSize?: number;
  fontFamily?: string;
}

export interface CanvasCursor {
  userId: string;
  userName: string;
  color: string;
  position: Point;
  /** Shape ID if the user is currently hovering/selecting */
  targetShapeId?: string;
  tool: CanvasTool;
  timestamp: number;
}

export type CanvasTool = 'select' | 'rectangle' | 'ellipse' | 'line' | 'pen' | 'text' | 'eraser' | 'hand';

export type CanvasOperationType =
  | 'shape-add'
  | 'shape-update'
  | 'shape-delete'
  | 'shape-move'
  | 'shape-reorder'
  | 'shape-lock'
  | 'shape-unlock';

export interface CanvasOperation {
  id: string;
  type: CanvasOperationType;
  shapeId: string;
  userId: string;
  lamport: number;
  timestamp: number;
  data?: Partial<CanvasShape>;
  /** Target z-index for reorder operations */
  zIndex?: number;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasEngineConfig {
  sessionId: string;
  user: CollabUser;
  transport: CollabTransport;
  /** Maximum shapes on canvas (default: 10000) */
  maxShapes?: number;
  /** Cursor broadcast throttle in ms (default: 33 ~30fps) */
  cursorThrottleMs?: number;
  /** Enable undo/redo history (default: true) */
  enableHistory?: boolean;
  /** Maximum undo stack size (default: 100) */
  maxHistorySize?: number;
}

export interface CanvasSnapshot {
  shapes: CanvasShape[];
  zOrder: string[];
  lamport: number;
  timestamp: number;
}

export interface CanvasEvent {
  type: 'shape-added' | 'shape-updated' | 'shape-deleted' | 'cursor-moved'
    | 'selection-changed' | 'history-changed' | 'snapshot-restored';
  userId: string;
  shapeId?: string;
  timestamp: number;
}

// ── Default Style ─────────────────────────────────────────

/** Default shape style applied when no style is specified */
export const DEFAULT_CANVAS_STYLE: ShapeStyle = {
  fill: '#4ECDC4',
  stroke: '#2C3E50',
  strokeWidth: 2,
  opacity: 1,
};

// ── Canvas Engine ─────────────────────────────────────────

/**
 * Real-time collaborative canvas with CRDT-backed shape operations.
 *
 * Supports multiple concurrent users drawing, moving, and editing shapes
 * with automatic conflict resolution via Lamport timestamps and
 * last-writer-wins semantics per shape property.
 */
export class CanvasEngine {
  readonly sessionId: string;
  readonly user: CollabUser;

  private readonly config: Required<CanvasEngineConfig>;
  private readonly transport: CollabTransport;

  private readonly shapesSubject: BehaviorSubject<Map<string, CanvasShape>>;
  private readonly zOrderSubject: BehaviorSubject<string[]>;
  private readonly cursorsSubject: BehaviorSubject<Map<string, CanvasCursor>>;
  private readonly selectionSubject: BehaviorSubject<Set<string>>;
  private readonly eventsSubject: Subject<CanvasEvent>;
  private readonly cursorOutSubject: Subject<CanvasCursor>;

  private readonly undoStack: CanvasOperation[][] = [];
  private readonly redoStack: CanvasOperation[][] = [];

  private lamport = 0;
  private unsubTransport: (() => void) | null = null;
  private disposed = false;

  constructor(config: CanvasEngineConfig) {
    this.sessionId = config.sessionId;
    this.user = config.user;
    this.config = {
      sessionId: config.sessionId,
      user: config.user,
      transport: config.transport,
      maxShapes: config.maxShapes ?? 10000,
      cursorThrottleMs: config.cursorThrottleMs ?? 33,
      enableHistory: config.enableHistory ?? true,
      maxHistorySize: config.maxHistorySize ?? 100,
    };
    this.transport = config.transport;

    this.shapesSubject = new BehaviorSubject<Map<string, CanvasShape>>(new Map());
    this.zOrderSubject = new BehaviorSubject<string[]>([]);
    this.cursorsSubject = new BehaviorSubject<Map<string, CanvasCursor>>(new Map());
    this.selectionSubject = new BehaviorSubject<Set<string>>(new Set());
    this.eventsSubject = new Subject();
    this.cursorOutSubject = new Subject();

    this.cursorOutSubject
      .pipe(throttleTime(this.config.cursorThrottleMs))
      .subscribe((cursor) => {
        this.sendMessage('cursor', cursor);
      });
  }

  // ── Observables ───────────────────────────────────────

  /** All shapes on the canvas */
  get shapes$(): Observable<Map<string, CanvasShape>> {
    return this.shapesSubject.asObservable();
  }

  /** Shape rendering order (back to front) */
  get zOrder$(): Observable<string[]> {
    return this.zOrderSubject.asObservable();
  }

  /** Remote user cursors */
  get cursors$(): Observable<Map<string, CanvasCursor>> {
    return this.cursorsSubject.asObservable();
  }

  /** Currently selected shape IDs */
  get selection$(): Observable<Set<string>> {
    return this.selectionSubject.asObservable();
  }

  /** Canvas events stream */
  get events$(): Observable<CanvasEvent> {
    return this.eventsSubject.asObservable();
  }

  /** Whether undo is available */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Whether redo is available */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ── Lifecycle ─────────────────────────────────────────

  /** Connect to the collaboration session and start syncing */
  async connect(): Promise<void> {
    if (this.disposed) throw new Error('CanvasEngine is disposed');

    this.unsubTransport = this.transport.onMessage((msg) => {
      this.handleMessage(msg);
    });
    await this.transport.connect();

    // Request initial state
    this.sendMessage('sync', { type: 'request-snapshot' });
  }

  /** Disconnect and clean up */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.unsubTransport?.();
    this.transport.disconnect();

    this.shapesSubject.complete();
    this.zOrderSubject.complete();
    this.cursorsSubject.complete();
    this.selectionSubject.complete();
    this.eventsSubject.complete();
    this.cursorOutSubject.complete();
  }

  // ── Shape Operations ──────────────────────────────────

  /** Add a new shape to the canvas */
  addShape(shape: Omit<CanvasShape, 'id' | 'createdBy' | 'lamport' | 'locked'>): CanvasShape {
    this.assertNotDisposed();

    const shapes = this.shapesSubject.getValue();
    if (shapes.size >= this.config.maxShapes) {
      throw new Error(`Maximum shape limit (${this.config.maxShapes}) reached`);
    }

    this.lamport++;
    const fullShape: CanvasShape = {
      ...shape,
      id: generateId(),
      createdBy: this.user.id,
      lamport: this.lamport,
      locked: false,
    };

    const op: CanvasOperation = {
      id: generateId(),
      type: 'shape-add',
      shapeId: fullShape.id,
      userId: this.user.id,
      lamport: this.lamport,
      timestamp: Date.now(),
      data: fullShape,
    };

    this.applyOperation(op);
    this.sendMessage('operation', op);
    this.pushToHistory([op]);

    return fullShape;
  }

  /** Update properties of an existing shape */
  updateShape(shapeId: string, updates: Partial<Pick<CanvasShape, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'style' | 'text' | 'pathData'>>): void {
    this.assertNotDisposed();

    const shape = this.shapesSubject.getValue().get(shapeId);
    if (!shape) throw new Error(`Shape ${shapeId} not found`);
    if (shape.locked && shape.createdBy !== this.user.id) {
      throw new Error(`Shape ${shapeId} is locked`);
    }

    this.lamport++;
    const op: CanvasOperation = {
      id: generateId(),
      type: 'shape-update',
      shapeId,
      userId: this.user.id,
      lamport: this.lamport,
      timestamp: Date.now(),
      data: updates,
    };

    this.applyOperation(op);
    this.sendMessage('operation', op);
    this.pushToHistory([op]);
  }

  /** Move a shape to a new position */
  moveShape(shapeId: string, x: number, y: number): void {
    this.updateShape(shapeId, { x, y });
  }

  /** Delete a shape from the canvas */
  deleteShape(shapeId: string): void {
    this.assertNotDisposed();

    const shape = this.shapesSubject.getValue().get(shapeId);
    if (!shape) return;

    this.lamport++;
    const op: CanvasOperation = {
      id: generateId(),
      type: 'shape-delete',
      shapeId,
      userId: this.user.id,
      lamport: this.lamport,
      timestamp: Date.now(),
      data: shape, // store for undo
    };

    this.applyOperation(op);
    this.sendMessage('operation', op);
    this.pushToHistory([op]);
  }

  /** Lock a shape to prevent edits by others */
  lockShape(shapeId: string): void {
    this.assertNotDisposed();
    this.lamport++;
    const op: CanvasOperation = {
      id: generateId(),
      type: 'shape-lock',
      shapeId,
      userId: this.user.id,
      lamport: this.lamport,
      timestamp: Date.now(),
    };
    this.applyOperation(op);
    this.sendMessage('operation', op);
  }

  /** Unlock a shape */
  unlockShape(shapeId: string): void {
    this.assertNotDisposed();
    this.lamport++;
    const op: CanvasOperation = {
      id: generateId(),
      type: 'shape-unlock',
      shapeId,
      userId: this.user.id,
      lamport: this.lamport,
      timestamp: Date.now(),
    };
    this.applyOperation(op);
    this.sendMessage('operation', op);
  }

  /** Reorder a shape to a specific z-index */
  reorderShape(shapeId: string, zIndex: number): void {
    this.assertNotDisposed();
    this.lamport++;
    const op: CanvasOperation = {
      id: generateId(),
      type: 'shape-reorder',
      shapeId,
      userId: this.user.id,
      lamport: this.lamport,
      timestamp: Date.now(),
      zIndex,
    };
    this.applyOperation(op);
    this.sendMessage('operation', op);
  }

  // ── Selection ─────────────────────────────────────────

  /** Select one or more shapes */
  select(shapeIds: string[]): void {
    this.selectionSubject.next(new Set(shapeIds));
    this.emitEvent('selection-changed', undefined);
  }

  /** Clear selection */
  clearSelection(): void {
    this.selectionSubject.next(new Set());
    this.emitEvent('selection-changed', undefined);
  }

  /** Get shapes within a rectangular region */
  getShapesInRegion(topLeft: Point, bottomRight: Point): CanvasShape[] {
    const shapes = this.shapesSubject.getValue();
    return Array.from(shapes.values()).filter((s) =>
      s.x >= topLeft.x && s.y >= topLeft.y &&
      s.x + s.width <= bottomRight.x && s.y + s.height <= bottomRight.y
    );
  }

  // ── Cursor ────────────────────────────────────────────

  /** Update the local user's cursor position */
  updateCursor(position: Point, tool: CanvasTool = 'select', targetShapeId?: string): void {
    if (this.disposed) return;

    const cursor: CanvasCursor = {
      userId: this.user.id,
      userName: this.user.name,
      color: this.user.color ?? '#4ECDC4',
      position,
      tool,
      targetShapeId,
      timestamp: Date.now(),
    };
    this.cursorOutSubject.next(cursor);
  }

  // ── History (Undo/Redo) ───────────────────────────────

  /** Undo the last operation batch */
  undo(): void {
    if (!this.config.enableHistory || this.undoStack.length === 0) return;

    const batch = this.undoStack.pop()!;
    const inverseBatch = batch.map((op) => this.invertOperation(op)).reverse();

    for (const op of inverseBatch) {
      this.applyOperation(op);
      this.sendMessage('operation', op);
    }
    this.redoStack.push(batch);
    this.emitEvent('history-changed', undefined);
  }

  /** Redo the last undone operation batch */
  redo(): void {
    if (!this.config.enableHistory || this.redoStack.length === 0) return;

    const batch = this.redoStack.pop()!;
    for (const op of batch) {
      this.applyOperation(op);
      this.sendMessage('operation', op);
    }
    this.undoStack.push(batch);
    this.emitEvent('history-changed', undefined);
  }

  // ── Snapshot ──────────────────────────────────────────

  /** Export current canvas state */
  toSnapshot(): CanvasSnapshot {
    return {
      shapes: Array.from(this.shapesSubject.getValue().values()),
      zOrder: [...this.zOrderSubject.getValue()],
      lamport: this.lamport,
      timestamp: Date.now(),
    };
  }

  /** Restore canvas from a snapshot */
  fromSnapshot(snapshot: CanvasSnapshot): void {
    const shapesMap = new Map<string, CanvasShape>();
    for (const shape of snapshot.shapes) {
      shapesMap.set(shape.id, shape);
    }
    this.shapesSubject.next(shapesMap);
    this.zOrderSubject.next(snapshot.zOrder);
    this.lamport = Math.max(this.lamport, snapshot.lamport);
    this.emitEvent('snapshot-restored', undefined);
  }

  // ── Internals ─────────────────────────────────────────

  private applyOperation(op: CanvasOperation): void {
    const shapes = new Map(this.shapesSubject.getValue());
    const zOrder = [...this.zOrderSubject.getValue()];

    this.lamport = Math.max(this.lamport, op.lamport);

    switch (op.type) {
      case 'shape-add': {
        if (op.data && 'id' in op.data) {
          shapes.set(op.shapeId, op.data as CanvasShape);
          zOrder.push(op.shapeId);
          this.emitEvent('shape-added', op.shapeId);
        }
        break;
      }
      case 'shape-update': {
        const existing = shapes.get(op.shapeId);
        if (existing && op.data) {
          // Last-writer-wins per Lamport timestamp
          if (op.lamport >= existing.lamport) {
            shapes.set(op.shapeId, { ...existing, ...op.data, lamport: op.lamport });
            this.emitEvent('shape-updated', op.shapeId);
          }
        }
        break;
      }
      case 'shape-move': {
        const existing = shapes.get(op.shapeId);
        if (existing && op.data && op.lamport >= existing.lamport) {
          shapes.set(op.shapeId, {
            ...existing,
            x: op.data.x ?? existing.x,
            y: op.data.y ?? existing.y,
            lamport: op.lamport,
          });
          this.emitEvent('shape-updated', op.shapeId);
        }
        break;
      }
      case 'shape-delete': {
        shapes.delete(op.shapeId);
        const idx = zOrder.indexOf(op.shapeId);
        if (idx >= 0) zOrder.splice(idx, 1);
        this.emitEvent('shape-deleted', op.shapeId);
        break;
      }
      case 'shape-lock':
      case 'shape-unlock': {
        const existing = shapes.get(op.shapeId);
        if (existing) {
          shapes.set(op.shapeId, { ...existing, locked: op.type === 'shape-lock' });
        }
        break;
      }
      case 'shape-reorder': {
        const idx = zOrder.indexOf(op.shapeId);
        if (idx >= 0 && op.zIndex !== undefined) {
          zOrder.splice(idx, 1);
          zOrder.splice(Math.min(op.zIndex, zOrder.length), 0, op.shapeId);
        }
        break;
      }
    }

    this.shapesSubject.next(shapes);
    this.zOrderSubject.next(zOrder);
  }

  private invertOperation(op: CanvasOperation): CanvasOperation {
    const shapes = this.shapesSubject.getValue();

    switch (op.type) {
      case 'shape-add':
        return { ...op, type: 'shape-delete' };
      case 'shape-delete':
        return { ...op, type: 'shape-add' };
      case 'shape-update': {
        const current = shapes.get(op.shapeId);
        return { ...op, data: current ? { ...current } : op.data };
      }
      default:
        return op;
    }
  }

  private handleMessage(msg: CollabMessage): void {
    if (msg.userId === this.user.id) return;
    if (msg.sessionId !== this.sessionId) return;

    const payload = msg.payload as Record<string, unknown>;

    switch (msg.type) {
      case 'operation':
        this.applyOperation(payload as unknown as CanvasOperation);
        break;
      case 'cursor': {
        const cursor = payload as unknown as CanvasCursor;
        const cursors = new Map(this.cursorsSubject.getValue());
        cursors.set(cursor.userId, cursor);
        this.cursorsSubject.next(cursors);
        this.emitEvent('cursor-moved', undefined);
        break;
      }
      case 'sync': {
        if (payload['type'] === 'request-snapshot') {
          this.sendMessage('sync', {
            type: 'snapshot-response',
            snapshot: this.toSnapshot(),
          });
        } else if (payload['type'] === 'snapshot-response') {
          const snapshot = payload['snapshot'] as CanvasSnapshot | undefined;
          if (snapshot) this.fromSnapshot(snapshot);
        }
        break;
      }
    }
  }

  private sendMessage(type: CollabMessage['type'], payload: unknown): void {
    this.transport.send({
      type,
      sessionId: this.sessionId,
      userId: this.user.id,
      payload,
      timestamp: Date.now(),
    });
  }

  private pushToHistory(ops: CanvasOperation[]): void {
    if (!this.config.enableHistory) return;

    this.undoStack.push(ops);
    this.redoStack.length = 0;

    if (this.undoStack.length > this.config.maxHistorySize) {
      this.undoStack.shift();
    }
    this.emitEvent('history-changed', undefined);
  }

  private emitEvent(type: CanvasEvent['type'], shapeId: string | undefined): void {
    this.eventsSubject.next({
      type,
      userId: this.user.id,
      shapeId,
      timestamp: Date.now(),
    });
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('CanvasEngine is disposed');
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create a new collaborative canvas engine */
export function createCanvasEngine(config: CanvasEngineConfig): CanvasEngine {
  return new CanvasEngine(config);
}

// ── Helpers ───────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
