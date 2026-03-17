import { beforeEach, describe, expect, it } from 'vitest';
import { applyCrdtChanges, createCrdtDocument } from '../crdt-document.js';
import type { CrdtDocument } from '../types.js';

describe('createCrdtDocument', () => {
  describe('initialization', () => {
    it('should create a document with default actor ID when none provided', () => {
      const doc = createCrdtDocument({ x: 1 });
      const state = doc.getState();
      expect(state.actorId).toBeTruthy();
      expect(typeof state.actorId).toBe('string');
      expect(state.actorId.length).toBeGreaterThan(0);
    });

    it('should create a document with empty object initial value', () => {
      const doc = createCrdtDocument({}, 'a');
      const state = doc.getState();
      expect(state.value).toEqual({});
      expect(state.clock).toBe(0);
      expect(state.changes).toHaveLength(0);
      expect(state.heads).toHaveLength(0);
    });

    it('should deeply clone the initial value', () => {
      const init = { nested: { a: 1 } };
      const doc = createCrdtDocument(init, 'a');
      init.nested.a = 999;
      expect(doc.getState().value.nested.a).toBe(1);
    });

    it('should return deeply cloned state on getState()', () => {
      const doc = createCrdtDocument({ x: 1 }, 'a');
      const s1 = doc.getState();
      const s2 = doc.getState();
      expect(s1).toEqual(s2);
      expect(s1).not.toBe(s2);
      expect(s1.value).not.toBe(s2.value);
    });

    it('should initialize with complex nested structure', () => {
      const doc = createCrdtDocument(
        {
          users: [{ name: 'Alice', tags: ['admin'] }],
          meta: { version: 1, settings: { theme: 'dark' } },
        },
        'a'
      );
      const state = doc.getState();
      expect(state.value.users[0]!.name).toBe('Alice');
      expect(state.value.meta.settings.theme).toBe('dark');
    });
  });

  describe('change operations', () => {
    let doc: CrdtDocument<{ title: string; count: number; tags: string[] }>;

    beforeEach(() => {
      doc = createCrdtDocument({ title: 'Init', count: 0, tags: [] }, 'actor-1');
    });

    it('should produce a change with correct actorId and seq', () => {
      const c1 = doc.change((d) => {
        (d as Record<string, unknown>).title = 'A';
      });
      expect(c1.actorId).toBe('actor-1');
      expect(c1.seq).toBe(1);

      const c2 = doc.change((d) => {
        (d as Record<string, unknown>).title = 'B';
      });
      expect(c2.seq).toBe(2);
    });

    it('should produce unique change IDs', () => {
      const c1 = doc.change((d) => {
        (d as Record<string, unknown>).title = 'A';
      });
      const c2 = doc.change((d) => {
        (d as Record<string, unknown>).title = 'B';
      });
      expect(c1.id).not.toBe(c2.id);
    });

    it('should produce unique hashes for different changes', () => {
      const c1 = doc.change((d) => {
        (d as Record<string, unknown>).title = 'A';
      });
      const c2 = doc.change((d) => {
        (d as Record<string, unknown>).title = 'B';
      });
      expect(c1.hash).not.toBe(c2.hash);
    });

    it('should track dependencies between changes', () => {
      const c1 = doc.change((d) => {
        (d as Record<string, unknown>).title = 'First';
      });
      const c2 = doc.change((d) => {
        (d as Record<string, unknown>).title = 'Second';
      });
      expect(c2.deps).toContain(c1.hash);
    });

    it('should generate set operations for value changes', () => {
      const c = doc.change((d) => {
        (d as Record<string, unknown>).title = 'New';
      });
      expect(c.operations.length).toBeGreaterThan(0);
      const setOps = c.operations.filter((op) => op.type === 'set');
      expect(setOps.length).toBeGreaterThan(0);
    });

    it('should handle nested object changes', () => {
      const nested = createCrdtDocument({ meta: { a: 1, b: 2 } }, 'a');
      nested.change((d) => {
        (d as Record<string, unknown>).meta = { a: 10, b: 2 };
      });
      expect(nested.getState().value.meta.a).toBe(10);
      expect(nested.getState().value.meta.b).toBe(2);
    });

    it('should handle adding new properties', () => {
      const doc2 = createCrdtDocument<Record<string, unknown>>({ x: 1 }, 'a');
      doc2.change((d) => {
        d.y = 2;
      });
      expect(doc2.getState().value.y).toBe(2);
      expect(doc2.getState().value.x).toBe(1);
    });

    it('should handle deleting properties', () => {
      const doc2 = createCrdtDocument({ x: 1, y: 2 }, 'a');
      doc2.change((d) => {
        delete (d as Record<string, unknown>).y;
      });
      expect(doc2.getState().value).not.toHaveProperty('y');
      expect((doc2.getState().value as Record<string, unknown>).x).toBe(1);
    });

    it('should produce delete operations', () => {
      const doc2 = createCrdtDocument({ x: 1, y: 2 }, 'a');
      const c = doc2.change((d) => {
        delete (d as Record<string, unknown>).y;
      });
      const deleteOps = c.operations.filter((op) => op.type === 'delete');
      expect(deleteOps.length).toBe(1);
      expect(deleteOps[0]!.path).toEqual(['y']);
    });

    it('should handle no-op changes (no actual diff)', () => {
      const c = doc.change((d) => {
        (d as Record<string, unknown>).title = 'Init';
      });
      expect(c.operations).toHaveLength(0);
    });

    it('should increment clock on each change', () => {
      doc.change((d) => {
        (d as Record<string, unknown>).count = 1;
      });
      expect(doc.getState().clock).toBe(1);
      doc.change((d) => {
        (d as Record<string, unknown>).count = 2;
      });
      expect(doc.getState().clock).toBe(2);
    });

    it('should update heads after each change', () => {
      const h0 = doc.getState().heads;
      expect(h0).toHaveLength(0);

      const c1 = doc.change((d) => {
        (d as Record<string, unknown>).title = 'A';
      });
      const h1 = doc.getState().heads;
      expect(h1).toHaveLength(1);
      expect(h1).toContain(c1.hash);

      const c2 = doc.change((d) => {
        (d as Record<string, unknown>).title = 'B';
      });
      const h2 = doc.getState().heads;
      expect(h2).toHaveLength(1);
      expect(h2).toContain(c2.hash);
      expect(h2).not.toContain(c1.hash);
    });
  });

  describe('getChangesSince', () => {
    it('should return all changes when heads is empty', () => {
      const doc = createCrdtDocument({ x: 0 }, 'a');
      doc.change((d) => {
        (d as Record<string, unknown>).x = 1;
      });
      doc.change((d) => {
        (d as Record<string, unknown>).x = 2;
      });
      const since = doc.getChangesSince([]);
      expect(since).toHaveLength(2);
    });

    it('should return changes after given heads', () => {
      const doc = createCrdtDocument({ x: 0 }, 'a');
      const c1 = doc.change((d) => {
        (d as Record<string, unknown>).x = 1;
      });
      doc.change((d) => {
        (d as Record<string, unknown>).x = 2;
      });
      const since = doc.getChangesSince([c1.hash]);
      expect(since).toHaveLength(1);
      expect(since[0]!.seq).toBe(2);
    });

    it('should return empty array when at current heads', () => {
      const doc = createCrdtDocument({ x: 0 }, 'a');
      doc.change((d) => {
        (d as Record<string, unknown>).x = 1;
      });
      const heads = doc.getState().heads;
      const since = doc.getChangesSince(heads);
      expect(since).toHaveLength(0);
    });
  });

  describe('applyChanges', () => {
    it('should apply remote changes from another document', () => {
      const docA = createCrdtDocument({ val: 0 }, 'a');
      const docB = createCrdtDocument({ val: 0 }, 'b');

      docA.change((d) => {
        (d as Record<string, unknown>).val = 42;
      });

      const result = docB.applyChanges(docA.getState().changes);
      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(1);
      expect(result.state.value.val).toBe(42);
    });

    it('should skip duplicate changes', () => {
      const docA = createCrdtDocument({ val: 0 }, 'a');
      const docB = createCrdtDocument({ val: 0 }, 'b');

      docA.change((d) => {
        (d as Record<string, unknown>).val = 1;
      });
      const changes = docA.getState().changes;

      docB.applyChanges(changes);
      const result = docB.applyChanges(changes);
      expect(result.appliedCount).toBe(0);
    });

    it('should return failure on destroyed document', () => {
      const doc = createCrdtDocument({ val: 0 }, 'a');
      doc.destroy();

      const result = doc.applyChanges([]);
      expect(result.success).toBe(false);
    });

    it('should detect concurrent conflicting changes', () => {
      const docA = createCrdtDocument({ title: 'Init' }, 'actor-a');
      const docB = createCrdtDocument({ title: 'Init' }, 'actor-b');

      docA.change((d) => {
        (d as Record<string, unknown>).title = 'From A';
      });
      docB.change((d) => {
        (d as Record<string, unknown>).title = 'From B';
      });

      const result = docB.applyChanges(docA.getState().changes);
      expect(result.success).toBe(true);
      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    it('should resolve conflicts deterministically via actor ID comparison', () => {
      const docA = createCrdtDocument({ x: 0 }, 'aaa');
      const docB = createCrdtDocument({ x: 0 }, 'zzz');

      docA.change((d) => {
        (d as Record<string, unknown>).x = 1;
      });
      docB.change((d) => {
        (d as Record<string, unknown>).x = 2;
      });

      // Remote actorId 'aaa' < local 'zzz', so local wins
      const result = docB.applyChanges(docA.getState().changes);
      expect(result.conflicts.length).toBeGreaterThan(0);
      const conflict = result.conflicts[0]!;
      expect(conflict.winner).toBe('zzz');
    });

    it('should advance clock past remote timestamps', () => {
      const docA = createCrdtDocument({ x: 0 }, 'a');
      const docB = createCrdtDocument({ x: 0 }, 'b');

      docA.change((d) => {
        (d as Record<string, unknown>).x = 1;
      });
      docA.change((d) => {
        (d as Record<string, unknown>).x = 2;
      });
      docA.change((d) => {
        (d as Record<string, unknown>).x = 3;
      });

      docB.applyChanges(docA.getState().changes);
      expect(docB.getState().clock).toBeGreaterThanOrEqual(3);
    });

    it('should apply multiple non-conflicting changes from different actors', () => {
      const docA = createCrdtDocument({ x: 0, y: 0 }, 'a');
      const docB = createCrdtDocument({ x: 0, y: 0 }, 'b');

      docA.change((d) => {
        (d as Record<string, unknown>).x = 10;
      });
      docB.change((d) => {
        (d as Record<string, unknown>).y = 20;
      });

      const result = docA.applyChanges(docB.getState().changes);
      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(0);
      expect(result.state.value.x).toBe(10);
      expect(result.state.value.y).toBe(20);
    });
  });

  describe('generateSyncMessage / receiveSyncMessage', () => {
    it('should generate a message with all changes when peer has no heads', () => {
      const doc = createCrdtDocument({ x: 0 }, 'a');
      doc.change((d) => {
        (d as Record<string, unknown>).x = 1;
      });
      doc.change((d) => {
        (d as Record<string, unknown>).x = 2;
      });

      const msg = doc.generateSyncMessage([]);
      expect(msg).not.toBeNull();
      expect(msg!.changes).toHaveLength(2);
      expect(msg!.senderId).toBe('a');
    });

    it('should generate null when peer is up to date', () => {
      const doc = createCrdtDocument({ x: 0 }, 'a');
      doc.change((d) => {
        (d as Record<string, unknown>).x = 1;
      });
      const heads = doc.getState().heads;

      const msg = doc.generateSyncMessage(heads);
      expect(msg).toBeNull();
    });

    it('should generate only missing changes based on peer heads', () => {
      const doc = createCrdtDocument({ x: 0 }, 'a');
      const c1 = doc.change((d) => {
        (d as Record<string, unknown>).x = 1;
      });
      doc.change((d) => {
        (d as Record<string, unknown>).x = 2;
      });

      const msg = doc.generateSyncMessage([c1.hash]);
      expect(msg).not.toBeNull();
      expect(msg!.changes).toHaveLength(1);
    });

    it('should receiveSyncMessage and apply changes', () => {
      const docA = createCrdtDocument({ x: 0 }, 'a');
      const docB = createCrdtDocument({ x: 0 }, 'b');

      docA.change((d) => {
        (d as Record<string, unknown>).x = 42;
      });
      const msg = docA.generateSyncMessage([]);
      expect(msg).not.toBeNull();

      const result = docB.receiveSyncMessage(msg!);
      expect(result.success).toBe(true);
      expect(docB.getState().value.x).toBe(42);
    });
  });

  describe('fork', () => {
    it('should create an independent copy with new actor ID', () => {
      const doc = createCrdtDocument({ x: 1, y: 'hello' }, 'original');
      doc.change((d) => {
        (d as Record<string, unknown>).x = 10;
      });

      const forked = doc.fork('forked-actor');
      expect(forked.getState().actorId).toBe('forked-actor');
      expect(forked.getState().value.x).toBe(10);
    });

    it('should allow independent changes after fork', () => {
      const doc = createCrdtDocument({ x: 1 }, 'original');
      doc.change((d) => {
        (d as Record<string, unknown>).x = 10;
      });

      const forked = doc.fork('forked');
      forked.change((d) => {
        (d as Record<string, unknown>).x = 99;
      });

      expect(doc.getState().value.x).toBe(10);
      expect(forked.getState().value.x).toBe(99);
    });

    it('should preserve all initial changes in forked document', () => {
      const doc = createCrdtDocument({ x: 0 }, 'orig');
      doc.change((d) => {
        (d as Record<string, unknown>).x = 1;
      });
      doc.change((d) => {
        (d as Record<string, unknown>).x = 2;
      });

      const forked = doc.fork('fork');
      // The forked doc should have changes applied (value is 2)
      expect(forked.getState().value.x).toBe(2);
    });
  });

  describe('destroy', () => {
    it('should throw on change after destroy', () => {
      const doc = createCrdtDocument({ x: 1 }, 'a');
      doc.destroy();
      expect(() =>
        doc.change((d) => {
          (d as Record<string, unknown>).x = 2;
        })
      ).toThrow('destroyed');
    });

    it('should return failure on applyChanges after destroy', () => {
      const doc = createCrdtDocument({ x: 1 }, 'a');
      doc.destroy();
      const result = doc.applyChanges([]);
      expect(result.success).toBe(false);
    });

    it('should clear internal state on destroy', () => {
      const doc = createCrdtDocument({ x: 1 }, 'a');
      doc.change((d) => {
        (d as Record<string, unknown>).x = 2;
      });
      doc.destroy();
      // getState still works but changes are empty
      expect(doc.getState().changes).toHaveLength(0);
    });
  });
});

describe('applyCrdtChanges', () => {
  it('should be a convenience wrapper for document.applyChanges', () => {
    const docA = createCrdtDocument({ v: 'a' }, 'a');
    const docB = createCrdtDocument({ v: 'a' }, 'b');

    docA.change((d) => {
      (d as Record<string, unknown>).v = 'updated';
    });
    const result = applyCrdtChanges(docB, docA.getState().changes);

    expect(result.success).toBe(true);
    expect(docB.getState().value.v).toBe('updated');
  });

  it('should handle empty changes array', () => {
    const doc = createCrdtDocument({ v: 1 }, 'a');
    const result = applyCrdtChanges(doc, []);
    expect(result.success).toBe(true);
    expect(result.appliedCount).toBe(0);
  });
});
