import { firstValueFrom } from 'rxjs';
import { skip } from 'rxjs/operators';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineQueue, createOfflineQueue } from '../offline-queue.js';

describe('OfflineQueue', () => {
  let queue: OfflineQueue;

  beforeEach(() => {
    queue = new OfflineQueue();
  });

  describe('enqueue', () => {
    it('adds an item to the queue', () => {
      const item = queue.enqueue({
        collection: 'users',
        operation: 'create',
        data: { name: 'Test' },
      });

      expect(item.id).toBeDefined();
      expect(item.collection).toBe('users');
      expect(item.operation).toBe('create');
      expect(item.timestamp).toBeGreaterThan(0);
      expect(item.retryCount).toBe(0);
      expect(queue.size).toBe(1);
    });

    it('emits updated queue via observable', async () => {
      const nextQueue = firstValueFrom(queue.queue$.pipe(skip(1)));
      queue.enqueue({ collection: 'users', operation: 'create', data: {} });
      const items = await nextQueue;
      expect(items).toHaveLength(1);
    });

    it('throws when queue is full', () => {
      const smallQueue = new OfflineQueue({ maxOfflineQueueSize: 2 });
      smallQueue.enqueue({ collection: 'a', operation: 'create', data: {} });
      smallQueue.enqueue({ collection: 'b', operation: 'create', data: {} });

      expect(() => smallQueue.enqueue({ collection: 'c', operation: 'create', data: {} })).toThrow(
        'Offline queue is full'
      );
    });

    it('assigns unique IDs to each item', () => {
      const item1 = queue.enqueue({ collection: 'a', operation: 'create', data: {} });
      const item2 = queue.enqueue({ collection: 'b', operation: 'create', data: {} });
      expect(item1.id).not.toBe(item2.id);
    });
  });

  describe('drain', () => {
    it('processes all items successfully', async () => {
      queue.enqueue({ collection: 'users', operation: 'create', data: { name: 'A' } });
      queue.enqueue({ collection: 'users', operation: 'create', data: { name: 'B' } });

      const result = await queue.drain(async () => true);
      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
      expect(queue.size).toBe(0);
    });

    it('retries failed items up to max retries', async () => {
      queue.enqueue({ collection: 'users', operation: 'create', data: {} });

      // First drain - all fail, items remain for retry
      const result1 = await queue.drain(async () => false);
      expect(result1.processed).toBe(0);
      expect(queue.size).toBe(1); // Still in queue for retry

      // Keep draining until max retries exhausted
      await queue.drain(async () => false);
      const result3 = await queue.drain(async () => false);
      expect(result3.failed).toBe(1);
      expect(queue.size).toBe(0);
    });

    it('handles processor exceptions', async () => {
      queue.enqueue({ collection: 'users', operation: 'create', data: {} });

      const result = await queue.drain(async () => {
        throw new Error('Network error');
      });
      // First failure, retryCount becomes 1, still < 3
      expect(queue.size).toBe(1);
      expect(result.processed).toBe(0);
    });

    it('empties queue on success and notifies subscribers', async () => {
      queue.enqueue({ collection: 'users', operation: 'create', data: {} });

      const nextQueue = firstValueFrom(queue.queue$.pipe(skip(1)));
      await queue.drain(async () => true);
      const items = await nextQueue;
      expect(items).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('removes all items from the queue', () => {
      queue.enqueue({ collection: 'a', operation: 'create', data: {} });
      queue.enqueue({ collection: 'b', operation: 'update', data: {} });
      expect(queue.size).toBe(2);

      queue.clear();
      expect(queue.size).toBe(0);
    });

    it('notifies subscribers of empty queue', async () => {
      queue.enqueue({ collection: 'a', operation: 'create', data: {} });
      const nextQueue = firstValueFrom(queue.queue$.pipe(skip(1)));
      queue.clear();
      const items = await nextQueue;
      expect(items).toHaveLength(0);
    });
  });

  describe('destroy', () => {
    it('clears items and completes the observable', () => {
      queue.enqueue({ collection: 'a', operation: 'create', data: {} });
      const completeSpy = vi.fn();
      queue.queue$.subscribe({ complete: completeSpy });

      queue.destroy();
      expect(queue.size).toBe(0);
      expect(completeSpy).toHaveBeenCalled();
    });
  });

  describe('createOfflineQueue', () => {
    it('creates a queue with config', () => {
      const q = createOfflineQueue({ maxOfflineQueueSize: 5 });
      expect(q).toBeInstanceOf(OfflineQueue);

      for (let i = 0; i < 5; i++) {
        q.enqueue({ collection: 'x', operation: 'create', data: {} });
      }
      expect(() => q.enqueue({ collection: 'x', operation: 'create', data: {} })).toThrow(
        'Offline queue is full'
      );
    });
  });
});
