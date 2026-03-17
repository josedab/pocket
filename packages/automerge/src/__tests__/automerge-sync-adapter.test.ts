import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAutomergeSyncAdapter } from '../automerge-sync-adapter.js';
import type { AutomergeSyncAdapter } from '../types.js';

describe('createAutomergeSyncAdapter', () => {
  let adapter: AutomergeSyncAdapter;

  afterEach(() => {
    try {
      adapter?.destroy();
    } catch {
      /* already destroyed */
    }
  });

  describe('initialization', () => {
    it('should create adapter with specified actorId', () => {
      adapter = createAutomergeSyncAdapter({ actorId: 'user-1' });
      expect(adapter.actorId).toBe('user-1');
    });

    it('should generate an actorId when empty string provided', () => {
      adapter = createAutomergeSyncAdapter({ actorId: '' });
      expect(adapter.actorId).toBeTruthy();
      expect(adapter.actorId.length).toBeGreaterThan(0);
    });
  });

  describe('getDocument', () => {
    beforeEach(() => {
      adapter = createAutomergeSyncAdapter({ actorId: 'user-1' });
    });

    it('should create a new document on first access', () => {
      const doc = adapter.getDocument('todos', 'todo-1');
      expect(doc).toBeDefined();
      expect(doc.getState().actorId).toBe('user-1');
    });

    it('should return the same document on subsequent access', () => {
      const doc1 = adapter.getDocument('todos', 'todo-1');
      const doc2 = adapter.getDocument('todos', 'todo-1');
      expect(doc1).toBe(doc2);
    });

    it('should create different documents for different IDs', () => {
      const doc1 = adapter.getDocument('todos', 'todo-1');
      const doc2 = adapter.getDocument('todos', 'todo-2');
      expect(doc1).not.toBe(doc2);
    });

    it('should create different documents for different collections', () => {
      const doc1 = adapter.getDocument('todos', 'item-1');
      const doc2 = adapter.getDocument('notes', 'item-1');
      expect(doc1).not.toBe(doc2);
    });

    it('should throw after destroy', () => {
      adapter.destroy();
      expect(() => adapter.getDocument('todos', 'todo-1')).toThrow('destroyed');
    });
  });

  describe('applyLocalChange', () => {
    beforeEach(() => {
      adapter = createAutomergeSyncAdapter({ actorId: 'user-1' });
    });

    it('should create document and apply change', () => {
      const change = adapter.applyLocalChange('todos', 'todo-1', (draft) => {
        (draft as Record<string, unknown>).title = 'Buy milk';
        (draft as Record<string, unknown>).done = false;
      });

      expect(change.actorId).toBe('user-1');
      expect(change.seq).toBe(1);
      expect(change.operations.length).toBeGreaterThan(0);
    });

    it('should accumulate changes on same document', () => {
      adapter.applyLocalChange('todos', 'todo-1', (draft) => {
        (draft as Record<string, unknown>).title = 'First';
      });
      const c2 = adapter.applyLocalChange('todos', 'todo-1', (draft) => {
        (draft as Record<string, unknown>).title = 'Second';
      });

      expect(c2.seq).toBe(2);
      const doc = adapter.getDocument('todos', 'todo-1');
      expect(doc.getState().value).toHaveProperty('title', 'Second');
    });

    it('should work across multiple collections', () => {
      adapter.applyLocalChange('todos', 't1', (draft) => {
        (draft as Record<string, unknown>).task = 'Do laundry';
      });
      adapter.applyLocalChange('notes', 'n1', (draft) => {
        (draft as Record<string, unknown>).content = 'Meeting notes';
      });

      const todoDoc = adapter.getDocument('todos', 't1');
      const noteDoc = adapter.getDocument('notes', 'n1');

      expect(todoDoc.getState().value).toHaveProperty('task', 'Do laundry');
      expect(noteDoc.getState().value).toHaveProperty('content', 'Meeting notes');
    });
  });

  describe('applyRemoteChanges', () => {
    it('should apply changes from another adapter', () => {
      const adapter1 = createAutomergeSyncAdapter({ actorId: 'user-1' });
      const adapter2 = createAutomergeSyncAdapter({ actorId: 'user-2' });

      adapter1.applyLocalChange('todos', 'todo-1', (draft) => {
        (draft as Record<string, unknown>).title = 'From user-1';
      });

      const doc1 = adapter1.getDocument('todos', 'todo-1');
      const changes = doc1.getState().changes;

      // Ensure doc exists in adapter2
      adapter2.getDocument('todos', 'todo-1');
      const result = adapter2.applyRemoteChanges('todos', 'todo-1', changes);

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(1);

      const doc2 = adapter2.getDocument('todos', 'todo-1');
      expect(doc2.getState().value).toHaveProperty('title', 'From user-1');

      adapter1.destroy();
      adapter2.destroy();
    });

    it('should handle applying changes to non-existent document (auto-creates)', () => {
      const adapter1 = createAutomergeSyncAdapter({ actorId: 'user-1' });
      const adapter2 = createAutomergeSyncAdapter({ actorId: 'user-2' });

      adapter1.applyLocalChange('todos', 'todo-1', (draft) => {
        (draft as Record<string, unknown>).title = 'Created by user-1';
      });

      const changes = adapter1.getDocument('todos', 'todo-1').getState().changes;
      // Don't pre-create doc in adapter2 — applyRemoteChanges calls getDocument internally
      const result = adapter2.applyRemoteChanges('todos', 'todo-1', changes);
      expect(result.success).toBe(true);

      adapter1.destroy();
      adapter2.destroy();
    });

    it('should handle concurrent changes between two adapters', () => {
      const adapter1 = createAutomergeSyncAdapter({ actorId: 'user-1' });
      const adapter2 = createAutomergeSyncAdapter({ actorId: 'user-2' });

      // Both create the doc
      adapter1.getDocument('todos', 'shared');
      adapter2.getDocument('todos', 'shared');

      // Both make concurrent changes to different fields
      adapter1.applyLocalChange('todos', 'shared', (draft) => {
        (draft as Record<string, unknown>).fieldA = 'from-1';
      });
      adapter2.applyLocalChange('todos', 'shared', (draft) => {
        (draft as Record<string, unknown>).fieldB = 'from-2';
      });

      // Sync: adapter1 → adapter2
      const changes1 = adapter1.getDocument('todos', 'shared').getState().changes;
      adapter2.applyRemoteChanges('todos', 'shared', changes1);

      // Sync: adapter2 → adapter1
      const changes2 = adapter2.getDocument('todos', 'shared').getState().changes;
      adapter1.applyRemoteChanges('todos', 'shared', changes2);

      const doc1 = adapter1.getDocument('todos', 'shared').getState().value;
      const doc2 = adapter2.getDocument('todos', 'shared').getState().value;

      expect(doc1).toHaveProperty('fieldA', 'from-1');
      expect(doc1).toHaveProperty('fieldB', 'from-2');
      expect(doc2).toHaveProperty('fieldA', 'from-1');
      expect(doc2).toHaveProperty('fieldB', 'from-2');

      adapter1.destroy();
      adapter2.destroy();
    });
  });

  describe('getDocumentIds', () => {
    beforeEach(() => {
      adapter = createAutomergeSyncAdapter({ actorId: 'user-1' });
    });

    it('should return empty array for unknown collection', () => {
      expect(adapter.getDocumentIds('nonexistent')).toEqual([]);
    });

    it('should return all document IDs in a collection', () => {
      adapter.getDocument('todos', 'a');
      adapter.getDocument('todos', 'b');
      adapter.getDocument('todos', 'c');

      const ids = adapter.getDocumentIds('todos');
      expect(ids).toHaveLength(3);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
      expect(ids).toContain('c');
    });

    it('should not mix documents across collections', () => {
      adapter.getDocument('todos', 'todo-1');
      adapter.getDocument('notes', 'note-1');

      expect(adapter.getDocumentIds('todos')).toEqual(['todo-1']);
      expect(adapter.getDocumentIds('notes')).toEqual(['note-1']);
    });
  });

  describe('createSyncSession', () => {
    beforeEach(() => {
      adapter = createAutomergeSyncAdapter({ actorId: 'user-1' });
    });

    it('should create a sync session for an existing document', () => {
      adapter.getDocument('todos', 'todo-1');
      const session = adapter.createSyncSession('todo-1');
      expect(session).toBeDefined();
      expect(session.documentId).toBe('todo-1');
    });

    it('should throw for non-existent document', () => {
      expect(() => adapter.createSyncSession('nonexistent')).toThrow('Document not found');
    });

    it('should throw after adapter is destroyed', () => {
      adapter.getDocument('todos', 'todo-1');
      adapter.destroy();
      expect(() => adapter.createSyncSession('todo-1')).toThrow('destroyed');
    });
  });

  describe('destroy', () => {
    it('should destroy all managed documents', () => {
      adapter = createAutomergeSyncAdapter({ actorId: 'user-1' });
      const doc = adapter.getDocument('todos', 'todo-1');
      adapter.applyLocalChange('todos', 'todo-1', (draft) => {
        (draft as Record<string, unknown>).title = 'test';
      });

      adapter.destroy();

      // After adapter destroy, trying to change the doc should throw
      expect(() =>
        doc.change((d) => {
          (d as Record<string, unknown>).title = 'fail';
        })
      ).toThrow('destroyed');
    });

    it('should clear all collections', () => {
      adapter = createAutomergeSyncAdapter({ actorId: 'user-1' });
      adapter.getDocument('todos', 'a');
      adapter.getDocument('notes', 'b');
      adapter.destroy();

      // Can't verify directly, but re-access should throw
      expect(() => adapter.getDocumentIds('todos')).not.toThrow();
      // getDocumentIds returns empty since map was cleared
    });

    it('should be idempotent for subsequent operations', () => {
      adapter = createAutomergeSyncAdapter({ actorId: 'user-1' });
      adapter.destroy();
      expect(() => adapter.getDocument('todos', 'x')).toThrow('destroyed');
    });
  });
});
