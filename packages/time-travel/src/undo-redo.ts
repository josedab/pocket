/**
 * Undo/Redo Manager - Undo and redo stack with operation grouping and branching
 *
 * @module undo-redo
 *
 * @example
 * ```typescript
 * import { createUndoRedoManager } from '@pocket/time-travel';
 *
 * const manager = createUndoRedoManager({ maxDepth: 100 });
 *
 * // Push individual operations
 * manager.push({
 *   type: 'update',
 *   collection: 'todos',
 *   documentId: 'todo-1',
 *   before: { id: 'todo-1', title: 'Old' },
 *   after: { id: 'todo-1', title: 'New' },
 *   description: 'Rename todo',
 * });
 *
 * // Group multiple operations into a single undo unit
 * manager.beginGroup('Batch update');
 * manager.push({ type: 'update', collection: 'todos', documentId: 'todo-1', before: v1, after: v2 });
 * manager.push({ type: 'update', collection: 'todos', documentId: 'todo-2', before: v3, after: v4 });
 * manager.endGroup();
 *
 * // Undo / redo
 * const undone = manager.undo(); // returns the operations to revert
 * const redone = manager.redo(); // returns the operations to re-apply
 *
 * // Observe state
 * manager.canUndo$.subscribe(can => console.log('canUndo', can));
 * manager.canRedo$.subscribe(can => console.log('canRedo', can));
 *
 * manager.destroy();
 * ```
 */

import type { Document } from '@pocket/core';
import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import type { OperationType } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single undoable operation */
export interface UndoableOperation<T extends Document = Document> {
  /** CRUD operation type */
  type: OperationType;
  /** Collection the operation targets */
  collection: string;
  /** Document ID */
  documentId: string;
  /** State before the operation (null for create) */
  before: T | null;
  /** State after the operation (null for delete) */
  after: T | null;
  /** Human-readable description of this operation */
  description?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/** A unit that sits on the undo/redo stack */
export interface UndoEntry {
  /** Unique entry ID */
  id: string;
  /** Operations in this undo unit */
  operations: UndoableOperation[];
  /** Timestamp when the entry was recorded */
  timestamp: number;
  /** Human-readable name of this undo unit */
  description?: string;
}

/** Configuration for the undo/redo manager */
export interface UndoRedoConfig {
  /** Maximum depth of the undo stack (default: 100) */
  maxDepth?: number;
}

/** Observable state exposed by the undo/redo manager */
export interface UndoRedoState {
  /** Number of entries on the undo stack */
  undoSize: number;
  /** Number of entries on the redo stack */
  redoSize: number;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
}

/** Event types emitted by the manager */
export type UndoRedoEventType =
  | 'push'
  | 'undo'
  | 'redo'
  | 'clear'
  | 'group_begin'
  | 'group_end';

/** Undo/redo event */
export interface UndoRedoEvent {
  type: UndoRedoEventType;
  timestamp: number;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ---------------------------------------------------------------------------
// UndoRedoManager
// ---------------------------------------------------------------------------

/**
 * Manages undo/redo stacks with configurable depth, operation grouping,
 * named operations, and observable state.
 *
 * @example
 * ```typescript
 * const manager = new UndoRedoManager({ maxDepth: 50 });
 *
 * manager.push({
 *   type: 'create',
 *   collection: 'notes',
 *   documentId: 'n1',
 *   before: null,
 *   after: { id: 'n1', text: 'Hello' },
 *   description: 'Create note',
 * });
 *
 * const ops = manager.undo();
 * console.log(ops); // operations to revert
 *
 * manager.destroy();
 * ```
 */
export class UndoRedoManager {
  private readonly maxDepth: number;
  private readonly undoStack: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];

  private groupOperations: UndoableOperation[] | null = null;
  private groupDescription: string | undefined;

  private readonly state$ = new BehaviorSubject<UndoRedoState>({
    undoSize: 0,
    redoSize: 0,
    canUndo: false,
    canRedo: false,
  });

  private readonly canUndo$ = new BehaviorSubject<boolean>(false);
  private readonly canRedo$ = new BehaviorSubject<boolean>(false);
  private readonly events$ = new Subject<UndoRedoEvent>();

  constructor(config: UndoRedoConfig = {}) {
    this.maxDepth = config.maxDepth ?? 100;
  }

  // ---- Push -------------------------------------------------------------

  /**
   * Push an undoable operation onto the stack. If a group is open the
   * operation is accumulated; otherwise it becomes its own undo unit.
   */
  push(operation: UndoableOperation): void {
    if (this.groupOperations) {
      this.groupOperations.push(operation);
      return;
    }

    const entry: UndoEntry = {
      id: generateId(),
      operations: [operation],
      timestamp: Date.now(),
      description: operation.description,
    };

    this.pushEntry(entry);
  }

  // ---- Grouping ---------------------------------------------------------

  /**
   * Begin an operation group. All operations pushed while a group is open
   * will be batched into a single undo unit.
   */
  beginGroup(description?: string): void {
    if (this.groupOperations) {
      throw new Error('A group is already in progress');
    }

    this.groupOperations = [];
    this.groupDescription = description;
    this.emitEvent('group_begin', { description });
  }

  /**
   * End the current operation group, committing the batched operations as
   * a single undo entry.
   */
  endGroup(): void {
    if (!this.groupOperations) {
      throw new Error('No group in progress');
    }

    if (this.groupOperations.length > 0) {
      const entry: UndoEntry = {
        id: generateId(),
        operations: [...this.groupOperations],
        timestamp: Date.now(),
        description: this.groupDescription,
      };

      this.pushEntry(entry);
    }

    this.groupOperations = null;
    this.groupDescription = undefined;
    this.emitEvent('group_end');
  }

  /**
   * Check whether a group is currently in progress.
   */
  isGrouping(): boolean {
    return this.groupOperations !== null;
  }

  // ---- Undo / Redo ------------------------------------------------------

  /**
   * Undo the most recent entry. Returns the operations that should be
   * reverted (each operation's `before` is the target state).
   */
  undo(): UndoEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;

    this.redoStack.push(entry);
    this.updateState();
    this.emitEvent('undo', { entryId: entry.id });

    return entry;
  }

  /**
   * Redo the most recently undone entry. Returns the operations that should
   * be re-applied (each operation's `after` is the target state).
   */
  redo(): UndoEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;

    this.undoStack.push(entry);
    this.updateState();
    this.emitEvent('redo', { entryId: entry.id });

    return entry;
  }

  // ---- Query helpers ----------------------------------------------------

  /**
   * Whether undo is possible.
   */
  getCanUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Whether redo is possible.
   */
  getCanRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Get the current undo stack (most recent last).
   */
  getUndoStack(): UndoEntry[] {
    return [...this.undoStack];
  }

  /**
   * Get the current redo stack (most recent last).
   */
  getRedoStack(): UndoEntry[] {
    return [...this.redoStack];
  }

  /**
   * Peek at the next entry that would be undone.
   */
  peekUndo(): UndoEntry | null {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1]! : null;
  }

  /**
   * Peek at the next entry that would be redone.
   */
  peekRedo(): UndoEntry | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1]! : null;
  }

  /**
   * Clear both stacks.
   */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.groupOperations = null;
    this.groupDescription = undefined;
    this.updateState();
    this.emitEvent('clear');
  }

  // ---- Observables ------------------------------------------------------

  /**
   * Observable that emits the current state whenever it changes.
   */
  get state(): Observable<UndoRedoState> {
    return this.state$.asObservable();
  }

  /**
   * Get current state snapshot.
   */
  getCurrentState(): UndoRedoState {
    return this.state$.value;
  }

  /**
   * Observable that emits whether undo is available.
   */
  get canUndo(): Observable<boolean> {
    return this.canUndo$.asObservable();
  }

  /**
   * Observable that emits whether redo is available.
   */
  get canRedo(): Observable<boolean> {
    return this.canRedo$.asObservable();
  }

  /**
   * Get events observable.
   */
  get events(): Observable<UndoRedoEvent> {
    return this.events$.asObservable();
  }

  // ---- Lifecycle --------------------------------------------------------

  /**
   * Clean up subscriptions and internal state.
   */
  destroy(): void {
    this.state$.complete();
    this.canUndo$.complete();
    this.canRedo$.complete();
    this.events$.complete();
  }

  // ---- Private ----------------------------------------------------------

  private pushEntry(entry: UndoEntry): void {
    this.undoStack.push(entry);

    // New change invalidates the redo branch
    this.redoStack.length = 0;

    // Enforce max depth
    while (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }

    this.updateState();
    this.emitEvent('push', { entryId: entry.id });
  }

  private updateState(): void {
    const canUndo = this.undoStack.length > 0;
    const canRedo = this.redoStack.length > 0;

    this.state$.next({
      undoSize: this.undoStack.length,
      redoSize: this.redoStack.length,
      canUndo,
      canRedo,
    });

    this.canUndo$.next(canUndo);
    this.canRedo$.next(canRedo);
  }

  private emitEvent(type: UndoRedoEventType, data?: unknown): void {
    this.events$.next({ type, timestamp: Date.now(), data });
  }
}

/**
 * Create an undo/redo manager instance
 *
 * @example
 * ```typescript
 * const manager = createUndoRedoManager({ maxDepth: 200 });
 * ```
 */
export function createUndoRedoManager(config?: UndoRedoConfig): UndoRedoManager {
  return new UndoRedoManager(config);
}
