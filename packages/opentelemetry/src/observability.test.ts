import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayDebugger, createReplayDebugger } from './replay-debugger.js';
import { MetricsDashboard, createMetricsDashboard } from './metrics-dashboard.js';

describe('ReplayDebugger', () => {
  let debugger_: ReplayDebugger;

  beforeEach(() => {
    debugger_ = createReplayDebugger({ maxEvents: 100, autoSnapshotInterval: 10 });
  });

  it('should record events', () => {
    debugger_.record({
      type: 'insert',
      collection: 'users',
      documentId: 'u1',
      timestamp: Date.now(),
      durationMs: 5,
    });
    expect(debugger_.eventCount).toBe(1);
  });

  it('should evict old events when at capacity', () => {
    for (let i = 0; i < 120; i++) {
      debugger_.record({
        type: 'insert',
        collection: 'users',
        timestamp: Date.now(),
        durationMs: 1,
      });
    }
    expect(debugger_.eventCount).toBeLessThanOrEqual(100);
  });

  it('should auto-snapshot at configured intervals', () => {
    for (let i = 0; i < 25; i++) {
      debugger_.record({
        type: 'query',
        collection: 'users',
        timestamp: Date.now(),
        durationMs: 1,
      });
    }
    // 10 and 20 should trigger snapshots
    expect(debugger_.snapshotCount).toBe(2);
  });

  it('should create named snapshots', () => {
    const snap = debugger_.createSnapshot('before-migration');
    expect(snap.label).toBe('before-migration');
    expect(debugger_.snapshotCount).toBe(1);
  });

  it('should filter events by collection', () => {
    debugger_.record({ type: 'insert', collection: 'users', timestamp: 1, durationMs: 1 });
    debugger_.record({ type: 'insert', collection: 'todos', timestamp: 2, durationMs: 1 });
    debugger_.record({ type: 'update', collection: 'users', timestamp: 3, durationMs: 1 });

    const userEvents = debugger_.getCollectionEvents('users');
    expect(userEvents.length).toBe(2);
  });

  it('should get document history', () => {
    debugger_.record({ type: 'insert', collection: 'users', documentId: 'u1', timestamp: 1, durationMs: 1 });
    debugger_.record({ type: 'update', collection: 'users', documentId: 'u1', timestamp: 2, durationMs: 1 });
    debugger_.record({ type: 'update', collection: 'users', documentId: 'u2', timestamp: 3, durationMs: 1 });

    const history = debugger_.getDocumentHistory('users', 'u1');
    expect(history.length).toBe(2);
  });

  it('should get errors only', () => {
    debugger_.record({ type: 'insert', collection: 'users', timestamp: 1, durationMs: 1 });
    debugger_.record({ type: 'insert', collection: 'users', timestamp: 2, durationMs: 1, error: 'Duplicate key' });

    const errors = debugger_.getErrors();
    expect(errors.length).toBe(1);
    expect(errors[0]!.error).toBe('Duplicate key');
  });

  it('should compute operation stats', () => {
    debugger_.record({ type: 'insert', collection: 'users', timestamp: 1, durationMs: 10 });
    debugger_.record({ type: 'insert', collection: 'users', timestamp: 2, durationMs: 20 });
    debugger_.record({ type: 'query', collection: 'users', timestamp: 3, durationMs: 5 });

    const stats = debugger_.getOperationStats();
    expect(stats['insert']!.count).toBe(2);
    expect(stats['insert']!.avgDurationMs).toBe(15);
    expect(stats['query']!.count).toBe(1);
  });

  it('should replay from snapshot', () => {
    for (let i = 0; i < 5; i++) {
      debugger_.record({ type: 'insert', collection: 'users', timestamp: i, durationMs: 1 });
    }
    const snap = debugger_.createSnapshot('mid');
    for (let i = 0; i < 3; i++) {
      debugger_.record({ type: 'update', collection: 'users', timestamp: 10 + i, durationMs: 1 });
    }

    const replayed = debugger_.replayFrom(snap.id);
    expect(replayed.length).toBe(3);
    expect(replayed[0]!.type).toBe('update');
  });

  it('should get timeline summary', () => {
    debugger_.record({ type: 'insert', collection: 'users', timestamp: 100, durationMs: 1 });
    debugger_.record({ type: 'insert', collection: 'users', timestamp: 200, durationMs: 1, error: 'fail' });

    const timeline = debugger_.getTimeline();
    expect(timeline.eventCount).toBe(2);
    expect(timeline.errorCount).toBe(1);
    expect(timeline.totalDuration).toBe(100);
  });

  it('should disable recording', () => {
    debugger_.setEnabled(false);
    debugger_.record({ type: 'insert', collection: 'users', timestamp: 1, durationMs: 1 });
    expect(debugger_.eventCount).toBe(0);
  });

  it('should clear all data', () => {
    debugger_.record({ type: 'insert', collection: 'users', timestamp: 1, durationMs: 1 });
    debugger_.createSnapshot();
    debugger_.clear();
    expect(debugger_.eventCount).toBe(0);
    expect(debugger_.snapshotCount).toBe(0);
  });
});

describe('MetricsDashboard', () => {
  let dashboard: MetricsDashboard;

  beforeEach(() => {
    dashboard = createMetricsDashboard({ maxPoints: 10 });
  });

  it('should record operations', () => {
    dashboard.recordOperation('users', 'insert', 5, true);
    dashboard.recordOperation('users', 'query', 2, true);

    const summary = dashboard.getSummary();
    expect(summary.totalOps).toBe(2);
    expect(summary.activeCollections).toBe(1);
  });

  it('should track error rate', () => {
    dashboard.recordOperation('users', 'insert', 5, true);
    dashboard.recordOperation('users', 'insert', 5, false);

    const summary = dashboard.getSummary();
    expect(summary.errorRate).toBe(0.5);
  });

  it('should compute average latency', () => {
    dashboard.recordOperation('users', 'insert', 10, true);
    dashboard.recordOperation('users', 'insert', 20, true);

    const summary = dashboard.getSummary();
    expect(summary.avgLatencyMs).toBe(15);
  });

  it('should track operation counts', () => {
    dashboard.recordOperation('users', 'insert', 5, true);
    dashboard.recordOperation('users', 'insert', 5, true);
    dashboard.recordOperation('todos', 'query', 3, true);

    const counts = dashboard.getOperationCounts();
    expect(counts['users.insert']).toBe(2);
    expect(counts['todos.query']).toBe(1);
  });

  it('should record sync metrics', () => {
    dashboard.recordSync('push', 100, 10);
    const names = dashboard.getSeriesNames();
    expect(names).toContain('sync.push.duration');
    expect(names).toContain('sync.push.docs');
  });

  it('should get series data', () => {
    dashboard.recordOperation('users', 'insert', 5, true);
    const series = dashboard.getSeries('latency.insert');
    expect(series).toBeDefined();
    expect(series!.points.length).toBe(1);
    expect(series!.unit).toBe('ms');
  });

  it('should respect maxPoints limit', () => {
    for (let i = 0; i < 15; i++) {
      dashboard.recordOperation('users', 'insert', i, true);
    }
    const series = dashboard.getSeries('latency.insert');
    expect(series!.points.length).toBeLessThanOrEqual(10);
  });

  it('should reset all metrics', () => {
    dashboard.recordOperation('users', 'insert', 5, true);
    dashboard.reset();
    expect(dashboard.getSummary().totalOps).toBe(0);
    expect(dashboard.getSeriesNames().length).toBe(0);
  });
});
