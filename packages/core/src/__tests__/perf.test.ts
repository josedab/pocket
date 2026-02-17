import { describe, it, expect, beforeEach } from 'vitest';
import { OperationProfiler, createOperationProfiler } from '../observability/perf.js';

describe('OperationProfiler', () => {
  let profiler: OperationProfiler;

  beforeEach(() => {
    profiler = createOperationProfiler();
  });

  describe('timing', () => {
    it('should time an operation', () => {
      const end = profiler.start('test-op');
      const record = end();
      expect(record.operation).toBe('test-op');
      expect(record.durationMs).toBeGreaterThanOrEqual(0);
      expect(record.timestamp).toBeGreaterThan(0);
    });

    it('should include metadata', () => {
      const end = profiler.start('query');
      const record = end({ resultCount: 42 });
      expect(record.metadata?.resultCount).toBe(42);
    });

    it('should record manually', () => {
      profiler.record('manual-op', 15.5);
      const summary = profiler.getSummary('manual-op');
      expect(summary).not.toBeNull();
      expect(summary!.count).toBe(1);
      expect(summary!.avgMs).toBe(15.5);
    });
  });

  describe('wrap', () => {
    it('should wrap async functions', async () => {
      const result = await profiler.wrap('async-op', async () => {
        return 'hello';
      });
      expect(result).toBe('hello');
      expect(profiler.getSummary('async-op')?.count).toBe(1);
    });

    it('should propagate errors from wrapped functions', async () => {
      await expect(profiler.wrap('fail-op', async () => {
        throw new Error('boom');
      })).rejects.toThrow('boom');
      expect(profiler.getSummary('fail-op')?.count).toBe(1);
    });
  });

  describe('summaries', () => {
    it('should compute correct statistics', () => {
      profiler.record('op', 10);
      profiler.record('op', 20);
      profiler.record('op', 30);
      const s = profiler.getSummary('op')!;
      expect(s.count).toBe(3);
      expect(s.avgMs).toBe(20);
      expect(s.minMs).toBe(10);
      expect(s.maxMs).toBe(30);
    });

    it('should return null for unknown operation', () => {
      expect(profiler.getSummary('unknown')).toBeNull();
    });

    it('should list all summaries sorted by total time', () => {
      profiler.record('fast', 5);
      profiler.record('slow', 100);
      const all = profiler.getAllSummaries();
      expect(all).toHaveLength(2);
      expect(all[0]!.operation).toBe('slow');
    });
  });

  describe('histograms', () => {
    it('should compute histogram buckets', () => {
      profiler.record('op', 5);
      profiler.record('op', 50);
      profiler.record('op', 500);
      const hist = profiler.getHistogram('op', [10, 100, 1000]);
      expect(hist[0]!.count).toBe(1); // ≤10: one (5)
      expect(hist[1]!.count).toBe(2); // ≤100: two (5, 50)
      expect(hist[2]!.count).toBe(3); // ≤1000: three (5, 50, 500)
    });

    it('should return zeros for unknown operation', () => {
      const hist = profiler.getHistogram('unknown');
      expect(hist.every((b) => b.count === 0)).toBe(true);
    });
  });

  describe('management', () => {
    it('should reset specific operations', () => {
      profiler.record('a', 10);
      profiler.record('b', 20);
      profiler.reset('a');
      expect(profiler.getSummary('a')).toBeNull();
      expect(profiler.getSummary('b')).not.toBeNull();
    });

    it('should reset all operations', () => {
      profiler.record('a', 10);
      profiler.record('b', 20);
      profiler.reset();
      expect(profiler.getOperations()).toHaveLength(0);
    });

    it('should list tracked operations', () => {
      profiler.record('x', 1);
      profiler.record('y', 2);
      expect(profiler.getOperations()).toContain('x');
      expect(profiler.getOperations()).toContain('y');
    });

    it('should enforce max samples', () => {
      const small = createOperationProfiler({ maxSamples: 5 });
      for (let i = 0; i < 20; i++) small.record('op', i);
      expect(small.getSummary('op')!.count).toBe(5);
    });
  });
});
