import { describe, it, expect, beforeEach } from 'vitest';
import { CacheWarmer, createCacheWarmer } from '../cache-warmer.js';

describe('CacheWarmer', () => {
  let warmer: CacheWarmer;

  beforeEach(() => {
    warmer = createCacheWarmer({ minAccessCount: 3, maxRegionsToWarm: 2 });
  });

  describe('access tracking', () => {
    it('should record access patterns', () => {
      warmer.recordAccess('todos', 'us-east', 10);
      warmer.recordAccess('todos', 'us-east', 20);
      const patterns = warmer.getPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0]!.accessCount).toBe(2);
      expect(patterns[0]!.avgResponseMs).toBe(15);
    });

    it('should track per-collection per-region', () => {
      warmer.recordAccess('todos', 'us-east', 10);
      warmer.recordAccess('todos', 'eu-west', 20);
      expect(warmer.getPatterns()).toHaveLength(2);
    });
  });

  describe('hot collections', () => {
    it('should identify hot collections above threshold', () => {
      for (let i = 0; i < 5; i++) warmer.recordAccess('todos', 'us-east', 10);
      warmer.recordAccess('cold', 'us-east', 10);
      const hot = warmer.getHotCollections();
      expect(hot).toContain('todos');
      expect(hot).not.toContain('cold');
    });
  });

  describe('warming recommendations', () => {
    it('should recommend warming for hot patterns', () => {
      for (let i = 0; i < 5; i++) warmer.recordAccess('todos', 'us-east', 10);
      for (let i = 0; i < 5; i++) warmer.recordAccess('todos', 'eu-west', 15);
      const recs = warmer.getWarmingRecommendations();
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0]!.collection).toBe('todos');
      expect(recs[0]!.targetRegions.length).toBeLessThanOrEqual(2);
    });

    it('should return empty for cold patterns', () => {
      warmer.recordAccess('cold', 'us-east', 10);
      expect(warmer.getWarmingRecommendations()).toHaveLength(0);
    });
  });

  describe('prefetch', () => {
    it('should execute prefetch and return result', async () => {
      const result = await warmer.prefetch({
        collection: 'todos',
        targetRegions: ['us-east', 'eu-west'],
        priority: 'high',
      });
      expect(result.regionsWarmed).toHaveLength(2);
      expect(result.documentsWarmed).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should track prefetch history', async () => {
      await warmer.prefetch({ collection: 'a', targetRegions: ['us-east'], priority: 'normal' });
      await warmer.prefetch({ collection: 'b', targetRegions: ['eu-west'], priority: 'low' });
      expect(warmer.getPrefetchHistory()).toHaveLength(2);
    });
  });

  describe('clear', () => {
    it('should clear all patterns and history', async () => {
      warmer.recordAccess('x', 'us-east', 1);
      await warmer.prefetch({ collection: 'x', targetRegions: ['us-east'], priority: 'normal' });
      warmer.clear();
      expect(warmer.getPatterns()).toHaveLength(0);
      expect(warmer.getPrefetchHistory()).toHaveLength(0);
    });
  });
});
