import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { createSnapshotEngine, SnapshotEngine } from '../snapshot-engine.js';
import type { Document } from '@pocket/core';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeState(
  collections: Record<string, Record<string, Record<string, unknown>>>
): Record<string, Record<string, Document>> {
  return collections as Record<string, Record<string, Document>>;
}

const stateA = makeState({
  users: {
    u1: { _id: 'u1', name: 'Alice' },
  },
});

const stateB = makeState({
  users: {
    u1: { _id: 'u1', name: 'Alice B.' },
  },
});

const stateC = makeState({
  users: {
    u1: { _id: 'u1', name: 'Alice B.' },
    u2: { _id: 'u2', name: 'Bob' },
  },
});

/* ================================================================== */
/*  SnapshotEngine                                                     */
/* ================================================================== */

describe('SnapshotEngine', () => {
  let engine: SnapshotEngine;

  beforeEach(() => {
    engine = createSnapshotEngine({ maxSnapshots: 200, retentionPolicy: 'sliding-window', retentionSize: 50 });
  });

  afterEach(() => {
    engine.destroy();
  });

  /* ---- Factory --------------------------------------------------- */

  describe('createSnapshotEngine', () => {
    it('should create an instance via factory function', () => {
      const e = createSnapshotEngine();
      expect(e).toBeInstanceOf(SnapshotEngine);
      e.destroy();
    });

    it('should accept configuration options', () => {
      const e = createSnapshotEngine({ maxSnapshots: 10 });
      expect(e).toBeInstanceOf(SnapshotEngine);
      e.destroy();
    });
  });

  /* ---- capture --------------------------------------------------- */

  describe('capture', () => {
    it('should create a snapshot with a label', () => {
      const snap = engine.capture(stateA, 'initial');
      expect(snap.id).toBeDefined();
      expect(snap.label).toBe('initial');
      expect(snap.base).not.toBeNull();
      expect(snap.delta).toBeNull();
      expect(snap.branch).toBe('main');
    });

    it('should create incremental snapshots (delta) after the first', () => {
      engine.capture(stateA, 'first');
      const snap2 = engine.capture(stateB, 'second');

      expect(snap2.base).toBeNull();
      expect(snap2.delta).not.toBeNull();
      expect(snap2.parentId).toBeDefined();
    });

    it('should store multiple sequential captures correctly', () => {
      engine.capture(stateA, 'first');
      engine.capture(stateB, 'second');
      engine.capture(stateC, 'third');

      const snapshots = engine.getSnapshots();
      expect(snapshots).toHaveLength(3);
      expect(snapshots[0]!.label).toBe('first');
      expect(snapshots[1]!.label).toBe('second');
      expect(snapshots[2]!.label).toBe('third');
    });

    it('should store null delta when state is unchanged', () => {
      engine.capture(stateA, 'first');
      const snap2 = engine.capture(stateA, 'no-change');

      expect(snap2.delta).toBeNull();
    });
  });

  /* ---- resolve --------------------------------------------------- */

  describe('resolve', () => {
    it('should reconstruct full state from a base snapshot', () => {
      const snap = engine.capture(stateA, 'initial');
      const resolved = engine.resolve(snap.id);
      expect(resolved).toEqual(stateA);
    });

    it('should reconstruct full state from deltas', () => {
      engine.capture(stateA, 'first');
      const snap2 = engine.capture(stateB, 'second');

      const resolved = engine.resolve(snap2.id);
      expect(resolved).toEqual(stateB);
    });

    it('should reconstruct full state across a chain of deltas', () => {
      engine.capture(stateA);
      engine.capture(stateB);
      const snap3 = engine.capture(stateC);

      const resolved = engine.resolve(snap3.id);
      expect(resolved).toEqual(stateC);
    });

    it('should throw for a non-existent snapshot', () => {
      expect(() => engine.resolve('nonexistent')).toThrow();
    });
  });

  /* ---- compare --------------------------------------------------- */

  describe('compare', () => {
    it('should show additions between snapshots', () => {
      const s1 = engine.capture(stateA);
      const s2 = engine.capture(stateC);

      const comparison = engine.compare(s1.id, s2.id);
      expect(comparison.delta.added.users).toBeDefined();
      expect(comparison.delta.added.users!['u2']).toBeDefined();
    });

    it('should show removals between snapshots', () => {
      const s1 = engine.capture(stateC);
      const s2 = engine.capture(stateA);

      const comparison = engine.compare(s1.id, s2.id);
      expect(comparison.delta.removed.users).toBeDefined();
      expect(comparison.delta.removed.users!['u2']).toBeDefined();
    });

    it('should show modifications between snapshots', () => {
      const s1 = engine.capture(stateA);
      const s2 = engine.capture(stateB);

      const comparison = engine.compare(s1.id, s2.id);
      expect(comparison.delta.modified.users).toBeDefined();
      expect(comparison.delta.modified.users!['u1']).toBeDefined();
    });

    it('should include a human-readable summary', () => {
      const s1 = engine.capture(stateA);
      const s2 = engine.capture(stateB);

      const comparison = engine.compare(s1.id, s2.id);
      expect(comparison.summary.length).toBeGreaterThan(0);
      expect(comparison.summary.some((s) => s.includes('modified'))).toBe(true);
    });

    it('should report no changes for identical snapshots', () => {
      const s1 = engine.capture(stateA);
      const s2 = engine.capture(stateA);

      const comparison = engine.compare(s1.id, s2.id);
      expect(comparison.summary).toContain('No changes');
    });
  });

  /* ---- branching ------------------------------------------------- */

  describe('createBranch', () => {
    it('should create a named branch from a snapshot', () => {
      const s1 = engine.capture(stateA);
      engine.createBranch('feature-x', s1.id);

      expect(engine.getBranches()).toContain('feature-x');
    });

    it('should throw when creating a branch that already exists', () => {
      const s1 = engine.capture(stateA);
      engine.createBranch('feature-x', s1.id);

      expect(() => engine.createBranch('feature-x', s1.id)).toThrow('already exists');
    });

    it('should throw when creating a branch from a non-existent snapshot', () => {
      expect(() => engine.createBranch('feature-x', 'nonexistent')).toThrow('not found');
    });
  });

  describe('switchBranch', () => {
    it('should switch the active branch', () => {
      const s1 = engine.capture(stateA);
      engine.createBranch('feature-x', s1.id);
      engine.switchBranch('feature-x');

      expect(engine.getCurrentBranch()).toBe('feature-x');
    });

    it('should throw when switching to a non-existent branch', () => {
      expect(() => engine.switchBranch('nonexistent')).toThrow('does not exist');
    });
  });

  /* ---- merge ----------------------------------------------------- */

  describe('merge', () => {
    it('should merge branch snapshots into the current branch', () => {
      const s1 = engine.capture(stateA, 'base');

      engine.createBranch('feature', s1.id);
      engine.switchBranch('feature');
      engine.capture(stateC, 'feature-change');

      engine.switchBranch('main');
      const mergeSnap = engine.merge('feature');

      expect(mergeSnap.label).toContain('Merge');
      const resolved = engine.resolve(mergeSnap.id);
      expect(resolved).toEqual(stateC);
    });

    it('should throw when merging a branch into itself', () => {
      engine.capture(stateA);
      expect(() => engine.merge('main')).toThrow('Cannot merge a branch into itself');
    });
  });

  /* ---- tag ------------------------------------------------------- */

  describe('tag', () => {
    it('should add a human-readable label to a snapshot', () => {
      const s1 = engine.capture(stateA);
      engine.tag(s1.id, 'v1.0');

      const found = engine.findByTag('v1.0');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(s1.id);
    });

    it('should not duplicate tags', () => {
      const s1 = engine.capture(stateA);
      engine.tag(s1.id, 'v1.0');
      engine.tag(s1.id, 'v1.0');

      const snap = engine.getSnapshot(s1.id);
      expect(snap!.tags.filter((t) => t === 'v1.0')).toHaveLength(1);
    });

    it('should throw when tagging a non-existent snapshot', () => {
      expect(() => engine.tag('nonexistent', 'v1.0')).toThrow('not found');
    });
  });

  /* ---- gc -------------------------------------------------------- */

  describe('gc', () => {
    it('should remove old snapshots per retention policy', () => {
      const smallEngine = createSnapshotEngine({
        retentionPolicy: 'sliding-window',
        retentionSize: 3,
        maxSnapshots: 200,
      });

      for (let i = 0; i < 10; i++) {
        smallEngine.capture(
          makeState({ items: { [`i${i}`]: { _id: `i${i}`, val: i } } }),
          `snap-${i}`
        );
      }

      const removed = smallEngine.gc();
      expect(removed).toBeGreaterThan(0);
      expect(smallEngine.getSnapshotCount()).toBeLessThanOrEqual(3);
      smallEngine.destroy();
    });

    it('should not remove snapshots with keep-all policy', () => {
      const keepAllEngine = createSnapshotEngine({ retentionPolicy: 'keep-all', maxSnapshots: 200 });

      for (let i = 0; i < 5; i++) {
        keepAllEngine.capture(
          makeState({ items: { [`i${i}`]: { _id: `i${i}`, val: i } } }),
          `snap-${i}`
        );
      }

      const removed = keepAllEngine.gc();
      expect(removed).toBe(0);
      expect(keepAllEngine.getSnapshotCount()).toBe(5);
      keepAllEngine.destroy();
    });
  });

  /* ---- getSnapshots ---------------------------------------------- */

  describe('getSnapshots', () => {
    it('should return snapshots for the current branch', () => {
      engine.capture(stateA);
      engine.capture(stateB);

      const snapshots = engine.getSnapshots();
      expect(snapshots).toHaveLength(2);
      expect(snapshots.every((s) => s.branch === 'main')).toBe(true);
    });

    it('should return snapshots for a named branch', () => {
      const s1 = engine.capture(stateA);
      engine.createBranch('feature', s1.id);
      engine.switchBranch('feature');
      engine.capture(stateB, 'feature-snap');

      const featureSnaps = engine.getSnapshots('feature');
      expect(featureSnaps.some((s) => s.label === 'feature-snap')).toBe(true);
    });
  });

  /* ---- destroy --------------------------------------------------- */

  describe('destroy', () => {
    it('should complete observables on destroy', async () => {
      const e = createSnapshotEngine();
      const statePromise = new Promise<void>((resolve) => {
        e.state.subscribe({ complete: () => resolve() });
      });
      const eventsPromise = new Promise<void>((resolve) => {
        e.events.subscribe({ complete: () => resolve() });
      });

      e.destroy();

      await expect(statePromise).resolves.toBeUndefined();
      await expect(eventsPromise).resolves.toBeUndefined();
    });
  });

  /* ---- observable state ------------------------------------------ */

  describe('observable state', () => {
    it('should reflect total snapshots and current branch', async () => {
      engine.capture(stateA);

      const state = await firstValueFrom(engine.state.pipe(take(1)));
      expect(state.totalSnapshots).toBe(1);
      expect(state.currentBranch).toBe('main');
      expect(state.branches).toContain('main');
    });
  });
});
