/**
 * CI Runner — automated benchmark execution for CI pipelines.
 *
 * Reads previous results, runs benchmarks, compares with baselines,
 * and outputs JSON artifacts and markdown summaries.
 */

import { formatReportTable } from './harness.js';
import type { BenchmarkReport, OperationResult } from './types.js';

/** Comparison between current and baseline results. */
export interface BenchmarkComparison {
  readonly operation: string;
  readonly engine: string;
  readonly currentAvgMs: number;
  readonly baselineAvgMs: number;
  readonly changePercent: number;
  readonly regression: boolean;
}

/** CI run result with comparison data. */
export interface CIRunResult {
  readonly report: BenchmarkReport;
  readonly comparisons: readonly BenchmarkComparison[];
  readonly hasRegressions: boolean;
  readonly markdownSummary: string;
}

/** Threshold for regression detection (percent slower). */
const REGRESSION_THRESHOLD_PERCENT = 15;

/**
 * Compare a new report against a baseline report.
 */
export function compareReports(
  current: BenchmarkReport,
  baseline: BenchmarkReport | null,
  regressionThreshold = REGRESSION_THRESHOLD_PERCENT
): readonly BenchmarkComparison[] {
  if (!baseline) return [];

  const comparisons: BenchmarkComparison[] = [];

  for (const result of current.results) {
    const baselineResult = baseline.results.find(
      (r) => r.operation === result.operation && r.engine === result.engine
    );
    if (!baselineResult) continue;

    const changePercent =
      baselineResult.avgMs > 0
        ? ((result.avgMs - baselineResult.avgMs) / baselineResult.avgMs) * 100
        : 0;

    comparisons.push({
      operation: result.operation,
      engine: result.engine,
      currentAvgMs: result.avgMs,
      baselineAvgMs: baselineResult.avgMs,
      changePercent: Math.round(changePercent * 100) / 100,
      regression: changePercent > regressionThreshold,
    });
  }

  return comparisons;
}

/**
 * Generate a Markdown summary of benchmark results for CI comments.
 */
export function generateMarkdownSummary(
  report: BenchmarkReport,
  comparisons: readonly BenchmarkComparison[]
): string {
  const lines: string[] = [
    '## ⚡ Benchmark Results',
    '',
    `**Config:** ${report.config.documentCount} documents, ${report.config.iterations} iterations`,
    `**Duration:** ${(report.totalDurationMs / 1000).toFixed(1)}s`,
    '',
  ];

  // Results table
  lines.push('### Results');
  lines.push('');
  lines.push(formatReportTable(report));
  lines.push('');

  // Comparison section
  if (comparisons.length > 0) {
    lines.push('### Comparison vs Baseline');
    lines.push('');
    lines.push('| Operation | Engine | Current | Baseline | Change |');
    lines.push('|-----------|--------|---------|----------|--------|');

    for (const c of comparisons) {
      const indicator = c.regression ? '🔴' : c.changePercent < -5 ? '🟢' : '⚪';
      const sign = c.changePercent > 0 ? '+' : '';
      lines.push(
        `| ${c.operation} | ${c.engine} | ${c.currentAvgMs.toFixed(2)}ms | ${c.baselineAvgMs.toFixed(2)}ms | ${indicator} ${sign}${c.changePercent.toFixed(1)}% |`
      );
    }

    const regressions = comparisons.filter((c) => c.regression);
    lines.push('');
    if (regressions.length > 0) {
      lines.push(
        `⚠️ **${regressions.length} regression(s) detected** (>${REGRESSION_THRESHOLD_PERCENT}% slower)`
      );
    } else {
      lines.push('✅ No regressions detected');
    }
  }

  // Winners
  lines.push('');
  lines.push('### Winners by Operation');
  lines.push('');
  for (const [op, winner] of Object.entries(report.winner)) {
    lines.push(`- **${op}**: ${winner}`);
  }

  return lines.join('\n');
}

/**
 * Process a benchmark report for CI: compare against baseline, generate summary.
 */
export function processCIResult(
  report: BenchmarkReport,
  baseline: BenchmarkReport | null
): CIRunResult {
  const comparisons = compareReports(report, baseline);
  const hasRegressions = comparisons.some((c) => c.regression);
  const markdownSummary = generateMarkdownSummary(report, comparisons);

  return { report, comparisons, hasRegressions, markdownSummary };
}

/**
 * Format results as a JSON artifact for storage.
 */
export function formatResultsJson(report: BenchmarkReport, meta?: Record<string, unknown>): string {
  return JSON.stringify(
    {
      version: 1,
      report,
      meta: {
        generatedAt: new Date().toISOString(),
        ...meta,
      },
    },
    null,
    2
  );
}

/**
 * Parse a stored results JSON artifact.
 */
export function parseResultsJson(
  json: string
): { report: BenchmarkReport; meta: Record<string, unknown> } | null {
  try {
    const data = JSON.parse(json) as {
      report: BenchmarkReport;
      meta: Record<string, unknown>;
    };
    if (!data.report?.id) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Aggregate multiple benchmark results to compute averages.
 * Useful for reducing noise across multiple CI runs.
 */
export function aggregateResults(reports: readonly BenchmarkReport[]): OperationResult[] {
  if (reports.length === 0) return [];

  const groups = new Map<string, OperationResult[]>();

  for (const report of reports) {
    for (const result of report.results) {
      const key = `${result.operation}:${result.engine}`;
      const existing = groups.get(key);
      if (existing) {
        existing.push(result);
      } else {
        groups.set(key, [result]);
      }
    }
  }

  return Array.from(groups.entries()).map(([, results]) => {
    const avgMs = results.reduce((sum, r) => sum + r.avgMs, 0) / results.length;
    const minMs = Math.min(...results.map((r) => r.minMs));
    const maxMs = Math.max(...results.map((r) => r.maxMs));
    const p95Ms = results.reduce((sum, r) => sum + r.p95Ms, 0) / results.length;
    const opsPerSecond = results.reduce((sum, r) => sum + r.opsPerSecond, 0) / results.length;

    return {
      operation: results[0]!.operation,
      engine: results[0]!.engine,
      avgMs: Math.round(avgMs * 100) / 100,
      minMs: Math.round(minMs * 100) / 100,
      maxMs: Math.round(maxMs * 100) / 100,
      p95Ms: Math.round(p95Ms * 100) / 100,
      opsPerSecond: Math.round(opsPerSecond),
      iterations: results.reduce((sum, r) => sum + r.iterations, 0),
    };
  });
}
