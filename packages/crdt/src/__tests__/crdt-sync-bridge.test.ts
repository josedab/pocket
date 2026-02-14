import { describe, expect, it } from 'vitest';
import type { CRDTSyncOperation } from '../crdt-sync-bridge.js';
import { createCRDTSyncBridge } from '../crdt-sync-bridge.js';
import type { MergeResult } from '../types.js';

describe('createCRDTSyncBridge', () => {
  it('should process local writes and generate operations', () => {
    const bridge = createCRDTSyncBridge({
      nodeId: 'node-a',
      collections: ['todos'],
    });

    const ops = bridge.processLocalWrite('todos', 'todo-1', {
      title: 'Buy milk',
      completed: false,
    });

    expect(ops).toHaveLength(2);
    expect(ops[0].collection).toBe('todos');
    expect(ops[0].documentId).toBe('todo-1');
    expect(ops[0].operation.path).toEqual(['title']);
    expect(ops[0].operation.value).toBe('Buy milk');
    bridge.destroy();
  });

  it('should retrieve document after local write', () => {
    const bridge = createCRDTSyncBridge({
      nodeId: 'node-a',
      collections: ['todos'],
    });

    bridge.processLocalWrite('todos', 'todo-1', { title: 'Test', done: false });
    const doc = bridge.getDocument('todos', 'todo-1');

    expect(doc).not.toBeNull();
    expect(doc!.title).toBe('Test');
    expect(doc!.done).toBe(false);
    bridge.destroy();
  });

  it('should apply remote operations without conflict', () => {
    const bridgeA = createCRDTSyncBridge({ nodeId: 'node-a', collections: ['todos'] });
    const bridgeB = createCRDTSyncBridge({ nodeId: 'node-b', collections: ['todos'] });

    // Node A writes
    const opsA = bridgeA.processLocalWrite('todos', 'todo-1', { title: 'Original' });

    // Node B applies A's operations
    const results = bridgeB.applyRemoteOperations(opsA);

    expect(results).toHaveLength(1);
    expect(results[0].hadConflict).toBe(false);

    const docB = bridgeB.getDocument('todos', 'todo-1');
    expect(docB!.title).toBe('Original');

    bridgeA.destroy();
    bridgeB.destroy();
  });

  it('should handle concurrent writes with CRDT conflict resolution', () => {
    const bridgeA = createCRDTSyncBridge({ nodeId: 'node-a', collections: ['todos'] });
    const bridgeB = createCRDTSyncBridge({ nodeId: 'node-b', collections: ['todos'] });

    // Both nodes write the same field concurrently
    const opsA = bridgeA.processLocalWrite('todos', 'todo-1', { title: 'Title A' });
    const opsB = bridgeB.processLocalWrite('todos', 'todo-1', { title: 'Title B' });

    // Cross-apply
    bridgeA.applyRemoteOperations(opsB);
    bridgeB.applyRemoteOperations(opsA);

    // Both should converge to the same value
    const docA = bridgeA.getDocument('todos', 'todo-1');
    const docB = bridgeB.getDocument('todos', 'todo-1');
    expect(docA!.title).toBe(docB!.title);

    bridgeA.destroy();
    bridgeB.destroy();
  });

  it('should handle field-level concurrent edits (no conflict)', () => {
    const bridgeA = createCRDTSyncBridge({ nodeId: 'node-a', collections: ['todos'] });
    const bridgeB = createCRDTSyncBridge({ nodeId: 'node-b', collections: ['todos'] });

    // Setup: both have the same initial document
    const initOps = bridgeA.processLocalWrite('todos', 'todo-1', {
      title: 'Task',
      completed: false,
    });
    bridgeB.applyRemoteOperations(initOps);

    // A edits title, B edits completed — no conflict
    const opsA = bridgeA.processLocalWrite('todos', 'todo-1', { title: 'Updated Task' });
    const opsB = bridgeB.processLocalWrite('todos', 'todo-1', { completed: true });

    bridgeA.applyRemoteOperations(opsB);
    bridgeB.applyRemoteOperations(opsA);

    const docA = bridgeA.getDocument('todos', 'todo-1');
    const docB = bridgeB.getDocument('todos', 'todo-1');

    expect(docA!.title).toBe('Updated Task');
    expect(docA!.completed).toBe(true);
    expect(docB!.title).toBe('Updated Task');
    expect(docB!.completed).toBe(true);

    bridgeA.destroy();
    bridgeB.destroy();
  });

  it('should track pending operations', () => {
    const bridge = createCRDTSyncBridge({ nodeId: 'node-a', collections: ['todos'] });

    bridge.processLocalWrite('todos', 'todo-1', { title: 'Test' });
    expect(bridge.getPendingOperations()).toHaveLength(1);

    const opId = bridge.getPendingOperations()[0].operation.id;
    bridge.acknowledgeOperations([opId]);
    expect(bridge.getPendingOperations()).toHaveLength(0);

    bridge.destroy();
  });

  it('should process local deletes', () => {
    const bridge = createCRDTSyncBridge({ nodeId: 'node-a', collections: ['todos'] });

    bridge.processLocalWrite('todos', 'todo-1', { title: 'Test', note: 'remove me' });

    // Delete specific field
    const ops = bridge.processLocalDelete('todos', 'todo-1', [['note']]);
    expect(ops).toHaveLength(1);

    const doc = bridge.getDocument('todos', 'todo-1');
    expect(doc!.note).toBeUndefined();
    expect(doc!.title).toBe('Test');

    bridge.destroy();
  });

  it('should tombstone entire document on delete without fields', () => {
    const bridge = createCRDTSyncBridge({ nodeId: 'node-a', collections: ['todos'] });

    bridge.processLocalWrite('todos', 'todo-1', { title: 'Test' });
    bridge.processLocalDelete('todos', 'todo-1');

    const doc = bridge.getDocument('todos', 'todo-1');
    expect(doc).toBeNull();

    bridge.destroy();
  });

  it('should run garbage collection', () => {
    const bridge = createCRDTSyncBridge({
      nodeId: 'node-a',
      collections: ['todos'],
      compactionThreshold: 3,
    });

    // Generate many operations to trigger compaction
    for (let i = 0; i < 5; i++) {
      bridge.processLocalWrite('todos', 'todo-1', { [`field${i}`]: i });
    }

    const result = bridge.runGarbageCollection();
    expect(result.compactedDocuments).toBeGreaterThanOrEqual(1);

    // Document should still be readable after GC
    const doc = bridge.getDocument('todos', 'todo-1');
    expect(doc).not.toBeNull();
    bridge.destroy();
  });

  it('should provide accurate stats', () => {
    const bridge = createCRDTSyncBridge({ nodeId: 'node-a', collections: ['todos', 'notes'] });

    bridge.processLocalWrite('todos', 'todo-1', { title: 'T1' });
    bridge.processLocalWrite('todos', 'todo-2', { title: 'T2' });
    bridge.processLocalWrite('notes', 'note-1', { text: 'N1' });

    const stats = bridge.getStats();
    expect(stats.totalDocuments).toBe(3);
    expect(stats.pendingOperations).toBe(3);
    expect(stats.collections).toContain('todos');
    expect(stats.collections).toContain('notes');

    bridge.destroy();
  });

  it('should emit changes via observable', () => {
    const bridge = createCRDTSyncBridge({ nodeId: 'node-a', collections: ['todos'] });
    const changes: CRDTSyncOperation[] = [];
    bridge.changes$.subscribe((op) => changes.push(op));

    bridge.processLocalWrite('todos', 'todo-1', { title: 'Test' });

    expect(changes).toHaveLength(1);
    expect(changes[0].collection).toBe('todos');
    bridge.destroy();
  });

  it('should emit merge results on remote apply', () => {
    const bridgeA = createCRDTSyncBridge({ nodeId: 'node-a', collections: ['todos'] });
    const bridgeB = createCRDTSyncBridge({ nodeId: 'node-b', collections: ['todos'] });
    const results: MergeResult[] = [];
    bridgeB.mergeResults$.subscribe((r) => results.push(r));

    const ops = bridgeA.processLocalWrite('todos', 'todo-1', { title: 'From A' });
    bridgeB.applyRemoteOperations(ops);

    expect(results).toHaveLength(1);
    expect(results[0].hadConflict).toBe(false);

    bridgeA.destroy();
    bridgeB.destroy();
  });
});
