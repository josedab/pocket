import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrefetchCache, createPrefetchCache } from '../prefetch-cache.js';

describe('PrefetchCache', () => {
  let cache: PrefetchCache;

  beforeEach(() => {
    cache = createPrefetchCache({ maxCacheSize: 3, ttlMs: 5000 });
  });

  /* ------------------------------------------------------------------ */
  /*  Set & Get                                                          */
  /* ------------------------------------------------------------------ */

  describe('set and get', () => {
    it('should set and get cache entries', () => {
      cache.set('q1', [{ id: 1 }, { id: 2 }]);

      const result = cache.get('q1');
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should return undefined for missing entries', () => {
      const result = cache.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should overwrite existing entries', () => {
      cache.set('q1', [{ id: 1 }]);
      cache.set('q1', [{ id: 2 }]);

      const result = cache.get('q1');
      expect(result).toEqual([{ id: 2 }]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  TTL Expiration                                                     */
  /* ------------------------------------------------------------------ */

  describe('TTL expiration', () => {
    it('should expire entries after TTL', () => {
      cache.set('q1', [{ id: 1 }], 50);

      vi.useFakeTimers();
      vi.advanceTimersByTime(100);

      const result = cache.get('q1');
      expect(result).toBeUndefined();

      vi.useRealTimers();
    });

    it('should return data before TTL expires', () => {
      vi.useFakeTimers();
      cache.set('q1', [{ id: 1 }], 1000);

      vi.advanceTimersByTime(500);
      const result = cache.get('q1');
      expect(result).toEqual([{ id: 1 }]);

      vi.useRealTimers();
    });

    it('should report expired entries as not present via has()', () => {
      cache.set('q1', [{ id: 1 }], 50);

      vi.useFakeTimers();
      vi.advanceTimersByTime(100);

      expect(cache.has('q1')).toBe(false);

      vi.useRealTimers();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  LRU Eviction                                                       */
  /* ------------------------------------------------------------------ */

  describe('LRU eviction', () => {
    it('should evict oldest entry when max size reached', () => {
      cache.set('q1', [1]);
      cache.set('q2', [2]);
      cache.set('q3', [3]);

      // Cache is full (maxCacheSize: 3), adding q4 evicts q1
      cache.set('q4', [4]);

      expect(cache.has('q1')).toBe(false);
      expect(cache.has('q2')).toBe(true);
      expect(cache.has('q4')).toBe(true);
    });

    it('should refresh LRU position on get', () => {
      cache.set('q1', [1]);
      cache.set('q2', [2]);
      cache.set('q3', [3]);

      // Access q1 to move it to most-recent
      cache.get('q1');

      // Adding q4 should now evict q2 (oldest after q1 was refreshed)
      cache.set('q4', [4]);

      expect(cache.has('q1')).toBe(true);
      expect(cache.has('q2')).toBe(false);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Stats                                                              */
  /* ------------------------------------------------------------------ */

  describe('getStats', () => {
    it('should track hit rate', () => {
      cache.set('q1', [1]);

      cache.get('q1'); // hit
      cache.get('q2'); // miss
      cache.get('q1'); // hit

      const stats = cache.getStats();
      expect(stats.cacheHits).toBe(2);
      expect(stats.cacheMisses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
    });

    it('should return zero hit rate when no accesses', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });

    it('should report cache size', () => {
      cache.set('q1', [1]);
      cache.set('q2', [2]);

      const stats = cache.getStats();
      expect(stats.cacheSize).toBe(2);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Prune                                                              */
  /* ------------------------------------------------------------------ */

  describe('prune', () => {
    it('should remove expired entries', () => {
      vi.useFakeTimers();

      cache.set('q1', [1], 50);
      cache.set('q2', [2], 5000);

      vi.advanceTimersByTime(100);

      cache.prune();

      expect(cache.has('q1')).toBe(false);
      expect(cache.has('q2')).toBe(true);
      expect(cache.getStats().cacheSize).toBe(1);

      vi.useRealTimers();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Clear & Evict                                                      */
  /* ------------------------------------------------------------------ */

  describe('clear and evict', () => {
    it('should clear all entries', () => {
      cache.set('q1', [1]);
      cache.set('q2', [2]);

      cache.clear();

      expect(cache.has('q1')).toBe(false);
      expect(cache.has('q2')).toBe(false);
      expect(cache.getStats().cacheSize).toBe(0);
    });

    it('should evict a specific entry', () => {
      cache.set('q1', [1]);
      cache.set('q2', [2]);

      cache.evict('q1');

      expect(cache.has('q1')).toBe(false);
      expect(cache.has('q2')).toBe(true);
    });
  });
});
