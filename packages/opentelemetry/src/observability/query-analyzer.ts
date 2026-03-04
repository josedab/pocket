/**
 * QueryPerformanceAnalyzer — tracks query execution metrics, identifies
 * slow queries, simulates query plans, and suggests index improvements.
 */

import type {
  QueryMetrics,
  QueryPlanDetails,
  QueryPlanStep,
  SlowQueryEntry,
} from './types.js';

// ── Helpers ──────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function generateId(): string {
  return `sq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function suggestForQuery(metrics: QueryMetrics): string {
  if (metrics.indexUsed === null && metrics.documentsScanned > 100) {
    return `Consider adding an index on collection "${metrics.collection}" to avoid full scans (${metrics.documentsScanned} documents scanned).`;
  }
  if (metrics.documentsScanned > metrics.documentsReturned * 10) {
    return `Query scanned ${metrics.documentsScanned} documents but returned only ${metrics.documentsReturned}. A more selective index may help.`;
  }
  if (metrics.executionTimeMs > 500) {
    return `Query took ${metrics.executionTimeMs}ms. Consider caching results or optimizing the query spec.`;
  }
  return 'Review query plan for potential optimizations.';
}

// ── QueryPerformanceAnalyzer ─────────────────────────────

export interface QueryAnalyzerConfig {
  slowQueryThresholdMs?: number;
  maxLogSize?: number;
}

export class QueryPerformanceAnalyzer {
  private readonly slowThreshold: number;
  private readonly maxLogSize: number;
  private readonly queryLog: QueryMetrics[] = [];
  private readonly slowQueries: SlowQueryEntry[] = [];
  private destroyed = false;

  constructor(config: QueryAnalyzerConfig = {}) {
    this.slowThreshold = config.slowQueryThresholdMs ?? 100;
    this.maxLogSize = config.maxLogSize ?? 10_000;
  }

  /**
   * Record a query execution and detect slow queries.
   */
  recordQuery(metrics: QueryMetrics): void {
    if (this.destroyed) return;

    this.queryLog.push(metrics);
    while (this.queryLog.length > this.maxLogSize) {
      this.queryLog.shift();
    }

    if (metrics.executionTimeMs >= this.slowThreshold) {
      const entry: SlowQueryEntry = {
        id: generateId(),
        queryMetrics: metrics,
        threshold: this.slowThreshold,
        suggestion: suggestForQuery(metrics),
      };
      this.slowQueries.push(entry);
      while (this.slowQueries.length > this.maxLogSize) {
        this.slowQueries.shift();
      }
    }
  }

  /**
   * Get recent slow queries.
   */
  getSlowQueries(limit = 50): SlowQueryEntry[] {
    return this.slowQueries.slice(-limit);
  }

  /**
   * Get aggregate query statistics, optionally filtered by collection.
   */
  getQueryStats(collection?: string): {
    totalQueries: number;
    avgTimeMs: number;
    p50: number;
    p95: number;
    p99: number;
    slowQueries: number;
  } {
    const filtered = collection
      ? this.queryLog.filter((q) => q.collection === collection)
      : this.queryLog;

    if (filtered.length === 0) {
      return { totalQueries: 0, avgTimeMs: 0, p50: 0, p95: 0, p99: 0, slowQueries: 0 };
    }

    const times = filtered.map((q) => q.executionTimeMs).sort((a, b) => a - b);
    const total = times.reduce((a, b) => a + b, 0);
    const slow = filtered.filter((q) => q.executionTimeMs >= this.slowThreshold).length;

    return {
      totalQueries: filtered.length,
      avgTimeMs: total / filtered.length,
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      p99: percentile(times, 99),
      slowQueries: slow,
    };
  }

  /**
   * Simulate a query explain plan.
   */
  explain(querySpec: unknown, collection: string): QueryPlanDetails {
    const spec = querySpec as Record<string, unknown> | null;
    const hasFilters = spec !== null && typeof spec === 'object' && Object.keys(spec).length > 0;

    // Simulate index detection: if the query has filter keys, assume index-scan
    const filterKeys = hasFilters ? Object.keys(spec) : [];
    const indexName = filterKeys.length > 0 ? `idx_${collection}_${filterKeys.join('_')}` : undefined;
    const planType: QueryPlanDetails['type'] = indexName ? 'index-scan' : 'full-scan';

    const estimatedRows = indexName ? 50 : 1000;
    const estimatedCost = indexName ? 10 : 100;

    const steps: QueryPlanStep[] = [];

    if (planType === 'full-scan') {
      steps.push({
        operation: 'COLLECTION_SCAN',
        collection,
        estimatedRows: 1000,
        actualRows: 1000,
        timeMs: 50,
      });
    } else {
      steps.push({
        operation: 'INDEX_SCAN',
        collection,
        indexUsed: indexName,
        estimatedRows,
        actualRows: estimatedRows,
        timeMs: 5,
      });
    }

    steps.push({
      operation: 'FETCH',
      collection,
      estimatedRows,
      actualRows: estimatedRows,
      timeMs: planType === 'full-scan' ? 30 : 3,
    });

    return {
      type: planType,
      indexName,
      estimatedCost,
      actualCost: estimatedCost * 1.1,
      steps,
    };
  }

  /**
   * Get the most frequently executed queries.
   */
  getTopQueries(limit = 10): Array<{ querySpec: unknown; count: number; avgTimeMs: number }> {
    const groups = new Map<string, { querySpec: unknown; count: number; totalMs: number }>();

    for (const q of this.queryLog) {
      const key = JSON.stringify(q.querySpec);
      const existing = groups.get(key);
      if (existing) {
        existing.count++;
        existing.totalMs += q.executionTimeMs;
      } else {
        groups.set(key, { querySpec: q.querySpec, count: 1, totalMs: q.executionTimeMs });
      }
    }

    return Array.from(groups.values())
      .map((g) => ({ querySpec: g.querySpec, count: g.count, avgTimeMs: g.totalMs / g.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get index usage statistics.
   */
  getIndexUsageStats(): Record<string, { hits: number; scans: number }> {
    const stats: Record<string, { hits: number; scans: number }> = {};

    for (const q of this.queryLog) {
      if (q.indexUsed) {
        if (!stats[q.indexUsed]) stats[q.indexUsed] = { hits: 0, scans: 0 };
        stats[q.indexUsed].hits++;
      }
      // Track collection-level full scans
      const scanKey = `${q.collection}:full_scan`;
      if (!q.indexUsed) {
        if (!stats[scanKey]) stats[scanKey] = { hits: 0, scans: 0 };
        stats[scanKey].scans++;
      }
    }

    return stats;
  }

  /**
   * Suggest indexes for a collection based on query patterns.
   */
  suggestIndexes(collection: string): string[] {
    const collectionQueries = this.queryLog.filter((q) => q.collection === collection);
    const fieldCounts = new Map<string, number>();

    for (const q of collectionQueries) {
      const spec = q.querySpec as Record<string, unknown> | null;
      if (spec && typeof spec === 'object') {
        for (const key of Object.keys(spec)) {
          fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
        }
      }
    }

    // Suggest indexes for fields queried more than once without an existing index
    const noIndexQueries = collectionQueries.filter((q) => q.indexUsed === null);
    const fieldsNeedingIndex = new Set<string>();

    for (const q of noIndexQueries) {
      const spec = q.querySpec as Record<string, unknown> | null;
      if (spec && typeof spec === 'object') {
        for (const key of Object.keys(spec)) {
          if ((fieldCounts.get(key) ?? 0) >= 2) {
            fieldsNeedingIndex.add(key);
          }
        }
      }
    }

    return Array.from(fieldsNeedingIndex).map(
      (field) => `CREATE INDEX idx_${collection}_${field} ON ${collection}(${field})`,
    );
  }

  /**
   * Clear all recorded query logs.
   */
  clearLogs(): void {
    this.queryLog.length = 0;
    this.slowQueries.length = 0;
  }

  /**
   * Destroy the analyzer.
   */
  destroy(): void {
    this.destroyed = true;
    this.clearLogs();
  }
}

/**
 * Create a QueryPerformanceAnalyzer instance.
 */
export function createQueryPerformanceAnalyzer(
  config?: QueryAnalyzerConfig,
): QueryPerformanceAnalyzer {
  return new QueryPerformanceAnalyzer(config);
}
