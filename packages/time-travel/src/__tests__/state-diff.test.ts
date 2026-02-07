import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStateDiffEngine, StateDiffEngine } from '../state-diff.js';

/* ================================================================== */
/*  StateDiffEngine                                                    */
/* ================================================================== */

describe('StateDiffEngine', () => {
  let engine: StateDiffEngine;

  beforeEach(() => {
    engine = createStateDiffEngine({ strategy: 'deep' });
  });

  afterEach(() => {
    engine.destroy();
  });

  /* ---- Factory --------------------------------------------------- */

  describe('createStateDiffEngine', () => {
    it('should create an instance via factory function', () => {
      const e = createStateDiffEngine();
      expect(e).toBeInstanceOf(StateDiffEngine);
      e.destroy();
    });

    it('should accept configuration options', () => {
      const e = createStateDiffEngine({ strategy: 'shallow', maxDepth: 5 });
      expect(e).toBeInstanceOf(StateDiffEngine);
      e.destroy();
    });
  });

  /* ---- diff: added fields --------------------------------------- */

  describe('diff - added fields', () => {
    it('should detect added fields', () => {
      const before = { id: '1', name: 'Alice' };
      const after = { id: '1', name: 'Alice', role: 'admin' };

      const result = engine.diff(before, after);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]!.kind).toBe('added');
      expect(result.changes[0]!.path).toBe('role');
      expect(result.changes[0]!.after).toBe('admin');
    });
  });

  /* ---- diff: removed fields ------------------------------------- */

  describe('diff - removed fields', () => {
    it('should detect removed fields', () => {
      const before = { id: '1', name: 'Alice', age: 30 };
      const after = { id: '1', name: 'Alice' };

      const result = engine.diff(before, after);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]!.kind).toBe('removed');
      expect(result.changes[0]!.path).toBe('age');
      expect(result.changes[0]!.before).toBe(30);
    });
  });

  /* ---- diff: modified fields ------------------------------------ */

  describe('diff - modified fields', () => {
    it('should detect modified fields (value change)', () => {
      const before = { id: '1', name: 'Alice' };
      const after = { id: '1', name: 'Alice B.' };

      const result = engine.diff(before, after);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]!.kind).toBe('modified');
      expect(result.changes[0]!.path).toBe('name');
      expect(result.changes[0]!.before).toBe('Alice');
      expect(result.changes[0]!.after).toBe('Alice B.');
    });
  });

  /* ---- diff: nested object changes ------------------------------ */

  describe('diff - nested object changes', () => {
    it('should detect nested object changes (deep)', () => {
      const before = { id: '1', address: { city: 'NYC', zip: '10001' } };
      const after = { id: '1', address: { city: 'LA', zip: '10001' } };

      const result = engine.diff(before, after);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]!.path).toBe('address.city');
      expect(result.changes[0]!.kind).toBe('modified');
      expect(result.changes[0]!.before).toBe('NYC');
      expect(result.changes[0]!.after).toBe('LA');
    });

    it('should detect deeply nested additions', () => {
      const before = { id: '1', meta: { tags: {} } } as Record<string, unknown>;
      const after = { id: '1', meta: { tags: { priority: 'high' } } } as Record<string, unknown>;

      const result = engine.diff(before, after);

      expect(result.changes.some((c) => c.path === 'meta.tags.priority' && c.kind === 'added')).toBe(true);
    });
  });

  /* ---- diff: identical objects ----------------------------------- */

  describe('diff - identical objects', () => {
    it('should return no changes for identical objects', () => {
      const obj = { id: '1', name: 'Alice', age: 30 };
      const result = engine.diff(obj, { ...obj });

      expect(result.changes).toHaveLength(0);
    });
  });

  /* ---- patch ----------------------------------------------------- */

  describe('patch', () => {
    it('should apply diff to produce new state', () => {
      const before = { id: '1', name: 'Alice', age: 30 };
      const after = { id: '1', name: 'Alice B.', role: 'admin' };

      const d = engine.diff(before, after);
      const patched = engine.patch(before, d);

      expect(patched).toEqual(after);
    });

    it('should not mutate the original state', () => {
      const before = { id: '1', name: 'Alice' };
      const after = { id: '1', name: 'Bob' };

      const d = engine.diff(before, after);
      engine.patch(before, d);

      expect(before.name).toBe('Alice');
    });
  });

  /* ---- unpatch --------------------------------------------------- */

  describe('unpatch', () => {
    it('should reverse diff to restore original state', () => {
      const before = { id: '1', name: 'Alice', age: 30 };
      const after = { id: '1', name: 'Alice B.', role: 'admin' };

      const d = engine.diff(before, after);
      const unpatched = engine.unpatch(after, d);

      expect(unpatched).toEqual(before);
    });

    it('should not mutate the input state', () => {
      const before = { id: '1', name: 'Alice' };
      const after = { id: '1', name: 'Bob' };

      const d = engine.diff(before, after);
      engine.unpatch(after, d);

      expect(after.name).toBe('Bob');
    });
  });

  /* ---- buildSummary --------------------------------------------- */

  describe('buildSummary', () => {
    it('should generate human-readable text for additions', () => {
      const d = engine.diff({ id: '1' }, { id: '1', name: 'Alice' });

      expect(d.summary.some((s) => s.includes('added') && s.includes('name'))).toBe(true);
    });

    it('should generate human-readable text for removals', () => {
      const d = engine.diff({ id: '1', name: 'Alice' }, { id: '1' });

      expect(d.summary.some((s) => s.includes('removed') && s.includes('name'))).toBe(true);
    });

    it('should generate human-readable text for modifications', () => {
      const d = engine.diff({ id: '1', name: 'Alice' }, { id: '1', name: 'Bob' });

      expect(d.summary.some((s) => s.includes('modified') && s.includes('name'))).toBe(true);
    });

    it('should report "No changes" for identical objects', () => {
      const d = engine.diff({ id: '1' }, { id: '1' });

      expect(d.summary).toContain('No changes');
    });
  });

  /* ---- diffCollections ------------------------------------------- */

  describe('diffCollections', () => {
    it('should compare multiple documents across collections', () => {
      const before = {
        users: {
          u1: { id: '1', name: 'Alice' },
        },
        todos: {
          t1: { id: 't1', title: 'Task 1' },
        },
      };

      const after = {
        users: {
          u1: { id: '1', name: 'Alice B.' },
          u2: { id: '2', name: 'Bob' },
        },
        todos: {
          t1: { id: 't1', title: 'Task 1' },
        },
      };

      const result = engine.diffCollections(before, after);

      // user u1 was modified
      expect(result.users!['u1']).toBeDefined();
      expect(result.users!['u1']!.changes.length).toBeGreaterThan(0);

      // user u2 was added
      expect(result.users!['u2']).toBeDefined();

      // todo t1 unchanged – should NOT appear
      expect(result.todos).toBeUndefined();
    });

    it('should handle empty collections', () => {
      const result = engine.diffCollections({}, {});
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should detect removed collections', () => {
      const before = {
        users: { u1: { id: '1', name: 'Alice' } },
      };
      const after = {};

      const result = engine.diffCollections(before, after);
      expect(result.users).toBeDefined();
    });
  });

  /* ---- destroy --------------------------------------------------- */

  describe('destroy', () => {
    it('should complete observables on destroy', async () => {
      const e = createStateDiffEngine();
      const eventsComplete = new Promise<void>((resolve) => {
        e.events.subscribe({ complete: () => resolve() });
      });

      e.destroy();

      await expect(eventsComplete).resolves.toBeUndefined();
    });
  });

  /* ---- Edge cases ------------------------------------------------ */

  describe('edge cases', () => {
    it('should handle null values', () => {
      const before = { id: '1', value: null } as Record<string, unknown>;
      const after = { id: '1', value: 'set' } as Record<string, unknown>;

      const result = engine.diff(before, after);
      expect(result.changes.some((c) => c.path === 'value' && c.kind === 'modified')).toBe(true);
    });

    it('should handle undefined values (field removal)', () => {
      const before = { id: '1', name: 'Alice', extra: 'data' };
      const after = { id: '1', name: 'Alice' };

      const result = engine.diff(before, after);
      expect(result.changes.some((c) => c.path === 'extra' && c.kind === 'removed')).toBe(true);
    });

    it('should handle array changes', () => {
      const before = { id: '1', tags: ['a', 'b'] } as Record<string, unknown>;
      const after = { id: '1', tags: ['a', 'c'] } as Record<string, unknown>;

      const result = engine.diff(before, after);
      expect(result.changes.some((c) => c.path === 'tags' && c.kind === 'modified')).toBe(true);
    });

    it('should handle adding a completely new nested object', () => {
      const before = { id: '1' };
      const after = { id: '1', meta: { createdBy: 'system' } };

      const result = engine.diff(before, after);
      expect(result.changes.some((c) => c.kind === 'added')).toBe(true);
    });

    it('should handle empty objects', () => {
      const result = engine.diff({}, {});
      expect(result.changes).toHaveLength(0);
    });
  });
});
