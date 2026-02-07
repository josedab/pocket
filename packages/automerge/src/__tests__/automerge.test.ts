import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCrdtDocument,
  applyCrdtChanges,
  createSyncSession,
  mergeSyncMessages,
  createAutomergeSyncAdapter,
  createMergeResolver,
} from '../index.js';
import type { CrdtDocument, MergeConflict } from '../types.js';

describe('@pocket/automerge', () => {
  describe('createCrdtDocument', () => {
    it('should create a document with initial state', () => {
      const doc = createCrdtDocument({ title: 'Hello', count: 0 }, 'actor-1');
      const state = doc.getState();

      expect(state.value).toEqual({ title: 'Hello', count: 0 });
      expect(state.actorId).toBe('actor-1');
      expect(state.clock).toBe(0);
      expect(state.changes).toHaveLength(0);
    });

    it('should apply local changes and track them', () => {
      const doc = createCrdtDocument({ title: 'Hello', count: 0 }, 'actor-1');

      const change = doc.change((draft) => {
        (draft as Record<string, unknown>).title = 'World';
      });

      expect(change.actorId).toBe('actor-1');
      expect(change.seq).toBe(1);
      expect(change.operations.length).toBeGreaterThan(0);

      const state = doc.getState();
      expect(state.value.title).toBe('World');
      expect(state.changes).toHaveLength(1);
    });

    it('should track multiple sequential changes', () => {
      const doc = createCrdtDocument({ title: '', count: 0 }, 'actor-1');

      doc.change((d) => { (d as Record<string, unknown>).title = 'First'; });
      doc.change((d) => { (d as Record<string, unknown>).title = 'Second'; });
      doc.change((d) => { (d as Record<string, unknown>).count = 5; });

      const state = doc.getState();
      expect(state.value.title).toBe('Second');
      expect(state.value.count).toBe(5);
      expect(state.changes).toHaveLength(3);
      expect(state.clock).toBe(3);
    });

    it('should throw when changing a destroyed document', () => {
      const doc = createCrdtDocument({ x: 1 }, 'a');
      doc.destroy();

      expect(() => doc.change((d) => { (d as Record<string, unknown>).x = 2; })).toThrow('destroyed');
    });
  });

  describe('sync between two documents', () => {
    let docA: CrdtDocument<{ title: string; count: number }>;
    let docB: CrdtDocument<{ title: string; count: number }>;

    beforeEach(() => {
      docA = createCrdtDocument({ title: 'Init', count: 0 }, 'actor-a');
      docB = createCrdtDocument({ title: 'Init', count: 0 }, 'actor-b');
    });

    it('should sync changes from A to B', () => {
      docA.change((d) => { (d as Record<string, unknown>).title = 'From A'; });

      const msg = docA.generateSyncMessage(docB.getState().heads);
      expect(msg).not.toBeNull();

      const result = docB.receiveSyncMessage(msg!);
      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(1);
      expect(docB.getState().value.title).toBe('From A');
    });

    it('should handle bidirectional sync', () => {
      docA.change((d) => { (d as Record<string, unknown>).title = 'From A'; });
      docB.change((d) => { (d as Record<string, unknown>).count = 42; });

      // Sync A -> B
      const msgAtoB = docA.generateSyncMessage(docB.getState().heads);
      if (msgAtoB) docB.receiveSyncMessage(msgAtoB);

      // Sync B -> A
      const msgBtoA = docB.generateSyncMessage(docA.getState().heads);
      if (msgBtoA) docA.receiveSyncMessage(msgBtoA);

      expect(docA.getState().value.title).toBe('From A');
      expect(docB.getState().value.title).toBe('From A');
      expect(docA.getState().value.count).toBe(42);
      expect(docB.getState().value.count).toBe(42);
    });

    it('should return null when no changes to sync', () => {
      const msg = docA.generateSyncMessage(docA.getState().heads);
      expect(msg).toBeNull();
    });
  });

  describe('applyCrdtChanges', () => {
    it('should apply external changes to a document', () => {
      const docA = createCrdtDocument({ value: 1 }, 'a');
      const docB = createCrdtDocument({ value: 1 }, 'b');

      docA.change((d) => { (d as Record<string, unknown>).value = 99; });

      const result = applyCrdtChanges(docB, docA.getState().changes);
      expect(result.success).toBe(true);
      expect(docB.getState().value.value).toBe(99);
    });
  });

  describe('createSyncSession', () => {
    it('should manage peers and generate messages', () => {
      const doc = createCrdtDocument({ x: 1 }, 'local');
      const session = createSyncSession('doc-1', doc);

      session.addPeer('remote-1');
      session.addPeer('remote-2');

      expect(session.getPeerStates()).toHaveLength(2);
      expect(session.documentId).toBe('doc-1');

      // No changes yet, but first sync sends full state
      doc.change((d) => { (d as Record<string, unknown>).x = 2; });
      const msg = session.generateMessage('remote-1');
      expect(msg).not.toBeNull();
      expect(msg!.targetId).toBe('remote-1');
    });

    it('should track sync status per peer', () => {
      const doc = createCrdtDocument({ x: 1 }, 'local');
      const session = createSyncSession('doc-1', doc);
      session.addPeer('remote-1');

      expect(session.isFullySynced()).toBe(false);

      // Generate and "send" a message, then confirm no more changes
      doc.change((d) => { (d as Record<string, unknown>).x = 2; });
      session.generateMessage('remote-1');

      // Simulate remote acknowledging with empty response
      const remoteDoc = createCrdtDocument({ x: 1 }, 'remote-1');
      const remoteMsg = remoteDoc.generateSyncMessage([]);
      if (remoteMsg) {
        session.receiveMessage(remoteMsg);
      }

      const peers = session.getPeerStates();
      expect(peers[0]!.syncCount).toBeGreaterThanOrEqual(0);
    });

    it('should remove peers', () => {
      const doc = createCrdtDocument({ x: 1 }, 'local');
      const session = createSyncSession('doc-1', doc);
      session.addPeer('remote-1');
      session.removePeer('remote-1');
      expect(session.getPeerStates()).toHaveLength(0);
    });
  });

  describe('mergeSyncMessages', () => {
    it('should apply multiple messages in order', () => {
      const docA = createCrdtDocument({ v: 0 }, 'a');
      const target = createCrdtDocument({ v: 0 }, 'target');

      docA.change((d) => { (d as Record<string, unknown>).v = 1; });
      docA.change((d) => { (d as Record<string, unknown>).v = 2; });

      const msg1 = docA.generateSyncMessage([]);
      const results = mergeSyncMessages(target, msg1 ? [msg1] : []);

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(true);
      expect(target.getState().value.v).toBe(2);
    });
  });

  describe('createAutomergeSyncAdapter', () => {
    it('should create adapter with actor ID', () => {
      const adapter = createAutomergeSyncAdapter({ actorId: 'user-1' });
      expect(adapter.actorId).toBe('user-1');
      adapter.destroy();
    });

    it('should manage documents across collections', () => {
      const adapter = createAutomergeSyncAdapter({ actorId: 'user-1' });

      const change = adapter.applyLocalChange('todos', 'todo-1', (draft) => {
        (draft as Record<string, unknown>).title = 'Buy milk';
      });

      expect(change.actorId).toBe('user-1');
      expect(adapter.getDocumentIds('todos')).toContain('todo-1');

      const doc = adapter.getDocument('todos', 'todo-1');
      expect(doc.getState().value).toHaveProperty('title', 'Buy milk');

      adapter.destroy();
    });

    it('should apply remote changes', () => {
      const adapter1 = createAutomergeSyncAdapter({ actorId: 'user-1' });
      const adapter2 = createAutomergeSyncAdapter({ actorId: 'user-2' });

      adapter1.applyLocalChange('todos', 'todo-1', (draft) => {
        (draft as Record<string, unknown>).title = 'From user-1';
      });

      const doc1 = adapter1.getDocument('todos', 'todo-1');
      const changes = doc1.getState().changes;

      // Initialize doc in adapter2 first
      adapter2.getDocument('todos', 'todo-1');
      const result = adapter2.applyRemoteChanges('todos', 'todo-1', changes);

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(1);

      adapter1.destroy();
      adapter2.destroy();
    });

    it('should throw after destroy', () => {
      const adapter = createAutomergeSyncAdapter({ actorId: 'user-1' });
      adapter.destroy();

      expect(() => adapter.getDocument('todos', 'todo-1')).toThrow('destroyed');
    });
  });

  describe('createMergeResolver', () => {
    it('should resolve with last-writer-wins strategy', () => {
      const resolver = createMergeResolver({ defaultStrategy: 'last-writer-wins' });

      const conflict: MergeConflict = {
        path: ['title'],
        localValue: 'local',
        remoteValue: 'remote',
        resolvedValue: 'remote',
        winner: 'remote-actor',
      };

      expect(resolver.resolve(conflict)).toBe('remote');
    });

    it('should merge objects with field-level-merge strategy', () => {
      const resolver = createMergeResolver({ defaultStrategy: 'field-level-merge' });

      const conflict: MergeConflict = {
        path: ['metadata'],
        localValue: { a: 1 },
        remoteValue: { b: 2 },
        resolvedValue: { b: 2 },
        winner: 'remote',
      };

      expect(resolver.resolve(conflict)).toEqual({ a: 1, b: 2 });
    });

    it('should use per-field strategy overrides', () => {
      const resolver = createMergeResolver({
        defaultStrategy: 'last-writer-wins',
        fieldStrategies: { 'metadata': 'field-level-merge' },
      });

      expect(resolver.getStrategy(['metadata'])).toBe('field-level-merge');
      expect(resolver.getStrategy(['title'])).toBe('last-writer-wins');
    });

    it('should use custom resolver', () => {
      const resolver = createMergeResolver({
        defaultStrategy: 'custom',
        customResolver: (c) => `${String(c.localValue)}+${String(c.remoteValue)}`,
      });

      const conflict: MergeConflict = {
        path: ['name'],
        localValue: 'Alice',
        remoteValue: 'Bob',
        resolvedValue: 'Bob',
        winner: 'remote',
      };

      expect(resolver.resolve(conflict)).toBe('Alice+Bob');
    });

    it('should resolve all conflicts in batch', () => {
      const resolver = createMergeResolver({ defaultStrategy: 'last-writer-wins' });

      const conflicts: MergeConflict[] = [
        { path: ['a'], localValue: 1, remoteValue: 2, resolvedValue: 2, winner: 'r' },
        { path: ['b'], localValue: 'x', remoteValue: 'y', resolvedValue: 'y', winner: 'r' },
      ];

      const results = resolver.resolveAll(conflicts);
      expect(results).toHaveLength(2);
    });
  });

  describe('fork', () => {
    it('should fork a document preserving state', () => {
      const doc = createCrdtDocument({ x: 1, y: 2 }, 'actor-1');
      doc.change((d) => { (d as Record<string, unknown>).x = 10; });

      const forked = doc.fork('actor-2');
      const state = forked.getState();

      expect(state.actorId).toBe('actor-2');
      expect(state.value.x).toBe(10);
      expect(state.value.y).toBe(2);
    });
  });
});
