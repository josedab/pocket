/**
 * @module ColumnarStore
 *
 * High-performance columnar storage engine for time-series data with
 * delta encoding, run-length encoding, and advanced aggregation pipelines.
 *
 * @example
 * ```typescript
 * const store = createColumnarStore({ partitionInterval: 3600000 });
 * store.ingest({ timestamp: Date.now(), value: 42.5, tags: { sensor: 'temp' } });
 * const result = store.aggregateRange(start, end, { function: 'avg', interval: 60000 });
 * ```
 */

import { BehaviorSubject, Subject } from 'rxjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single data point in the columnar store */
export interface ColumnarPoint {
  readonly timestamp: number;
  readonly value: number;
  readonly tags?: Record<string, string>;
}

/** Configuration for the columnar store */
export interface ColumnarStoreConfig {
  /** Partition interval in ms (default: 1 hour) */
  readonly partitionInterval?: number;
  /** Max points per partition before compaction (default: 10 000) */
  readonly maxPartitionSize?: number;
  /** Enable delta encoding for timestamps (default: true) */
  readonly deltaEncoding?: boolean;
  /** Enable run-length encoding for repeated values (default: true) */
  readonly runLengthEncoding?: boolean;
}

/** Aggregation request */
export interface AggregationRequest {
  readonly function: 'avg' | 'min' | 'max' | 'sum' | 'count' | 'percentile';
  /** Bucket interval in ms for grouped aggregation */
  readonly interval?: number;
  /** Percentile value (0-100), required when function is 'percentile' */
  readonly percentile?: number;
  /** Tag filter */
  readonly tags?: Record<string, string>;
}

/** Single aggregation bucket */
export interface AggregationBucket {
  readonly start: number;
  readonly end: number;
  readonly value: number;
  readonly count: number;
}

/** Result of an aggregation query */
export interface AggregationResult {
  readonly buckets: AggregationBucket[];
  readonly totalPoints: number;
  readonly executionMs: number;
}

/** Partition metadata */
export interface PartitionInfo {
  readonly id: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly pointCount: number;
  readonly compressedSize: number;
  readonly rawSize: number;
  readonly compressionRatio: number;
}

/** Store statistics */
export interface ColumnarStoreStats {
  readonly totalPoints: number;
  readonly partitionCount: number;
  readonly totalRawSize: number;
  readonly totalCompressedSize: number;
  readonly compressionRatio: number;
  readonly oldestTimestamp: number | null;
  readonly newestTimestamp: number | null;
}

/** Encoded partition data */
interface EncodedPartition {
  timestamps: number[];
  values: number[];
  tagKeys: string[];
  tagValues: string[][];
  pointCount: number;
  startTime: number;
  endTime: number;
}

// ---------------------------------------------------------------------------
// Delta Encoding
// ---------------------------------------------------------------------------

function deltaEncode(values: number[]): number[] {
  if (values.length === 0) return [];
  const encoded = [values[0]!];
  for (let i = 1; i < values.length; i++) {
    encoded.push(values[i]! - values[i - 1]!);
  }
  return encoded;
}

function deltaDecode(encoded: number[]): number[] {
  if (encoded.length === 0) return [];
  const decoded = [encoded[0]!];
  for (let i = 1; i < encoded.length; i++) {
    decoded.push(decoded[i - 1]! + encoded[i]!);
  }
  return decoded;
}

// ---------------------------------------------------------------------------
// Run-Length Encoding
// ---------------------------------------------------------------------------

interface RLEEntry {
  readonly value: number;
  readonly count: number;
}

function rleEncode(values: number[]): RLEEntry[] {
  if (values.length === 0) return [];
  const entries: RLEEntry[] = [];
  let current = values[0]!;
  let count = 1;

  for (let i = 1; i < values.length; i++) {
    if (values[i] === current) {
      count++;
    } else {
      entries.push({ value: current, count });
      current = values[i]!;
      count = 1;
    }
  }
  entries.push({ value: current, count });
  return entries;
}

function rleDecode(entries: RLEEntry[]): number[] {
  const values: number[] = [];
  for (const entry of entries) {
    for (let i = 0; i < entry.count; i++) {
      values.push(entry.value);
    }
  }
  return values;
}

function rleSize(entries: RLEEntry[]): number {
  return entries.length * 2; // value + count per entry
}

// ---------------------------------------------------------------------------
// Partition
// ---------------------------------------------------------------------------

class Partition {
  private readonly _points: ColumnarPoint[] = [];
  readonly startTime: number;
  readonly endTime: number;

  constructor(startTime: number, interval: number) {
    this.startTime = startTime;
    this.endTime = startTime + interval;
  }

  add(point: ColumnarPoint): void {
    // Insert maintaining sorted order
    const idx = this._binarySearchInsert(point.timestamp);
    this._points.splice(idx, 0, point);
  }

  get pointCount(): number {
    return this._points.length;
  }

  queryRange(start: number, end: number, tags?: Record<string, string>): ColumnarPoint[] {
    const startIdx = this._binarySearchLower(start);
    const endIdx = this._binarySearchUpper(end);
    const slice = this._points.slice(startIdx, endIdx);

    if (!tags || Object.keys(tags).length === 0) return slice;

    return slice.filter((p) => {
      if (!p.tags) return false;
      return Object.entries(tags).every(([k, v]) => p.tags?.[k] === v);
    });
  }

  encode(useDelta: boolean, useRLE: boolean): EncodedPartition {
    const timestamps = this._points.map((p) => p.timestamp);
    const values = this._points.map((p) => p.value);

    const tagKeySet = new Set<string>();
    for (const p of this._points) {
      if (p.tags) {
        for (const k of Object.keys(p.tags)) tagKeySet.add(k);
      }
    }
    const tagKeys = [...tagKeySet];
    const tagValues = tagKeys.map((key) => this._points.map((p) => p.tags?.[key] ?? ''));

    return {
      timestamps: useDelta ? deltaEncode(timestamps) : timestamps,
      values: useRLE ? rleDecode(rleEncode(values)) : values,
      tagKeys,
      tagValues,
      pointCount: this._points.length,
      startTime: this.startTime,
      endTime: this.endTime,
    };
  }

  getCompressedSize(useDelta: boolean, useRLE: boolean): number {
    const timestamps = this._points.map((p) => p.timestamp);
    const values = this._points.map((p) => p.value);

    let size = 0;
    size += useDelta ? deltaEncode(timestamps).length : timestamps.length;
    size += useRLE ? rleSize(rleEncode(values)) : values.length;
    return size;
  }

  getRawSize(): number {
    return this._points.length * 2; // timestamp + value
  }

  private _binarySearchInsert(timestamp: number): number {
    let lo = 0;
    let hi = this._points.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._points[mid]!.timestamp < timestamp) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private _binarySearchLower(timestamp: number): number {
    let lo = 0;
    let hi = this._points.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._points[mid]!.timestamp < timestamp) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private _binarySearchUpper(timestamp: number): number {
    let lo = 0;
    let hi = this._points.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._points[mid]!.timestamp <= timestamp) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

// ---------------------------------------------------------------------------
// ColumnarStore
// ---------------------------------------------------------------------------

export class ColumnarStore {
  private readonly _partitions = new Map<string, Partition>();
  private readonly _config: Required<ColumnarStoreConfig>;
  private readonly _stats$ = new BehaviorSubject<ColumnarStoreStats>(this._emptyStats());
  private readonly _destroy$ = new Subject<void>();

  /** Observable of store statistics */
  readonly stats$ = this._stats$.asObservable();

  constructor(config: ColumnarStoreConfig = {}) {
    this._config = {
      partitionInterval: config.partitionInterval ?? 3_600_000,
      maxPartitionSize: config.maxPartitionSize ?? 10_000,
      deltaEncoding: config.deltaEncoding ?? true,
      runLengthEncoding: config.runLengthEncoding ?? true,
    };
  }

  /** Ingest a single point */
  ingest(point: ColumnarPoint): void {
    const partition = this._getOrCreatePartition(point.timestamp);
    partition.add(point);
    this._updateStats();
  }

  /** Ingest a batch of points */
  ingestBatch(points: ColumnarPoint[]): number {
    for (const p of points) {
      const partition = this._getOrCreatePartition(p.timestamp);
      partition.add(p);
    }
    this._updateStats();
    return points.length;
  }

  /** Query raw points in a time range */
  queryRange(start: number, end: number, tags?: Record<string, string>): ColumnarPoint[] {
    const results: ColumnarPoint[] = [];
    for (const partition of this._partitions.values()) {
      if (partition.endTime < start || partition.startTime > end) continue;
      results.push(...partition.queryRange(start, end, tags));
    }
    results.sort((a, b) => a.timestamp - b.timestamp);
    return results;
  }

  /** Run an aggregation query over a time range */
  aggregateRange(start: number, end: number, request: AggregationRequest): AggregationResult {
    const t0 = Date.now();
    const points = this.queryRange(start, end, request.tags);

    if (!request.interval) {
      // Single bucket
      const value = this._aggregate(
        points.map((p) => p.value),
        request
      );
      return {
        buckets: [{ start, end, value, count: points.length }],
        totalPoints: points.length,
        executionMs: Date.now() - t0,
      };
    }

    // Group into buckets
    const buckets: AggregationBucket[] = [];
    let bucketStart = start;
    while (bucketStart < end) {
      const bucketEnd = Math.min(bucketStart + request.interval, end);
      const bucketPoints = points.filter(
        (p) => p.timestamp >= bucketStart && p.timestamp < bucketEnd
      );
      const value = this._aggregate(
        bucketPoints.map((p) => p.value),
        request
      );
      buckets.push({ start: bucketStart, end: bucketEnd, value, count: bucketPoints.length });
      bucketStart = bucketEnd;
    }

    return {
      buckets,
      totalPoints: points.length,
      executionMs: Date.now() - t0,
    };
  }

  /** Get partition metadata */
  getPartitions(): PartitionInfo[] {
    const useDelta = this._config.deltaEncoding;
    const useRLE = this._config.runLengthEncoding;
    const infos: PartitionInfo[] = [];

    for (const [id, partition] of this._partitions) {
      const rawSize = partition.getRawSize();
      const compressedSize = partition.getCompressedSize(useDelta, useRLE);
      infos.push({
        id,
        startTime: partition.startTime,
        endTime: partition.endTime,
        pointCount: partition.pointCount,
        rawSize,
        compressedSize,
        compressionRatio: rawSize > 0 ? compressedSize / rawSize : 1,
      });
    }

    return infos.sort((a, b) => a.startTime - b.startTime);
  }

  /** Get current store statistics */
  getStats(): ColumnarStoreStats {
    return this._stats$.getValue();
  }

  /** Drop partitions older than the given timestamp */
  dropBefore(timestamp: number): number {
    let dropped = 0;
    for (const [id, partition] of this._partitions) {
      if (partition.endTime <= timestamp) {
        this._partitions.delete(id);
        dropped++;
      }
    }
    if (dropped > 0) this._updateStats();
    return dropped;
  }

  /** Clear all data */
  clear(): void {
    this._partitions.clear();
    this._updateStats();
  }

  /** Clean up resources */
  destroy(): void {
    this._destroy$.next();
    this._destroy$.complete();
    this._stats$.complete();
    this._partitions.clear();
  }

  /** Delta-encode an array (exposed for testing) */
  static deltaEncode(values: number[]): number[] {
    return deltaEncode(values);
  }

  /** Delta-decode an array (exposed for testing) */
  static deltaDecode(encoded: number[]): number[] {
    return deltaDecode(encoded);
  }

  /** Run-length encode (exposed for testing) */
  static rleEncode(values: number[]): RLEEntry[] {
    return rleEncode(values);
  }

  /** Run-length decode (exposed for testing) */
  static rleDecode(entries: RLEEntry[]): number[] {
    return rleDecode(entries);
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _getOrCreatePartition(timestamp: number): Partition {
    const interval = this._config.partitionInterval;
    const partStart = Math.floor(timestamp / interval) * interval;
    const key = `p_${partStart}`;

    let partition = this._partitions.get(key);
    if (!partition) {
      partition = new Partition(partStart, interval);
      this._partitions.set(key, partition);
    }
    return partition;
  }

  private _aggregate(values: number[], request: AggregationRequest): number {
    if (values.length === 0) return 0;

    switch (request.function) {
      case 'avg':
        return values.reduce((a, b) => a + b, 0) / values.length;
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'count':
        return values.length;
      case 'percentile': {
        const p = request.percentile ?? 50;
        const sorted = [...values].sort((a, b) => a - b);
        const idx = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, idx)]!;
      }
    }
  }

  private _updateStats(): void {
    let totalPoints = 0;
    let totalRawSize = 0;
    let totalCompressedSize = 0;
    let oldest: number | null = null;
    let newest: number | null = null;

    const useDelta = this._config.deltaEncoding;
    const useRLE = this._config.runLengthEncoding;

    for (const partition of this._partitions.values()) {
      totalPoints += partition.pointCount;
      totalRawSize += partition.getRawSize();
      totalCompressedSize += partition.getCompressedSize(useDelta, useRLE);

      if (oldest === null || partition.startTime < oldest) oldest = partition.startTime;
      if (newest === null || partition.endTime > newest) newest = partition.endTime;
    }

    this._stats$.next({
      totalPoints,
      partitionCount: this._partitions.size,
      totalRawSize,
      totalCompressedSize,
      compressionRatio: totalRawSize > 0 ? totalCompressedSize / totalRawSize : 1,
      oldestTimestamp: oldest,
      newestTimestamp: newest,
    });
  }

  private _emptyStats(): ColumnarStoreStats {
    return {
      totalPoints: 0,
      partitionCount: 0,
      totalRawSize: 0,
      totalCompressedSize: 0,
      compressionRatio: 1,
      oldestTimestamp: null,
      newestTimestamp: null,
    };
  }
}

/** Factory function to create a ColumnarStore */
export function createColumnarStore(config?: ColumnarStoreConfig): ColumnarStore {
  return new ColumnarStore(config);
}
