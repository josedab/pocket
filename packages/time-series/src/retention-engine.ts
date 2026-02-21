/**
 * Retention Engine — automated data lifecycle management for time-series data.
 *
 * Enforces retention policies by expiring old data, triggering downsampling
 * pipelines, and compacting storage. Supports tiered retention where raw
 * data ages into progressively coarser aggregations.
 *
 * @module @pocket/time-series
 */

import type {
  TimeSeriesPoint,
  AggregationFunction,
} from './types.js';

// ── Types ─────────────────────────────────────────────────

export interface RetentionTier {
  name: string;
  /** Maximum age of data in this tier (ms) */
  maxAge: number;
  /** Aggregation interval for this tier (ms). Raw = 0 */
  aggregationInterval: number;
  /** Aggregation function to apply */
  aggregation: AggregationFunction;
}

export interface RetentionEngineConfig {
  /** Retention tiers from most granular to least */
  tiers: RetentionTier[];
  /** How often to run the retention check (ms, default: 60000) */
  checkIntervalMs?: number;
  /** Callback when data is expired */
  onExpire?: (tier: string, count: number) => void;
  /** Callback when data is downsampled */
  onDownsample?: (fromTier: string, toTier: string, count: number) => void;
}

export interface RetentionStats {
  totalPoints: number;
  pointsByTier: Record<string, number>;
  lastCheckTimestamp: number;
  expiredCount: number;
  downsampledCount: number;
}

export interface TieredData {
  tier: string;
  points: TimeSeriesPoint[];
}

// ── Retention Engine ──────────────────────────────────────

/**
 * Manages time-series data retention across multiple tiers.
 *
 * Raw data is automatically downsampled into coarser tiers as it ages,
 * and eventually expired when it exceeds the maximum retention period.
 */
export class RetentionEngine {
  private readonly tiers: RetentionTier[];
  private readonly tierData: Map<string, TimeSeriesPoint[]> = new Map();
  private readonly checkIntervalMs: number;
  private readonly onExpire?: (tier: string, count: number) => void;
  private readonly onDownsample?: (fromTier: string, toTier: string, count: number) => void;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private lastCheckTimestamp = 0;
  private expiredTotal = 0;
  private downsampledTotal = 0;

  constructor(config: RetentionEngineConfig) {
    this.tiers = [...config.tiers].sort((a, b) => a.maxAge - b.maxAge);
    this.checkIntervalMs = config.checkIntervalMs ?? 60000;
    this.onExpire = config.onExpire;
    this.onDownsample = config.onDownsample;

    for (const tier of this.tiers) {
      this.tierData.set(tier.name, []);
    }
  }

  /** Ingest new data points into the raw (first) tier */
  ingest(points: TimeSeriesPoint[]): void {
    const firstTier = this.tiers[0];
    if (!firstTier) return;

    const tierPoints = this.tierData.get(firstTier.name) ?? [];
    tierPoints.push(...points);
    // Keep sorted by timestamp
    tierPoints.sort((a, b) => a.timestamp - b.timestamp);
    this.tierData.set(firstTier.name, tierPoints);
  }

  /** Run the retention check: downsample and expire data */
  enforce(now: number = Date.now()): RetentionStats {
    this.lastCheckTimestamp = now;

    // Process tiers from finest to coarsest
    for (let i = 0; i < this.tiers.length; i++) {
      const tier = this.tiers[i]!;
      const nextTier = this.tiers[i + 1];
      const points = this.tierData.get(tier.name) ?? [];

      // Find points that have exceeded this tier's max age
      const cutoff = now - tier.maxAge;
      const expired = points.filter((p) => p.timestamp < cutoff);
      const retained = points.filter((p) => p.timestamp >= cutoff);

      if (expired.length > 0) {
        if (nextTier) {
          // Downsample expired points into next tier
          const downsampled = this.downsample(
            expired,
            nextTier.aggregationInterval,
            nextTier.aggregation,
          );
          const nextPoints = this.tierData.get(nextTier.name) ?? [];
          nextPoints.push(...downsampled);
          nextPoints.sort((a, b) => a.timestamp - b.timestamp);
          this.tierData.set(nextTier.name, nextPoints);

          this.downsampledTotal += downsampled.length;
          this.onDownsample?.(tier.name, nextTier.name, downsampled.length);
        } else {
          // Last tier — expire the data permanently
          this.expiredTotal += expired.length;
          this.onExpire?.(tier.name, expired.length);
        }

        this.tierData.set(tier.name, retained);
      }
    }

    return this.getStats();
  }

  /** Start automatic periodic retention enforcement */
  start(): void {
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => this.enforce(), this.checkIntervalMs);
  }

  /** Stop automatic retention enforcement */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /** Get all data for a specific tier */
  getTierData(tierName: string): TimeSeriesPoint[] {
    return [...(this.tierData.get(tierName) ?? [])];
  }

  /** Get data from all tiers */
  getAllTieredData(): TieredData[] {
    return this.tiers.map((tier) => ({
      tier: tier.name,
      points: this.getTierData(tier.name),
    }));
  }

  /** Query across tiers for a time range, picking the best resolution */
  queryRange(start: number, end: number): TimeSeriesPoint[] {
    const now = Date.now();
    const results: TimeSeriesPoint[] = [];

    // For each tier, collect points that fall in range and belong to this tier's age bracket
    for (let i = 0; i < this.tiers.length; i++) {
      const tier = this.tiers[i]!;
      const prevMaxAge = i > 0 ? this.tiers[i - 1]!.maxAge : 0;
      const tierStart = now - tier.maxAge;
      const tierEnd = i > 0 ? now - prevMaxAge : now;

      const effectiveStart = Math.max(start, tierStart);
      const effectiveEnd = Math.min(end, tierEnd);

      if (effectiveStart < effectiveEnd) {
        const points = this.tierData.get(tier.name) ?? [];
        results.push(
          ...points.filter((p) => p.timestamp >= effectiveStart && p.timestamp <= effectiveEnd),
        );
      }
    }

    // Also include first tier for recent data
    const firstTier = this.tiers[0];
    if (firstTier) {
      const points = this.tierData.get(firstTier.name) ?? [];
      results.push(
        ...points.filter(
          (p) => p.timestamp >= start && p.timestamp <= end &&
          !results.some((r) => r.timestamp === p.timestamp),
        ),
      );
    }

    return results.sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Get retention statistics */
  getStats(): RetentionStats {
    let totalPoints = 0;
    const pointsByTier: Record<string, number> = {};

    for (const tier of this.tiers) {
      const count = (this.tierData.get(tier.name) ?? []).length;
      pointsByTier[tier.name] = count;
      totalPoints += count;
    }

    return {
      totalPoints,
      pointsByTier,
      lastCheckTimestamp: this.lastCheckTimestamp,
      expiredCount: this.expiredTotal,
      downsampledCount: this.downsampledTotal,
    };
  }

  /** Dispose of the engine and stop timers */
  dispose(): void {
    this.stop();
    this.tierData.clear();
  }

  // ── Internals ─────────────────────────────────────────

  private downsample(
    points: TimeSeriesPoint[],
    interval: number,
    aggregation: AggregationFunction,
  ): TimeSeriesPoint[] {
    if (points.length === 0 || interval <= 0) return [];

    const buckets = new Map<number, TimeSeriesPoint[]>();

    for (const point of points) {
      const bucketKey = Math.floor(point.timestamp / interval) * interval;
      const bucket = buckets.get(bucketKey) ?? [];
      bucket.push(point);
      buckets.set(bucketKey, bucket);
    }

    const result: TimeSeriesPoint[] = [];
    for (const [bucketTs, bucketPoints] of buckets) {
      const value = this.aggregate(bucketPoints, aggregation);
      // Merge tags from first point
      const tags = bucketPoints[0]?.tags;
      result.push({ timestamp: bucketTs, value, tags });
    }

    return result.sort((a, b) => a.timestamp - b.timestamp);
  }

  private aggregate(points: TimeSeriesPoint[], fn: AggregationFunction): number {
    if (points.length === 0) return 0;

    switch (fn) {
      case 'avg':
        return points.reduce((s, p) => s + p.value, 0) / points.length;
      case 'min':
        return Math.min(...points.map((p) => p.value));
      case 'max':
        return Math.max(...points.map((p) => p.value));
      case 'sum':
        return points.reduce((s, p) => s + p.value, 0);
      case 'count':
        return points.length;
      case 'first':
        return points[0]!.value;
      case 'last':
        return points[points.length - 1]!.value;
    }
  }
}

// ── Range Index ───────────────────────────────────────────

/**
 * B-tree-like range index for efficient time-range queries.
 *
 * Partitions points into fixed-size buckets for O(1) bucket lookup
 * and O(n) scan within matching buckets.
 */
export class RangeIndex {
  private readonly bucketSize: number;
  private readonly buckets: Map<number, TimeSeriesPoint[]> = new Map();
  private totalCount = 0;

  constructor(bucketSizeMs: number = 3600000) {
    this.bucketSize = bucketSizeMs;
  }

  /** Insert points into the index */
  insert(points: TimeSeriesPoint[]): void {
    for (const point of points) {
      const key = Math.floor(point.timestamp / this.bucketSize);
      const bucket = this.buckets.get(key) ?? [];
      bucket.push(point);
      this.buckets.set(key, bucket);
      this.totalCount++;
    }
  }

  /** Query points within a time range */
  query(start: number, end: number, tagFilter?: Record<string, string>): TimeSeriesPoint[] {
    const startKey = Math.floor(start / this.bucketSize);
    const endKey = Math.floor(end / this.bucketSize);
    const results: TimeSeriesPoint[] = [];

    for (let key = startKey; key <= endKey; key++) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;

      for (const point of bucket) {
        if (point.timestamp >= start && point.timestamp <= end) {
          if (!tagFilter || this.matchTags(point, tagFilter)) {
            results.push(point);
          }
        }
      }
    }

    return results.sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Aggregate over a time range */
  aggregate(
    start: number,
    end: number,
    fn: AggregationFunction,
    intervalMs: number,
  ): TimeSeriesPoint[] {
    const points = this.query(start, end);
    if (points.length === 0) return [];

    const buckets = new Map<number, number[]>();
    for (const p of points) {
      const key = Math.floor(p.timestamp / intervalMs) * intervalMs;
      const bucket = buckets.get(key) ?? [];
      bucket.push(p.value);
      buckets.set(key, bucket);
    }

    const result: TimeSeriesPoint[] = [];
    for (const [ts, values] of buckets) {
      result.push({ timestamp: ts, value: this.computeAgg(values, fn) });
    }

    return result.sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Remove points older than a given timestamp */
  expireBefore(timestamp: number): number {
    const maxKey = Math.floor(timestamp / this.bucketSize);
    let count = 0;

    for (const [key, bucket] of this.buckets) {
      if (key < maxKey) {
        count += bucket.length;
        this.totalCount -= bucket.length;
        this.buckets.delete(key);
      } else if (key === maxKey) {
        const before = bucket.length;
        const remaining = bucket.filter((p) => p.timestamp >= timestamp);
        const removed = before - remaining.length;
        count += removed;
        this.totalCount -= removed;
        if (remaining.length === 0) {
          this.buckets.delete(key);
        } else {
          this.buckets.set(key, remaining);
        }
      }
    }

    return count;
  }

  /** Get total number of indexed points */
  get size(): number {
    return this.totalCount;
  }

  /** Get number of buckets */
  get bucketCount(): number {
    return this.buckets.size;
  }

  /** Clear the index */
  clear(): void {
    this.buckets.clear();
    this.totalCount = 0;
  }

  private matchTags(point: TimeSeriesPoint, filter: Record<string, string>): boolean {
    if (!point.tags) return false;
    for (const [key, value] of Object.entries(filter)) {
      if (point.tags[key] !== value) return false;
    }
    return true;
  }

  private computeAgg(values: number[], fn: AggregationFunction): number {
    switch (fn) {
      case 'avg': return values.reduce((a, b) => a + b, 0) / values.length;
      case 'min': return Math.min(...values);
      case 'max': return Math.max(...values);
      case 'sum': return values.reduce((a, b) => a + b, 0);
      case 'count': return values.length;
      case 'first': return values[0]!;
      case 'last': return values[values.length - 1]!;
    }
  }
}

// ── Factories ─────────────────────────────────────────────

/** Create a new retention engine with tiered storage */
export function createTimeSeriesRetention(config: RetentionEngineConfig): RetentionEngine {
  return new RetentionEngine(config);
}

/** Create a new time-range index for efficient queries */
export function createRangeIndex(bucketSizeMs?: number): RangeIndex {
  return new RangeIndex(bucketSizeMs);
}
