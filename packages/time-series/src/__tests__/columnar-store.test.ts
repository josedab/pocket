import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ColumnarStore, createColumnarStore } from '../columnar-store.js';

describe('ColumnarStore', () => {
  let store: ColumnarStore;

  beforeEach(() => {
    store = createColumnarStore({ partitionInterval: 3_600_000 });
  });

  afterEach(() => {
    store.destroy();
  });

  it('should ingest and query points', () => {
    const now = Date.now();
    store.ingest({ timestamp: now, value: 10 });
    store.ingest({ timestamp: now + 1000, value: 20 });
    store.ingest({ timestamp: now + 2000, value: 30 });

    const results = store.queryRange(now, now + 3000);
    expect(results).toHaveLength(3);
    expect(results[0]!.value).toBe(10);
    expect(results[2]!.value).toBe(30);
  });

  it('should batch ingest points', () => {
    const now = Date.now();
    const points = Array.from({ length: 100 }, (_, i) => ({
      timestamp: now + i * 1000,
      value: Math.sin(i) * 100,
    }));

    const count = store.ingestBatch(points);
    expect(count).toBe(100);
    expect(store.getStats().totalPoints).toBe(100);
  });

  it('should filter by tags', () => {
    const now = Date.now();
    store.ingest({ timestamp: now, value: 10, tags: { sensor: 'temp' } });
    store.ingest({ timestamp: now + 1000, value: 20, tags: { sensor: 'humidity' } });
    store.ingest({ timestamp: now + 2000, value: 30, tags: { sensor: 'temp' } });

    const results = store.queryRange(now, now + 3000, { sensor: 'temp' });
    expect(results).toHaveLength(2);
    expect(results.every((p) => p.tags?.sensor === 'temp')).toBe(true);
  });

  it('should aggregate with avg', () => {
    const now = Date.now();
    store.ingestBatch([
      { timestamp: now, value: 10 },
      { timestamp: now + 1000, value: 20 },
      { timestamp: now + 2000, value: 30 },
    ]);

    const result = store.aggregateRange(now, now + 3000, { function: 'avg' });
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]!.value).toBe(20);
    expect(result.totalPoints).toBe(3);
  });

  it('should aggregate with bucketed intervals', () => {
    const now = Date.now();
    store.ingestBatch([
      { timestamp: now, value: 10 },
      { timestamp: now + 500, value: 20 },
      { timestamp: now + 1000, value: 30 },
      { timestamp: now + 1500, value: 40 },
    ]);

    const result = store.aggregateRange(now, now + 2000, {
      function: 'avg',
      interval: 1000,
    });
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets[0]!.value).toBe(15); // avg(10, 20)
    expect(result.buckets[1]!.value).toBe(35); // avg(30, 40)
  });

  it('should compute percentile aggregation', () => {
    const now = Date.now();
    const points = Array.from({ length: 100 }, (_, i) => ({
      timestamp: now + i * 100,
      value: i + 1,
    }));
    store.ingestBatch(points);

    const p50 = store.aggregateRange(now, now + 10000, {
      function: 'percentile',
      percentile: 50,
    });
    expect(p50.buckets[0]!.value).toBe(50);

    const p99 = store.aggregateRange(now, now + 10000, {
      function: 'percentile',
      percentile: 99,
    });
    expect(p99.buckets[0]!.value).toBe(99);
  });

  it('should partition data by interval', () => {
    const baseTime = 1_700_000_000_000;
    // 2 points in first hour, 2 in second hour
    store.ingest({ timestamp: baseTime, value: 1 });
    store.ingest({ timestamp: baseTime + 1000, value: 2 });
    store.ingest({ timestamp: baseTime + 3_600_000, value: 3 });
    store.ingest({ timestamp: baseTime + 3_601_000, value: 4 });

    const partitions = store.getPartitions();
    expect(partitions).toHaveLength(2);
    expect(partitions[0]!.pointCount).toBe(2);
    expect(partitions[1]!.pointCount).toBe(2);
  });

  it('should drop old partitions', () => {
    const baseTime = 1_700_000_000_000;
    store.ingest({ timestamp: baseTime, value: 1 });
    store.ingest({ timestamp: baseTime + 3_600_000, value: 2 });
    store.ingest({ timestamp: baseTime + 7_200_000, value: 3 });

    const dropped = store.dropBefore(baseTime + 3_600_000);
    expect(dropped).toBe(1);
    expect(store.getPartitions()).toHaveLength(2);
  });

  it('should delta-encode and decode roundtrip', () => {
    const values = [100, 105, 108, 115, 120];
    const encoded = ColumnarStore.deltaEncode(values);
    const decoded = ColumnarStore.deltaDecode(encoded);
    expect(decoded).toEqual(values);
    expect(encoded[0]).toBe(100);
    expect(encoded[1]).toBe(5); // delta
  });

  it('should RLE encode repeated values', () => {
    const values = [1, 1, 1, 2, 2, 3];
    const encoded = ColumnarStore.rleEncode(values);
    expect(encoded).toEqual([
      { value: 1, count: 3 },
      { value: 2, count: 2 },
      { value: 3, count: 1 },
    ]);
    const decoded = ColumnarStore.rleDecode(encoded);
    expect(decoded).toEqual(values);
  });

  it('should expose stats observable', () => {
    const stats = store.getStats();
    expect(stats.totalPoints).toBe(0);
    expect(stats.partitionCount).toBe(0);

    store.ingest({ timestamp: Date.now(), value: 42 });
    const updated = store.getStats();
    expect(updated.totalPoints).toBe(1);
    expect(updated.partitionCount).toBe(1);
  });

  it('should clear all data', () => {
    store.ingestBatch(
      Array.from({ length: 50 }, (_, i) => ({
        timestamp: Date.now() + i * 100,
        value: i,
      }))
    );
    expect(store.getStats().totalPoints).toBe(50);

    store.clear();
    expect(store.getStats().totalPoints).toBe(0);
    expect(store.getPartitions()).toHaveLength(0);
  });
});
