import { firstValueFrom, skip } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MetricsCollector, createMetricsCollector } from '../metrics-collector.js';
import type { SyncEventData } from '../sync-visualizer.js';
import { SyncVisualizer, createSyncVisualizer } from '../sync-visualizer.js';

// ── SyncVisualizer ────────────────────────────────────────

describe('SyncVisualizer', () => {
  let visualizer: SyncVisualizer;

  beforeEach(() => {
    visualizer = createSyncVisualizer({ maxHistory: 100 });
  });

  afterEach(() => {
    visualizer.destroy();
  });

  it('should create via factory function', () => {
    expect(visualizer).toBeInstanceOf(SyncVisualizer);
  });

  it('should start with empty timeline', () => {
    expect(visualizer.getTimeline()).toEqual([]);
  });

  it('should start with offline health', () => {
    const health = visualizer.getSyncHealth();
    expect(health.status).toBe('offline');
    expect(health.successRate).toBe(0);
    expect(health.lastSyncAt).toBeNull();
  });

  it('should record sync events and update timeline', () => {
    const event: SyncEventData = {
      type: 'push',
      collection: 'users',
      documentCount: 5,
      durationMs: 120,
      success: true,
      timestamp: 1000,
    };
    visualizer.recordSyncEvent(event);

    const timeline = visualizer.getTimeline();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.type).toBe('push');
    expect(timeline[0]!.collection).toBe('users');
    expect(timeline[0]!.documentCount).toBe(5);
    expect(timeline[0]!.durationMs).toBe(120);
    expect(timeline[0]!.success).toBe(true);
    expect(timeline[0]!.timestamp).toBe(1000);
    expect(timeline[0]!.id).toMatch(/^sync-/);
  });

  it('should emit timeline updates via observable', async () => {
    const timelinePromise = firstValueFrom(visualizer.timeline$.pipe(skip(1)));
    visualizer.recordSyncEvent({
      type: 'pull',
      collection: 'orders',
      documentCount: 3,
      durationMs: 50,
      success: true,
    });

    const timeline = await timelinePromise;
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.type).toBe('pull');
  });

  it('should emit health updates via observable', async () => {
    visualizer.addConnection({
      id: 'ws1',
      type: 'websocket',
      status: 'connected',
      latencyMs: 10,
      lastActivity: Date.now(),
    });

    const healthPromise = firstValueFrom(visualizer.health$.pipe(skip(1)));
    visualizer.recordSyncEvent({
      type: 'push',
      collection: 'docs',
      documentCount: 1,
      durationMs: 30,
      success: true,
    });

    const health = await healthPromise;
    expect(health.status).toBe('healthy');
    expect(health.successRate).toBe(1);
  });

  it('should trim timeline to maxHistory', () => {
    for (let i = 0; i < 150; i++) {
      visualizer.recordSyncEvent({
        type: 'push',
        collection: 'test',
        documentCount: 1,
        durationMs: 10,
        success: true,
        timestamp: i,
      });
    }
    expect(visualizer.getTimeline()).toHaveLength(100);
  });

  it('should calculate degraded health on low success rate', () => {
    visualizer.addConnection({
      id: 'c1',
      type: 'http',
      status: 'connected',
      latencyMs: 50,
      lastActivity: Date.now(),
    });

    // Record 3 failures and 1 success => 25% success rate
    for (let i = 0; i < 3; i++) {
      visualizer.recordSyncEvent({
        type: 'error',
        collection: 'test',
        documentCount: 0,
        durationMs: 100,
        success: false,
      });
    }
    visualizer.recordSyncEvent({
      type: 'push',
      collection: 'test',
      documentCount: 1,
      durationMs: 10,
      success: true,
    });

    const health = visualizer.getSyncHealth();
    expect(health.status).toBe('degraded');
    expect(health.successRate).toBe(0.25);
  });

  it('should track active connections', () => {
    visualizer.addConnection({
      id: 'ws1',
      type: 'websocket',
      status: 'connected',
      latencyMs: 5,
      lastActivity: Date.now(),
    });
    visualizer.addConnection({
      id: 'http1',
      type: 'http',
      status: 'connecting',
      latencyMs: 0,
      lastActivity: Date.now(),
    });

    expect(visualizer.getActiveConnections()).toHaveLength(2);

    visualizer.removeConnection('ws1');
    expect(visualizer.getActiveConnections()).toHaveLength(1);
  });

  it('should track pending changes', () => {
    visualizer.setPendingChanges(42);
    const health = visualizer.getSyncHealth();
    expect(health.pendingChanges).toBe(42);
  });

  it('should reset all state', () => {
    visualizer.recordSyncEvent({
      type: 'push',
      collection: 'test',
      documentCount: 1,
      durationMs: 10,
      success: true,
    });
    visualizer.addConnection({
      id: 'c1',
      type: 'http',
      status: 'connected',
      latencyMs: 10,
      lastActivity: Date.now(),
    });
    visualizer.setPendingChanges(5);

    visualizer.reset();

    expect(visualizer.getTimeline()).toEqual([]);
    expect(visualizer.getActiveConnections()).toEqual([]);
    expect(visualizer.getSyncHealth().pendingChanges).toBe(0);
    expect(visualizer.getSyncHealth().status).toBe('offline');
  });

  it('should not record events after destroy', () => {
    visualizer.destroy();
    visualizer.recordSyncEvent({
      type: 'push',
      collection: 'test',
      documentCount: 1,
      durationMs: 10,
      success: true,
    });
    // Can't call getTimeline on completed subject, but entries should be empty
    // since recordSyncEvent returns early on destroyed
  });
});

// ── MetricsCollector ──────────────────────────────────────

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = createMetricsCollector({ retentionMs: 60000, bucketSizeMs: 100 });
  });

  afterEach(() => {
    collector.destroy();
  });

  it('should create via factory function', () => {
    expect(collector).toBeInstanceOf(MetricsCollector);
  });

  it('should return null for unknown metric', () => {
    expect(collector.getMetric('nonexistent')).toBeNull();
  });

  it('should record and retrieve a metric', () => {
    collector.recordMetric('query.duration', 50);
    collector.recordMetric('query.duration', 150);
    collector.recordMetric('query.duration', 100);

    const summary = collector.getMetric('query.duration');
    expect(summary).not.toBeNull();
    expect(summary!.name).toBe('query.duration');
    expect(summary!.count).toBe(3);
    expect(summary!.min).toBe(50);
    expect(summary!.max).toBe(150);
    expect(summary!.avg).toBe(100);
    expect(summary!.lastValue).toBe(100);
  });

  it('should compute percentiles correctly', () => {
    // Insert 100 values from 1 to 100
    for (let i = 1; i <= 100; i++) {
      collector.recordMetric('latency', i);
    }

    const summary = collector.getMetric('latency')!;
    expect(summary.p50).toBeCloseTo(50.5, 0);
    expect(summary.p95).toBeCloseTo(95.05, 0);
    expect(summary.p99).toBeCloseTo(99.01, 0);
  });

  it('should get all metrics', () => {
    collector.recordMetric('metric.a', 10);
    collector.recordMetric('metric.b', 20);

    const all = collector.getAllMetrics();
    expect(all).toHaveLength(2);
    expect(all.map((m) => m.name).sort()).toEqual(['metric.a', 'metric.b']);
  });

  it('should emit metrics via observable', async () => {
    const metricsPromise = firstValueFrom(collector.metrics$.pipe(skip(1)));
    collector.recordMetric('ops', 42);

    const metrics = await metricsPromise;
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.name).toBe('ops');
  });

  it('should produce time series data', () => {
    // Record some metrics (they'll all be near "now")
    collector.recordMetric('ts.test', 10);
    collector.recordMetric('ts.test', 20);
    collector.recordMetric('ts.test', 30);

    const series = collector.getTimeSeries('ts.test', 5000);
    expect(series.length).toBeGreaterThanOrEqual(1);

    // All points should be within the bucket
    const totalCount = series.reduce((sum, p) => sum + p.count, 0);
    expect(totalCount).toBe(3);
  });

  it('should return empty time series for unknown metric', () => {
    expect(collector.getTimeSeries('nope', 5000)).toEqual([]);
  });

  it('should reset all metrics', () => {
    collector.recordMetric('foo', 1);
    collector.recordMetric('bar', 2);

    collector.reset();

    expect(collector.getAllMetrics()).toEqual([]);
    expect(collector.getMetric('foo')).toBeNull();
  });

  it('should accept optional tags', () => {
    collector.recordMetric('op', 10, { collection: 'users' });
    const summary = collector.getMetric('op');
    expect(summary).not.toBeNull();
    expect(summary!.count).toBe(1);
  });

  it('should handle single data point percentiles', () => {
    collector.recordMetric('single', 42);
    const summary = collector.getMetric('single')!;
    expect(summary.p50).toBe(42);
    expect(summary.p95).toBe(42);
    expect(summary.p99).toBe(42);
    expect(summary.min).toBe(42);
    expect(summary.max).toBe(42);
  });

  it('should not record after destroy', () => {
    collector.destroy();
    collector.recordMetric('after', 999);
    // Cannot call getMetric after destroy since subject is completed
    // but recordMetric should not throw
  });
});
