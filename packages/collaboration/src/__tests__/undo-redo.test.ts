import { describe, it, expect, beforeEach } from 'vitest';
import { UndoRedoStack, createUndoRedoStack } from '../undo-redo.js';
import type { DocumentOperation } from '../types.js';

describe('UndoRedoStack', () => {
  let stack: UndoRedoStack;

  beforeEach(() => {
    stack = createUndoRedoStack({ maxDepth: 10, groupingWindowMs: 0 });
  });

  describe('push and undo', () => {
    it('should push operations onto the stack', () => {
      stack.push('doc-1', 'user-1', [{ type: 'set', path: 'title', value: 'Hello' }]);
      expect(stack.getState().canUndo).toBe(true);
      expect(stack.getState().undoCount).toBe(1);
    });

    it('should undo the last operation', () => {
      stack.push('doc-1', 'user-1', [{ type: 'set', path: 'title', value: 'Hello' }]);
      const entry = stack.undo();
      expect(entry).not.toBeNull();
      expect(entry!.operations[0]!.type).toBe('set');
      expect(entry!.inverseOperations[0]!.type).toBe('delete');
      expect(stack.getState().canUndo).toBe(false);
    });

    it('should return null when nothing to undo', () => {
      expect(stack.undo()).toBeNull();
    });
  });

  describe('redo', () => {
    it('should redo an undone operation', () => {
      stack.push('doc-1', 'user-1', [{ type: 'set', path: 'title', value: 'Hello' }]);
      stack.undo();
      expect(stack.getState().canRedo).toBe(true);

      const entry = stack.redo();
      expect(entry).not.toBeNull();
      expect(entry!.operations[0]!.value).toBe('Hello');
      expect(stack.getState().canUndo).toBe(true);
      expect(stack.getState().canRedo).toBe(false);
    });

    it('should return null when nothing to redo', () => {
      expect(stack.redo()).toBeNull();
    });

    it('should clear redo stack on new push', () => {
      stack.push('doc-1', 'user-1', [{ type: 'set', path: 'a', value: 1 }]);
      stack.undo();
      stack.push('doc-1', 'user-1', [{ type: 'set', path: 'b', value: 2 }]);
      expect(stack.getState().canRedo).toBe(false);
    });
  });

  describe('inverse operations', () => {
    it('should invert set to delete', () => {
      stack.push('d', 'u', [{ type: 'set', path: 'x', value: 1 }]);
      const entry = stack.undo()!;
      expect(entry.inverseOperations[0]!.type).toBe('delete');
    });

    it('should invert delete to set', () => {
      stack.push('d', 'u', [{ type: 'delete', path: 'x', value: 1 }]);
      const entry = stack.undo()!;
      expect(entry.inverseOperations[0]!.type).toBe('set');
    });

    it('should invert insert-text to delete-text', () => {
      stack.push('d', 'u', [{ type: 'insert-text', path: 'body', value: 'hello' }]);
      const entry = stack.undo()!;
      expect(entry.inverseOperations[0]!.type).toBe('delete-text');
    });
  });

  describe('max depth', () => {
    it('should enforce max depth', () => {
      for (let i = 0; i < 15; i++) {
        stack.push('doc', 'user', [{ type: 'set', path: `f${i}`, value: i }]);
      }
      expect(stack.getState().undoCount).toBeLessThanOrEqual(10);
    });
  });

  describe('operation grouping', () => {
    it('should group rapid edits within window', () => {
      const grouped = createUndoRedoStack({ groupingWindowMs: 500 });
      grouped.push('doc', 'user', [{ type: 'set', path: 'a', value: 1 }]);
      grouped.push('doc', 'user', [{ type: 'set', path: 'b', value: 2 }]);
      // Both should be in one entry since within 500ms
      expect(grouped.getState().undoCount).toBe(1);
    });

    it('should not group across different documents', () => {
      const grouped = createUndoRedoStack({ groupingWindowMs: 500 });
      grouped.push('doc-1', 'user', [{ type: 'set', path: 'a', value: 1 }]);
      grouped.push('doc-2', 'user', [{ type: 'set', path: 'b', value: 2 }]);
      expect(grouped.getState().undoCount).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all history', () => {
      stack.push('d', 'u', [{ type: 'set', path: 'x', value: 1 }]);
      stack.clear();
      expect(stack.getState().canUndo).toBe(false);
      expect(stack.getState().canRedo).toBe(false);
    });

    it('should clear document-specific history', () => {
      stack.push('doc-1', 'u', [{ type: 'set', path: 'a', value: 1 }]);
      stack.push('doc-2', 'u', [{ type: 'set', path: 'b', value: 2 }]);
      stack.clearDocument('doc-1');
      expect(stack.getState().undoCount).toBe(1);
    });
  });

  describe('state', () => {
    it('should report label from latest entry', () => {
      stack.push('d', 'u', [{ type: 'set', path: 'x', value: 1 }], 'Edit title');
      expect(stack.getState().currentLabel).toBe('Edit title');
    });
  });
});
