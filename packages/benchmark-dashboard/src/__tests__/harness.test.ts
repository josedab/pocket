import { describe, expect, it } from 'vitest';
import {
  createInMemoryEngine,
  decodeReport,
  encodeReport,
  formatReportTable,
  runBenchmarkSuite,
} from '../index.js';

describe('BenchmarkHarness', () => {
  it('should run benchmarks with in-memory engine', async () => {
    const engine = createInMemoryEngine('test-engine');
    const report = await runBenchmarkSuite({
      engines: [engine],
      documentCount: 50,
      iterations: 5,
    });

    expect(report.results.length).toBeGreaterThan(0);
    expect(report.id).toMatch(/^bench-/);
    expect(report.totalDurationMs).toBeGreaterThan(0);
    expect(report.config.documentCount).toBe(50);
  });

  it('should measure all operations', async () => {
    const engine = createInMemoryEngine();
    const report = await runBenchmarkSuite({
      engines: [engine],
      documentCount: 20,
      iterations: 3,
      warmupIterations: 1,
    });

    const ops = report.results.map((r) => r.operation);
    expect(ops).toContain('insert-single');
    expect(ops).toContain('insert-batch-100');
    expect(ops).toContain('find-all');
    expect(ops).toContain('find-filtered');
    expect(ops).toContain('update-single');
    expect(ops).toContain('delete-single');
  });

  it('should determine winners per operation', async () => {
    const fast = createInMemoryEngine('fast');
    const report = await runBenchmarkSuite({
      engines: [fast],
      documentCount: 10,
      iterations: 2,
    });

    expect(Object.keys(report.winner).length).toBeGreaterThan(0);
    // With only one engine, it should always win
    for (const winner of Object.values(report.winner)) {
      expect(winner).toBe('fast');
    }
  });

  it('should compare two engines', async () => {
    const engine1 = createInMemoryEngine('engine-a');
    const engine2 = createInMemoryEngine('engine-b');

    const report = await runBenchmarkSuite({
      engines: [engine1, engine2],
      documentCount: 10,
      iterations: 3,
    });

    const engines = new Set(report.results.map((r) => r.engine));
    expect(engines.size).toBe(2);
    expect(engines.has('engine-a')).toBe(true);
    expect(engines.has('engine-b')).toBe(true);
  });

  it('should calculate p95 latency', async () => {
    const engine = createInMemoryEngine();
    const report = await runBenchmarkSuite({
      engines: [engine],
      documentCount: 10,
      iterations: 10,
    });

    for (const r of report.results) {
      expect(r.p95Ms).toBeGreaterThanOrEqual(r.minMs);
      expect(r.p95Ms).toBeLessThanOrEqual(r.maxMs);
      expect(r.opsPerSecond).toBeGreaterThan(0);
    }
  });

  it('should support custom document factory', async () => {
    const engine = createInMemoryEngine();
    const report = await runBenchmarkSuite({
      engines: [engine],
      documentCount: 5,
      iterations: 2,
      documentFactory: (i) => ({ _id: `custom-${i}`, name: `Custom ${i}` }),
    });

    expect(report.results.length).toBeGreaterThan(0);
  });
});

describe('Report formatting', () => {
  it('should format report as table', async () => {
    const engine = createInMemoryEngine('pocket');
    const report = await runBenchmarkSuite({
      engines: [engine],
      documentCount: 5,
      iterations: 2,
    });

    const table = formatReportTable(report);
    expect(table).toContain('pocket');
    expect(table).toContain('insert-single');
    expect(table).toContain('Winner');
  });
});

describe('Report encoding', () => {
  it('should encode and decode a report', async () => {
    const engine = createInMemoryEngine('pocket-wasm');
    const report = await runBenchmarkSuite({
      engines: [engine],
      documentCount: 5,
      iterations: 2,
    });

    const encoded = encodeReport(report);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = decodeReport(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(report.id);
    expect(decoded!.results.length).toBe(report.results.length);
    expect(decoded!.winner).toEqual(report.winner);
  });

  it('should return null for invalid encoded data', () => {
    expect(decodeReport('not-valid-base64!!!')).toBeNull();
  });
});
