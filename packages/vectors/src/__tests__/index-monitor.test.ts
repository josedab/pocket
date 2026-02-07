import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { IndexMonitor, createIndexMonitor } from '../index-monitor.js';
import { createVectorStore, VectorStore } from '../vector-store.js';
import type { VectorSearchResult } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DIMS = 4;

async function seedStore(store: VectorStore) {
  await store.upsert('a', [1, 0, 0, 0], { label: 'alpha' });
  await store.upsert('b', [0, 1, 0, 0], { label: 'beta' });
  await store.upsert('c', [0, 0, 1, 0], { label: 'gamma' });
}

/* ================================================================== */
/*  IndexMonitor                                                        */
/* ================================================================== */

describe('IndexMonitor', () => {
  let store: VectorStore;
  let monitor: IndexMonitor;

  beforeEach(async () => {
    store = createVectorStore({ name: 'test-monitor', dimensions: DIMS });
    await seedStore(store);
    monitor = createIndexMonitor(store, {
      latencyThresholdMs: 50,
      memoryThresholdBytes: 100_000_000,
      recallThreshold: 0.8,
    });
  });

  afterEach(() => {
    monitor.destroy();
    store.dispose();
  });

  describe('createIndexMonitor', () => {
    it('should create instance via factory', () => {
      expect(monitor).toBeInstanceOf(IndexMonitor);
    });
  });

  describe('recordLatency', () => {
    it('should track search latencies', () => {
      monitor.recordLatency(10);
      monitor.recordLatency(20);
      monitor.recordLatency(30);

      const metrics = monitor.getLatencyMetrics();
      expect(metrics.sampleCount).toBe(3);
    });
  });

  describe('getLatencyMetrics', () => {
    it('should return zeros when no samples', () => {
      const metrics = monitor.getLatencyMetrics();
      expect(metrics.sampleCount).toBe(0);
      expect(metrics.min).toBe(0);
      expect(metrics.max).toBe(0);
      expect(metrics.mean).toBe(0);
      expect(metrics.p50).toBe(0);
      expect(metrics.p95).toBe(0);
      expect(metrics.p99).toBe(0);
    });

    it('should compute p50/p95/p99', () => {
      // Add 100 latency samples: 1, 2, 3, ..., 100
      for (let i = 1; i <= 100; i++) {
        monitor.recordLatency(i);
      }

      const metrics = monitor.getLatencyMetrics();
      expect(metrics.sampleCount).toBe(100);
      expect(metrics.min).toBe(1);
      expect(metrics.max).toBe(100);
      expect(metrics.mean).toBeCloseTo(50.5, 1);
      expect(metrics.p50).toBeCloseTo(50.5, 0);
      expect(metrics.p95).toBeCloseTo(95, 0);
      expect(metrics.p99).toBeCloseTo(99, 0);
    });

    it('should handle single sample', () => {
      monitor.recordLatency(42);
      const metrics = monitor.getLatencyMetrics();
      expect(metrics.sampleCount).toBe(1);
      expect(metrics.min).toBe(42);
      expect(metrics.max).toBe(42);
      expect(metrics.p50).toBe(42);
    });
  });

  describe('getMemoryMetrics', () => {
    it('should return memory usage info', () => {
      const metrics = monitor.getMemoryMetrics();
      expect(metrics.vectorCount).toBe(3);
      expect(metrics.currentBytes).toBeGreaterThanOrEqual(0);
      expect(metrics.peakBytes).toBeGreaterThanOrEqual(0);
      expect(metrics.bytesPerVector).toBeGreaterThanOrEqual(0);
    });
  });

  describe('recordRecall', () => {
    it('should track recall accuracy', () => {
      const predicted: VectorSearchResult[] = [
        { id: 'a', score: 0.9, distance: 0.1 },
        { id: 'b', score: 0.8, distance: 0.2 },
      ];
      monitor.recordRecall(predicted, ['a', 'b', 'c']);

      const metrics = monitor.getRecallMetrics();
      expect(metrics).toBeDefined();
      expect(metrics!.queryCount).toBe(1);
      // found 2 of 3 ground truth → recall ≈ 0.667
      expect(metrics!.averageRecall).toBeCloseTo(2 / 3, 2);
      expect(metrics!.averageRelevantFound).toBeCloseTo(2, 0);
    });

    it('should ignore empty ground truth', () => {
      monitor.recordRecall([], []);
      expect(monitor.getRecallMetrics()).toBeUndefined();
    });
  });

  describe('getRecallMetrics', () => {
    it('should return undefined when no recall recorded', () => {
      expect(monitor.getRecallMetrics()).toBeUndefined();
    });

    it('should return precision metrics after recording', () => {
      const predicted: VectorSearchResult[] = [
        { id: 'a', score: 0.9, distance: 0.1 },
      ];
      monitor.recordRecall(predicted, ['a']);

      const metrics = monitor.getRecallMetrics();
      expect(metrics).toBeDefined();
      expect(metrics!.averageRecall).toBe(1);
      expect(metrics!.queryCount).toBe(1);
      expect(metrics!.averageRelevantFound).toBe(1);
    });
  });

  describe('getReport', () => {
    it('should return full report', () => {
      monitor.recordLatency(10);
      monitor.recordLatency(20);

      const report = monitor.getReport();
      expect(report.storeName).toBe('test-monitor');
      expect(report.latency.sampleCount).toBe(2);
      expect(report.memory.vectorCount).toBe(3);
      expect(report.generatedAt).toBeGreaterThan(0);
    });

    it('should include recall when ground truth recorded', () => {
      const predicted: VectorSearchResult[] = [
        { id: 'a', score: 0.9, distance: 0.1 },
      ];
      monitor.recordRecall(predicted, ['a', 'b']);

      const report = monitor.getReport();
      expect(report.recall).toBeDefined();
      expect(report.recall!.averageRecall).toBeCloseTo(0.5, 2);
    });

    it('should omit recall when no ground truth recorded', () => {
      const report = monitor.getReport();
      expect(report.recall).toBeUndefined();
    });
  });

  describe('alerts$', () => {
    it('should emit on latency threshold breach', async () => {
      const alertPromise = firstValueFrom(monitor.alerts().pipe(take(1)));

      // Record latency above threshold (50ms)
      monitor.recordLatency(60);

      const alert = await alertPromise;
      expect(alert.metric).toBe('latency');
      expect(alert.severity).toBe('warning');
      expect(alert.currentValue).toBe(60);
      expect(alert.threshold).toBe(50);
    });

    it('should emit critical for very high latency', async () => {
      const alertPromise = firstValueFrom(monitor.alerts().pipe(take(1)));

      // Record latency > 2x threshold
      monitor.recordLatency(110);

      const alert = await alertPromise;
      expect(alert.metric).toBe('latency');
      expect(alert.severity).toBe('critical');
    });

    it('should emit on recall threshold breach', async () => {
      const alertPromise = firstValueFrom(monitor.alerts().pipe(take(1)));

      const predicted: VectorSearchResult[] = [
        { id: 'a', score: 0.9, distance: 0.1 },
      ];
      // Only 1 of 5 found → recall = 0.2, below threshold of 0.8
      monitor.recordRecall(predicted, ['a', 'b', 'c', 'd', 'e']);

      const alert = await alertPromise;
      expect(alert.metric).toBe('recall');
      expect(alert.currentValue).toBeCloseTo(0.2, 1);
    });

    it('should not emit when under threshold', () => {
      let emitted = false;
      const sub = monitor.alerts().subscribe(() => {
        emitted = true;
      });

      monitor.recordLatency(10); // Below 50ms threshold
      expect(emitted).toBe(false);
      sub.unsubscribe();
    });
  });

  describe('reset', () => {
    it('should clear all metrics', () => {
      monitor.recordLatency(10);
      monitor.recordLatency(20);
      const predicted: VectorSearchResult[] = [
        { id: 'a', score: 0.9, distance: 0.1 },
      ];
      monitor.recordRecall(predicted, ['a']);

      monitor.reset();

      const latency = monitor.getLatencyMetrics();
      expect(latency.sampleCount).toBe(0);
      expect(monitor.getRecallMetrics()).toBeUndefined();
    });
  });

  describe('destroy', () => {
    it('should complete observables', () => {
      let alertsCompleted = false;
      monitor.alerts().subscribe({
        complete: () => {
          alertsCompleted = true;
        },
      });

      monitor.destroy();
      expect(alertsCompleted).toBe(true);
    });
  });
});
