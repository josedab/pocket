import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { createUndoRedoManager, UndoRedoManager } from '../undo-redo.js';
import type { UndoableOperation } from '../undo-redo.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeOp(overrides: Partial<UndoableOperation> = {}): UndoableOperation {
  return {
    type: overrides.type ?? 'update',
    collection: overrides.collection ?? 'todos',
    documentId: overrides.documentId ?? 'todo-1',
    before: overrides.before ?? { _id: 'todo-1', title: 'Old' },
    after: overrides.after ?? { _id: 'todo-1', title: 'New' },
    description: overrides.description ?? 'Update todo',
  };
}

/* ================================================================== */
/*  UndoRedoManager                                                    */
/* ================================================================== */

describe('UndoRedoManager', () => {
  let manager: UndoRedoManager;

  beforeEach(() => {
    manager = createUndoRedoManager({ maxDepth: 100 });
  });

  afterEach(() => {
    manager.destroy();
  });

  /* ---- Factory --------------------------------------------------- */

  describe('createUndoRedoManager', () => {
    it('should create an instance via factory function', () => {
      const m = createUndoRedoManager();
      expect(m).toBeInstanceOf(UndoRedoManager);
      m.destroy();
    });

    it('should accept configuration options', () => {
      const m = createUndoRedoManager({ maxDepth: 50 });
      expect(m).toBeInstanceOf(UndoRedoManager);
      m.destroy();
    });
  });

  /* ---- push ------------------------------------------------------ */

  describe('push', () => {
    it('should add an operation to the undo stack', () => {
      manager.push(makeOp());

      expect(manager.getCanUndo()).toBe(true);
      expect(manager.getUndoStack()).toHaveLength(1);
    });

    it('should clear the redo stack on a new push', () => {
      manager.push(makeOp({ description: 'op1' }));
      manager.undo();
      expect(manager.getCanRedo()).toBe(true);

      manager.push(makeOp({ description: 'op2' }));
      expect(manager.getCanRedo()).toBe(false);
      expect(manager.getRedoStack()).toHaveLength(0);
    });
  });

  /* ---- undo ------------------------------------------------------ */

  describe('undo', () => {
    it('should return the last operation (reverses)', () => {
      const op = makeOp({ description: 'rename' });
      manager.push(op);

      const entry = manager.undo();
      expect(entry).not.toBeNull();
      expect(entry!.operations[0]!.description).toBe('rename');
      expect(manager.getCanUndo()).toBe(false);
    });

    it('should return null on empty undo stack', () => {
      const entry = manager.undo();
      expect(entry).toBeNull();
    });

    it('should move the entry to the redo stack', () => {
      manager.push(makeOp());
      manager.undo();

      expect(manager.getCanRedo()).toBe(true);
      expect(manager.getRedoStack()).toHaveLength(1);
    });
  });

  /* ---- redo ------------------------------------------------------ */

  describe('redo', () => {
    it('should re-apply an undone operation', () => {
      manager.push(makeOp({ description: 'update' }));
      manager.undo();

      const entry = manager.redo();
      expect(entry).not.toBeNull();
      expect(entry!.operations[0]!.description).toBe('update');
      expect(manager.getCanUndo()).toBe(true);
      expect(manager.getCanRedo()).toBe(false);
    });

    it('should return null on empty redo stack', () => {
      const entry = manager.redo();
      expect(entry).toBeNull();
    });
  });

  /* ---- grouping -------------------------------------------------- */

  describe('beginGroup / endGroup', () => {
    it('should group operations as one undo unit', () => {
      manager.beginGroup('batch');
      manager.push(makeOp({ documentId: 'a' }));
      manager.push(makeOp({ documentId: 'b' }));
      manager.endGroup();

      expect(manager.getUndoStack()).toHaveLength(1);
      const entry = manager.peekUndo();
      expect(entry!.operations).toHaveLength(2);
      expect(entry!.description).toBe('batch');
    });

    it('should undo the entire group as one unit', () => {
      manager.beginGroup('batch');
      manager.push(makeOp({ documentId: 'a' }));
      manager.push(makeOp({ documentId: 'b' }));
      manager.endGroup();

      const entry = manager.undo();
      expect(entry!.operations).toHaveLength(2);
      expect(manager.getCanUndo()).toBe(false);
    });

    it('should throw if beginGroup is called while a group is in progress', () => {
      manager.beginGroup('first');
      expect(() => manager.beginGroup('second')).toThrow('already in progress');
    });

    it('should throw if endGroup is called without a group in progress', () => {
      expect(() => manager.endGroup()).toThrow('No group in progress');
    });

    it('should not push entry if group is empty', () => {
      manager.beginGroup('empty');
      manager.endGroup();

      expect(manager.getUndoStack()).toHaveLength(0);
    });
  });

  /* ---- canUndo$ observable --------------------------------------- */

  describe('canUndo$ observable', () => {
    it('should reflect state changes', async () => {
      let initial = await firstValueFrom(manager.canUndo.pipe(take(1)));
      expect(initial).toBe(false);

      manager.push(makeOp());
      const afterPush = await firstValueFrom(manager.canUndo.pipe(take(1)));
      expect(afterPush).toBe(true);

      manager.undo();
      const afterUndo = await firstValueFrom(manager.canUndo.pipe(take(1)));
      expect(afterUndo).toBe(false);
    });
  });

  /* ---- canRedo$ observable --------------------------------------- */

  describe('canRedo$ observable', () => {
    it('should reflect state changes', async () => {
      let initial = await firstValueFrom(manager.canRedo.pipe(take(1)));
      expect(initial).toBe(false);

      manager.push(makeOp());
      manager.undo();
      const afterUndo = await firstValueFrom(manager.canRedo.pipe(take(1)));
      expect(afterUndo).toBe(true);

      manager.redo();
      const afterRedo = await firstValueFrom(manager.canRedo.pipe(take(1)));
      expect(afterRedo).toBe(false);
    });
  });

  /* ---- getUndoStack / getRedoStack ------------------------------- */

  describe('getUndoStack / getRedoStack', () => {
    it('should return stack contents', () => {
      manager.push(makeOp({ description: 'op1' }));
      manager.push(makeOp({ description: 'op2' }));

      const undoStack = manager.getUndoStack();
      expect(undoStack).toHaveLength(2);
      expect(undoStack[0]!.description).toBe('op1');
      expect(undoStack[1]!.description).toBe('op2');
    });

    it('should return redo stack after undo', () => {
      manager.push(makeOp({ description: 'op1' }));
      manager.push(makeOp({ description: 'op2' }));
      manager.undo();

      const redoStack = manager.getRedoStack();
      expect(redoStack).toHaveLength(1);
      expect(redoStack[0]!.description).toBe('op2');
    });

    it('should return copies (not references) of stacks', () => {
      manager.push(makeOp());
      const stack1 = manager.getUndoStack();
      const stack2 = manager.getUndoStack();
      expect(stack1).not.toBe(stack2);
    });
  });

  /* ---- configurable max depth ------------------------------------ */

  describe('configurable max depth', () => {
    it('should enforce max depth on undo stack', () => {
      const smallManager = createUndoRedoManager({ maxDepth: 3 });

      for (let i = 0; i < 5; i++) {
        smallManager.push(makeOp({ description: `op-${i}` }));
      }

      const stack = smallManager.getUndoStack();
      expect(stack).toHaveLength(3);
      // Oldest entries should have been removed
      expect(stack[0]!.description).toBe('op-2');
      smallManager.destroy();
    });
  });

  /* ---- clear ----------------------------------------------------- */

  describe('clear', () => {
    it('should empty both stacks', () => {
      manager.push(makeOp());
      manager.push(makeOp());
      manager.undo();

      expect(manager.getUndoStack().length).toBeGreaterThan(0);
      expect(manager.getRedoStack().length).toBeGreaterThan(0);

      manager.clear();

      expect(manager.getUndoStack()).toHaveLength(0);
      expect(manager.getRedoStack()).toHaveLength(0);
      expect(manager.getCanUndo()).toBe(false);
      expect(manager.getCanRedo()).toBe(false);
    });
  });

  /* ---- destroy --------------------------------------------------- */

  describe('destroy', () => {
    it('should complete observables on destroy', async () => {
      const m = createUndoRedoManager();

      const stateComplete = new Promise<void>((resolve) => {
        m.state.subscribe({ complete: () => resolve() });
      });
      const canUndoComplete = new Promise<void>((resolve) => {
        m.canUndo.subscribe({ complete: () => resolve() });
      });
      const canRedoComplete = new Promise<void>((resolve) => {
        m.canRedo.subscribe({ complete: () => resolve() });
      });
      const eventsComplete = new Promise<void>((resolve) => {
        m.events.subscribe({ complete: () => resolve() });
      });

      m.destroy();

      await expect(stateComplete).resolves.toBeUndefined();
      await expect(canUndoComplete).resolves.toBeUndefined();
      await expect(canRedoComplete).resolves.toBeUndefined();
      await expect(eventsComplete).resolves.toBeUndefined();
    });
  });

  /* ---- Edge cases ------------------------------------------------ */

  describe('edge cases', () => {
    it('should handle undo on empty stack gracefully', () => {
      expect(manager.undo()).toBeNull();
    });

    it('should handle redo on empty stack gracefully', () => {
      expect(manager.redo()).toBeNull();
    });

    it('should handle multiple undo/redo cycles', () => {
      manager.push(makeOp({ description: 'op1' }));
      manager.push(makeOp({ description: 'op2' }));

      const u1 = manager.undo();
      expect(u1!.description).toBe('op2');
      const u2 = manager.undo();
      expect(u2!.description).toBe('op1');
      expect(manager.undo()).toBeNull();

      const r1 = manager.redo();
      expect(r1!.description).toBe('op1');
      const r2 = manager.redo();
      expect(r2!.description).toBe('op2');
      expect(manager.redo()).toBeNull();
    });
  });
});
