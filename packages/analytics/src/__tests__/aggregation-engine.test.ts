import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AggregationEngine, type AnalyticsEvent } from '../aggregation-engine.js';

function createEvent(overrides: Partial<AnalyticsEvent> = {}): AnalyticsEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 8)}`,
    name: 'page_view',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('AggregationEngine', () => {
  let engine: AggregationEngine;

  beforeEach(() => {
    engine = new AggregationEngine({ maxEventsInMemory: 1000 });
  });

  afterEach(() => {
    engine.destroy();
  });

  describe('ingest', () => {
    it('should accept events', () => {
      engine.ingest(createEvent());
      expect(engine.getEventCount()).toBe(1);
    });

    it('should accept batch events', () => {
      engine.ingestBatch([createEvent(), createEvent(), createEvent()]);
      expect(engine.getEventCount()).toBe(3);
    });

    it('should evict old events when over limit', () => {
      const engine2 = new AggregationEngine({ maxEventsInMemory: 3 });
      for (let i = 0; i < 5; i++) {
        engine2.ingest(createEvent({ id: `evt_${i}` }));
      }
      expect(engine2.getEventCount()).toBe(3);
      engine2.destroy();
    });
  });

  describe('computeFunnel', () => {
    it('should compute a basic funnel', () => {
      const now = Date.now();
      engine.ingestBatch([
        createEvent({ name: 'visit', userId: 'u1', timestamp: now }),
        createEvent({ name: 'signup', userId: 'u1', timestamp: now + 1000 }),
        createEvent({ name: 'purchase', userId: 'u1', timestamp: now + 2000 }),
        createEvent({ name: 'visit', userId: 'u2', timestamp: now }),
        createEvent({ name: 'signup', userId: 'u2', timestamp: now + 1000 }),
        createEvent({ name: 'visit', userId: 'u3', timestamp: now }),
      ]);

      const result = engine.computeFunnel([
        { name: 'Visit', eventName: 'visit' },
        { name: 'Sign Up', eventName: 'signup' },
        { name: 'Purchase', eventName: 'purchase' },
      ]);

      expect(result.steps).toHaveLength(3);
      expect(result.steps[0]!.count).toBe(3);
      expect(result.steps[1]!.count).toBe(2);
      expect(result.steps[2]!.count).toBe(1);
      expect(result.totalConversion).toBeCloseTo(1 / 3);
    });

    it('should handle empty funnel', () => {
      const result = engine.computeFunnel([
        { name: 'Visit', eventName: 'visit' },
      ]);
      expect(result.steps[0]!.count).toBe(0);
    });
  });

  describe('computeMetric', () => {
    it('should compute count metric', () => {
      engine.ingestBatch([
        createEvent({ name: 'click' }),
        createEvent({ name: 'click' }),
        createEvent({ name: 'click' }),
      ]);

      const result = engine.computeMetric({
        name: 'Total Clicks',
        eventName: 'click',
        aggregation: 'count',
      });

      expect(result.value).toBe(3);
    });

    it('should compute sum metric', () => {
      engine.ingestBatch([
        createEvent({ name: 'purchase', properties: { amount: 10 } }),
        createEvent({ name: 'purchase', properties: { amount: 20 } }),
        createEvent({ name: 'purchase', properties: { amount: 30 } }),
      ]);

      const result = engine.computeMetric({
        name: 'Revenue',
        eventName: 'purchase',
        aggregation: 'sum',
        property: 'amount',
      });

      expect(result.value).toBe(60);
    });

    it('should compute average metric', () => {
      engine.ingestBatch([
        createEvent({ name: 'page_load', properties: { duration: 100 } }),
        createEvent({ name: 'page_load', properties: { duration: 200 } }),
        createEvent({ name: 'page_load', properties: { duration: 300 } }),
      ]);

      const result = engine.computeMetric({
        name: 'Avg Load Time',
        eventName: 'page_load',
        aggregation: 'avg',
        property: 'duration',
      });

      expect(result.value).toBe(200);
    });

    it('should compute unique users', () => {
      engine.ingestBatch([
        createEvent({ name: 'login', userId: 'u1' }),
        createEvent({ name: 'login', userId: 'u2' }),
        createEvent({ name: 'login', userId: 'u1' }),
      ]);

      const result = engine.computeMetric({
        name: 'DAU',
        eventName: 'login',
        aggregation: 'unique',
      });

      expect(result.value).toBe(2);
    });
  });

  describe('computeSummary', () => {
    it('should compute accurate summary', () => {
      engine.ingestBatch([
        createEvent({ name: 'click', userId: 'u1', sessionId: 's1' }),
        createEvent({ name: 'click', userId: 'u2', sessionId: 's2' }),
        createEvent({ name: 'view', userId: 'u1', sessionId: 's1' }),
      ]);

      const summary = engine.computeSummary();
      expect(summary.totalEvents).toBe(3);
      expect(summary.uniqueUsers).toBe(2);
      expect(summary.uniqueSessions).toBe(2);
      expect(summary.topEvents[0]!.name).toBe('click');
      expect(summary.topEvents[0]!.count).toBe(2);
    });
  });

  describe('exportForSync', () => {
    it('should export all events', () => {
      engine.ingestBatch([createEvent(), createEvent()]);
      const exported = engine.exportForSync();
      expect(exported).toHaveLength(2);
    });

    it('should export events since timestamp', () => {
      const now = Date.now();
      engine.ingestBatch([
        createEvent({ timestamp: now - 10000 }),
        createEvent({ timestamp: now - 5000 }),
        createEvent({ timestamp: now }),
      ]);

      const exported = engine.exportForSync(now - 6000);
      expect(exported).toHaveLength(2);
    });
  });

  describe('compact', () => {
    it('should remove expired events', () => {
      const now = Date.now();
      engine.ingestBatch([
        createEvent({ timestamp: now - 100 * 24 * 60 * 60 * 1000 }), // 100 days ago
        createEvent({ timestamp: now }),
      ]);

      const removed = engine.compact();
      expect(removed).toBe(1);
      expect(engine.getEventCount()).toBe(1);
    });
  });
});
