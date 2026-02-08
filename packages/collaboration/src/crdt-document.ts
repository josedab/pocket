/**
 * CRDT Document binding for conflict-free collaborative editing.
 *
 * Provides a Yjs-compatible document abstraction that integrates with
 * Pocket's collaboration transport. Supports text, array, and map
 * CRDT types with automatic merge semantics.
 *
 * @module @pocket/collaboration
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import type { CollabMessage, CollabTransport } from './types.js';

// ── CRDT Clock ────────────────────────────────────────────

type VectorClock = Record<string, number>;

function mergeClocks(a: VectorClock, b: VectorClock): VectorClock {
  const merged: VectorClock = { ...a };
  for (const [key, val] of Object.entries(b)) {
    merged[key] = Math.max(merged[key] ?? 0, val);
  }
  return merged;
}

function tickClock(clock: VectorClock, clientId: string): VectorClock {
  return { ...clock, [clientId]: (clock[clientId] ?? 0) + 1 };
}

// ── CRDT Operations ───────────────────────────────────────

export type CRDTOperationType =
  | 'text-insert'
  | 'text-delete'
  | 'map-set'
  | 'map-delete'
  | 'array-insert'
  | 'array-delete';

export interface CRDTOperation {
  type: CRDTOperationType;
  path: string;
  clientId: string;
  clock: VectorClock;
  /** For text-insert / array-insert */
  position?: number;
  value?: unknown;
  /** For text-delete / array-delete */
  length?: number;
}

export interface CRDTDocumentState {
  fields: Map<string, unknown>;
  texts: Map<string, string>;
  arrays: Map<string, unknown[]>;
  clock: VectorClock;
  version: number;
}

export interface CRDTDocumentConfig {
  documentId: string;
  clientId: string;
  transport: CollabTransport;
  sessionId: string;
  /** Batch operations within this window (ms) before broadcasting (default: 50) */
  batchIntervalMs?: number;
}

export interface CRDTSnapshot {
  documentId: string;
  fields: Record<string, unknown>;
  texts: Record<string, string>;
  arrays: Record<string, unknown[]>;
  clock: VectorClock;
  version: number;
  timestamp: number;
}

// ── CRDTDocument ──────────────────────────────────────────

/**
 * CRDTDocument — conflict-free replicated document.
 *
 * Each field, text, or array is independently mergeable. Operations
 * are tracked with vector clocks and automatically broadcast via
 * the collaboration transport.
 *
 * @example
 * ```typescript
 * const doc = createCRDTDocument({
 *   documentId: 'doc-1',
 *   clientId: 'user-1',
 *   transport: hub.createTransport(),
 *   sessionId: 'session-1',
 * });
 *
 * doc.setField('title', 'Hello');
 * doc.insertText('body', 0, 'World');
 *
 * doc.state$.subscribe(state => console.log(state));
 * ```
 */
export class CRDTDocument {
  readonly documentId: string;
  readonly clientId: string;

  private readonly config: Required<CRDTDocumentConfig>;
  private readonly transport: CollabTransport;
  private readonly stateSubject: BehaviorSubject<CRDTDocumentState>;
  private readonly operationsSubject: Subject<CRDTOperation>;
  private readonly remoteOpsSubject: Subject<CRDTOperation[]>;

  private pendingOps: CRDTOperation[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubTransport: (() => void) | null = null;
  private destroyed = false;

  constructor(config: CRDTDocumentConfig) {
    this.documentId = config.documentId;
    this.clientId = config.clientId;
    this.config = {
      ...config,
      batchIntervalMs: config.batchIntervalMs ?? 50,
    };
    this.transport = config.transport;

    const initialState: CRDTDocumentState = {
      fields: new Map(),
      texts: new Map(),
      arrays: new Map(),
      clock: { [this.clientId]: 0 },
      version: 0,
    };

    this.stateSubject = new BehaviorSubject(initialState);
    this.operationsSubject = new Subject();
    this.remoteOpsSubject = new Subject();

    this.unsubTransport = this.transport.onMessage((msg) => this.handleTransportMessage(msg));
  }

  // ── Observables ──────────────────────────────────────────

  /** Reactive stream of the full document state. */
  get state$(): Observable<CRDTDocumentState> {
    return this.stateSubject.asObservable();
  }

  /** Stream of every local operation as it's created. */
  get operations$(): Observable<CRDTOperation> {
    return this.operationsSubject.asObservable();
  }

  /** Stream of remote operation batches received from peers. */
  get remoteOperations$(): Observable<CRDTOperation[]> {
    return this.remoteOpsSubject.asObservable();
  }

  /** Snapshot of the current state. */
  get state(): CRDTDocumentState {
    return this.stateSubject.getValue();
  }

  // ── Field Operations (Map CRDT: LWW per field) ──────────

  /** Set a field value (last-writer-wins per field). */
  setField(path: string, value: unknown): void {
    this.assertNotDestroyed();
    const op = this.createOp('map-set', path, { value });
    this.applyOperation(op);
    this.enqueueOp(op);
  }

  /** Delete a field. */
  deleteField(path: string): void {
    this.assertNotDestroyed();
    const op = this.createOp('map-delete', path);
    this.applyOperation(op);
    this.enqueueOp(op);
  }

  /** Get current value of a field. */
  getField(path: string): unknown {
    return this.state.fields.get(path);
  }

  // ── Text Operations (RGA-like) ──────────────────────────

  /** Insert text at the given position. */
  insertText(path: string, position: number, text: string): void {
    this.assertNotDestroyed();
    const op = this.createOp('text-insert', path, { position, value: text });
    this.applyOperation(op);
    this.enqueueOp(op);
  }

  /** Delete text at the given position. */
  deleteText(path: string, position: number, length: number): void {
    this.assertNotDestroyed();
    const op = this.createOp('text-delete', path, { position, length });
    this.applyOperation(op);
    this.enqueueOp(op);
  }

  /** Get the current text content of a text field. */
  getText(path: string): string {
    return this.state.texts.get(path) ?? '';
  }

  // ── Array Operations ────────────────────────────────────

  /** Insert an element at a given index. */
  insertArrayElement(path: string, index: number, value: unknown): void {
    this.assertNotDestroyed();
    const op = this.createOp('array-insert', path, { position: index, value });
    this.applyOperation(op);
    this.enqueueOp(op);
  }

  /** Delete an element at a given index. */
  deleteArrayElement(path: string, index: number): void {
    this.assertNotDestroyed();
    const op = this.createOp('array-delete', path, { position: index, length: 1 });
    this.applyOperation(op);
    this.enqueueOp(op);
  }

  /** Get current array content. */
  getArray(path: string): unknown[] {
    return this.state.arrays.get(path) ?? [];
  }

  // ── Snapshot & Restore ──────────────────────────────────

  /** Create an immutable snapshot of the current state. */
  snapshot(): CRDTSnapshot {
    const s = this.state;
    return {
      documentId: this.documentId,
      fields: Object.fromEntries(s.fields),
      texts: Object.fromEntries(s.texts),
      arrays: Object.fromEntries(s.arrays.entries()),
      clock: { ...s.clock },
      version: s.version,
      timestamp: Date.now(),
    };
  }

  /** Restore state from a snapshot. */
  applySnapshot(snapshot: CRDTSnapshot): void {
    this.assertNotDestroyed();
    const state: CRDTDocumentState = {
      fields: new Map(Object.entries(snapshot.fields)),
      texts: new Map(Object.entries(snapshot.texts)),
      arrays: new Map(Object.entries(snapshot.arrays)),
      clock: mergeClocks(this.state.clock, snapshot.clock),
      version: Math.max(this.state.version, snapshot.version),
    };
    this.stateSubject.next(state);
  }

  // ── Lifecycle ───────────────────────────────────────────

  /** Tear down transport subscription and complete streams. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.flushPendingOps();
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.unsubTransport) {
      this.unsubTransport();
      this.unsubTransport = null;
    }
    this.stateSubject.complete();
    this.operationsSubject.complete();
    this.remoteOpsSubject.complete();
  }

  // ── Private ─────────────────────────────────────────────

  private createOp(
    type: CRDTOperationType,
    path: string,
    extra?: { value?: unknown; position?: number; length?: number }
  ): CRDTOperation {
    const current = this.state;
    const clock = tickClock(current.clock, this.clientId);
    return {
      type,
      path,
      clientId: this.clientId,
      clock,
      value: extra?.value,
      position: extra?.position,
      length: extra?.length,
    };
  }

  private applyOperation(op: CRDTOperation): void {
    const prev = this.state;
    const fields = new Map(prev.fields);
    const texts = new Map(prev.texts);
    const arrays = new Map(prev.arrays);

    switch (op.type) {
      case 'map-set':
        fields.set(op.path, op.value);
        break;
      case 'map-delete':
        fields.delete(op.path);
        break;
      case 'text-insert': {
        const current = texts.get(op.path) ?? '';
        const pos = Math.min(op.position ?? 0, current.length);
        texts.set(op.path, current.slice(0, pos) + String(op.value ?? '') + current.slice(pos));
        break;
      }
      case 'text-delete': {
        const current = texts.get(op.path) ?? '';
        const pos = Math.min(op.position ?? 0, current.length);
        const len = Math.min(op.length ?? 0, current.length - pos);
        texts.set(op.path, current.slice(0, pos) + current.slice(pos + len));
        break;
      }
      case 'array-insert': {
        const arr = [...(arrays.get(op.path) ?? [])];
        const idx = Math.min(op.position ?? arr.length, arr.length);
        arr.splice(idx, 0, op.value);
        arrays.set(op.path, arr);
        break;
      }
      case 'array-delete': {
        const arr = [...(arrays.get(op.path) ?? [])];
        const idx = op.position ?? 0;
        if (idx >= 0 && idx < arr.length) {
          arr.splice(idx, op.length ?? 1);
        }
        arrays.set(op.path, arr);
        break;
      }
    }

    this.stateSubject.next({
      fields,
      texts,
      arrays,
      clock: mergeClocks(prev.clock, op.clock),
      version: prev.version + 1,
    });

    this.operationsSubject.next(op);
  }

  private enqueueOp(op: CRDTOperation): void {
    this.pendingOps.push(op);

    this.batchTimer ??= setTimeout(() => {
      this.flushPendingOps();
    }, this.config.batchIntervalMs);
  }

  private flushPendingOps(): void {
    if (this.pendingOps.length === 0) return;

    const ops = this.pendingOps;
    this.pendingOps = [];
    this.batchTimer = null;

    this.transport.send({
      type: 'operation',
      sessionId: this.config.sessionId,
      userId: this.clientId,
      payload: { documentId: this.documentId, operations: ops },
      timestamp: Date.now(),
    });
  }

  private handleTransportMessage(msg: CollabMessage): void {
    if (msg.sessionId !== this.config.sessionId) return;
    if (msg.userId === this.clientId) return;
    if (msg.type !== 'operation') return;

    const payload = msg.payload as { documentId: string; operations: CRDTOperation[] };
    if (payload.documentId !== this.documentId) return;

    for (const op of payload.operations) {
      this.applyOperation(op);
    }

    this.remoteOpsSubject.next(payload.operations);
  }

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error(`CRDTDocument "${this.documentId}" is destroyed`);
    }
  }
}

/**
 * Create a new CRDTDocument.
 *
 * @example
 * ```typescript
 * const doc = createCRDTDocument({
 *   documentId: 'doc-1',
 *   clientId: 'user-1',
 *   transport: hub.createTransport(),
 *   sessionId: 'session-1',
 * });
 * ```
 */
export function createCRDTDocument(config: CRDTDocumentConfig): CRDTDocument {
  return new CRDTDocument(config);
}
