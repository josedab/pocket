import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DataLoaderRegistry,
  createDataLoaderRegistry,
} from '../data-loader.js';
import type { BatchLoadFn } from '../data-loader.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** A simple in-memory batch function that returns `{ id, value }` objects. */
function createBatchFn(): BatchLoadFn<{ id: string; value: string }> {
  return vi.fn(async (keys: string[]) =>
    keys.map((k) => ({ id: k, value: `val-${k}` })),
  );
}

/* ================================================================== */
/*  DataLoaderRegistry                                                 */
/* ================================================================== */

describe('DataLoaderRegistry', () => {
  let registry: DataLoaderRegistry;
  let batchFn: ReturnType<typeof createBatchFn>;

  beforeEach(() => {
    registry = createDataLoaderRegistry();
    batchFn = createBatchFn();
    registry.registerLoader('users', batchFn);
  });

  /* ---------------------------------------------------------------- */
  /*  Factory                                                          */
  /* ---------------------------------------------------------------- */

  describe('createDataLoaderRegistry', () => {
    it('returns a DataLoaderRegistry instance', () => {
      expect(registry).toBeInstanceOf(DataLoaderRegistry);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  registerLoader                                                    */
  /* ---------------------------------------------------------------- */

  describe('registerLoader', () => {
    it('registers a batch function for a collection', () => {
      expect(registry.getRegisteredCollections()).toContain('users');
    });

    it('replaces an existing loader for the same collection', () => {
      const newBatch = createBatchFn();
      registry.registerLoader('users', newBatch);
      expect(registry.getRegisteredCollections()).toEqual(['users']);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  load                                                              */
  /* ---------------------------------------------------------------- */

  describe('load', () => {
    it('returns a single item', async () => {
      const result = await registry.load('users', 'u1');
      expect(result).toEqual({ id: 'u1', value: 'val-u1' });
    });

    it('throws when collection is not registered', async () => {
      await expect(registry.load('unknown', 'k')).rejects.toThrow(
        'no loader registered for collection "unknown"',
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /*  loadMany                                                          */
  /* ---------------------------------------------------------------- */

  describe('loadMany', () => {
    it('returns multiple items', async () => {
      const results = await registry.loadMany('users', ['u1', 'u2']);
      expect(results).toEqual([
        { id: 'u1', value: 'val-u1' },
        { id: 'u2', value: 'val-u2' },
      ]);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Batching                                                          */
  /* ---------------------------------------------------------------- */

  describe('batching', () => {
    it('batches multiple load calls within the same tick', async () => {
      const [r1, r2, r3] = await Promise.all([
        registry.load('users', 'a'),
        registry.load('users', 'b'),
        registry.load('users', 'c'),
      ]);

      expect(r1).toEqual({ id: 'a', value: 'val-a' });
      expect(r2).toEqual({ id: 'b', value: 'val-b' });
      expect(r3).toEqual({ id: 'c', value: 'val-c' });

      // The batch function should have been called exactly once
      expect(batchFn).toHaveBeenCalledTimes(1);
      expect(batchFn).toHaveBeenCalledWith(['a', 'b', 'c']);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Caching                                                           */
  /* ---------------------------------------------------------------- */

  describe('caching', () => {
    it('caches results and serves subsequent loads from cache', async () => {
      await registry.load('users', 'u1');
      await registry.load('users', 'u1');

      // Second load should be a cache hit — batchFn called only once
      const stats = registry.getStats('users');
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  clearCache / clearAll                                             */
  /* ---------------------------------------------------------------- */

  describe('clearCache', () => {
    it('clears cache for a specific collection', async () => {
      await registry.load('users', 'u1');
      registry.clearCache('users');

      const stats = registry.getStats('users');
      expect(stats.cacheSize).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('clears caches for all collections', async () => {
      const otherBatch = createBatchFn();
      registry.registerLoader('posts', otherBatch);

      await registry.load('users', 'u1');
      await registry.load('posts', 'p1');

      registry.clearAll();

      expect(registry.getStats('users').cacheSize).toBe(0);
      expect(registry.getStats('posts').cacheSize).toBe(0);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  getStats / getAllStats                                             */
  /* ---------------------------------------------------------------- */

  describe('getStats', () => {
    it('returns hit/miss counts for a collection', async () => {
      await registry.load('users', 'u1');
      const stats = registry.getStats('users');

      expect(stats.collection).toBe('users');
      expect(stats.loads).toBe(1);
      expect(stats.batchCalls).toBe(1);
      expect(stats.cacheMisses).toBe(1);
      expect(stats.cacheHits).toBe(0);
      expect(stats.cacheSize).toBe(1);
    });
  });

  describe('getAllStats', () => {
    it('returns stats for all registered collections', async () => {
      registry.registerLoader('posts', createBatchFn());
      const allStats = registry.getAllStats();

      expect(allStats).toHaveLength(2);
      expect(allStats.map((s) => s.collection).sort()).toEqual(['posts', 'users']);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  getRegisteredCollections                                          */
  /* ---------------------------------------------------------------- */

  describe('getRegisteredCollections', () => {
    it('lists all registered collection names', () => {
      registry.registerLoader('posts', createBatchFn());
      expect(registry.getRegisteredCollections().sort()).toEqual(['posts', 'users']);
    });
  });
});
