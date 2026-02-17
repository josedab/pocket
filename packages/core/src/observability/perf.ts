/**
 * Performance measurement utilities for Pocket core.
 *
 * Provides timing wrappers, operation profiling, and histogram tracking
 * that integrates with the structured logger.
 *
 * @module observability/perf
 */

import { type PocketLogger } from './logger.js';

/** A completed timing record */
export interface TimingRecord {
  readonly operation: string;
  readonly durationMs: number;
  readonly timestamp: number;
  readonly metadata?: Record<string, unknown>;
}

/** Histogram bucket for latency distribution */
export interface HistogramBucket {
  readonly le: number; // less-than-or-equal threshold in ms
  readonly count: number;
}

/** Performance summary for an operation */
export interface PerfSummary {
  readonly operation: string;
  readonly count: number;
  readonly totalMs: number;
  readonly avgMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

/**
 * Tracks operation performance with histograms and percentiles.
 *
 * @example
 * ```typescript
 * const profiler = new OperationProfiler({ logger });
 *
 * const end = profiler.start('collection.find');
 * const results = await collection.find({ filter });
 * end({ resultCount: results.length });
 *
 * const summary = profiler.getSummary('collection.find');
 * console.log(`Avg: ${summary.avgMs}ms, p95: ${summary.p95Ms}ms`);
 * ```
 */
export class OperationProfiler {
  private readonly logger?: PocketLogger;
  private readonly timings = new Map<string, number[]>();
  private readonly maxSamples: number;

  constructor(options?: { logger?: PocketLogger; maxSamples?: number }) {
    this.logger = options?.logger;
    this.maxSamples = options?.maxSamples ?? 10_000;
  }

  /** Start timing an operation. Returns a function to call when done. */
  start(operation: string): (metadata?: Record<string, unknown>) => TimingRecord {
    const startTime = performance.now();

    return (metadata?: Record<string, unknown>) => {
      const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
      this.record(operation, durationMs);

      this.logger?.debug(`${operation}: ${durationMs}ms`, { ...metadata, durationMs });

      return { operation, durationMs, timestamp: Date.now(), metadata };
    };
  }

  /** Manually record a timing */
  record(operation: string, durationMs: number): void {
    let samples = this.timings.get(operation);
    if (!samples) {
      samples = [];
      this.timings.set(operation, samples);
    }
    samples.push(durationMs);
    if (samples.length > this.maxSamples) samples.shift();
  }

  /** Wrap an async function with automatic timing */
  async wrap<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const end = this.start(operation);
    try {
      const result = await fn();
      end({ success: true });
      return result;
    } catch (err) {
      end({ success: false, error: String(err) });
      throw err;
    }
  }

  /** Get performance summary for an operation */
  getSummary(operation: string): PerfSummary | null {
    const samples = this.timings.get(operation);
    if (!samples || samples.length === 0) return null;

    const sorted = [...samples].sort((a, b) => a - b);
    const count = sorted.length;
    const total = sorted.reduce((a, b) => a + b, 0);

    return {
      operation,
      count,
      totalMs: Math.round(total * 100) / 100,
      avgMs: Math.round((total / count) * 100) / 100,
      minMs: sorted[0]!,
      maxMs: sorted[count - 1]!,
      p50Ms: sorted[Math.floor(count * 0.5)]!,
      p95Ms: sorted[Math.floor(count * 0.95)]!,
      p99Ms: sorted[Math.floor(count * 0.99)]!,
    };
  }

  /** Get summaries for all tracked operations */
  getAllSummaries(): PerfSummary[] {
    const results: PerfSummary[] = [];
    for (const operation of this.timings.keys()) {
      const summary = this.getSummary(operation);
      if (summary) results.push(summary);
    }
    return results.sort((a, b) => b.totalMs - a.totalMs);
  }

  /** Get histogram buckets for an operation */
  getHistogram(operation: string, buckets = [1, 5, 10, 25, 50, 100, 250, 500, 1000]): HistogramBucket[] {
    const samples = this.timings.get(operation);
    if (!samples) return buckets.map((le) => ({ le, count: 0 }));

    return buckets.map((le) => ({
      le,
      count: samples.filter((s) => s <= le).length,
    }));
  }

  /** Reset all tracked data */
  reset(operation?: string): void {
    if (operation) {
      this.timings.delete(operation);
    } else {
      this.timings.clear();
    }
  }

  /** Get all tracked operation names */
  getOperations(): string[] {
    return Array.from(this.timings.keys());
  }
}

/** Factory function */
export function createOperationProfiler(options?: { logger?: PocketLogger; maxSamples?: number }): OperationProfiler {
  return new OperationProfiler(options);
}
