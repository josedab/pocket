import { describe, expect, it } from 'vitest';
import { StabilitySuite } from '../stability-suite.js';

describe('StabilitySuite', () => {
  const suite = new StabilitySuite();

  describe('Chaos Testing', () => {
    it('should run chaos test with deterministic seed', () => {
      const r1 = suite.runChaosTest({ operations: 50, failureRate: 0.3, seed: 42 });
      const r2 = suite.runChaosTest({ operations: 50, failureRate: 0.3, seed: 42 });
      expect(r1.successfulOperations).toBe(r2.successfulOperations);
      expect(r1.failedOperations).toBe(r2.failedOperations);
    });

    it('should track operation breakdown', () => {
      const result = suite.runChaosTest({ operations: 200, seed: 123 });
      expect(result.totalOperations).toBe(200);
      expect(result.successfulOperations + result.failedOperations).toBe(200);
      const breakdown = result.operationBreakdown;
      const total = Object.values(breakdown).reduce((s, b) => s + b.success + b.failed, 0);
      expect(total).toBe(200);
    });

    it('should report no data loss for simulated operations', () => {
      const result = suite.runChaosTest({ operations: 100, failureRate: 0.5, seed: 99 });
      expect(result.dataLoss).toBe(false);
    });

    it('should track recovered operations', () => {
      const result = suite.runChaosTest({ operations: 100, failureRate: 0.5, seed: 7 });
      expect(result.recoveredOperations).toBeLessThanOrEqual(result.failedOperations);
    });
  });

  describe('Fuzz Testing', () => {
    it('should run fuzz tests with reproducible seed', () => {
      const r1 = suite.runFuzzTest({ iterations: 100, seed: 42 });
      const r2 = suite.runFuzzTest({ iterations: 100, seed: 42 });
      expect(r1.crashes.length).toBe(r2.crashes.length);
    });

    it('should generate random documents without crashing', () => {
      const result = suite.runFuzzTest({ iterations: 500, seed: 1234, targets: ['documents'] });
      expect(result.iterations).toBe(500);
      expect(result.crashes).toHaveLength(0);
    });

    it('should generate random queries without crashing', () => {
      const result = suite.runFuzzTest({ iterations: 200, seed: 5678, targets: ['queries'] });
      expect(result.crashes).toHaveLength(0);
    });

    it('should generate random filters including nested $and/$or', () => {
      const result = suite.runFuzzTest({ iterations: 200, seed: 9999, targets: ['filters'] });
      expect(result.crashes).toHaveLength(0);
    });

    it('should fuzz schemas without crashing', () => {
      const result = suite.runFuzzTest({ iterations: 100, seed: 111, targets: ['schemas'] });
      expect(result.crashes).toHaveLength(0);
    });

    it('should fuzz sync messages without crashing', () => {
      const result = suite.runFuzzTest({ iterations: 100, seed: 222, targets: ['sync-messages'] });
      expect(result.crashes).toHaveLength(0);
    });

    it('should estimate coverage', () => {
      const result = suite.runFuzzTest({ iterations: 1000, seed: 333 });
      expect(result.coverageEstimate).toBe(100);
    });
  });

  describe('Load Testing', () => {
    it('should measure throughput and latency', () => {
      const result = suite.runLoadTest({ totalOperations: 500 });
      expect(result.totalOperations).toBe(500);
      expect(result.successfulOperations).toBe(500);
      expect(result.opsPerSecond).toBeGreaterThan(0);
      expect(result.avgLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should compute percentile latencies', () => {
      const result = suite.runLoadTest({ totalOperations: 1000 });
      expect(result.p50LatencyMs).toBeLessThanOrEqual(result.p95LatencyMs);
      expect(result.p95LatencyMs).toBeLessThanOrEqual(result.p99LatencyMs);
      expect(result.p99LatencyMs).toBeLessThanOrEqual(result.maxLatencyMs);
    });

    it('should respect read/write ratio', () => {
      const result = suite.runLoadTest({ totalOperations: 100, readWriteRatio: 0.5 });
      expect(result.successfulOperations).toBe(100);
    });
  });

  describe('Memory Leak Detection', () => {
    it('should detect no leaks for well-behaved objects', () => {
      const result = suite.runMemoryLeakTest(
        () => ({
          data: new Map(),
          destroy() {
            this.data.clear();
          },
        }),
        { iterations: 50 }
      );
      expect(result.leaksDetected).toBe(0);
    });

    it('should report heap measurements', () => {
      const result = suite.runMemoryLeakTest(() => ({ destroy() {} }), {
        iterations: 10,
        warmupIterations: 5,
      });
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.growthRate).toBeGreaterThanOrEqual(0);
    });
  });
});
