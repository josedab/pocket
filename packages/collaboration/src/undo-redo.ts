/**
 * Undo/redo stack for collaborative document editing.
 *
 * Provides a per-user undo/redo stack that integrates with
 * DocumentSyncManager version history, supporting both
 * local and collaborative undo operations.
 *
 * @module undo-redo
 */

import type { DocumentOperation } from './types.js';

/** An undo/redo entry */
export interface UndoEntry {
  readonly id: string;
  readonly documentId: string;
  readonly userId: string;
  readonly operations: readonly DocumentOperation[];
  readonly inverseOperations: readonly DocumentOperation[];
  readonly timestamp: number;
  readonly label?: string;
}

/** Undo/redo stack state */
export interface UndoRedoState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoCount: number;
  readonly redoCount: number;
  readonly currentLabel?: string;
}

/** Configuration */
export interface UndoRedoConfig {
  /** Maximum undo history depth (default: 100) */
  readonly maxDepth?: number;
  /** Group operations within this window into a single undo entry (default: 300ms) */
  readonly groupingWindowMs?: number;
}

/**
 * Per-user undo/redo stack for collaborative editing.
 *
 * @example
 * ```typescript
 * const stack = new UndoRedoStack({ maxDepth: 50 });
 *
 * // After applying an operation:
 * stack.push('doc-1', 'user-1', [
 *   { type: 'set', path: 'title', value: 'New Title' },
 * ]);
 *
 * // Undo
 * const undoOps = stack.undo();
 * if (undoOps) applyOperations(undoOps.inverseOperations);
 *
 * // Redo
 * const redoOps = stack.redo();
 * if (redoOps) applyOperations(redoOps.operations);
 * ```
 */
export class UndoRedoStack {
  private readonly config: Required<UndoRedoConfig>;
  private readonly undoStack: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];
  private lastPushTime = 0;

  constructor(config: UndoRedoConfig = {}) {
    this.config = {
      maxDepth: config.maxDepth ?? 100,
      groupingWindowMs: config.groupingWindowMs ?? 300,
    };
  }

  /** Push operations onto the undo stack */
  push(documentId: string, userId: string, operations: DocumentOperation[], label?: string): void {
    const now = Date.now();
    const inverseOps = operations.map((op) => this.invertOperation(op));

    // Group with previous entry if within grouping window
    if (this.undoStack.length > 0 && now - this.lastPushTime <= this.config.groupingWindowMs) {
      const last = this.undoStack[this.undoStack.length - 1]!;
      if (last.documentId === documentId && last.userId === userId) {
        // Merge into existing entry
        const merged: UndoEntry = {
          ...last,
          operations: [...last.operations, ...operations],
          inverseOperations: [...inverseOps, ...last.inverseOperations],
          timestamp: now,
        };
        this.undoStack[this.undoStack.length - 1] = merged;
        this.lastPushTime = now;
        // Clear redo on new edit
        this.redoStack.length = 0;
        return;
      }
    }

    const entry: UndoEntry = {
      id: `undo_${now}_${Math.random().toString(36).slice(2, 8)}`,
      documentId,
      userId,
      operations,
      inverseOperations: inverseOps,
      timestamp: now,
      label,
    };

    this.undoStack.push(entry);
    if (this.undoStack.length > this.config.maxDepth) {
      this.undoStack.shift();
    }

    // Clear redo on new edit
    this.redoStack.length = 0;
    this.lastPushTime = now;
  }

  /** Undo the most recent operation. Returns the entry to apply (use inverseOperations). */
  undo(): UndoEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return entry;
  }

  /** Redo the most recently undone operation. Returns the entry to apply (use operations). */
  redo(): UndoEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return entry;
  }

  /** Get current state */
  getState(): UndoRedoState {
    const lastUndo = this.undoStack[this.undoStack.length - 1];
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      currentLabel: lastUndo?.label,
    };
  }

  /** Clear all history */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  /** Clear history for a specific document */
  clearDocument(documentId: string): void {
    this.removeFromStack(this.undoStack, documentId);
    this.removeFromStack(this.redoStack, documentId);
  }

  // ── Private ──────────────────────────────────────────────────────────

  private invertOperation(op: DocumentOperation): DocumentOperation {
    switch (op.type) {
      case 'set':
        return { type: 'delete', path: op.path, value: op.value };
      case 'delete':
        return { type: 'set', path: op.path, value: op.value };
      case 'insert-text':
        return { type: 'delete-text', path: op.path, value: op.value };
      case 'delete-text':
        return { type: 'insert-text', path: op.path, value: op.value };
    }
  }

  private removeFromStack(stack: UndoEntry[], documentId: string): void {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.documentId === documentId) {
        stack.splice(i, 1);
      }
    }
  }
}

/** Factory function */
export function createUndoRedoStack(config?: UndoRedoConfig): UndoRedoStack {
  return new UndoRedoStack(config);
}
