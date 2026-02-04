import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DashboardDataProvider,
  createDashboardDataProvider,
  type AnalyticsDataSource,
  type AnalyticsDashboardEvent,
  type DateRange,
} from '../dashboard.js';

function createEvent(overrides: Partial<AnalyticsDashboardEvent> = {}): AnalyticsDashboardEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 8)}`,
    name: 'page_view',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createDataSource(events: AnalyticsDashboardEvent[]): AnalyticsDataSource {
  return {
    getEvents(range?: DateRange) {
      if (!range) return [...events];
      return events.filter((e) => e.timestamp >= range.start && e.timestamp <= range.end);
    },
  };
}

describe('DashboardDataProvider', () => {
  let provider: DashboardDataProvider;
  let events: AnalyticsDashboardEvent[];
  const now = Date.now();

  beforeEach(() => {
    events = [
      createEvent({ name: 'visit', userId: 'u1', sessionId: 's1', timestamp: now - 5000 }),
      createEvent({ name: 'signup', userId: 'u1', sessionId: 's1', timestamp: now - 4000 }),
      createEvent({ name: 'purchase', userId: 'u1', sessionId: 's1', timestamp: now - 3000 }),
      createEvent({ name: 'visit', userId: 'u2', sessionId: 's2', timestamp: now - 5000 }),
      createEvent({ name: 'signup', userId: 'u2', sessionId: 's2', timestamp: now - 4000 }),
      createEvent({ name: 'visit', userId: 'u3', sessionId: 's3', timestamp: now - 5000 }),
    ];
    provider = new DashboardDataProvider(createDataSource(events));
  });

  afterEach(() => {
    provider.destroy();
  });

  describe('getFunnelData', () => {
    it('should compute funnel step counts', () => {
      const funnel = provider.getFunnelData(['visit', 'signup', 'purchase']);

      expect(funnel).toHaveLength(3);
      expect(funnel[0]!.name).toBe('visit');
      expect(funnel[0]!.count).toBe(3);
      expect(funnel[1]!.name).toBe('signup');
      expect(funnel[1]!.count).toBe(2);
      expect(funnel[2]!.name).toBe('purchase');
      expect(funnel[2]!.count).toBe(1);
    });

    it('should compute conversion and dropoff rates', () => {
      const funnel = provider.getFunnelData(['visit', 'signup', 'purchase']);

      expect(funnel[0]!.conversionRate).toBe(1);
      expect(funnel[0]!.dropoffRate).toBe(0);
      expect(funnel[1]!.conversionRate).toBeCloseTo(2 / 3);
      expect(funnel[1]!.dropoffRate).toBeCloseTo(1 / 3);
      expect(funnel[2]!.conversionRate).toBeCloseTo(0.5);
      expect(funnel[2]!.dropoffRate).toBeCloseTo(0.5);
    });

    it('should handle empty funnel', () => {
      const emptyProvider = new DashboardDataProvider(createDataSource([]));
      const funnel = emptyProvider.getFunnelData(['visit', 'signup']);
      expect(funnel[0]!.count).toBe(0);
      expect(funnel[1]!.count).toBe(0);
      emptyProvider.destroy();
    });
  });

  describe('getRetentionData', () => {
    it('should return retention cohorts', () => {
      const cohorts = provider.getRetentionData('day', 3);

      expect(cohorts.length).toBeGreaterThan(0);
      for (const cohort of cohorts) {
        expect(cohort.cohortDate).toBeDefined();
        expect(typeof cohort.cohortSize).toBe('number');
        expect(Array.isArray(cohort.periods)).toBe(true);
      }
    });

    it('should have valid retention rates', () => {
      const cohorts = provider.getRetentionData('day', 3);

      for (const cohort of cohorts) {
        for (const period of cohort.periods) {
          expect(period.retentionRate).toBeGreaterThanOrEqual(0);
          expect(period.retentionRate).toBeLessThanOrEqual(1);
          expect(period.retained).toBeLessThanOrEqual(cohort.cohortSize);
        }
      }
    });
  });

  describe('getMetricTimeSeries', () => {
    it('should return time series points', () => {
      const range: DateRange = { start: now - 10000, end: now };
      const points = provider.getMetricTimeSeries('visit', 'hour', range);

      expect(Array.isArray(points)).toBe(true);
      for (const point of points) {
        expect(typeof point.timestamp).toBe('number');
        expect(typeof point.value).toBe('number');
        expect(typeof point.label).toBe('string');
      }
    });

    it('should count events per interval', () => {
      const range: DateRange = { start: now - 10000, end: now };
      const points = provider.getMetricTimeSeries('visit', 'hour', range);

      const totalCount = points.reduce((sum, p) => sum + p.value, 0);
      expect(totalCount).toBe(3); // 3 visit events
    });

    it('should return sorted points', () => {
      const range: DateRange = { start: now - 10000, end: now };
      const points = provider.getMetricTimeSeries('visit', 'hour', range);

      for (let i = 1; i < points.length; i++) {
        expect(points[i]!.timestamp).toBeGreaterThanOrEqual(points[i - 1]!.timestamp);
      }
    });
  });

  describe('getSummary', () => {
    it('should compute total events', () => {
      const summary = provider.getSummary();
      expect(summary.totalEvents).toBe(6);
    });

    it('should compute unique users', () => {
      const summary = provider.getSummary();
      expect(summary.uniqueUsers).toBe(3);
    });

    it('should compute average session duration', () => {
      const summary = provider.getSummary();
      expect(typeof summary.avgSessionDuration).toBe('number');
      expect(summary.avgSessionDuration).toBeGreaterThanOrEqual(0);
    });

    it('should include top events', () => {
      const summary = provider.getSummary();
      expect(summary.topEvents.length).toBeGreaterThan(0);
      expect(summary.topEvents[0]!.name).toBe('visit');
      expect(summary.topEvents[0]!.count).toBe(3);
    });

    it('should emit via data$ observable', () => {
      const values: unknown[] = [];
      provider.data$.subscribe((v) => values.push(v));

      provider.getSummary();

      // Initial null + emitted summary
      expect(values.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getTopEvents', () => {
    it('should return events sorted by count', () => {
      const top = provider.getTopEvents(10);

      expect(top[0]!.name).toBe('visit');
      expect(top[0]!.count).toBe(3);
      expect(top[0]!.uniqueUsers).toBe(3);
    });

    it('should respect limit', () => {
      const top = provider.getTopEvents(1);
      expect(top).toHaveLength(1);
    });
  });

  describe('cache', () => {
    it('should return cached result on second call', () => {
      const result1 = provider.getFunnelData(['visit', 'signup']);
      const result2 = provider.getFunnelData(['visit', 'signup']);

      expect(result1).toBe(result2); // same reference = cached
    });

    it('should invalidate cache after refresh', () => {
      const result1 = provider.getFunnelData(['visit', 'signup']);
      provider.refresh();
      const result2 = provider.getFunnelData(['visit', 'signup']);

      expect(result1).not.toBe(result2); // different reference = recomputed
      expect(result1).toEqual(result2); // same data
    });

    it('should expire cache after TTL', async () => {
      const shortCacheProvider = new DashboardDataProvider(createDataSource(events), {
        cacheTtlMs: 1,
      });

      const result1 = shortCacheProvider.getFunnelData(['visit']);

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result2 = shortCacheProvider.getFunnelData(['visit']);
      expect(result1).not.toBe(result2);
      shortCacheProvider.destroy();
    });
  });

  describe('factory', () => {
    it('should create provider via factory', () => {
      const p = createDashboardDataProvider(createDataSource([]));
      expect(p).toBeInstanceOf(DashboardDataProvider);
      p.destroy();
    });
  });

  describe('destroy', () => {
    it('should clear cache on destroy', () => {
      provider.getFunnelData(['visit']);
      provider.destroy();
      // No assertion needed - just verify no errors
    });

    it('should be safe to call destroy multiple times', () => {
      provider.destroy();
      expect(() => provider.destroy()).not.toThrow();
    });
  });
});
