import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOfflineQueue, OfflineQueue } from '../offline-queue.js';
import type { QueuedOperation } from '../types.js';

describe('OfflineQueue', () => {
  let queue: OfflineQueue;

  beforeEach(() => {
    queue = createOfflineQueue();
  });

  afterEach(() => {
    queue.destroy();
  });

  describe('createOfflineQueue', () => {
    it('returns an OfflineQueue instance', () => {
      expect(queue).toBeInstanceOf(OfflineQueue);
    });

    it('accepts optional config', () => {
      queue.destroy();
      queue = createOfflineQueue({ maxSize: 10, conflictStrategy: 'server-wins' });
      expect(queue).toBeInstanceOf(OfflineQueue);
      expect(queue.getConflictStrategy()).toBe('server-wins');
    });
  });

  describe('enqueue', () => {
    it('adds an operation and returns it with generated fields', () => {
      const op = queue.enqueue({
        collection: 'todos',
        type: 'insert',
        payload: { title: 'Test' },
      });
      expect(op.id).toBeDefined();
      expect(op.collection).toBe('todos');
      expect(op.type).toBe('insert');
      expect(op.priority).toBe('normal');
      expect(op.retryCount).toBe(0);
      expect(op.timestamp).toBeGreaterThan(0);
      expect(queue.size()).toBe(1);
    });

    it('uses provided priority', () => {
      const op = queue.enqueue({
        collection: 'todos',
        type: 'insert',
        payload: {},
        priority: 'high',
      });
      expect(op.priority).toBe('high');
    });

    it('updates status from empty to idle', () => {
      expect(queue.getStatus()).toBe('empty');
      queue.enqueue({ collection: 'todos', type: 'insert', payload: {} });
      expect(queue.getStatus()).toBe('idle');
    });
  });

  describe('peek', () => {
    it('returns the next operation without removing it', () => {
      queue.enqueue({ collection: 'todos', type: 'insert', payload: { n: 1 } });
      const peeked = queue.peek();
      expect(peeked).not.toBeNull();
      expect(queue.size()).toBe(1);
    });

    it('returns null when empty', () => {
      expect(queue.peek()).toBeNull();
    });
  });

  describe('dequeue', () => {
    it('returns and removes the highest-priority operation', () => {
      queue.enqueue({ collection: 'todos', type: 'insert', payload: {}, priority: 'low' });
      queue.enqueue({ collection: 'todos', type: 'insert', payload: {}, priority: 'high' });
      const op = queue.dequeue();
      expect(op!.priority).toBe('high');
      expect(queue.size()).toBe(1);
    });

    it('returns null when empty', () => {
      expect(queue.dequeue()).toBeNull();
    });

    it('updates status to empty when last item is dequeued', () => {
      queue.enqueue({ collection: 'todos', type: 'insert', payload: {} });
      queue.dequeue();
      expect(queue.getStatus()).toBe('empty');
    });
  });

  describe('getByCollection', () => {
    it('filters operations by collection name', () => {
      queue.enqueue({ collection: 'todos', type: 'insert', payload: {} });
      queue.enqueue({ collection: 'notes', type: 'insert', payload: {} });
      queue.enqueue({ collection: 'todos', type: 'update', payload: {} });

      const todos = queue.getByCollection('todos');
      expect(todos).toHaveLength(2);
      expect(todos.every((op) => op.collection === 'todos')).toBe(true);
    });

    it('returns empty array for unknown collection', () => {
      queue.enqueue({ collection: 'todos', type: 'insert', payload: {} });
      expect(queue.getByCollection('unknown')).toEqual([]);
    });
  });

  describe('remove', () => {
    it('deletes a specific operation by ID', () => {
      const op = queue.enqueue({ collection: 'todos', type: 'insert', payload: {} });
      expect(queue.remove(op.id)).toBe(true);
      expect(queue.size()).toBe(0);
    });

    it('returns false for non-existent IDs', () => {
      expect(queue.remove('non-existent-id')).toBe(false);
    });

    it('updates status to empty when last item is removed', () => {
      const op = queue.enqueue({ collection: 'todos', type: 'insert', payload: {} });
      queue.remove(op.id);
      expect(queue.getStatus()).toBe('empty');
    });
  });

  describe('replay', () => {
    it('executes all queued operations and returns results', async () => {
      queue.enqueue({ collection: 'todos', type: 'insert', payload: { n: 1 } });
      queue.enqueue({ collection: 'todos', type: 'insert', payload: { n: 2 } });

      const results = await queue.replay();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
      expect(queue.size()).toBe(0);
    });

    it('returns empty array when queue is empty', async () => {
      const results = await queue.replay();
      expect(results).toEqual([]);
    });

    it('sets status to replaying during replay', async () => {
      queue.enqueue({ collection: 'todos', type: 'insert', payload: {} });

      const statusesObserved: string[] = [];
      queue.status$.subscribe((s) => statusesObserved.push(s));

      await queue.replay();
      expect(statusesObserved).toContain('replaying');
    });

    it('calls onReplayComplete callback', async () => {
      const onReplayComplete = vi.fn();
      queue.destroy();
      queue = createOfflineQueue({ onReplayComplete });

      queue.enqueue({ collection: 'todos', type: 'insert', payload: {} });
      await queue.replay();

      expect(onReplayComplete).toHaveBeenCalledOnce();
      expect(onReplayComplete.mock.calls[0]![0]).toHaveLength(1);
    });

    it('sets status to empty after successful replay', async () => {
      queue.enqueue({ collection: 'todos', type: 'insert', payload: {} });
      await queue.replay();
      expect(queue.getStatus()).toBe('empty');
    });
  });

  describe('priority ordering', () => {
    it('orders operations by priority: critical > high > normal > low', () => {
      queue.enqueue({ collection: 'a', type: 'insert', payload: {}, priority: 'low' });
      queue.enqueue({ collection: 'b', type: 'insert', payload: {}, priority: 'critical' });
      queue.enqueue({ collection: 'c', type: 'insert', payload: {}, priority: 'normal' });
      queue.enqueue({ collection: 'd', type: 'insert', payload: {}, priority: 'high' });

      const all = queue.getAll();
      expect(all[0]!.collection).toBe('b'); // critical
      expect(all[1]!.collection).toBe('d'); // high
      expect(all[2]!.collection).toBe('c'); // normal
      expect(all[3]!.collection).toBe('a'); // low
    });

    it('dequeues highest priority first', () => {
      queue.enqueue({ collection: 'a', type: 'insert', payload: {}, priority: 'low' });
      queue.enqueue({ collection: 'b', type: 'insert', payload: {}, priority: 'high' });

      const first = queue.dequeue();
      expect(first!.priority).toBe('high');
    });
  });

  describe('serialize/deserialize', () => {
    it('persists and restores the queue', () => {
      queue.enqueue({ collection: 'todos', type: 'insert', payload: { title: 'A' } });
      queue.enqueue({ collection: 'notes', type: 'update', payload: { title: 'B' } });

      const serialized = queue.serialize();

      queue.destroy();
      queue = createOfflineQueue();
      queue.deserialize(serialized);

      expect(queue.size()).toBe(2);
      const all = queue.getAll();
      expect(all[0]!.collection).toBe('todos');
    });

    it('updates status after deserialize', () => {
      queue.enqueue({ collection: 'todos', type: 'insert', payload: {} });
      const serialized = queue.serialize();

      queue.destroy();
      queue = createOfflineQueue();
      expect(queue.getStatus()).toBe('empty');

      queue.deserialize(serialized);
      expect(queue.getStatus()).toBe('idle');
    });

    it('handles empty serialized data', () => {
      queue.deserialize('[]');
      expect(queue.size()).toBe(0);
      expect(queue.getStatus()).toBe('empty');
    });
  });

  describe('getAll', () => {
    it('returns a copy of all queued operations', () => {
      queue.enqueue({ collection: 'todos', type: 'insert', payload: { n: 1 } });
      queue.enqueue({ collection: 'todos', type: 'insert', payload: { n: 2 } });

      const all = queue.getAll();
      expect(all).toHaveLength(2);

      // Verify it's a copy
      all.length = 0;
      expect(queue.size()).toBe(2);
    });
  });

  describe('clear', () => {
    it('empties the queue', () => {
      queue.enqueue({ collection: 'todos', type: 'insert', payload: {} });
      queue.enqueue({ collection: 'notes', type: 'insert', payload: {} });
      queue.clear();
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
      expect(queue.getStatus()).toBe('empty');
    });
  });

  describe('max queue size enforcement', () => {
    it('evicts lowest-priority item when queue is full', () => {
      queue.destroy();
      queue = createOfflineQueue({ maxSize: 2 });

      queue.enqueue({ collection: 'a', type: 'insert', payload: {}, priority: 'high' });
      queue.enqueue({ collection: 'b', type: 'insert', payload: {}, priority: 'normal' });
      // This should evict the lowest-priority item ('normal')
      queue.enqueue({ collection: 'c', type: 'insert', payload: {}, priority: 'critical' });

      expect(queue.size()).toBe(2);
      const all = queue.getAll();
      const priorities = all.map((op) => op.priority);
      expect(priorities).toContain('critical');
      expect(priorities).toContain('high');
    });

    it('reports isFull correctly', () => {
      queue.destroy();
      queue = createOfflineQueue({ maxSize: 1 });
      expect(queue.isFull()).toBe(false);

      queue.enqueue({ collection: 'a', type: 'insert', payload: {} });
      expect(queue.isFull()).toBe(true);
    });
  });

  describe('destroy', () => {
    it('clears the queue', () => {
      queue.enqueue({ collection: 'a', type: 'insert', payload: {} });
      queue.destroy();
      expect(queue.size()).toBe(0);
    });

    it('completes status$ observable', () => {
      let completed = false;
      queue.status$.subscribe({ complete: () => { completed = true; } });
      queue.destroy();
      expect(completed).toBe(true);
    });

    it('completes replayed$ observable', () => {
      let completed = false;
      queue.replayed$.subscribe({ complete: () => { completed = true; } });
      queue.destroy();
      expect(completed).toBe(true);
    });
  });
});
