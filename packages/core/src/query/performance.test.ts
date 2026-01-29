import { describe, it, expect, beforeEach } from 'vitest';
import { QueryCache } from './query-cache.js';
import { IndexAdvisor } from './index-advisor.js';
import { PredictivePrefetcher } from './predictive-prefetch.js';

// ── QueryCache ──────────────────────────────────────────────────────

describe('QueryCache', () => {
  let cache: QueryCache;

  beforeEach(() => {
    cache = new QueryCache({ maxSize: 5, defaultTTL: 1000 });
  });

  it('should return undefined on cache miss', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should store and retrieve entries', () => {
    const docs = [{ _id: '1', name: 'Alice' }];
    cache.set('users:all', docs);
    expect(cache.get('users:all')).toEqual(docs);
  });

  it('should evict LRU entries when at capacity', () => {
    for (let i = 0; i < 6; i++) {
      cache.set(`key${i}`, [{ _id: String(i) }]);
    }
    // key0 should have been evicted
    expect(cache.get('key0')).toBeUndefined();
    expect(cache.get('key5')).toBeDefined();
  });

  it('should expire entries after TTL', async () => {
    cache = new QueryCache({ maxSize: 10, defaultTTL: 50 });
    cache.set('k', [{ _id: '1' }]);
    expect(cache.get('k')).toBeDefined();

    await new Promise((r) => setTimeout(r, 80));
    expect(cache.get('k')).toBeUndefined();
  });

  it('should invalidate collection entries', () => {
    cache.set('users:q1', [{ _id: '1' }]);
    cache.set('users:q2', [{ _id: '2' }]);
    cache.set('todos:q1', [{ _id: '3' }]);

    cache.invalidateCollection('users');

    expect(cache.get('users:q1')).toBeUndefined();
    expect(cache.get('users:q2')).toBeUndefined();
    expect(cache.get('todos:q1')).toBeDefined();
  });

  it('should track hit/miss statistics', () => {
    cache.set('k', [{ _id: '1' }]);
    cache.get('k');       // hit
    cache.get('k');       // hit
    cache.get('missing'); // miss

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3);
  });

  it('should prune expired entries', async () => {
    cache = new QueryCache({ maxSize: 10, defaultTTL: 50 });
    cache.set('a', [{ _id: '1' }]);
    cache.set('b', [{ _id: '2' }]);

    await new Promise((r) => setTimeout(r, 80));
    const pruned = cache.prune();
    expect(pruned).toBe(2);
    expect(cache.getStats().size).toBe(0);
  });

  it('should build deterministic cache keys', () => {
    const key1 = QueryCache.buildKey('users', { filter: { age: 25 }, sort: 'name' });
    const key2 = QueryCache.buildKey('users', { sort: 'name', filter: { age: 25 } });
    expect(key1).toBe(key2);
  });
});

// ── IndexAdvisor ────────────────────────────────────────────────────

describe('IndexAdvisor', () => {
  let advisor: IndexAdvisor;

  beforeEach(() => {
    advisor = new IndexAdvisor({ minQueryCount: 2, maxSuggestions: 5 });
  });

  it('should not suggest indexes below threshold', () => {
    advisor.recordQuery('users', ['name'], []);
    expect(advisor.suggest()).toHaveLength(0);
  });

  it('should suggest indexes for frequent patterns', () => {
    for (let i = 0; i < 5; i++) {
      advisor.recordQuery('users', ['email'], ['createdAt']);
    }
    const suggestions = advisor.suggest();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]!.collection).toBe('users');
    expect(suggestions[0]!.fields).toContain('email');
  });

  it('should skip suggestions covered by existing indexes', () => {
    for (let i = 0; i < 5; i++) {
      advisor.recordQuery('users', ['email'], []);
    }

    const existing = new Map<string, string[][]>();
    existing.set('users', [['email']]);

    const suggestions = advisor.suggest(existing);
    expect(suggestions).toHaveLength(0);
  });

  it('should rank suggestions by impact', () => {
    for (let i = 0; i < 10; i++) {
      advisor.recordQuery('users', ['status'], []);
    }
    for (let i = 0; i < 3; i++) {
      advisor.recordQuery('users', ['email'], []);
    }

    const suggestions = advisor.suggest();
    expect(suggestions[0]!.fields).toContain('status');
  });

  it('should clear patterns', () => {
    advisor.recordQuery('users', ['name'], []);
    advisor.clear();
    expect(advisor.getPatternCount()).toBe(0);
  });
});

// ── PredictivePrefetcher ────────────────────────────────────────────

describe('PredictivePrefetcher', () => {
  let prefetcher: PredictivePrefetcher;

  beforeEach(() => {
    prefetcher = new PredictivePrefetcher({
      minProbability: 0.5,
      cooldownMs: 100,
    });
  });

  it('should record accesses without error', () => {
    prefetcher.recordAccess('users');
    prefetcher.recordAccess('todos');
    expect(prefetcher.getStats().trackedCollections).toBe(2);
  });

  it('should detect co-access patterns', () => {
    // Simulate users → todos pattern repeatedly
    for (let i = 0; i < 5; i++) {
      prefetcher.recordAccess('users');
      prefetcher.recordAccess('todos');
    }

    const rules = prefetcher.getRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0]!.source).toBe('users');
    expect(rules[0]!.target).toBe('todos');
    expect(rules[0]!.probability).toBeGreaterThanOrEqual(0.5);
  });

  it('should fire prefetch callback for high-probability targets', () => {
    const prefetched: string[] = [];
    prefetcher.onPrefetch = (collection) => prefetched.push(collection);

    // Build up pattern
    for (let i = 0; i < 5; i++) {
      prefetcher.recordAccess('users');
      prefetcher.recordAccess('todos');
    }

    expect(prefetched).toContain('todos');
  });

  it('should respect cooldown period', async () => {
    const prefetched: string[] = [];
    prefetcher.onPrefetch = (collection) => prefetched.push(collection);

    for (let i = 0; i < 3; i++) {
      prefetcher.recordAccess('users');
      prefetcher.recordAccess('todos');
    }

    const countBefore = prefetched.length;

    // Immediate re-trigger should be suppressed by cooldown
    prefetcher.recordAccess('users');
    expect(prefetched.length).toBe(countBefore);

    // After cooldown, should fire again
    await new Promise((r) => setTimeout(r, 150));
    prefetcher.recordAccess('users');
    expect(prefetched.length).toBeGreaterThan(countBefore);
  });

  it('should clear all state', () => {
    prefetcher.recordAccess('users');
    prefetcher.recordAccess('todos');
    prefetcher.clear();

    expect(prefetcher.getStats().trackedCollections).toBe(0);
    expect(prefetcher.getStats().prefetchesFired).toBe(0);
  });
});
