import { describe, expect, it } from 'vitest';
import {
  PerfRegressionTracker,
  type BenchmarkResult,
} from '../../../../scripts/perf-regression-tracker.js';

describe('PerfRegressionTracker', () => {
  const baselineResults: BenchmarkResult[] = [
    {
      name: 'filter-1k',
      suite: 'query',
      opsPerSecond: 10000,
      avgMs: 0.1,
      p95Ms: 0.2,
      samples: 100,
      timestamp: Date.now(),
    },
    {
      name: 'sort-1k',
      suite: 'query',
      opsPerSecond: 5000,
      avgMs: 0.2,
      p95Ms: 0.4,
      samples: 100,
      timestamp: Date.now(),
    },
    {
      name: 'insert',
      suite: 'crud',
      opsPerSecond: 20000,
      avgMs: 0.05,
      p95Ms: 0.1,
      samples: 100,
      timestamp: Date.now(),
    },
  ];

  it('should set and retrieve baselines', () => {
    const tracker = new PerfRegressionTracker();
    tracker.setBaseline('v1.0', baselineResults);
    expect(tracker.getBaseline('v1.0')).toBeDefined();
    expect(tracker.getBaseline('v1.0')!.results).toHaveLength(3);
  });

  it('should detect regressions', () => {
    const tracker = new PerfRegressionTracker({ regressionThreshold: 10 });
    tracker.setBaseline('v1.0', baselineResults);

    const current: BenchmarkResult[] = [
      { ...baselineResults[0]!, opsPerSecond: 8000 }, // 20% slower
      { ...baselineResults[1]!, opsPerSecond: 5000 }, // same
      { ...baselineResults[2]!, opsPerSecond: 22000 }, // 10% faster
    ];

    const report = tracker.compare('v1.0', current);
    expect(report.regressions).toHaveLength(1);
    expect(report.regressions[0]!.name).toBe('filter-1k');
    expect(report.overallStatus).toBe('fail');
  });

  it('should detect improvements', () => {
    const tracker = new PerfRegressionTracker();
    tracker.setBaseline('v1.0', baselineResults);

    const current: BenchmarkResult[] = [
      { ...baselineResults[0]!, opsPerSecond: 15000 }, // 50% faster
      { ...baselineResults[1]!, opsPerSecond: 5000 },
      { ...baselineResults[2]!, opsPerSecond: 20000 },
    ];

    const report = tracker.compare('v1.0', current);
    expect(report.improvements).toHaveLength(1);
    expect(report.overallStatus).toBe('pass');
  });

  it('should format reports', () => {
    const tracker = new PerfRegressionTracker();
    tracker.setBaseline('v1.0', baselineResults);
    const report = tracker.compare('v1.0', baselineResults, 'v1.1');
    const output = tracker.formatReport(report);
    expect(output).toContain('Performance Regression Report');
    expect(output).toContain('v1.0');
    expect(output).toContain('v1.1');
  });

  it('should serialize and deserialize baselines', () => {
    const tracker = new PerfRegressionTracker();
    tracker.setBaseline('v1.0', baselineResults);

    const serialized = tracker.serialize();
    const tracker2 = new PerfRegressionTracker();
    tracker2.deserialize(serialized);

    expect(tracker2.getBaseline('v1.0')).toBeDefined();
    expect(tracker2.getBaseline('v1.0')!.results).toHaveLength(3);
  });

  it('should warn instead of fail when configured', () => {
    const tracker = new PerfRegressionTracker({ failOnRegression: false });
    tracker.setBaseline('v1.0', baselineResults);

    const current = [{ ...baselineResults[0]!, opsPerSecond: 1000 }];
    const report = tracker.compare('v1.0', current);
    expect(report.overallStatus).toBe('warn');
  });
});
