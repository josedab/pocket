/**
 * MetricsCollector — collects and aggregates database performance metrics.
 *
 * Records named metrics with optional tags, computes statistical summaries
 * (count, avg, min, max, percentiles), and provides time-series data.
 *
 * @module @pocket/studio
 */

import { BehaviorSubject, type Observable } from 'rxjs';

// ── Types ─────────────────────────────────────────────────

export interface MetricSummary {
  readonly name: string;
  readonly count: number;
  readonly sum: number;
  readonly avg: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly lastValue: number;
  readonly lastUpdated: number;
}

export interface TimeSeriesPoint {
  readonly timestamp: number;
  readonly value: number;
  readonly count: number;
}

export interface MetricsCollectorConfig {
  /** How long to retain raw data points in ms (default: 300000 = 5 min) */
  readonly retentionMs?: number;
  /** Bucket size for time-series aggregation in ms (default: 1000) */
  readonly bucketSizeMs?: number;
}

interface RawDataPoint {
  readonly value: number;
  readonly timestamp: number;
  readonly tags?: Record<string, string>;
}

// ── MetricsCollector ──────────────────────────────────────

export class MetricsCollector {
  private readonly config: Required<MetricsCollectorConfig>;
  private readonly metricsSubject: BehaviorSubject<MetricSummary[]>;
  private readonly dataPoints = new Map<string, RawDataPoint[]>();
  private destroyed = false;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: MetricsCollectorConfig) {
    this.config = {
      retentionMs: config?.retentionMs ?? 300_000,
      bucketSizeMs: config?.bucketSizeMs ?? 1000,
    };

    this.metricsSubject = new BehaviorSubject<MetricSummary[]>([]);

    // Periodically prune old data
    this.pruneTimer = setInterval(() => this.pruneExpired(), this.config.retentionMs / 2);
  }

  // ── Observables ──────────────────────────────────────────

  get metrics$(): Observable<MetricSummary[]> {
    return this.metricsSubject.asObservable();
  }

  // ── Public API ───────────────────────────────────────────

  /** Record a metric data point. */
  recordMetric(name: string, value: number, tags?: Record<string, string>): void {
    if (this.destroyed) return;

    const points = this.dataPoints.get(name) ?? [];
    points.push({ value, timestamp: Date.now(), tags });
    this.dataPoints.set(name, points);

    this.emitSummaries();
  }

  /** Get summary for a specific metric. */
  getMetric(name: string): MetricSummary | null {
    const points = this.dataPoints.get(name);
    if (!points || points.length === 0) return null;
    return this.computeSummary(name, points);
  }

  /** Get summaries for all recorded metrics. */
  getAllMetrics(): MetricSummary[] {
    const summaries: MetricSummary[] = [];
    for (const [name, points] of this.dataPoints) {
      if (points.length > 0) {
        summaries.push(this.computeSummary(name, points));
      }
    }
    return summaries;
  }

  /** Get time-series data for a metric over the given duration. */
  getTimeSeries(name: string, durationMs: number): TimeSeriesPoint[] {
    const points = this.dataPoints.get(name);
    if (!points || points.length === 0) return [];

    const cutoff = Date.now() - durationMs;
    const filtered = points.filter((p) => p.timestamp >= cutoff);
    if (filtered.length === 0) return [];

    // Group into buckets
    const buckets = new Map<number, { sum: number; count: number }>();
    for (const point of filtered) {
      const bucketKey =
        Math.floor(point.timestamp / this.config.bucketSizeMs) * this.config.bucketSizeMs;
      const bucket = buckets.get(bucketKey) ?? { sum: 0, count: 0 };
      bucket.sum += point.value;
      bucket.count += 1;
      buckets.set(bucketKey, bucket);
    }

    const series: TimeSeriesPoint[] = [];
    for (const [timestamp, bucket] of buckets) {
      series.push({
        timestamp,
        value: bucket.count > 0 ? bucket.sum / bucket.count : 0,
        count: bucket.count,
      });
    }

    series.sort((a, b) => a.timestamp - b.timestamp);
    return series;
  }

  /** Reset all collected metrics. */
  reset(): void {
    this.dataPoints.clear();
    this.metricsSubject.next([]);
  }

  /** Destroy the collector and release resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.metricsSubject.complete();
  }

  // ── Private ──────────────────────────────────────────────

  private computeSummary(name: string, points: readonly RawDataPoint[]): MetricSummary {
    const values = points.map((p) => p.value);
    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      name,
      count,
      sum: Math.round(sum * 100) / 100,
      avg: Math.round((sum / count) * 100) / 100,
      min: sorted[0]!,
      max: sorted[count - 1]!,
      p50: this.percentile(sorted, 0.5),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99),
      lastValue: points[points.length - 1]!.value,
      lastUpdated: points[points.length - 1]!.timestamp,
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0]!;
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower]!;
    const weight = index - lower;
    return Math.round((sorted[lower]! * (1 - weight) + sorted[upper]! * weight) * 100) / 100;
  }

  private pruneExpired(): void {
    if (this.destroyed) return;
    const cutoff = Date.now() - this.config.retentionMs;
    let changed = false;
    for (const [name, points] of this.dataPoints) {
      const filtered = points.filter((p) => p.timestamp >= cutoff);
      if (filtered.length !== points.length) {
        changed = true;
        if (filtered.length === 0) {
          this.dataPoints.delete(name);
        } else {
          this.dataPoints.set(name, filtered);
        }
      }
    }
    if (changed) {
      this.emitSummaries();
    }
  }

  private emitSummaries(): void {
    this.metricsSubject.next(this.getAllMetrics());
  }
}

/**
 * Create a new MetricsCollector instance.
 */
export function createMetricsCollector(config?: MetricsCollectorConfig): MetricsCollector {
  return new MetricsCollector(config);
}
