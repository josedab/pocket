import { describe, it, expect, beforeEach } from 'vitest';
import { RetentionEngine, createRetentionEngine } from '../retention-engine.js';
import type { AnalyticsEvent } from '../types.js';

function makeEvent(name: string, timestamp: number, userId = 'u1'): AnalyticsEvent {
  return {
    id: `e_${Math.random().toString(36).slice(2)}`,
    name,
    properties: {},
    userId,
    anonymousId: 'anon-1',
    sessionId: 'sess-1',
    timestamp,
    synced: false,
    context: { userAgent: '', locale: '', timezone: '' },
  };
}

describe('RetentionEngine', () => {
  describe('age-based pruning', () => {
    it('should prune events older than maxAgeMs', () => {
      const engine = createRetentionEngine({ maxAgeMs: 10_000 });
      const events = [
        makeEvent('old', Date.now() - 20_000),
        makeEvent('recent', Date.now() - 1_000),
      ];
      const result = engine.prune(events);
      expect(result.prunedByAge).toBe(1);
      expect(result.remaining).toHaveLength(1);
      expect(result.remaining[0]!.name).toBe('recent');
    });

    it('should keep all events when none expired', () => {
      const engine = createRetentionEngine({ maxAgeMs: 60_000 });
      const events = [makeEvent('a', Date.now()), makeEvent('b', Date.now())];
      const result = engine.prune(events);
      expect(result.prunedCount).toBe(0);
    });
  });

  describe('count-based pruning', () => {
    it('should keep only maxCount events', () => {
      const engine = createRetentionEngine({ maxCount: 3 });
      const events = Array.from({ length: 5 }, (_, i) => makeEvent(`e${i}`, Date.now() - i * 1000));
      const result = engine.prune(events);
      expect(result.remaining.length).toBeLessThanOrEqual(3);
      expect(result.prunedByCount).toBeGreaterThan(0);
    });

    it('should keep newest events', () => {
      const engine = createRetentionEngine({ maxCount: 2 });
      const events = [
        makeEvent('oldest', Date.now() - 3000),
        makeEvent('middle', Date.now() - 2000),
        makeEvent('newest', Date.now() - 1000),
      ];
      const result = engine.prune(events);
      expect(result.remaining.some((e) => e.name === 'newest')).toBe(true);
    });
  });

  describe('size-based pruning', () => {
    it('should prune based on estimated size', () => {
      const engine = createRetentionEngine({ maxSizeBytes: 400, avgEventSizeBytes: 200 });
      const events = Array.from({ length: 5 }, (_, i) => makeEvent(`e${i}`, Date.now() - i * 1000));
      const result = engine.prune(events);
      expect(result.remaining.length).toBeLessThanOrEqual(2);
      expect(result.prunedBySize).toBeGreaterThan(0);
    });
  });

  describe('exempt events', () => {
    it('should preserve exempt events', () => {
      const engine = createRetentionEngine({ maxCount: 2, exemptEvents: ['purchase'] });
      const events = [
        makeEvent('purchase', Date.now() - 5000),
        makeEvent('view', Date.now() - 4000),
        makeEvent('click', Date.now() - 3000),
        makeEvent('purchase', Date.now() - 2000),
      ];
      const result = engine.prune(events);
      const purchases = result.remaining.filter((e) => e.name === 'purchase');
      expect(purchases).toHaveLength(2);
    });
  });

  describe('needsPruning', () => {
    it('should return true when over count limit', () => {
      const engine = createRetentionEngine({ maxCount: 100 });
      expect(engine.needsPruning(150)).toBe(true);
      expect(engine.needsPruning(50)).toBe(false);
    });

    it('should return true when over size limit', () => {
      const engine = createRetentionEngine({ maxSizeBytes: 10000, avgEventSizeBytes: 200 });
      expect(engine.needsPruning(100)).toBe(true);
      expect(engine.needsPruning(10)).toBe(false);
    });
  });

  describe('combined policies', () => {
    it('should apply age + count together', () => {
      const engine = createRetentionEngine({ maxAgeMs: 5000, maxCount: 3 });
      const events = [
        makeEvent('expired', Date.now() - 10_000),
        makeEvent('a', Date.now() - 1000),
        makeEvent('b', Date.now() - 500),
        makeEvent('c', Date.now()),
        makeEvent('d', Date.now()),
      ];
      const result = engine.prune(events);
      expect(result.remaining.every((e) => e.name !== 'expired')).toBe(true);
      expect(result.remaining.length).toBeLessThanOrEqual(3);
    });
  });
});
