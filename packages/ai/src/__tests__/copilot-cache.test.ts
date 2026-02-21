import { describe, it, expect, beforeEach } from 'vitest';
import { CopilotCache, createCopilotCache } from '../copilot-cache.js';
import type { GeneratedQuery } from '../smart-query.js';

const MOCK_QUERY: GeneratedQuery = {
  collection: 'todos',
  filter: { completed: false },
  explanation: 'Find incomplete todos',
  confidence: 0.9,
  naturalLanguage: 'show incomplete todos',
};

describe('CopilotCache', () => {
  let cache: CopilotCache;

  beforeEach(() => {
    cache = createCopilotCache({ ttlMs: 60_000, maxEntries: 5 });
  });

  describe('basic operations', () => {
    it('should store and retrieve a query', () => {
      cache.set('show incomplete todos', MOCK_QUERY);
      const entry = cache.get('show incomplete todos');
      expect(entry).not.toBeNull();
      expect(entry!.query.collection).toBe('todos');
    });

    it('should return null for cache miss', () => {
      expect(cache.get('nonexistent question')).toBeNull();
    });

    it('should check existence without counting hits', () => {
      cache.set('test', MOCK_QUERY);
      expect(cache.has('test')).toBe(true);
      expect(cache.has('missing')).toBe(false);
    });

    it('should invalidate a specific entry', () => {
      cache.set('test', MOCK_QUERY);
      expect(cache.invalidate('test')).toBe(true);
      expect(cache.get('test')).toBeNull();
    });

    it('should clear all entries', () => {
      cache.set('a', MOCK_QUERY);
      cache.set('b', MOCK_QUERY);
      cache.clear();
      expect(cache.get('a')).toBeNull();
      expect(cache.get('b')).toBeNull();
    });
  });

  describe('key normalization', () => {
    it('should treat case-insensitively', () => {
      cache.set('Show Incomplete Todos', MOCK_QUERY);
      expect(cache.get('show incomplete todos')).not.toBeNull();
    });

    it('should normalize whitespace', () => {
      cache.set('show   incomplete   todos', MOCK_QUERY);
      expect(cache.get('show incomplete todos')).not.toBeNull();
    });

    it('should strip trailing punctuation', () => {
      cache.set('show incomplete todos?', MOCK_QUERY);
      expect(cache.get('show incomplete todos')).not.toBeNull();
    });
  });

  describe('TTL eviction', () => {
    it('should evict expired entries on get', () => {
      const shortTtl = createCopilotCache({ ttlMs: 1 });
      shortTtl.set('test', MOCK_QUERY);
      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }
      expect(shortTtl.get('test')).toBeNull();
    });

    it('should prune expired entries', () => {
      const shortTtl = createCopilotCache({ ttlMs: 1 });
      shortTtl.set('a', MOCK_QUERY);
      shortTtl.set('b', MOCK_QUERY);
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }
      const pruned = shortTtl.prune();
      expect(pruned).toBe(2);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest when at capacity', () => {
      for (let i = 0; i < 5; i++) {
        cache.set(`q${i}`, { ...MOCK_QUERY, naturalLanguage: `q${i}` });
      }
      cache.set('q5', { ...MOCK_QUERY, naturalLanguage: 'q5' });
      // q0 should have been evicted
      expect(cache.get('q0')).toBeNull();
      expect(cache.get('q5')).not.toBeNull();
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', () => {
      cache.set('test', MOCK_QUERY);
      cache.get('test'); // hit
      cache.get('missing'); // miss
      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(50);
    });

    it('should track entry count', () => {
      cache.set('a', MOCK_QUERY);
      cache.set('b', MOCK_QUERY);
      expect(cache.getStats().entries).toBe(2);
    });

    it('should increment hit count on repeated access', () => {
      cache.set('test', MOCK_QUERY);
      cache.get('test');
      cache.get('test');
      const entry = cache.get('test');
      expect(entry!.hitCount).toBe(3);
    });
  });
});
