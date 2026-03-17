/**
 * Comprehensive tests for QueryCache.
 *
 * Covers TTL expiration, LRU ordering, buildKey, clear, size,
 * and edge cases like zero-capacity and immediate expiration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryCache, createQueryCache } from '../query-cache.js';

describe('QueryCache', () => {
  // ─── Basic Operations ──────────────────────────────────────────────────────

  describe('basic get/set', () => {
    it('stores and retrieves a value', () => {
      const cache = new QueryCache<string>(10, 60_000);
      cache.set('k', 'v');
      expect(cache.get('k')).toBe('v');
    });

    it('returns undefined for missing key', () => {
      const cache = new QueryCache<string>(10, 60_000);
      expect(cache.get('nope')).toBeUndefined();
    });

    it('overwrites existing key', () => {
      const cache = new QueryCache<string>(10, 60_000);
      cache.set('k', 'v1');
      cache.set('k', 'v2');
      expect(cache.get('k')).toBe('v2');
    });

    it('stores objects by reference', () => {
      const cache = new QueryCache<{ data: number }>(10, 60_000);
      const obj = { data: 42 };
      cache.set('k', obj);
      expect(cache.get('k')).toBe(obj);
    });
  });

  // ─── TTL Expiration ────────────────────────────────────────────────────────

  describe('TTL expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns value within TTL', () => {
      const cache = new QueryCache<string>(10, 1000);
      cache.set('k', 'v');
      vi.advanceTimersByTime(999);
      expect(cache.get('k')).toBe('v');
    });

    it('expires entry after TTL', () => {
      const cache = new QueryCache<string>(10, 1000);
      cache.set('k', 'v');
      vi.advanceTimersByTime(1001);
      expect(cache.get('k')).toBeUndefined();
    });

    it('expired entry is removed from cache', () => {
      const cache = new QueryCache<string>(10, 500);
      cache.set('k', 'v');
      vi.advanceTimersByTime(501);
      cache.get('k'); // triggers deletion
      expect(cache.size).toBe(0);
    });

    it('TTL of 0 expires immediately', () => {
      const cache = new QueryCache<string>(10, 0);
      cache.set('k', 'v');
      vi.advanceTimersByTime(1);
      expect(cache.get('k')).toBeUndefined();
    });

    it('different entries expire independently', () => {
      const cache = new QueryCache<string>(10, 1000);
      cache.set('k1', 'v1');
      vi.advanceTimersByTime(600);
      cache.set('k2', 'v2');
      vi.advanceTimersByTime(500); // k1 at 1100ms, k2 at 500ms
      expect(cache.get('k1')).toBeUndefined();
      expect(cache.get('k2')).toBe('v2');
    });
  });

  // ─── LRU Eviction ─────────────────────────────────────────────────────────

  describe('LRU eviction', () => {
    it('evicts oldest entry at capacity', () => {
      const cache = new QueryCache<string>(3, 60_000);
      cache.set('k1', 'v1');
      cache.set('k2', 'v2');
      cache.set('k3', 'v3');
      cache.set('k4', 'v4'); // evicts k1
      expect(cache.get('k1')).toBeUndefined();
      expect(cache.get('k4')).toBe('v4');
      expect(cache.size).toBe(3);
    });

    it('accessing entry moves it to most-recently-used', () => {
      const cache = new QueryCache<string>(3, 60_000);
      cache.set('k1', 'v1');
      cache.set('k2', 'v2');
      cache.set('k3', 'v3');

      // Access k1, making it most recently used
      cache.get('k1');

      // Now k2 is least recently used
      cache.set('k4', 'v4'); // should evict k2
      expect(cache.get('k1')).toBe('v1');
      expect(cache.get('k2')).toBeUndefined();
      expect(cache.get('k3')).toBeDefined();
      expect(cache.get('k4')).toBe('v4');
    });

    it('handles capacity of 1', () => {
      const cache = new QueryCache<string>(1, 60_000);
      cache.set('k1', 'v1');
      expect(cache.get('k1')).toBe('v1');
      cache.set('k2', 'v2');
      expect(cache.get('k1')).toBeUndefined();
      expect(cache.get('k2')).toBe('v2');
      expect(cache.size).toBe(1);
    });
  });

  // ─── buildKey ──────────────────────────────────────────────────────────────

  describe('buildKey', () => {
    it('includes document count', () => {
      const key = QueryCache.buildKey({ filter: { field: 'x', operator: 'eq', value: 1 } }, 100);
      expect(key).toContain('100:');
    });

    it('generates different keys for different plans', () => {
      const key1 = QueryCache.buildKey({ limit: 10 }, 100);
      const key2 = QueryCache.buildKey({ limit: 20 }, 100);
      expect(key1).not.toBe(key2);
    });

    it('generates different keys for different doc counts', () => {
      const plan = { limit: 10 };
      const key1 = QueryCache.buildKey(plan, 100);
      const key2 = QueryCache.buildKey(plan, 200);
      expect(key1).not.toBe(key2);
    });

    it('same plan + doc count produces same key', () => {
      const plan = { filter: { field: 'a', operator: 'eq', value: 1 }, limit: 5 };
      const key1 = QueryCache.buildKey(plan, 50);
      const key2 = QueryCache.buildKey(plan, 50);
      expect(key1).toBe(key2);
    });
  });

  // ─── clear ─────────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('removes all entries', () => {
      const cache = new QueryCache<string>(10, 60_000);
      cache.set('k1', 'v1');
      cache.set('k2', 'v2');
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('k1')).toBeUndefined();
      expect(cache.get('k2')).toBeUndefined();
    });

    it('clear on empty cache does not throw', () => {
      const cache = new QueryCache<string>(10, 60_000);
      expect(() => cache.clear()).not.toThrow();
    });
  });

  // ─── Hit Rate ──────────────────────────────────────────────────────────────

  describe('hitRate', () => {
    it('starts at 0 with no accesses', () => {
      const cache = new QueryCache<string>(10, 60_000);
      expect(cache.hitRate).toBe(0);
    });

    it('all hits returns 1', () => {
      const cache = new QueryCache<string>(10, 60_000);
      cache.set('k1', 'v1');
      cache.get('k1');
      cache.get('k1');
      cache.get('k1');
      expect(cache.hitRate).toBe(1);
    });

    it('all misses returns 0', () => {
      const cache = new QueryCache<string>(10, 60_000);
      cache.get('missing1');
      cache.get('missing2');
      expect(cache.hitRate).toBe(0);
    });

    it('mixed hits and misses', () => {
      const cache = new QueryCache<string>(10, 60_000);
      cache.set('k1', 'v1');
      cache.get('k1'); // hit
      cache.get('k2'); // miss
      cache.get('k1'); // hit
      cache.get('k3'); // miss
      expect(cache.hitRate).toBe(0.5);
    });
  });

  // ─── size ──────────────────────────────────────────────────────────────────

  describe('size', () => {
    it('starts at 0', () => {
      const cache = new QueryCache<string>(10, 60_000);
      expect(cache.size).toBe(0);
    });

    it('increments on set', () => {
      const cache = new QueryCache<string>(10, 60_000);
      cache.set('k1', 'v1');
      expect(cache.size).toBe(1);
      cache.set('k2', 'v2');
      expect(cache.size).toBe(2);
    });

    it('does not exceed maxSize', () => {
      const cache = new QueryCache<string>(2, 60_000);
      cache.set('k1', 'v1');
      cache.set('k2', 'v2');
      cache.set('k3', 'v3');
      expect(cache.size).toBe(2);
    });
  });

  // ─── createQueryCache factory ──────────────────────────────────────────────

  describe('createQueryCache factory', () => {
    it('creates cache with default parameters', () => {
      const cache = createQueryCache();
      expect(cache).toBeInstanceOf(QueryCache);
      expect(cache.size).toBe(0);
    });

    it('creates cache with custom parameters', () => {
      const cache = createQueryCache<number>(5, 1000);
      cache.set('k', 42);
      expect(cache.get('k')).toBe(42);
    });
  });
});
