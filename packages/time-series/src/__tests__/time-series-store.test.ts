import { describe, it, expect } from 'vitest';
import { TimeSeriesStore, createTimeSeriesStore } from '../time-series-store.js';
import type { TimeSeriesPoint, TimeRange } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makePoint(overrides: Partial<TimeSeriesPoint> = {}): TimeSeriesPoint {
  return {
    timestamp: overrides.timestamp ?? 1_700_000_000_000,
    value: overrides.value ?? 42,
    tags: overrides.tags,
  };
}

function makeStore(bucketSize = 60_000): TimeSeriesStore {
  return createTimeSeriesStore({
    name: 'test-series',
    bucketSize,
    retention: {
      rawDataTTL: 24 * 60 * 60 * 1000,
      downsampledTTL: 7 * 24 * 60 * 60 * 1000,
      maxDataPoints: 10_000,
    },
  });
}

/* ================================================================== */
/*  TimeSeriesStore                                                    */
/* ================================================================== */

describe('TimeSeriesStore', () => {
  it('should insert a single point and query it', () => {
    const store = makeStore();
    const point = makePoint({ timestamp: 1_700_000_000_000, value: 10 });

    store.insert(point);

    const result = store.query({ start: 1_699_999_999_000, end: 1_700_000_001_000 });
    expect(result.points).toHaveLength(1);
    expect(result.points[0].value).toBe(10);
    expect(result.points[0].timestamp).toBe(1_700_000_000_000);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should batch insert and range query', () => {
    const store = makeStore();
    const base = 1_700_000_000_000;
    const points: TimeSeriesPoint[] = [
      makePoint({ timestamp: base, value: 1 }),
      makePoint({ timestamp: base + 1000, value: 2 }),
      makePoint({ timestamp: base + 2000, value: 3 }),
      makePoint({ timestamp: base + 3000, value: 4 }),
      makePoint({ timestamp: base + 4000, value: 5 }),
    ];

    store.insertBatch(points);

    // Query a sub-range
    const result = store.query({ start: base + 1000, end: base + 3000 });
    expect(result.points).toHaveLength(3);
    expect(result.points.map((p) => p.value)).toEqual([2, 3, 4]);
  });

  it('should filter by tags', () => {
    const store = makeStore();
    const base = 1_700_000_000_000;

    store.insertBatch([
      makePoint({ timestamp: base, value: 10, tags: { host: 'server-1', region: 'us' } }),
      makePoint({ timestamp: base + 1000, value: 20, tags: { host: 'server-2', region: 'eu' } }),
      makePoint({ timestamp: base + 2000, value: 30, tags: { host: 'server-1', region: 'us' } }),
    ]);

    const result = store.query(
      { start: base, end: base + 5000 },
      { tags: { host: 'server-1' } },
    );
    expect(result.points).toHaveLength(2);
    expect(result.points.every((p) => p.tags?.host === 'server-1')).toBe(true);
  });

  it('should compute aggregation (avg)', () => {
    const store = makeStore();
    const base = 1_700_000_000_000;

    store.insertBatch([
      makePoint({ timestamp: base, value: 10 }),
      makePoint({ timestamp: base + 100, value: 20 }),
      makePoint({ timestamp: base + 200, value: 30 }),
      makePoint({ timestamp: base + 1000, value: 40 }),
      makePoint({ timestamp: base + 1100, value: 50 }),
    ]);

    const result = store.query(
      { start: base, end: base + 2000 },
      { aggregation: 'avg', interval: 1000 },
    );

    // Two groups: [10, 20, 30] -> avg 20, [40, 50] -> avg 45
    expect(result.points).toHaveLength(2);
    expect(result.points[0].value).toBe(20);
    expect(result.points[1].value).toBe(45);
  });

  it('should compute aggregation (min, max, sum, count)', () => {
    const store = makeStore();
    const base = 1_700_000_000_000;

    store.insertBatch([
      makePoint({ timestamp: base, value: 5 }),
      makePoint({ timestamp: base + 100, value: 15 }),
      makePoint({ timestamp: base + 200, value: 10 }),
    ]);

    const minResult = store.query(
      { start: base, end: base + 1000 },
      { aggregation: 'min', interval: 1000 },
    );
    expect(minResult.points[0].value).toBe(5);

    const maxResult = store.query(
      { start: base, end: base + 1000 },
      { aggregation: 'max', interval: 1000 },
    );
    expect(maxResult.points[0].value).toBe(15);

    const sumResult = store.query(
      { start: base, end: base + 1000 },
      { aggregation: 'sum', interval: 1000 },
    );
    expect(sumResult.points[0].value).toBe(30);

    const countResult = store.query(
      { start: base, end: base + 1000 },
      { aggregation: 'count', interval: 1000 },
    );
    expect(countResult.points[0].value).toBe(3);
  });

  it('should downsample data', () => {
    const store = makeStore();
    const base = 1_700_000_000_000;

    store.insertBatch([
      makePoint({ timestamp: base, value: 10 }),
      makePoint({ timestamp: base + 500, value: 20 }),
      makePoint({ timestamp: base + 1000, value: 30 }),
      makePoint({ timestamp: base + 1500, value: 40 }),
    ]);

    const downsampled = store.downsample(
      { start: base, end: base + 2000 },
      1000,
      'avg',
    );

    expect(downsampled).toHaveLength(2);
    expect(downsampled[0].value).toBe(15); // avg(10, 20)
    expect(downsampled[1].value).toBe(35); // avg(30, 40)
  });

  it('should apply moving average window function', () => {
    const store = makeStore();
    const points: TimeSeriesPoint[] = [
      makePoint({ timestamp: 1000, value: 10 }),
      makePoint({ timestamp: 2000, value: 20 }),
      makePoint({ timestamp: 3000, value: 30 }),
      makePoint({ timestamp: 4000, value: 40 }),
      makePoint({ timestamp: 5000, value: 50 }),
    ];

    const result = store.applyWindow(points, {
      function: 'moving-average',
      windowSize: 3,
    });

    expect(result).toHaveLength(5);
    expect(result[0].value).toBe(10); // [10]
    expect(result[1].value).toBe(15); // [10, 20] / 2
    expect(result[2].value).toBe(20); // [10, 20, 30] / 3
    expect(result[3].value).toBe(30); // [20, 30, 40] / 3
    expect(result[4].value).toBe(40); // [30, 40, 50] / 3
  });

  it('should apply retention policy', () => {
    const store = createTimeSeriesStore({
      name: 'retention-test',
      bucketSize: 60_000,
      retention: {
        rawDataTTL: 60_000, // 1 minute
        downsampledTTL: 120_000,
        maxDataPoints: 10_000,
      },
    });

    const now = Date.now();

    // Insert old and recent data
    store.insertBatch([
      makePoint({ timestamp: now - 120_000, value: 1 }), // 2 min ago - should be removed
      makePoint({ timestamp: now - 90_000, value: 2 }),   // 1.5 min ago - should be removed
      makePoint({ timestamp: now - 30_000, value: 3 }),   // 30s ago - should remain
      makePoint({ timestamp: now, value: 4 }),             // now - should remain
    ]);

    expect(store.getPointCount()).toBe(4);

    store.applyRetention();

    expect(store.getPointCount()).toBe(2);
  });

  it('should compute stats', () => {
    const store = makeStore();
    const base = 1_700_000_000_000;

    store.insertBatch([
      makePoint({ timestamp: base, value: 10 }),
      makePoint({ timestamp: base + 1000, value: 20 }),
      makePoint({ timestamp: base + 2000, value: 30 }),
      makePoint({ timestamp: base + 3000, value: 40 }),
    ]);

    const stats = store.getStats();
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(40);
    expect(stats.avg).toBe(25);
    expect(stats.count).toBe(4);
    expect(stats.sum).toBe(100);

    // Stats with range
    const rangeStats = store.getStats({ start: base, end: base + 1500 });
    expect(rangeStats.count).toBe(2);
    expect(rangeStats.avg).toBe(15);
  });

  it('should return empty result for empty range', () => {
    const store = makeStore();
    const base = 1_700_000_000_000;

    store.insert(makePoint({ timestamp: base, value: 10 }));

    const result = store.query({ start: base + 100_000, end: base + 200_000 });
    expect(result.points).toHaveLength(0);
    expect(result.stats.count).toBe(0);
    expect(result.stats.min).toBe(0);
    expect(result.stats.max).toBe(0);
    expect(result.stats.avg).toBe(0);
    expect(result.stats.sum).toBe(0);
  });
});
