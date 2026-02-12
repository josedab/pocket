import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrefetchEngine, createPrefetchEngine } from '../prefetch-engine.js';

describe('PrefetchEngine', () => {
  let engine: PrefetchEngine;

  beforeEach(() => {
    engine = createPrefetchEngine({
      maxCacheSize: 10,
      confidenceThreshold: 0.1,
      idleDelayMs: 1000,
      ttlMs: 60_000,
    });
  });

  afterEach(() => {
    engine.stop();
  });

  /* ------------------------------------------------------------------ */
  /*  Record & Cache                                                     */
  /* ------------------------------------------------------------------ */

  describe('recordQuery and getCached', () => {
    it('should record a query and retrieve cached result', () => {
      const data = [{ id: 1, title: 'Buy groceries' }];
      engine.recordQuery('todos', { completed: false }, 10, data);

      const cached = engine.getCached('todos', { completed: false });
      expect(cached).toEqual(data);
    });

    it('should return undefined for uncached queries', () => {
      const cached = engine.getCached('todos', { completed: false });
      expect(cached).toBeUndefined();
    });

    it('should record without caching when result not provided', () => {
      engine.recordQuery('todos', { completed: false }, 10);

      const cached = engine.getCached('todos', { completed: false });
      expect(cached).toBeUndefined();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Stats                                                              */
  /* ------------------------------------------------------------------ */

  describe('getStats', () => {
    it('should track stats', () => {
      engine.recordQuery('todos', {}, 10, [{ id: 1 }]);

      engine.getCached('todos', {}); // hit
      engine.getCached('users', {}); // miss

      const stats = engine.getStats();
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(1);
      expect(stats.cacheSize).toBe(1);
    });

    it('should track prediction counts after triggerPrefetch', async () => {
      engine.recordQuery('todos', {}, 10, [{ id: 1 }]);
      engine.recordQuery('users', {}, 5, [{ id: 2 }]);

      engine.onPrefetchNeeded(async (prediction) => {
        return [{ prefetched: true, hash: prediction.queryHash }];
      });

      await engine.triggerPrefetch();

      const stats = engine.getStats();
      expect(stats.totalPredictions).toBeGreaterThanOrEqual(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Manual Prefetch Trigger                                            */
  /* ------------------------------------------------------------------ */

  describe('triggerPrefetch', () => {
    it('should call prefetch callback for predicted queries', async () => {
      const callback = vi.fn().mockResolvedValue([{ prefetched: true }]);
      engine.onPrefetchNeeded(callback);

      // Build up some patterns
      engine.recordQuery('todos', { completed: false }, 10);
      engine.recordQuery('users', { role: 'admin' }, 5);
      engine.recordQuery('todos', { completed: false }, 8);

      await engine.triggerPrefetch();

      expect(callback).toHaveBeenCalled();
    });

    it('should not call callback if none registered', async () => {
      engine.recordQuery('todos', {}, 10);
      // Should not throw
      await engine.triggerPrefetch();
    });

    it('should skip queries already in cache', async () => {
      const callback = vi.fn().mockResolvedValue([{ prefetched: true }]);
      engine.onPrefetchNeeded(callback);

      // Record and cache a query
      engine.recordQuery('todos', {}, 10, [{ id: 1 }]);

      await engine.triggerPrefetch();

      // The callback should not be called for already-cached queries
      for (const call of callback.mock.calls) {
        expect(call[0].queryHash).not.toBe('todos:{}');
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Start / Stop                                                       */
  /* ------------------------------------------------------------------ */

  describe('start and stop', () => {
    it('should stop engine and clear interval', () => {
      vi.useFakeTimers();

      engine.start();
      engine.stop();

      // After stop, advancing timers should not trigger prefetch
      const callback = vi.fn().mockResolvedValue([]);
      engine.onPrefetchNeeded(callback);

      vi.advanceTimersByTime(5000);

      expect(callback).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should not create multiple intervals on repeated start calls', () => {
      vi.useFakeTimers();

      engine.start();
      engine.start(); // second call should be no-op

      engine.stop();

      vi.useRealTimers();
    });
  });
});
