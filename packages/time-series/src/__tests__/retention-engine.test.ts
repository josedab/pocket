import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RetentionEngine, RangeIndex, createRetentionEngine, createRangeIndex } from '../retention-engine.js';
import type { TimeSeriesPoint } from '../types.js';

function generatePoints(count: number, startMs: number, intervalMs: number): TimeSeriesPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startMs + i * intervalMs,
    value: Math.random() * 100,
    tags: { host: i % 2 === 0 ? 'a' : 'b' },
  }));
}

describe('RetentionEngine', () => {
  let engine: RetentionEngine;

  beforeEach(() => {
    engine = createRetentionEngine({
      tiers: [
        { name: 'raw', maxAge: 3600000, aggregationInterval: 0, aggregation: 'avg' },
        { name: 'hourly', maxAge: 86400000, aggregationInterval: 3600000, aggregation: 'avg' },
        { name: 'daily', maxAge: 604800000, aggregationInterval: 86400000, aggregation: 'avg' },
      ],
    });
  });

  afterEach(() => {
    engine.dispose();
  });

  it('should ingest points into raw tier', () => {
    const points = generatePoints(100, Date.now() - 1000, 10);
    engine.ingest(points);

    const stats = engine.getStats();
    expect(stats.totalPoints).toBe(100);
    expect(stats.pointsByTier['raw']).toBe(100);
  });

  it('should downsample expired raw data to hourly tier', () => {
    const now = Date.now();
    // Insert points 2 hours old (exceeds raw tier maxAge of 1 hour)
    const oldPoints = generatePoints(60, now - 7200000, 60000);
    engine.ingest(oldPoints);

    engine.enforce(now);

    const stats = engine.getStats();
    expect(stats.pointsByTier['raw']).toBe(0);
    expect(stats.pointsByTier['hourly']).toBeGreaterThan(0);
    expect(stats.downsampledCount).toBeGreaterThan(0);
  });

  it('should expire data from last tier', () => {
    const now = Date.now();
    // Insert very old points (older than daily tier maxAge of 7 days)
    const veryOldPoints = generatePoints(10, now - 700000000, 1000);
    engine.ingest(veryOldPoints);

    engine.enforce(now);

    const stats = engine.getStats();
    expect(stats.expiredCount).toBeGreaterThan(0);
  });

  it('should return data from specific tier', () => {
    const points = generatePoints(10, Date.now(), 1000);
    engine.ingest(points);

    expect(engine.getTierData('raw')).toHaveLength(10);
    expect(engine.getTierData('hourly')).toHaveLength(0);
  });

  it('should return all tiered data', () => {
    engine.ingest(generatePoints(5, Date.now(), 100));

    const allData = engine.getAllTieredData();
    expect(allData).toHaveLength(3);
    expect(allData[0]?.tier).toBe('raw');
  });

  it('should call onExpire callback', () => {
    let expiredTier = '';
    let expiredCount = 0;

    const e = createRetentionEngine({
      tiers: [
        { name: 'raw', maxAge: 1000, aggregationInterval: 0, aggregation: 'avg' },
      ],
      onExpire: (tier, count) => { expiredTier = tier; expiredCount = count; },
    });

    e.ingest(generatePoints(5, Date.now() - 5000, 100));
    e.enforce();

    expect(expiredTier).toBe('raw');
    expect(expiredCount).toBe(5);
    e.dispose();
  });
});

describe('RangeIndex', () => {
  let index: RangeIndex;

  beforeEach(() => {
    index = createRangeIndex(3600000); // 1-hour buckets
  });

  it('should insert and query points', () => {
    const now = Date.now();
    const points = generatePoints(100, now - 3600000, 36000);
    index.insert(points);

    expect(index.size).toBe(100);
    const results = index.query(now - 3600000, now);
    expect(results.length).toBe(100);
  });

  it('should filter by time range', () => {
    const now = Date.now();
    index.insert(generatePoints(50, now - 7200000, 60000));
    index.insert(generatePoints(50, now - 1800000, 60000));

    const recent = index.query(now - 2000000, now);
    expect(recent.length).toBeLessThanOrEqual(100);
    expect(recent.every((p) => p.timestamp >= now - 2000000)).toBe(true);
  });

  it('should filter by tags', () => {
    const now = Date.now();
    index.insert(generatePoints(20, now, 1000));

    const hostA = index.query(now, now + 20000, { host: 'a' });
    expect(hostA.every((p) => p.tags?.['host'] === 'a')).toBe(true);
  });

  it('should aggregate over intervals', () => {
    const now = Date.now();
    index.insert(generatePoints(60, now - 3600000, 60000));

    const hourlyAvg = index.aggregate(now - 3600000, now, 'avg', 1800000); // 30-min intervals
    expect(hourlyAvg.length).toBeLessThanOrEqual(3);
  });

  it('should expire old points', () => {
    const now = Date.now();
    index.insert(generatePoints(50, now - 7200000, 60000));
    index.insert(generatePoints(50, now - 1800000, 60000));

    const removed = index.expireBefore(now - 3600000);
    expect(removed).toBeGreaterThan(0);
    expect(index.size).toBeLessThan(100);
  });

  it('should clear the index', () => {
    index.insert(generatePoints(10, Date.now(), 100));
    expect(index.size).toBe(10);

    index.clear();
    expect(index.size).toBe(0);
    expect(index.bucketCount).toBe(0);
  });
});
