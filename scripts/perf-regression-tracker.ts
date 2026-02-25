/**
 * PerfRegressionTracker — Benchmark baseline management and regression detection.
 *
 * Stores benchmark baselines, compares against new results,
 * and reports regressions with configurable thresholds.
 */

export interface BenchmarkResult {
  name: string;
  suite: string;
  opsPerSecond: number;
  avgMs: number;
  p95Ms: number;
  samples: number;
  timestamp: number;
}

export interface Baseline {
  version: string;
  createdAt: number;
  results: BenchmarkResult[];
}

export interface RegressionReport {
  baselineVersion: string;
  currentVersion: string;
  comparisons: BenchmarkComparison[];
  regressions: BenchmarkComparison[];
  improvements: BenchmarkComparison[];
  unchanged: BenchmarkComparison[];
  overallStatus: 'pass' | 'warn' | 'fail';
  summary: string;
}

export interface BenchmarkComparison {
  name: string;
  suite: string;
  baselineOpsPerSec: number;
  currentOpsPerSec: number;
  changePercent: number;
  status: 'regression' | 'improvement' | 'unchanged';
  significant: boolean;
}

export interface TrackerConfig {
  /** Regression threshold percentage (default: 10 = 10% slower) */
  regressionThreshold?: number;
  /** Improvement threshold percentage (default: 10 = 10% faster) */
  improvementThreshold?: number;
  /** Fail on any regression (default: true) */
  failOnRegression?: boolean;
}

export class PerfRegressionTracker {
  private readonly config: Required<TrackerConfig>;
  private baselines = new Map<string, Baseline>();

  constructor(config: TrackerConfig = {}) {
    this.config = {
      regressionThreshold: config.regressionThreshold ?? 10,
      improvementThreshold: config.improvementThreshold ?? 10,
      failOnRegression: config.failOnRegression ?? true,
    };
  }

  setBaseline(version: string, results: BenchmarkResult[]): void {
    this.baselines.set(version, { version, createdAt: Date.now(), results });
  }

  getBaseline(version: string): Baseline | undefined {
    return this.baselines.get(version);
  }

  compare(
    baselineVersion: string,
    currentResults: BenchmarkResult[],
    currentVersion = 'current'
  ): RegressionReport {
    const baseline = this.baselines.get(baselineVersion);
    if (!baseline) throw new Error(`Baseline "${baselineVersion}" not found`);

    const comparisons: BenchmarkComparison[] = [];

    for (const current of currentResults) {
      const base = baseline.results.find(
        (b) => b.name === current.name && b.suite === current.suite
      );
      if (!base) continue;

      const change = ((current.opsPerSecond - base.opsPerSecond) / base.opsPerSecond) * 100;

      let status: 'regression' | 'improvement' | 'unchanged';
      if (change < -this.config.regressionThreshold) status = 'regression';
      else if (change > this.config.improvementThreshold) status = 'improvement';
      else status = 'unchanged';

      comparisons.push({
        name: current.name,
        suite: current.suite,
        baselineOpsPerSec: base.opsPerSecond,
        currentOpsPerSec: current.opsPerSecond,
        changePercent: Math.round(change * 100) / 100,
        status,
        significant: Math.abs(change) > this.config.regressionThreshold,
      });
    }

    const regressions = comparisons.filter((c) => c.status === 'regression');
    const improvements = comparisons.filter((c) => c.status === 'improvement');
    const unchanged = comparisons.filter((c) => c.status === 'unchanged');

    let overallStatus: 'pass' | 'warn' | 'fail' = 'pass';
    if (regressions.length > 0) {
      overallStatus = this.config.failOnRegression ? 'fail' : 'warn';
    }

    const summary = `${comparisons.length} benchmarks: ${regressions.length} regressions, ${improvements.length} improvements, ${unchanged.length} unchanged`;

    return {
      baselineVersion,
      currentVersion,
      comparisons,
      regressions,
      improvements,
      unchanged,
      overallStatus,
      summary,
    };
  }

  formatReport(report: RegressionReport): string {
    const lines: string[] = [];
    const icon = { pass: '✅', warn: '⚠️', fail: '❌' }[report.overallStatus];
    lines.push(`\n  ${icon} Performance Regression Report`);
    lines.push(`  Baseline: ${report.baselineVersion} → Current: ${report.currentVersion}`);
    lines.push('  ' + '─'.repeat(50));

    for (const c of report.comparisons) {
      const sign = c.changePercent >= 0 ? '+' : '';
      const status = { regression: '🔴', improvement: '🟢', unchanged: '⚪' }[c.status];
      lines.push(
        `  ${status} ${c.suite}/${c.name}: ${sign}${c.changePercent}% (${c.baselineOpsPerSec.toFixed(0)} → ${c.currentOpsPerSec.toFixed(0)} ops/s)`
      );
    }

    lines.push('  ' + '─'.repeat(50));
    lines.push(`  ${report.summary}\n`);
    return lines.join('\n');
  }

  serialize(): string {
    return JSON.stringify([...this.baselines.values()]);
  }

  deserialize(data: string): void {
    const baselines = JSON.parse(data) as Baseline[];
    for (const b of baselines) this.baselines.set(b.version, b);
  }
}

export function createPerfTracker(config?: TrackerConfig): PerfRegressionTracker {
  return new PerfRegressionTracker(config);
}
