import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Downsampler } from '../downsampler.js';
import { createDownsampler } from '../downsampler.js';
import type { IngestionEngine } from '../ingestion-engine.js';
import { createIngestionEngine } from '../ingestion-engine.js';
import type { TimeRangeQueryExecutor } from '../time-range-query.js';
import { createTimeRangeQueryExecutor } from '../time-range-query.js';

// ─── IngestionEngine ────────────────────────────────────────────────────────

describe('IngestionEngine', () => {
  let engine: IngestionEngine;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    engine?.destroy();
    vi.useRealTimers();
  });

  it('ingests a single point and flushes via timer', () => {
    const onFlush = vi.fn();
    engine = createIngestionEngine({ flushIntervalMs: 100, onFlush });

    engine.ingest({ metric: 'cpu', value: 42, timestamp: 1000 });
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([{ metric: 'cpu', value: 42, timestamp: 1000 }]);
  });

  it('ingests a batch of points', () => {
    const onFlush = vi.fn();
    engine = createIngestionEngine({ flushIntervalMs: 100, onFlush });

    engine.ingestBatch([
      { metric: 'cpu', value: 10, timestamp: 1000 },
      { metric: 'cpu', value: 20, timestamp: 2000 },
      { metric: 'mem', value: 512, timestamp: 1500 },
    ]);

    vi.advanceTimersByTime(150);

    expect(onFlush).toHaveBeenCalledTimes(1);
    const batch = onFlush.mock.calls[0][0];
    expect(batch).toHaveLength(3);
  });

  it('queries points by metric and time range', () => {
    const onFlush = vi.fn();
    engine = createIngestionEngine({ flushIntervalMs: 50, onFlush });

    engine.ingestBatch([
      { metric: 'cpu', value: 10, timestamp: 1000 },
      { metric: 'cpu', value: 20, timestamp: 2000 },
      { metric: 'cpu', value: 30, timestamp: 3000 },
      { metric: 'mem', value: 512, timestamp: 1500 },
    ]);

    vi.advanceTimersByTime(100);

    const result = engine.query('cpu', 1000, 2000);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe(10);
    expect(result[1].value).toBe(20);
  });

  it('returns empty array for unknown metric', () => {
    engine = createIngestionEngine({ flushIntervalMs: 50 });
    vi.advanceTimersByTime(100);
    expect(engine.query('unknown', 0, 9999)).toEqual([]);
  });

  it('tracks metric names', () => {
    engine = createIngestionEngine({ flushIntervalMs: 50 });

    engine.ingestBatch([
      { metric: 'cpu', value: 10, timestamp: 1000 },
      { metric: 'mem', value: 256, timestamp: 1000 },
    ]);
    vi.advanceTimersByTime(100);

    const metrics = engine.getMetrics();
    expect(metrics).toContain('cpu');
    expect(metrics).toContain('mem');
  });

  it('returns the latest point for a metric', () => {
    engine = createIngestionEngine({ flushIntervalMs: 50 });

    engine.ingestBatch([
      { metric: 'cpu', value: 10, timestamp: 1000 },
      { metric: 'cpu', value: 99, timestamp: 5000 },
      { metric: 'cpu', value: 50, timestamp: 3000 },
    ]);
    vi.advanceTimersByTime(100);

    const latest = engine.getLatest('cpu');
    expect(latest).not.toBeNull();
    expect(latest!.value).toBe(99);
    expect(latest!.timestamp).toBe(5000);
  });

  it('returns null for latest on unknown metric', () => {
    engine = createIngestionEngine({ flushIntervalMs: 50 });
    expect(engine.getLatest('nope')).toBeNull();
  });

  it('tracks ingestion stats', () => {
    engine = createIngestionEngine({ flushIntervalMs: 50 });

    engine.ingestBatch([
      { metric: 'cpu', value: 10, timestamp: 1000 },
      { metric: 'cpu', value: 20, timestamp: 2000 },
    ]);
    vi.advanceTimersByTime(100);

    const stats = engine.getStats();
    expect(stats.totalIngested).toBe(2);
    expect(stats.totalFlushed).toBe(2);
    expect(stats.batchCount).toBe(1);
  });

  it('drops invalid points', () => {
    engine = createIngestionEngine({ flushIntervalMs: 50 });

    engine.ingest({ metric: '', value: 10, timestamp: 1000 });
    engine.ingest({ metric: 'cpu', value: NaN, timestamp: 1000 });

    const stats = engine.getStats();
    // Empty metric is dropped; NaN is typeof number so it passes validation
    expect(stats.droppedPoints).toBe(1);
    expect(stats.totalIngested).toBe(1);
  });

  it('flushes when batch size is reached', () => {
    const onFlush = vi.fn();
    engine = createIngestionEngine({ flushIntervalMs: 10000, batchSize: 3, onFlush });

    engine.ingestBatch([
      { metric: 'a', value: 1, timestamp: 1 },
      { metric: 'a', value: 2, timestamp: 2 },
      { metric: 'a', value: 3, timestamp: 3 },
    ]);

    // bufferTime emits when count reaches batchSize
    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});

// ─── Downsampler ────────────────────────────────────────────────────────────

describe('Downsampler', () => {
  let ds: Downsampler;

  beforeEach(() => {
    ds = createDownsampler();
  });

  it('downsamples with avg aggregation', () => {
    const points = [
      { timestamp: 100, value: 10 },
      { timestamp: 200, value: 20 },
      { timestamp: 300, value: 30 },
      { timestamp: 1100, value: 40 },
      { timestamp: 1200, value: 50 },
    ];

    const result = ds.downsample(points, { resolution: 1000, aggregation: 'avg' });
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe(20); // avg(10, 20, 30)
    expect(result[1].value).toBe(45); // avg(40, 50)
  });

  it('downsamples with sum aggregation', () => {
    const points = [
      { timestamp: 100, value: 10 },
      { timestamp: 200, value: 20 },
    ];

    const result = ds.downsample(points, { resolution: 1000, aggregation: 'sum' });
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(30);
  });

  it('downsamples with min/max aggregation', () => {
    const points = [
      { timestamp: 100, value: 5 },
      { timestamp: 200, value: 15 },
      { timestamp: 300, value: 10 },
    ];

    const minResult = ds.downsample(points, { resolution: 1000, aggregation: 'min' });
    expect(minResult[0].value).toBe(5);

    const maxResult = ds.downsample(points, { resolution: 1000, aggregation: 'max' });
    expect(maxResult[0].value).toBe(15);
  });

  it('downsamples with count aggregation', () => {
    const points = [
      { timestamp: 100, value: 5 },
      { timestamp: 200, value: 15 },
      { timestamp: 300, value: 10 },
    ];

    const result = ds.downsample(points, { resolution: 1000, aggregation: 'count' });
    expect(result[0].value).toBe(3);
  });

  it('returns empty for empty input', () => {
    expect(ds.downsample([], { resolution: 1000, aggregation: 'avg' })).toEqual([]);
  });

  it('delta-encodes and decodes roundtrip', () => {
    const points = [
      { timestamp: 1000, value: 10 },
      { timestamp: 2000, value: 20 },
      { timestamp: 3000, value: 15 },
      { timestamp: 4000, value: 25 },
    ];

    const encoded = ds.deltaEncode(points, 'test-metric', 1000);
    expect(encoded.metric).toBe('test-metric');
    expect(encoded.pointCount).toBe(4);
    expect(encoded.timestamps[0]).toBe(1000); // absolute first
    expect(encoded.timestamps[1]).toBe(1000); // delta
    expect(encoded.compressionRatio).toBeGreaterThan(1);

    const decoded = ds.deltaDecode(encoded);
    expect(decoded).toHaveLength(4);
    expect(decoded[0].timestamp).toBe(1000);
    expect(decoded[0].value).toBe(10);
    expect(decoded[3].timestamp).toBe(4000);
    expect(decoded[3].value).toBe(25);
  });

  it('handles empty series in delta encode/decode', () => {
    const encoded = ds.deltaEncode([], 'empty');
    expect(encoded.pointCount).toBe(0);
    expect(ds.deltaDecode(encoded)).toEqual([]);
  });

  it('preserves tags through RLE encode/decode', () => {
    const points = [
      { timestamp: 1000, value: 10, tags: { host: 'a' } },
      { timestamp: 2000, value: 20, tags: { host: 'a' } },
      { timestamp: 3000, value: 30, tags: { host: 'b' } },
      { timestamp: 4000, value: 40, tags: { host: 'b' } },
      { timestamp: 5000, value: 50, tags: { host: 'b' } },
    ];

    const encoded = ds.deltaEncode(points, 'tagged');
    expect(encoded.tags).toBeDefined();
    expect(encoded.tags!).toHaveLength(1);
    expect(encoded.tags![0].key).toBe('host');
    // RLE: 'a' x2, 'b' x3
    expect(encoded.tags![0].runs).toEqual([
      { value: 'a', count: 2 },
      { value: 'b', count: 3 },
    ]);

    const decoded = ds.deltaDecode(encoded);
    expect(decoded[0].tags).toEqual({ host: 'a' });
    expect(decoded[1].tags).toEqual({ host: 'a' });
    expect(decoded[2].tags).toEqual({ host: 'b' });
    expect(decoded[4].tags).toEqual({ host: 'b' });
  });
});

// ─── TimeRangeQueryExecutor ─────────────────────────────────────────────────

describe('TimeRangeQueryExecutor', () => {
  let executor: TimeRangeQueryExecutor;

  const samplePoints = [
    { timestamp: 1000, value: 10, tags: { region: 'us' } },
    { timestamp: 2000, value: 20, tags: { region: 'us' } },
    { timestamp: 3000, value: 30, tags: { region: 'eu' } },
    { timestamp: 4000, value: 40, tags: { region: 'eu' } },
    { timestamp: 5000, value: 50, tags: { region: 'us' } },
  ];

  beforeEach(() => {
    executor = createTimeRangeQueryExecutor();
  });

  it('filters points by time range', () => {
    const result = executor.execute({ metric: 'cpu', from: 2000, to: 4000 }, samplePoints);
    expect(result.points).toHaveLength(3);
    expect(result.stats.pointCount).toBe(3);
    expect(result.metric).toBe('cpu');
  });

  it('returns empty result for out-of-range query', () => {
    const result = executor.execute({ metric: 'cpu', from: 9000, to: 10000 }, samplePoints);
    expect(result.points).toHaveLength(0);
  });

  it('applies limit', () => {
    const result = executor.execute(
      { metric: 'cpu', from: 1000, to: 5000, limit: 2 },
      samplePoints
    );
    expect(result.points).toHaveLength(2);
  });

  it('computes tumbling windows', () => {
    const result = executor.execute(
      {
        metric: 'cpu',
        from: 1000,
        to: 5000,
        window: { type: 'tumbling', size: 2000 },
      },
      samplePoints
    );

    expect(result.windows).toBeDefined();
    expect(result.windows!.length).toBeGreaterThanOrEqual(2);

    for (const w of result.windows!) {
      expect(w.count).toBeGreaterThan(0);
      expect(w.min).toBeLessThanOrEqual(w.max);
      expect(w.avg).toBeGreaterThanOrEqual(w.min);
      expect(w.avg).toBeLessThanOrEqual(w.max);
    }
  });

  it('computes sliding windows', () => {
    const result = executor.execute(
      {
        metric: 'cpu',
        from: 1000,
        to: 5000,
        window: { type: 'sliding', size: 3000, slide: 1000 },
      },
      samplePoints
    );

    expect(result.windows).toBeDefined();
    // Sliding windows with smaller slide produce more windows than tumbling
    expect(result.windows!.length).toBeGreaterThanOrEqual(3);
  });

  it('computes session windows', () => {
    const sessionPoints = [
      { timestamp: 1000, value: 10 },
      { timestamp: 1500, value: 20 },
      { timestamp: 2000, value: 30 },
      // gap > 5000
      { timestamp: 8000, value: 40 },
      { timestamp: 8500, value: 50 },
    ];

    const result = executor.execute(
      {
        metric: 'cpu',
        from: 0,
        to: 10000,
        window: { type: 'session', size: 5000, gap: 5000 },
      },
      sessionPoints
    );

    expect(result.windows).toBeDefined();
    expect(result.windows!).toHaveLength(2);
    expect(result.windows![0].count).toBe(3);
    expect(result.windows![1].count).toBe(2);
  });

  it('groups by tag', () => {
    const result = executor.execute(
      {
        metric: 'cpu',
        from: 1000,
        to: 5000,
        groupByTag: 'region',
      },
      samplePoints
    );

    expect(result.groups).toBeDefined();
    expect(result.groups!['us']).toHaveLength(3);
    expect(result.groups!['eu']).toHaveLength(2);
  });

  it('assigns _untagged group for points without the tag', () => {
    const points = [
      { timestamp: 1000, value: 10 },
      { timestamp: 2000, value: 20, tags: { env: 'prod' } },
    ];

    const result = executor.execute(
      { metric: 'cpu', from: 0, to: 5000, groupByTag: 'env' },
      points
    );

    expect(result.groups).toBeDefined();
    expect(result.groups!['_untagged']).toHaveLength(1);
    expect(result.groups!['prod']).toHaveLength(1);
  });

  it('tracks execution time', () => {
    const result = executor.execute({ metric: 'cpu', from: 1000, to: 5000 }, samplePoints);
    expect(result.stats.executionMs).toBeGreaterThanOrEqual(0);
  });
});
