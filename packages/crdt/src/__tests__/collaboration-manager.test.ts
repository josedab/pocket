import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CollaborationManager } from '../collaboration-manager.js';
import { firstValueFrom } from 'rxjs';
import type { CRDTOperation } from '../types.js';

function makeOp(overrides: Partial<CRDTOperation> & { id: string }): CRDTOperation {
  return {
    type: 'update',
    timestamp: { counter: 1, nodeId: 'node-1' },
    origin: 'node-1',
    ...overrides,
  };
}

describe('CollaborationManager', () => {
  let manager: CollaborationManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new CollaborationManager({
      nodeId: 'node-1',
      displayName: 'Alice',
      maxUndoHistory: 10,
      presenceIntervalMs: 5000,
    });
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  describe('lifecycle', () => {
    it('should start disconnected', async () => {
      const status = await firstValueFrom(manager.getStatus());
      expect(status).toBe('disconnected');
    });

    it('should transition to connected on start', async () => {
      manager.start();
      const status = await firstValueFrom(manager.getStatus());
      expect(status).toBe('connected');
    });

    it('should transition to disconnected on stop', async () => {
      manager.start();
      manager.stop();
      const status = await firstValueFrom(manager.getStatus());
      expect(status).toBe('disconnected');
    });
  });

  describe('collaborators', () => {
    it('should register self on start', async () => {
      manager.start();
      const collaborators = await firstValueFrom(manager.getCollaborators());
      expect(collaborators).toHaveLength(1);
      expect(collaborators[0]!.displayName).toBe('Alice');
      expect(collaborators[0]!.isOnline).toBe(true);
    });

    it('should handle remote joins', async () => {
      manager.start();
      manager.handleRemoteJoin({
        nodeId: 'node-2',
        displayName: 'Bob',
        color: '#FF0000',
        lastActiveAt: Date.now(),
        isOnline: true,
      });

      const collaborators = await firstValueFrom(manager.getCollaborators());
      expect(collaborators).toHaveLength(2);
    });

    it('should handle remote leaves', async () => {
      manager.start();
      manager.handleRemoteJoin({
        nodeId: 'node-2',
        displayName: 'Bob',
        color: '#FF0000',
        lastActiveAt: Date.now(),
        isOnline: true,
      });

      manager.handleRemoteLeave('node-2');

      const collaborators = await firstValueFrom(manager.getCollaborators());
      expect(collaborators).toHaveLength(1);
      expect(collaborators[0]!.nodeId).toBe('node-1');
    });

    it('should track collaborator count', async () => {
      manager.start();
      const count1 = await firstValueFrom(manager.getCollaboratorCount());
      expect(count1).toBe(1);

      manager.handleRemoteJoin({
        nodeId: 'node-2',
        displayName: 'Bob',
        color: '#FF0000',
        lastActiveAt: Date.now(),
        isOnline: true,
      });

      const count2 = await firstValueFrom(manager.getCollaboratorCount());
      expect(count2).toBe(2);
    });
  });

  describe('cursor tracking', () => {
    it('should update local cursor', async () => {
      manager.start();
      manager.updateCursor({
        documentId: 'doc-1',
        fieldPath: 'title',
        offset: 5,
      });

      const cursor = await firstValueFrom(
        manager.getCollaboratorCursor('node-1')
      );
      expect(cursor?.documentId).toBe('doc-1');
      expect(cursor?.offset).toBe(5);
    });
  });

  describe('undo/redo', () => {
    it('should start with no undo/redo available', async () => {
      const state = await firstValueFrom(manager.getUndoRedoState());
      expect(state.canUndo).toBe(false);
      expect(state.canRedo).toBe(false);
    });

    it('should enable undo after operation', async () => {
      manager.applyOperation(makeOp({ id: 'op-1' }));

      const state = await firstValueFrom(manager.getUndoRedoState());
      expect(state.canUndo).toBe(true);
      expect(state.canRedo).toBe(false);
    });

    it('should enable redo after undo', async () => {
      manager.applyOperation(makeOp({ id: 'op-1' }));
      manager.undo();

      const state = await firstValueFrom(manager.getUndoRedoState());
      expect(state.canUndo).toBe(false);
      expect(state.canRedo).toBe(true);
    });

    it('should clear redo stack on new operation', async () => {
      manager.applyOperation(makeOp({ id: 'op-1' }));
      manager.undo();

      manager.applyOperation(makeOp({
        id: 'op-2',
        timestamp: { counter: 2, nodeId: 'node-1' },
      }));

      const state = await firstValueFrom(manager.getUndoRedoState());
      expect(state.canUndo).toBe(true);
      expect(state.canRedo).toBe(false);
    });

    it('should respect max undo history', () => {
      for (let i = 0; i < 15; i++) {
        manager.applyOperation(makeOp({
          id: `op-${i}`,
          timestamp: { counter: i, nodeId: 'node-1' },
        }));
      }

      let undoCount = 0;
      while (manager.undo()) undoCount++;
      expect(undoCount).toBe(10); // maxUndoHistory = 10
    });
  });

  describe('operations', () => {
    it('should buffer operations', async () => {
      manager.applyOperation(makeOp({ id: 'op-1' }));

      const pending = await firstValueFrom(manager.getPendingOperations());
      expect(pending).toHaveLength(1);
    });

    it('should flush operations', () => {
      manager.applyOperation(makeOp({ id: 'op-1' }));
      manager.applyOperation(makeOp({
        id: 'op-2',
        timestamp: { counter: 2, nodeId: 'node-1' },
      }));

      const flushed = manager.flushOperations();
      expect(flushed).toHaveLength(2);
    });

    it('should emit events for operations', async () => {
      const eventPromise = firstValueFrom(manager.getEvents());

      manager.applyOperation(makeOp({ id: 'op-1' }));

      const event = await eventPromise;
      expect(event.type).toBe('operation-applied');
      expect(event.nodeId).toBe('node-1');
    });
  });
});
