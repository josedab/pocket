/**
 * Time-series store with bucketed storage, aggregation, and windowing
 */

import type {
  AggregationFunction,
  BucketInfo,
  TimeRange,
  TimeSeriesConfig,
  TimeSeriesPoint,
  TimeSeriesQueryResult,
  WindowConfig,
} from './types.js';
import { DEFAULT_TIME_SERIES_CONFIG } from './types.js';

/**
 * Time-series optimized store using time-bucketed storage
 */
export class TimeSeriesStore {
  private readonly config: TimeSeriesConfig;
  private readonly buckets: Map<number, TimeSeriesPoint[]> = new Map();

  constructor(config: Partial<TimeSeriesConfig> = {}) {
    this.config = { ...DEFAULT_TIME_SERIES_CONFIG, ...config };
  }

  /**
   * Insert a single data point
   */
  insert(point: TimeSeriesPoint): void {
    const bucketKey = this.getBucketKey(point.timestamp);
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = [];
      this.buckets.set(bucketKey, bucket);
    }
    bucket.push(point);
  }

  /**
   * Insert multiple data points
   */
  insertBatch(points: TimeSeriesPoint[]): void {
    for (const point of points) {
      this.insert(point);
    }
  }

  /**
   * Query data points within a time range
   */
  query(
    range: TimeRange,
    options: {
      tags?: Record<string, string>;
      aggregation?: AggregationFunction;
      interval?: number;
    } = {},
  ): TimeSeriesQueryResult {
    const startMs = performance.now();

    let points = this.getPointsInRange(range);

    // Filter by tags
    if (options.tags) {
      const filterTags = options.tags;
      points = points.filter((p) => {
        if (!p.tags) return false;
        return Object.entries(filterTags).every(
          ([key, value]) => p.tags![key] === value,
        );
      });
    }

    // Apply aggregation with interval if specified
    if (options.aggregation && options.interval) {
      points = this.aggregatePoints(points, options.interval, options.aggregation);
    }

    // Sort by timestamp
    points.sort((a, b) => a.timestamp - b.timestamp);

    const stats = this.computeStats(points);
    const executionTimeMs = performance.now() - startMs;

    return { points, stats, executionTimeMs };
  }

  /**
   * Apply a window function to data points
   */
  applyWindow(points: TimeSeriesPoint[], windowConfig: WindowConfig): TimeSeriesPoint[] {
    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);

    switch (windowConfig.function) {
      case 'moving-average':
        return this.movingAverage(sorted, windowConfig.windowSize);
      case 'ewma':
        return this.ewma(sorted, windowConfig.windowSize);
      case 'rate':
        return this.rate(sorted);
      case 'delta':
        return this.delta(sorted);
      default:
        return sorted;
    }
  }

  /**
   * Downsample data points to a target interval
   */
  downsample(
    range: TimeRange,
    targetInterval: number,
    aggregation: AggregationFunction,
  ): TimeSeriesPoint[] {
    const points = this.getPointsInRange(range);
    return this.aggregatePoints(points, targetInterval, aggregation);
  }

  /**
   * Get statistics for all points or points in a range
   */
  getStats(range?: TimeRange): { min: number; max: number; avg: number; count: number; sum: number } {
    const points = range ? this.getPointsInRange(range) : this.getAllPoints();
    return this.computeStats(points);
  }

  /**
   * List all time buckets
   */
  getBuckets(): BucketInfo[] {
    const buckets: BucketInfo[] = [];
    for (const [key, points] of this.buckets) {
      buckets.push({
        startTime: key,
        endTime: key + this.config.bucketSize,
        pointCount: points.length,
      });
    }
    return buckets.sort((a, b) => a.startTime - b.startTime);
  }

  /**
   * Remove expired data based on retention policy
   */
  applyRetention(): void {
    const now = Date.now();
    const cutoff = now - this.config.retention.rawDataTTL;

    for (const [key, points] of this.buckets) {
      // Remove entire bucket if it's older than the cutoff
      if (key + this.config.bucketSize <= cutoff) {
        this.buckets.delete(key);
        continue;
      }

      // Filter individual points within boundary buckets
      const filtered = points.filter((p) => p.timestamp > cutoff);
      if (filtered.length === 0) {
        this.buckets.delete(key);
      } else {
        this.buckets.set(key, filtered);
      }
    }

    // Enforce maxDataPoints
    const totalPoints = this.getPointCount();
    if (totalPoints > this.config.retention.maxDataPoints) {
      const excess = totalPoints - this.config.retention.maxDataPoints;
      this.removeOldestPoints(excess);
    }
  }

  /**
   * Remove all data
   */
  clear(): void {
    this.buckets.clear();
  }

  /**
   * Get total number of stored points
   */
  getPointCount(): number {
    let count = 0;
    for (const points of this.buckets.values()) {
      count += points.length;
    }
    return count;
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers                                                    */
  /* ------------------------------------------------------------------ */

  private getBucketKey(timestamp: number): number {
    return Math.floor(timestamp / this.config.bucketSize) * this.config.bucketSize;
  }

  private getPointsInRange(range: TimeRange): TimeSeriesPoint[] {
    const result: TimeSeriesPoint[] = [];
    const startBucket = this.getBucketKey(range.start);
    const endBucket = this.getBucketKey(range.end);

    for (let key = startBucket; key <= endBucket; key += this.config.bucketSize) {
      const bucket = this.buckets.get(key);
      if (bucket) {
        for (const point of bucket) {
          if (point.timestamp >= range.start && point.timestamp <= range.end) {
            result.push(point);
          }
        }
      }
    }
    return result;
  }

  private getAllPoints(): TimeSeriesPoint[] {
    const result: TimeSeriesPoint[] = [];
    for (const points of this.buckets.values()) {
      result.push(...points);
    }
    return result;
  }

  private computeStats(points: TimeSeriesPoint[]): {
    min: number;
    max: number;
    avg: number;
    count: number;
    sum: number;
  } {
    if (points.length === 0) {
      return { min: 0, max: 0, avg: 0, count: 0, sum: 0 };
    }

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;

    for (const point of points) {
      if (point.value < min) min = point.value;
      if (point.value > max) max = point.value;
      sum += point.value;
    }

    return {
      min,
      max,
      avg: sum / points.length,
      count: points.length,
      sum,
    };
  }

  private aggregatePoints(
    points: TimeSeriesPoint[],
    interval: number,
    aggregation: AggregationFunction,
  ): TimeSeriesPoint[] {
    if (points.length === 0) return [];

    // Group by interval
    const groups = new Map<number, TimeSeriesPoint[]>();
    for (const point of points) {
      const key = Math.floor(point.timestamp / interval) * interval;
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(point);
    }

    // Aggregate each group
    const result: TimeSeriesPoint[] = [];
    for (const [key, group] of groups) {
      const value = this.aggregate(group, aggregation);
      result.push({ timestamp: key, value });
    }

    return result.sort((a, b) => a.timestamp - b.timestamp);
  }

  private aggregate(points: TimeSeriesPoint[], fn: AggregationFunction): number {
    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);

    switch (fn) {
      case 'avg':
        return sorted.reduce((s, p) => s + p.value, 0) / sorted.length;
      case 'min':
        return Math.min(...sorted.map((p) => p.value));
      case 'max':
        return Math.max(...sorted.map((p) => p.value));
      case 'sum':
        return sorted.reduce((s, p) => s + p.value, 0);
      case 'count':
        return sorted.length;
      case 'first':
        return sorted[0]!.value;
      case 'last':
        return sorted[sorted.length - 1]!.value;
    }
  }

  private movingAverage(points: TimeSeriesPoint[], windowSize: number): TimeSeriesPoint[] {
    const result: TimeSeriesPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const window = points.slice(start, i + 1);
      const avg = window.reduce((s, p) => s + p.value, 0) / window.length;
      result.push({ timestamp: points[i]!.timestamp, value: avg });
    }
    return result;
  }

  private ewma(points: TimeSeriesPoint[], alpha: number): TimeSeriesPoint[] {
    if (points.length === 0) return [];

    const result: TimeSeriesPoint[] = [];
    let ewmaValue = points[0]!.value;
    result.push({ timestamp: points[0]!.timestamp, value: ewmaValue });

    for (let i = 1; i < points.length; i++) {
      ewmaValue = alpha * points[i]!.value + (1 - alpha) * ewmaValue;
      result.push({ timestamp: points[i]!.timestamp, value: ewmaValue });
    }
    return result;
  }

  private rate(points: TimeSeriesPoint[]): TimeSeriesPoint[] {
    const result: TimeSeriesPoint[] = [];
    for (let i = 1; i < points.length; i++) {
      const dt = points[i]!.timestamp - points[i - 1]!.timestamp;
      if (dt === 0) continue;
      const rate = (points[i]!.value - points[i - 1]!.value) / dt;
      result.push({ timestamp: points[i]!.timestamp, value: rate });
    }
    return result;
  }

  private delta(points: TimeSeriesPoint[]): TimeSeriesPoint[] {
    const result: TimeSeriesPoint[] = [];
    for (let i = 1; i < points.length; i++) {
      const delta = points[i]!.value - points[i - 1]!.value;
      result.push({ timestamp: points[i]!.timestamp, value: delta });
    }
    return result;
  }

  private removeOldestPoints(count: number): void {
    const sortedKeys = [...this.buckets.keys()].sort((a, b) => a - b);
    let removed = 0;

    for (const key of sortedKeys) {
      if (removed >= count) break;
      const bucket = this.buckets.get(key)!;
      bucket.sort((a, b) => a.timestamp - b.timestamp);

      while (bucket.length > 0 && removed < count) {
        bucket.shift();
        removed++;
      }

      if (bucket.length === 0) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Create a new TimeSeriesStore instance
 */
export function createTimeSeriesStore(config: Partial<TimeSeriesConfig> = {}): TimeSeriesStore {
  return new TimeSeriesStore(config);
}
