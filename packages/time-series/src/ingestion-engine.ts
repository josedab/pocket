/**
 * High-frequency append-only ingestion engine with batched writes
 * and timestamp indexing for IoT, analytics, and monitoring data.
 */
import { Subject, type Observable, type Subscription } from 'rxjs';
import { bufferTime, filter } from 'rxjs/operators';

export interface IngestionPoint {
  metric: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

export interface IngestionConfig {
  batchSize?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  onFlush?: (points: IngestionPoint[]) => void;
}

export interface IngestionStats {
  totalIngested: number;
  totalFlushed: number;
  batchCount: number;
  droppedPoints: number;
  avgBatchSize: number;
  lastFlushAt: number | null;
}

interface TimestampIndex {
  /** Map of metric -> sorted timestamps -> point indices */
  metrics: Map<string, { timestamps: number[]; points: IngestionPoint[] }>;
}

/**
 * High-frequency ingestion engine with batched writes and timestamp indexing.
 */
export class IngestionEngine {
  private readonly config: Required<IngestionConfig>;
  private readonly input$ = new Subject<IngestionPoint>();
  private readonly flushed$ = new Subject<IngestionPoint[]>();
  private readonly index: TimestampIndex = { metrics: new Map() };
  private subscription: Subscription | null = null;
  private stats: IngestionStats = {
    totalIngested: 0,
    totalFlushed: 0,
    batchCount: 0,
    droppedPoints: 0,
    avgBatchSize: 0,
    lastFlushAt: null,
  };

  constructor(config?: IngestionConfig) {
    this.config = {
      batchSize: config?.batchSize ?? 1000,
      flushIntervalMs: config?.flushIntervalMs ?? 1000,
      maxBufferSize: config?.maxBufferSize ?? 100000,
      onFlush: config?.onFlush ?? (() => {}),
    };

    this.startBatching();
  }

  /** Ingest a single point */
  ingest(point: IngestionPoint): void {
    if (!point.metric || typeof point.value !== 'number') {
      this.stats.droppedPoints++;
      return;
    }

    // Use current time if not provided
    if (!point.timestamp) {
      point.timestamp = Date.now();
    }

    this.stats.totalIngested++;
    this.input$.next(point);
  }

  /** Ingest a batch of points */
  ingestBatch(points: IngestionPoint[]): void {
    for (const point of points) {
      this.ingest(point);
    }
  }

  /** Get flushed batches observable */
  get batches$(): Observable<IngestionPoint[]> {
    return this.flushed$.asObservable();
  }

  /** Query points by metric and time range */
  query(metric: string, from: number, to: number): IngestionPoint[] {
    const metricData = this.index.metrics.get(metric);
    if (!metricData) return [];

    const result: IngestionPoint[] = [];
    for (let i = 0; i < metricData.timestamps.length; i++) {
      const ts = metricData.timestamps[i]!;
      if (ts >= from && ts <= to) {
        result.push(metricData.points[i]!);
      } else if (ts > to) {
        break; // timestamps are sorted
      }
    }
    return result;
  }

  /** Get all known metric names */
  getMetrics(): string[] {
    return Array.from(this.index.metrics.keys());
  }

  /** Get latest point for a metric */
  getLatest(metric: string): IngestionPoint | null {
    const data = this.index.metrics.get(metric);
    if (!data || data.points.length === 0) return null;
    return data.points[data.points.length - 1] ?? null;
  }

  /** Get ingestion stats */
  getStats(): IngestionStats {
    return { ...this.stats };
  }

  /** Flush pending buffer immediately */
  flush(): void {
    // Complete and restart batching to force flush
    this.stopBatching();
    this.startBatching();
  }

  /** Destroy the engine */
  destroy(): void {
    this.stopBatching();
    this.input$.complete();
    this.flushed$.complete();
  }

  private startBatching(): void {
    this.subscription = this.input$
      .pipe(
        bufferTime(this.config.flushIntervalMs, undefined, this.config.batchSize),
        filter((batch: IngestionPoint[]) => batch.length > 0)
      )
      .subscribe((batch) => {
        this.processBatch(batch);
      });
  }

  private stopBatching(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  private processBatch(batch: IngestionPoint[]): void {
    // Index the points
    for (const point of batch) {
      let metricData = this.index.metrics.get(point.metric);
      if (!metricData) {
        metricData = { timestamps: [], points: [] };
        this.index.metrics.set(point.metric, metricData);
      }

      // Insert maintaining timestamp order (binary search for position)
      const insertIdx = this.binarySearchInsert(metricData.timestamps, point.timestamp);
      metricData.timestamps.splice(insertIdx, 0, point.timestamp);
      metricData.points.splice(insertIdx, 0, point);

      // Enforce max buffer size per metric
      if (metricData.points.length > this.config.maxBufferSize) {
        const excess = metricData.points.length - this.config.maxBufferSize;
        metricData.timestamps.splice(0, excess);
        metricData.points.splice(0, excess);
        this.stats.droppedPoints += excess;
      }
    }

    this.stats.totalFlushed += batch.length;
    this.stats.batchCount++;
    this.stats.avgBatchSize = this.stats.totalFlushed / this.stats.batchCount;
    this.stats.lastFlushAt = Date.now();

    this.config.onFlush(batch);
    this.flushed$.next(batch);
  }

  private binarySearchInsert(arr: number[], target: number): number {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

export function createIngestionEngine(config?: IngestionConfig): IngestionEngine {
  return new IngestionEngine(config);
}
