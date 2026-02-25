import { describe, expect, it } from 'vitest';
import { OptimisticSyncQueue } from '../optimistic-sync-queue.js';

describe('OptimisticSyncQueue', () => {
  function makeInput(overrides = {}) {
    return {
      collection: 'todos',
      documentId: 'td-1',
      operation: 'update' as const,
      changes: { completed: true },
      previousState: { completed: false },
      ...overrides,
    };
  }

  it('should enqueue mutations with pending status', () => {
    const q = new OptimisticSyncQueue();
    const m = q.enqueue(makeInput());
    expect(m.status).toBe('pending');
    expect(m.collection).toBe('todos');
    expect(q.hasPending).toBe(true);
    expect(q.getPending()).toHaveLength(1);
    q.destroy();
  });

  it('should confirm mutations', () => {
    const q = new OptimisticSyncQueue();
    const m = q.enqueue(makeInput());
    expect(q.confirm(m.id)).toBe(true);
    expect(q.getMutation(m.id)!.status).toBe('confirmed');
    expect(q.hasPending).toBe(false);
    q.destroy();
  });

  it('should reject mutations and auto-rollback', () => {
    const q = new OptimisticSyncQueue({ autoRollback: true });
    const m = q.enqueue(makeInput());
    q.reject(m.id, 'Conflict');
    expect(q.getMutation(m.id)!.status).toBe('rolled-back');
    expect(q.hasPending).toBe(false);
    q.destroy();
  });

  it('should reject without rollback when disabled', () => {
    const q = new OptimisticSyncQueue({ autoRollback: false });
    const m = q.enqueue(makeInput());
    q.reject(m.id, 'Server error');
    expect(q.getMutation(m.id)!.status).toBe('rejected');
    q.destroy();
  });

  it('should rollback and return previous state', () => {
    const q = new OptimisticSyncQueue({ autoRollback: false });
    const m = q.enqueue(makeInput({ previousState: { completed: false, title: 'Test' } }));
    const prev = q.rollback(m.id);
    expect(prev).toEqual({ completed: false, title: 'Test' });
    q.destroy();
  });

  it('should retry rejected mutations', () => {
    const q = new OptimisticSyncQueue({ autoRollback: false, maxRetries: 3 });
    const m = q.enqueue(makeInput());
    q.reject(m.id, 'Timeout');
    expect(q.retry(m.id)).toBe(true);
    expect(q.getMutation(m.id)!.status).toBe('pending');
    expect(q.getMutation(m.id)!.retryCount).toBe(1);
    q.destroy();
  });

  it('should not retry beyond max retries', () => {
    const q = new OptimisticSyncQueue({ autoRollback: false, maxRetries: 1 });
    const m = q.enqueue(makeInput());
    q.reject(m.id, 'Fail');
    q.retry(m.id);
    q.reject(m.id, 'Fail again');
    expect(q.retry(m.id)).toBe(false);
    q.destroy();
  });

  it('should maintain pending order', () => {
    const q = new OptimisticSyncQueue();
    const m1 = q.enqueue(makeInput({ documentId: 'd1' }));
    const m2 = q.enqueue(makeInput({ documentId: 'd2' }));
    const m3 = q.enqueue(makeInput({ documentId: 'd3' }));

    const pending = q.getPending();
    expect(pending[0]!.id).toBe(m1.id);
    expect(pending[1]!.id).toBe(m2.id);
    expect(pending[2]!.id).toBe(m3.id);
    q.destroy();
  });

  it('should filter pending by document', () => {
    const q = new OptimisticSyncQueue();
    q.enqueue(makeInput({ documentId: 'd1' }));
    q.enqueue(makeInput({ documentId: 'd2' }));
    q.enqueue(makeInput({ documentId: 'd1' }));

    const d1Pending = q.getPendingForDocument('todos', 'd1');
    expect(d1Pending).toHaveLength(2);
    q.destroy();
  });

  it('should confirmAll pending mutations', () => {
    const q = new OptimisticSyncQueue();
    q.enqueue(makeInput({ documentId: 'd1' }));
    q.enqueue(makeInput({ documentId: 'd2' }));
    q.enqueue(makeInput({ documentId: 'd3' }));

    const count = q.confirmAll();
    expect(count).toBe(3);
    expect(q.hasPending).toBe(false);
    q.destroy();
  });

  it('should prune confirmed/rolled-back mutations', () => {
    const q = new OptimisticSyncQueue();
    const m1 = q.enqueue(makeInput({ documentId: 'd1' }));
    const m2 = q.enqueue(makeInput({ documentId: 'd2' }));
    q.confirm(m1.id);
    q.reject(m2.id, 'err');

    const pruned = q.prune();
    expect(pruned).toBe(2);
    expect(q.getMutation(m1.id)).toBeUndefined();
    q.destroy();
  });

  it('should handle queue overflow by dropping oldest', () => {
    const q = new OptimisticSyncQueue({ maxQueueSize: 5 });
    const events: string[] = [];
    q.events$.subscribe((e) => events.push(e.type));

    for (let i = 0; i < 8; i++) {
      q.enqueue(makeInput({ documentId: `d${i}` }));
    }

    expect(events).toContain('queue-overflow');
    q.destroy();
  });

  it('should track statistics', () => {
    const q = new OptimisticSyncQueue();
    q.enqueue(makeInput({ documentId: 'd1' }));
    const m2 = q.enqueue(makeInput({ documentId: 'd2' }));
    q.confirm(m2.id);
    q.enqueue(makeInput({ documentId: 'd3' }));

    const stats = q.getStats();
    expect(stats.pending).toBe(2);
    expect(stats.confirmed).toBe(1);
    expect(stats.totalEnqueued).toBe(3);
    expect(stats.oldestPendingAge).not.toBeNull();
    q.destroy();
  });

  it('should emit events via observable', () => {
    const q = new OptimisticSyncQueue();
    const events: string[] = [];
    q.events$.subscribe((e) => events.push(e.type));

    const m = q.enqueue(makeInput());
    q.confirm(m.id);

    expect(events).toContain('enqueued');
    expect(events).toContain('confirmed');
    q.destroy();
  });
});
