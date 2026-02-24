import { describe, expect, it } from 'vitest';
import { ConflictPlayground } from '../conflict-playground.js';

describe('ConflictPlayground', () => {
  it('should record and retrieve conflicts', () => {
    const pg = new ConflictPlayground();
    const conflict = pg.recordConflict(
      'users',
      'u-1',
      { _id: 'u-1', name: 'Alice', age: 30 },
      { _id: 'u-1', name: 'Alice B', age: 31 }
    );

    expect(conflict.id).toBeTruthy();
    expect(pg.getConflict(conflict.id)).toBeDefined();
    expect(pg.listConflicts()).toHaveLength(1);
    pg.destroy();
  });

  it('should compute field diffs', () => {
    const pg = new ConflictPlayground();
    const conflict = pg.recordConflict(
      'users',
      'u-1',
      { _id: 'u-1', name: 'Alice', role: 'admin' },
      { _id: 'u-1', name: 'Bob', role: 'admin' }
    );

    const nameDiff = conflict.fieldDiffs.find((d) => d.field === 'name');
    expect(nameDiff!.conflicting).toBe(true);
    expect(nameDiff!.localValue).toBe('Alice');
    expect(nameDiff!.remoteValue).toBe('Bob');

    const roleDiff = conflict.fieldDiffs.find((d) => d.field === 'role');
    expect(roleDiff!.conflicting).toBe(false);
    pg.destroy();
  });

  it('should auto-resolve with local-wins', () => {
    const pg = new ConflictPlayground();
    const conflict = pg.recordConflict(
      'docs',
      'd-1',
      { _id: 'd-1', title: 'Local Title' },
      { _id: 'd-1', title: 'Remote Title' }
    );

    const resolved = pg.autoResolve(conflict.id, 'local-wins');
    expect(resolved!.title).toBe('Local Title');
    expect(pg.getConflict(conflict.id)!.resolvedBy).toBe('auto');
    pg.destroy();
  });

  it('should auto-resolve with merge', () => {
    const pg = new ConflictPlayground();
    const conflict = pg.recordConflict(
      'docs',
      'd-1',
      { _id: 'd-1', title: 'A', extra: 'local-only' },
      { _id: 'd-1', title: 'B', remote: 'remote-only' }
    );

    const resolved = pg.autoResolve(conflict.id, 'merge');
    expect(resolved!.title).toBe('A'); // local wins on overlap
    expect(resolved!.remote).toBe('remote-only'); // remote-only preserved
    pg.destroy();
  });

  it('should manually resolve with field choices', () => {
    const pg = new ConflictPlayground();
    const conflict = pg.recordConflict(
      'docs',
      'd-1',
      { _id: 'd-1', title: 'Local', body: 'Local body' },
      { _id: 'd-1', title: 'Remote', body: 'Remote body' }
    );

    const resolved = pg.manualResolve({
      conflictId: conflict.id,
      fieldChoices: { title: 'remote', body: 'custom' },
      customValues: { body: 'Merged body' },
    });

    expect(resolved!.title).toBe('Remote');
    expect(resolved!.body).toBe('Merged body');
    expect(pg.getConflict(conflict.id)!.resolvedBy).toBe('manual');
    pg.destroy();
  });

  it('should replay resolved conflicts', () => {
    const pg = new ConflictPlayground();
    const conflict = pg.recordConflict('docs', 'd-1', { title: 'A' }, { title: 'B' });
    pg.autoResolve(conflict.id, 'local-wins');
    expect(pg.getConflict(conflict.id)!.resolvedVersion).not.toBeNull();

    pg.replay(conflict.id);
    expect(pg.getConflict(conflict.id)!.resolvedVersion).toBeNull();
    pg.destroy();
  });

  it('should track statistics', () => {
    const pg = new ConflictPlayground();
    pg.recordConflict('a', '1', { v: 1 }, { v: 2 });
    pg.recordConflict('b', '2', { v: 3 }, { v: 4 });
    pg.autoResolve(pg.listConflicts()[0]!.id, 'local-wins');

    const stats = pg.getStats();
    expect(stats.totalConflicts).toBe(2);
    expect(stats.resolvedConflicts).toBe(1);
    expect(stats.pendingConflicts).toBe(1);
    pg.destroy();
  });

  it('should export conflicts as JSON', () => {
    const pg = new ConflictPlayground();
    pg.recordConflict('a', '1', { v: 1 }, { v: 2 });
    const exported = pg.exportConflicts();
    const parsed = JSON.parse(exported);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    pg.destroy();
  });

  it('should filter by collection', () => {
    const pg = new ConflictPlayground();
    pg.recordConflict('users', '1', {}, {});
    pg.recordConflict('orders', '2', {}, {});
    pg.recordConflict('users', '3', {}, {});

    expect(pg.listConflicts('users')).toHaveLength(2);
    expect(pg.listConflicts('orders')).toHaveLength(1);
    pg.destroy();
  });
});
