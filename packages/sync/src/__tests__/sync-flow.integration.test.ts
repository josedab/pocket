import type { ChangeEvent, Document } from '@pocket/core';
import {
  ConflictResolver,
  detectConflict,
  type ConflictStrategy,
} from '../conflict.js';
import {
  OptimisticUpdateManager,
} from '../optimistic.js';
import {
  CheckpointManager,
} from '../checkpoint.js';
import {
  RollbackManager,
} from '../rollback.js';

interface TestDoc extends Document {
  _id: string;
  title: string;
  content: string;
}

function makeChangeEvent(
  operation: ChangeEvent<TestDoc>['operation'],
  doc: TestDoc | null,
  previousDoc?: TestDoc
): ChangeEvent<TestDoc> {
  return {
    operation,
    documentId: doc?._id ?? previousDoc?._id ?? 'unknown',
    document: doc,
    previousDocument: previousDoc,
    isFromSync: false,
    timestamp: Date.now(),
    sequence: 1,
  };
}

describe('Sync Flow Integration', () => {
  describe('ConflictResolver strategies', () => {
    const localDoc: TestDoc = {
      _id: 'doc-1',
      title: 'Local Title',
      content: 'Local Content',
      _updatedAt: 1000,
      _rev: '1-abc',
    };

    const remoteDoc: TestDoc = {
      _id: 'doc-1',
      title: 'Remote Title',
      content: 'Remote Content',
      _updatedAt: 2000,
      _rev: '1-def',
    };

    it('should resolve with server-wins strategy', () => {
      const resolver = new ConflictResolver<TestDoc>('server-wins');
      const result = resolver.resolve({
        documentId: 'doc-1',
        localDocument: localDoc,
        remoteDocument: remoteDoc,
        timestamp: Date.now(),
      });

      expect(result.winner).toBe('remote');
      expect(result.document).toBe(remoteDoc);
      expect(result.needsManualResolution).toBe(false);
    });

    it('should resolve with client-wins strategy', () => {
      const resolver = new ConflictResolver<TestDoc>('client-wins');
      const result = resolver.resolve({
        documentId: 'doc-1',
        localDocument: localDoc,
        remoteDocument: remoteDoc,
        timestamp: Date.now(),
      });

      expect(result.winner).toBe('local');
      expect(result.document).toBe(localDoc);
    });

    it('should resolve with last-write-wins strategy', () => {
      const resolver = new ConflictResolver<TestDoc>('last-write-wins');

      // Remote has a later _updatedAt
      const result = resolver.resolve({
        documentId: 'doc-1',
        localDocument: localDoc,
        remoteDocument: remoteDoc,
        timestamp: Date.now(),
      });

      expect(result.winner).toBe('remote');
      expect(result.document.title).toBe('Remote Title');
    });

    it('should resolve with last-write-wins favoring local when local is newer', () => {
      const resolver = new ConflictResolver<TestDoc>('last-write-wins');

      const newerLocal = { ...localDoc, _updatedAt: 3000 };
      const result = resolver.resolve({
        documentId: 'doc-1',
        localDocument: newerLocal,
        remoteDocument: remoteDoc,
        timestamp: Date.now(),
      });

      expect(result.winner).toBe('local');
      expect(result.document.title).toBe('Local Title');
    });

    it('should resolve with merge strategy using custom merge function', () => {
      const customMerge = (local: TestDoc, remote: TestDoc) => ({
        ...remote,
        title: local.title,
        content: remote.content,
      });

      const resolver = new ConflictResolver<TestDoc>('merge', customMerge);
      const result = resolver.resolve({
        documentId: 'doc-1',
        localDocument: localDoc,
        remoteDocument: remoteDoc,
        timestamp: Date.now(),
      });

      expect(result.winner).toBe('merged');
      expect(result.document.title).toBe('Local Title');
      expect(result.document.content).toBe('Remote Content');
    });
  });

  describe('detectConflict', () => {
    it('should not detect conflict for same revision', () => {
      const doc1: TestDoc = { _id: '1', title: 'A', content: 'B', _rev: '1-abc' };
      const doc2: TestDoc = { _id: '1', title: 'C', content: 'D', _rev: '1-abc' };

      expect(detectConflict(doc1, doc2)).toBe(false);
    });

    it('should detect conflict for same sequence different revision', () => {
      const doc1: TestDoc = { _id: '1', title: 'A', content: 'B', _rev: '1-abc' };
      const doc2: TestDoc = { _id: '1', title: 'C', content: 'D', _rev: '1-def' };

      expect(detectConflict(doc1, doc2)).toBe(true);
    });

    it('should detect conflict when one has rev and other does not', () => {
      const doc1: TestDoc = { _id: '1', title: 'A', content: 'B', _rev: '1-abc' };
      const doc2: TestDoc = { _id: '1', title: 'C', content: 'D' };

      expect(detectConflict(doc1, doc2)).toBe(true);
    });

    it('should not detect conflict when neither has revision', () => {
      const doc1: TestDoc = { _id: '1', title: 'A', content: 'B' };
      const doc2: TestDoc = { _id: '1', title: 'C', content: 'D' };

      expect(detectConflict(doc1, doc2)).toBe(false);
    });
  });

  describe('OptimisticUpdateManager', () => {
    let manager: OptimisticUpdateManager;

    beforeEach(() => {
      manager = new OptimisticUpdateManager('test_optimistic_' + Date.now());
    });

    it('should add and retrieve optimistic updates', () => {
      const doc: TestDoc = { _id: 'doc-1', title: 'Test', content: 'Content' };
      const change = makeChangeEvent('insert', doc);

      const id = manager.add('todos', change, null);

      expect(id).toBeDefined();
      expect(manager.count).toBe(1);
      expect(manager.hasPending).toBe(true);

      const retrieved = manager.get(id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.collection).toBe('todos');
    });

    it('should mark updates as synced and remove them', () => {
      const doc: TestDoc = { _id: 'doc-1', title: 'Test', content: 'Content' };
      const change = makeChangeEvent('insert', doc);

      const id = manager.add('todos', change, null);
      expect(manager.count).toBe(1);

      manager.markSynced(id);
      expect(manager.count).toBe(0);
      expect(manager.hasPending).toBe(false);
    });

    it('should mark updates as failed and track attempts', () => {
      const doc: TestDoc = { _id: 'doc-1', title: 'Test', content: 'Content' };
      const change = makeChangeEvent('insert', doc);

      const id = manager.add('todos', change, null);
      manager.markFailed(id, new Error('Network error'));

      const update = manager.get(id);
      expect(update!.attempts).toBe(1);
      expect(update!.lastError!.message).toBe('Network error');
    });

    it('should get pending sync updates respecting max attempts', () => {
      const doc: TestDoc = { _id: 'doc-1', title: 'Test', content: 'Content' };
      const change = makeChangeEvent('insert', doc);

      const id = manager.add('todos', change, null);

      // Fail it 5 times
      for (let i = 0; i < 5; i++) {
        manager.markFailed(id, new Error('fail'));
      }

      const pending = manager.getPendingSync(5);
      expect(pending).toHaveLength(0);

      const failed = manager.getFailedUpdates(5);
      expect(failed).toHaveLength(1);
    });

    it('should get updates for a specific collection', () => {
      const doc1: TestDoc = { _id: 'doc-1', title: 'A', content: 'A' };
      const doc2: TestDoc = { _id: 'doc-2', title: 'B', content: 'B' };

      manager.add('todos', makeChangeEvent('insert', doc1), null);
      manager.add('notes', makeChangeEvent('insert', doc2), null);

      const todoUpdates = manager.getForCollection('todos');
      expect(todoUpdates).toHaveLength(1);

      const noteUpdates = manager.getForCollection('notes');
      expect(noteUpdates).toHaveLength(1);
    });

    it('should get updates for a specific document', async () => {
      const doc: TestDoc = { _id: 'doc-1', title: 'Original', content: 'A' };
      const updatedDoc: TestDoc = { ...doc, title: 'Updated' };

      manager.add('todos', makeChangeEvent('insert', doc), null);
      // Small delay to ensure unique timestamp-based IDs
      await new Promise((r) => setTimeout(r, 5));
      manager.add('todos', makeChangeEvent('update', updatedDoc, doc), doc);

      const docUpdates = manager.getForDocument('todos', 'doc-1');
      expect(docUpdates).toHaveLength(2);
    });

    it('should clear all updates', () => {
      manager.add('todos', makeChangeEvent('insert', { _id: 'd1', title: 'A', content: 'A' }), null);
      manager.add('todos', makeChangeEvent('insert', { _id: 'd2', title: 'B', content: 'B' }), null);

      manager.clear();
      expect(manager.count).toBe(0);
    });
  });

  describe('CheckpointManager', () => {
    let checkpoint: CheckpointManager;
    let cpCounter = 0;

    beforeEach(() => {
      cpCounter++;
      checkpoint = new CheckpointManager('test-node-' + cpCounter, 'test_checkpoint_' + cpCounter + '_' + Date.now());
    });

    it('should initialize with empty sequences', () => {
      const cp = checkpoint.getCheckpoint();
      expect(cp.sequences).toEqual({});
      expect(cp.nodeId).toContain('test-node-');
    });

    it('should update and retrieve sequence numbers', () => {
      checkpoint.updateSequence('todos', 42);
      expect(checkpoint.getSequence('todos')).toBe(42);

      // Should not go backwards
      checkpoint.updateSequence('todos', 10);
      expect(checkpoint.getSequence('todos')).toBe(42);

      // Should advance forward
      checkpoint.updateSequence('todos', 100);
      expect(checkpoint.getSequence('todos')).toBe(100);
    });

    it('should track multiple collections independently', () => {
      checkpoint.updateSequence('todos', 42);
      checkpoint.updateSequence('notes', 15);

      expect(checkpoint.getSequence('todos')).toBe(42);
      expect(checkpoint.getSequence('notes')).toBe(15);
      expect(checkpoint.getSequence('unknown')).toBe(0);
    });

    it('should update from server checkpoint', () => {
      checkpoint.updateSequence('todos', 10);

      checkpoint.updateFromServer({
        sequences: {
          todos: 50,
          notes: 20,
        },
      });

      expect(checkpoint.getSequence('todos')).toBe(50);
      expect(checkpoint.getSequence('notes')).toBe(20);
    });

    it('should not regress from server checkpoint', () => {
      checkpoint.updateSequence('todos', 100);

      checkpoint.updateFromServer({
        sequences: { todos: 50 },
      });

      expect(checkpoint.getSequence('todos')).toBe(100);
    });

    it('should reset checkpoint', () => {
      checkpoint.updateSequence('todos', 42);
      checkpoint.reset();

      expect(checkpoint.getSequence('todos')).toBe(0);
      const cp = checkpoint.getCheckpoint();
      expect(cp.sequences).toEqual({});
    });
  });

  describe('conflict detection + resolution flow', () => {
    it('should detect conflict and resolve with chosen strategy', () => {
      const localDoc: TestDoc = {
        _id: 'doc-1',
        title: 'Edited locally',
        content: 'Local',
        _rev: '2-localrev',
        _updatedAt: 1000,
      };

      const remoteDoc: TestDoc = {
        _id: 'doc-1',
        title: 'Edited remotely',
        content: 'Remote',
        _rev: '2-remoterev',
        _updatedAt: 2000,
      };

      // Detect conflict
      const hasConflict = detectConflict(localDoc, remoteDoc);
      expect(hasConflict).toBe(true);

      // Resolve with last-write-wins
      const resolver = new ConflictResolver<TestDoc>('last-write-wins');
      const resolution = resolver.resolve({
        documentId: 'doc-1',
        localDocument: localDoc,
        remoteDocument: remoteDoc,
        timestamp: Date.now(),
      });

      expect(resolution.winner).toBe('remote');
      expect(resolution.document.title).toBe('Edited remotely');
    });
  });

  describe('optimistic update + rollback scenario', () => {
    it('should track optimistic updates and support rollback metadata', () => {
      const manager = new OptimisticUpdateManager('test_rollback_' + Date.now());

      const originalDoc: TestDoc = {
        _id: 'doc-1',
        title: 'Original',
        content: 'Original content',
      };

      const updatedDoc: TestDoc = {
        ...originalDoc,
        title: 'Optimistically Updated',
      };

      const change = makeChangeEvent('update', updatedDoc, originalDoc);
      const updateId = manager.add('todos', change, originalDoc);

      // Verify the update is tracked with previous document for rollback
      const update = manager.get(updateId);
      expect(update).toBeDefined();
      expect(update!.previousDocument).toEqual(originalDoc);
      expect(update!.change.document!.title).toBe('Optimistically Updated');

      // Simulate sync failure
      manager.markFailed(updateId, new Error('Server rejected'));

      const pendingUpdates = manager.getPendingSync();
      expect(pendingUpdates).toHaveLength(1);
      expect(pendingUpdates[0].attempts).toBe(1);

      // After rollback, mark as synced to remove
      manager.markSynced(updateId);
      expect(manager.count).toBe(0);
    });
  });
});
