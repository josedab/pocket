/**
 * Index performance monitor for tracking search latency, memory usage,
 * and recall quality metrics.
 *
 * Provides percentile-based latency tracking, degradation alerts, and
 * performance report generation.
 *
 * @module index-monitor
 *
 * @example Basic monitoring
 * ```typescript
 * const monitor = createIndexMonitor(store);
 *
 * monitor.alerts().subscribe((alert) => {
 *   console.warn(`Alert: ${alert.metric} - ${alert.message}`);
 * });
 *
 * // Wrap search calls to track latency
 * const results = await monitor.monitorSearch({ text: 'query' });
 *
 * // Generate report
 * const report = monitor.getReport();
 * console.log(`p95 latency: ${report.latency.p95}ms`);
 * ```
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import type { VectorSearchOptions, VectorSearchResult } from './types.js';
import type { VectorStore } from './vector-store.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Configuration for the index monitor.
 */
export interface IndexMonitorConfig {
  /**
   * Maximum number of latency samples to keep.
   * @default 1000
   */
  maxSamples?: number;

  /**
   * Latency threshold in ms for triggering alerts.
   * @default 100
   */
  latencyThresholdMs?: number;

  /**
   * Memory usage threshold in bytes for triggering alerts.
   * @default 100_000_000
   */
  memoryThresholdBytes?: number;

  /**
   * Minimum recall threshold for triggering alerts (0-1).
   * @default 0.8
   */
  recallThreshold?: number;
}

/**
 * Latency percentile metrics.
 */
export interface LatencyMetrics {
  /** Minimum latency in milliseconds */
  min: number;

  /** Maximum latency in milliseconds */
  max: number;

  /** Mean latency in milliseconds */
  mean: number;

  /** 50th percentile (median) in milliseconds */
  p50: number;

  /** 95th percentile in milliseconds */
  p95: number;

  /** 99th percentile in milliseconds */
  p99: number;

  /** Total number of samples */
  sampleCount: number;
}

/**
 * Memory usage metrics.
 */
export interface MemoryMetrics {
  /** Current estimated memory usage in bytes */
  currentBytes: number;

  /** Peak observed memory usage in bytes */
  peakBytes: number;

  /** Number of vectors stored */
  vectorCount: number;

  /** Average bytes per vector */
  bytesPerVector: number;
}

/**
 * Recall quality metrics (computed when ground truth is available).
 */
export interface RecallMetrics {
  /** Average recall across queries (0-1) */
  averageRecall: number;

  /** Number of queries evaluated */
  queryCount: number;

  /** Average number of relevant results found */
  averageRelevantFound: number;
}

/**
 * Performance alert emitted when metrics exceed thresholds.
 */
export interface PerformanceAlert {
  /** Which metric triggered the alert */
  metric: 'latency' | 'memory' | 'recall';

  /** Severity of the alert */
  severity: 'warning' | 'critical';

  /** Human-readable alert message */
  message: string;

  /** Current metric value */
  currentValue: number;

  /** Threshold that was exceeded */
  threshold: number;

  /** When the alert was generated */
  timestamp: number;
}

/**
 * Complete performance report.
 */
export interface PerformanceReport {
  /** Latency statistics */
  latency: LatencyMetrics;

  /** Memory usage statistics */
  memory: MemoryMetrics;

  /** Recall metrics (if ground truth was provided) */
  recall?: RecallMetrics;

  /** When the report was generated */
  generatedAt: number;

  /** Store name */
  storeName: string;
}

// ─── Index Monitor ───────────────────────────────────────────────────────────

/**
 * Performance monitor for vector index operations.
 *
 * Tracks search latency with percentile statistics, monitors memory usage,
 * measures recall quality, and generates alerts when thresholds are exceeded.
 *
 * @example
 * ```typescript
 * const monitor = createIndexMonitor(store, {
 *   latencyThresholdMs: 50,
 *   memoryThresholdBytes: 50_000_000,
 * });
 *
 * monitor.alerts().subscribe((alert) => {
 *   console.warn(`[${alert.severity}] ${alert.message}`);
 * });
 *
 * // Track search latency
 * const results = await monitor.monitorSearch({ text: 'query' });
 *
 * // Get performance report
 * const report = monitor.getReport();
 * ```
 */
export class IndexMonitor {
  private readonly store: VectorStore;
  private readonly maxSamples: number;
  private readonly latencyThreshold: number;
  private readonly memoryThreshold: number;
  private readonly recallThreshold: number;

  private latencySamples: number[] = [];
  private peakMemoryBytes = 0;
  private recallSamples: { recall: number; relevantFound: number }[] = [];

  private readonly alerts$ = new Subject<PerformanceAlert>();
  private readonly report$: BehaviorSubject<PerformanceReport>;

  constructor(store: VectorStore, config: IndexMonitorConfig = {}) {
    this.store = store;
    this.maxSamples = config.maxSamples ?? 1000;
    this.latencyThreshold = config.latencyThresholdMs ?? 100;
    this.memoryThreshold = config.memoryThresholdBytes ?? 100_000_000;
    this.recallThreshold = config.recallThreshold ?? 0.8;
    this.report$ = new BehaviorSubject<PerformanceReport>(this.buildReport());
  }

  /**
   * Subscribe to performance alerts.
   *
   * @returns Observable of performance alerts
   *
   * @example
   * ```typescript
   * monitor.alerts().subscribe((alert) => {
   *   console.warn(`${alert.metric}: ${alert.message}`);
   * });
   * ```
   */
  alerts(): Observable<PerformanceAlert> {
    return this.alerts$.asObservable();
  }

  /**
   * Subscribe to periodic report updates.
   *
   * @returns Observable of performance reports
   */
  reports(): Observable<PerformanceReport> {
    return this.report$.asObservable();
  }

  /**
   * Execute a search and record its latency.
   *
   * @param options - Search options to pass to the store
   * @returns The search results
   *
   * @example
   * ```typescript
   * const results = await monitor.monitorSearch({
   *   text: 'machine learning',
   *   limit: 10,
   * });
   * ```
   */
  async monitorSearch(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    const start = performance.now();
    const results = await this.store.search(options);
    const elapsed = performance.now() - start;

    this.recordLatency(elapsed);
    this.checkMemory();
    this.updateReport();

    return results;
  }

  /**
   * Record a search latency sample manually.
   *
   * @param latencyMs - Search latency in milliseconds
   */
  recordLatency(latencyMs: number): void {
    this.latencySamples.push(latencyMs);

    // Evict oldest samples
    if (this.latencySamples.length > this.maxSamples) {
      this.latencySamples = this.latencySamples.slice(-this.maxSamples);
    }

    // Check threshold
    if (latencyMs > this.latencyThreshold) {
      this.alerts$.next({
        metric: 'latency',
        severity: latencyMs > this.latencyThreshold * 2 ? 'critical' : 'warning',
        message: `Search latency ${latencyMs.toFixed(1)}ms exceeds threshold ${this.latencyThreshold}ms`,
        currentValue: latencyMs,
        threshold: this.latencyThreshold,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Record recall quality against ground truth results.
   *
   * @param predicted - The actual search results returned
   * @param groundTruth - The expected (correct) result IDs
   *
   * @example
   * ```typescript
   * const results = await store.search({ vector: query, limit: 10 });
   * monitor.recordRecall(results, ['id-1', 'id-3', 'id-7']);
   * ```
   */
  recordRecall(predicted: VectorSearchResult[], groundTruth: string[]): void {
    if (groundTruth.length === 0) return;

    const predictedIds = new Set(predicted.map((r) => r.id));
    let relevantFound = 0;

    for (const id of groundTruth) {
      if (predictedIds.has(id)) {
        relevantFound++;
      }
    }

    const recall = relevantFound / groundTruth.length;

    this.recallSamples.push({ recall, relevantFound });

    // Evict oldest samples
    if (this.recallSamples.length > this.maxSamples) {
      this.recallSamples = this.recallSamples.slice(-this.maxSamples);
    }

    // Check threshold
    if (recall < this.recallThreshold) {
      this.alerts$.next({
        metric: 'recall',
        severity: recall < this.recallThreshold * 0.5 ? 'critical' : 'warning',
        message: `Recall ${(recall * 100).toFixed(1)}% below threshold ${(this.recallThreshold * 100).toFixed(1)}%`,
        currentValue: recall,
        threshold: this.recallThreshold,
        timestamp: Date.now(),
      });
    }

    this.updateReport();
  }

  /**
   * Get the current performance report.
   *
   * @returns Current performance report snapshot
   */
  getReport(): PerformanceReport {
    return this.buildReport();
  }

  /**
   * Get latency percentile metrics.
   *
   * @returns Current latency statistics
   */
  getLatencyMetrics(): LatencyMetrics {
    return this.computeLatencyMetrics();
  }

  /**
   * Get memory usage metrics.
   *
   * @returns Current memory statistics
   */
  getMemoryMetrics(): MemoryMetrics {
    return this.computeMemoryMetrics();
  }

  /**
   * Get recall quality metrics.
   *
   * @returns Recall metrics or undefined if no ground truth recorded
   */
  getRecallMetrics(): RecallMetrics | undefined {
    return this.computeRecallMetrics();
  }

  /**
   * Reset all collected metrics.
   */
  reset(): void {
    this.latencySamples = [];
    this.recallSamples = [];
    this.peakMemoryBytes = 0;
    this.updateReport();
  }

  /**
   * Release resources and complete observables.
   */
  destroy(): void {
    this.alerts$.complete();
    this.report$.complete();
  }

  /**
   * Check memory and emit alerts if thresholds are exceeded.
   */
  private checkMemory(): void {
    const stats = this.store.getStats();
    const memoryBytes = stats.memoryUsage;

    if (memoryBytes > this.peakMemoryBytes) {
      this.peakMemoryBytes = memoryBytes;
    }

    if (memoryBytes > this.memoryThreshold) {
      this.alerts$.next({
        metric: 'memory',
        severity: memoryBytes > this.memoryThreshold * 1.5 ? 'critical' : 'warning',
        message: `Memory usage ${(memoryBytes / 1024 / 1024).toFixed(1)}MB exceeds threshold ${(this.memoryThreshold / 1024 / 1024).toFixed(1)}MB`,
        currentValue: memoryBytes,
        threshold: this.memoryThreshold,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Compute latency percentile metrics.
   */
  private computeLatencyMetrics(): LatencyMetrics {
    if (this.latencySamples.length === 0) {
      return { min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0, sampleCount: 0 };
    }

    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      min: sorted[0]!,
      max: sorted[sorted.length - 1]!,
      mean: sum / sorted.length,
      p50: this.percentile(sorted, 50),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
      sampleCount: sorted.length,
    };
  }

  /**
   * Compute memory usage metrics.
   */
  private computeMemoryMetrics(): MemoryMetrics {
    const stats = this.store.getStats();
    const currentBytes = stats.memoryUsage;
    const vectorCount = stats.vectorCount;

    if (currentBytes > this.peakMemoryBytes) {
      this.peakMemoryBytes = currentBytes;
    }

    return {
      currentBytes,
      peakBytes: this.peakMemoryBytes,
      vectorCount,
      bytesPerVector: vectorCount > 0 ? currentBytes / vectorCount : 0,
    };
  }

  /**
   * Compute recall quality metrics.
   */
  private computeRecallMetrics(): RecallMetrics | undefined {
    if (this.recallSamples.length === 0) return undefined;

    const totalRecall = this.recallSamples.reduce((sum, s) => sum + s.recall, 0);
    const totalRelevant = this.recallSamples.reduce((sum, s) => sum + s.relevantFound, 0);

    return {
      averageRecall: totalRecall / this.recallSamples.length,
      queryCount: this.recallSamples.length,
      averageRelevantFound: totalRelevant / this.recallSamples.length,
    };
  }

  /**
   * Compute a percentile value from a sorted array.
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0]!;

    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) return sorted[lower]!;

    const fraction = index - lower;
    return sorted[lower]! + fraction * (sorted[upper]! - sorted[lower]!);
  }

  /**
   * Build a complete performance report.
   */
  private buildReport(): PerformanceReport {
    const report: PerformanceReport = {
      latency: this.computeLatencyMetrics(),
      memory: this.computeMemoryMetrics(),
      generatedAt: Date.now(),
      storeName: this.store.name,
    };

    const recall = this.computeRecallMetrics();
    if (recall) {
      report.recall = recall;
    }

    return report;
  }

  /**
   * Update the report observable.
   */
  private updateReport(): void {
    this.report$.next(this.buildReport());
  }
}

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Create an index performance monitor for a vector store.
 *
 * @param store - The vector store to monitor
 * @param config - Monitor configuration
 * @returns A new IndexMonitor instance
 *
 * @example
 * ```typescript
 * const monitor = createIndexMonitor(store, {
 *   latencyThresholdMs: 50,
 *   memoryThresholdBytes: 50_000_000,
 * });
 *
 * monitor.alerts().subscribe(console.warn);
 * const results = await monitor.monitorSearch({ text: 'query' });
 * ```
 */
export function createIndexMonitor(
  store: VectorStore,
  config?: IndexMonitorConfig
): IndexMonitor {
  return new IndexMonitor(store, config);
}