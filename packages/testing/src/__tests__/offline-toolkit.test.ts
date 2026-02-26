import { describe, expect, it } from 'vitest';
import {
  assertConvergence,
  createMockSync,
  createTestDatabase,
  simulateConflict,
  simulateNetwork,
  simulateOffline,
} from '../offline-toolkit.js';

describe('createTestDatabase', () => {
  it('should create empty database', () => {
    const db = createTestDatabase({ name: 'test' });
    expect(db.name).toBe('test');
    expect(db.getAll('todos')).toHaveLength(0);
  });

  it('should seed data', () => {
    const db = createTestDatabase({
      seedData: {
        todos: [
          { _id: 't1', title: 'Buy milk' },
          { _id: 't2', title: 'Write code' },
        ],
      },
    });
    expect(db.getAll('todos')).toHaveLength(2);
  });

  it('should support CRUD operations', () => {
    const db = createTestDatabase();
    db.insert('todos', { _id: 't1', title: 'A' });
    expect(db.get('todos', 't1')?.['title']).toBe('A');

    db.update('todos', 't1', { title: 'B' });
    expect(db.get('todos', 't1')?.['title']).toBe('B');

    db.delete('todos', 't1');
    expect(db.get('todos', 't1')).toBeUndefined();
  });

  it('should filter documents', () => {
    const db = createTestDatabase({
      seedData: {
        todos: [
          { _id: 't1', status: 'active' },
          { _id: 't2', status: 'done' },
          { _id: 't3', status: 'active' },
        ],
      },
    });
    expect(db.find('todos', { status: 'active' })).toHaveLength(2);
  });

  it('should clear collections', () => {
    const db = createTestDatabase({ seedData: { a: [{ _id: '1' }], b: [{ _id: '2' }] } });
    db.clear('a');
    expect(db.getAll('a')).toHaveLength(0);
    expect(db.getAll('b')).toHaveLength(1);
  });
});

describe('simulateNetwork', () => {
  it('should be online by default', () => {
    const net = simulateNetwork();
    expect(net.isOnline()).toBe(true);
  });

  it('should block requests when offline', async () => {
    const net = simulateOffline();
    await expect(net.simulateRequest(async () => 'data')).rejects.toThrow('offline');
  });

  it('should allow requests when online', async () => {
    const net = simulateNetwork('online');
    const result = await net.simulateRequest(async () => 42);
    expect(result).toBe(42);
  });

  it('should add latency when slow', async () => {
    const net = simulateNetwork('slow');
    const start = Date.now();
    await net.simulateRequest(async () => 'ok');
    expect(Date.now() - start).toBeGreaterThanOrEqual(400);
  });

  it('should fail intermittently when flaky', async () => {
    const net = simulateNetwork('flaky');
    let failures = 0;
    for (let i = 0; i < 10; i++) {
      try {
        await net.simulateRequest(async () => 'ok');
      } catch {
        failures++;
      }
    }
    expect(failures).toBeGreaterThan(0);
    expect(failures).toBeLessThan(10);
  });

  it('should switch conditions', () => {
    const net = simulateNetwork('online');
    net.setCondition('offline');
    expect(net.isOnline()).toBe(false);
  });
});

describe('simulateConflict', () => {
  it('should create a conflict scenario', () => {
    const conflict = simulateConflict(
      'todos',
      { _id: 't1', title: 'Original', done: false },
      { title: 'Local Edit' },
      { done: true }
    );

    expect(conflict.documentId).toBe('t1');
    expect(conflict.baseVersion['title']).toBe('Original');
    expect(conflict.localVersion['title']).toBe('Local Edit');
    expect(conflict.remoteVersion['done']).toBe(true);
  });
});

describe('assertConvergence', () => {
  it('should pass for identical document sets', () => {
    const docs = [
      { _id: '1', v: 'a' },
      { _id: '2', v: 'b' },
    ];
    const result = assertConvergence(docs, docs);
    expect(result.converged).toBe(true);
    expect(result.differences).toHaveLength(0);
  });

  it('should detect missing documents', () => {
    const result = assertConvergence([{ _id: '1' }, { _id: '2' }], [{ _id: '1' }]);
    expect(result.converged).toBe(false);
    expect(result.differences.some((d) => d.includes('count mismatch'))).toBe(true);
  });

  it('should detect differing field values', () => {
    const result = assertConvergence([{ _id: '1', v: 'a' }], [{ _id: '1', v: 'b' }]);
    expect(result.converged).toBe(false);
    expect(result.differences.some((d) => d.includes('differs'))).toBe(true);
  });

  it('should pass for same docs in different order', () => {
    const result = assertConvergence(
      [
        { _id: '2', v: 'b' },
        { _id: '1', v: 'a' },
      ],
      [
        { _id: '1', v: 'a' },
        { _id: '2', v: 'b' },
      ]
    );
    expect(result.converged).toBe(true);
  });
});

describe('createMockSync', () => {
  it('should sync documents between databases', () => {
    const dbA = createTestDatabase({ name: 'A', seedData: { todos: [{ _id: '1', title: 'A' }] } });
    const dbB = createTestDatabase({ name: 'B' });

    const sync = createMockSync();
    sync.syncTo(dbA, dbB, 'todos');

    expect(dbB.getAll('todos')).toHaveLength(1);
    expect(sync.history).toHaveLength(1);
    expect(sync.history[0]!.docCount).toBe(1);
  });

  it('should bidirectional sync', () => {
    const dbA = createTestDatabase({ name: 'A', seedData: { todos: [{ _id: '1' }] } });
    const dbB = createTestDatabase({ name: 'B', seedData: { todos: [{ _id: '2' }] } });

    const sync = createMockSync();
    sync.syncBoth(dbA, dbB, 'todos');

    expect(dbA.getAll('todos').length).toBeGreaterThanOrEqual(2);
    expect(dbB.getAll('todos').length).toBeGreaterThanOrEqual(2);
  });
});
