import { describe, expect, it } from 'vitest';
import { createDataTimeline, createQueryProfiler } from '../index.js';

describe('QueryProfiler', () => {
  it('should record and retrieve queries', () => {
    const profiler = createQueryProfiler();
    profiler.record({
      collection: 'todos',
      durationMs: 5,
      resultCount: 10,
      scannedCount: 100,
      timestamp: Date.now(),
      usedIndex: true,
    });

    const stats = profiler.getStats();
    expect(stats.totalQueries).toBe(1);
    expect(stats.recentQueries).toHaveLength(1);
    profiler.destroy();
  });

  it('should detect slow queries', () => {
    const profiler = createQueryProfiler({ slowThresholdMs: 50 });

    profiler.record({
      collection: 'todos',
      durationMs: 10,
      resultCount: 5,
      scannedCount: 5,
      timestamp: Date.now(),
      usedIndex: true,
    });
    profiler.record({
      collection: 'users',
      durationMs: 200,
      resultCount: 1000,
      scannedCount: 10000,
      timestamp: Date.now(),
      usedIndex: false,
    });

    const slow = profiler.getSlowQueries();
    expect(slow).toHaveLength(1);
    expect(slow[0]!.collection).toBe('users');
    profiler.destroy();
  });

  it('should compute statistics', () => {
    const profiler = createQueryProfiler();

    for (let i = 0; i < 5; i++) {
      profiler.record({
        collection: 'todos',
        durationMs: 10,
        resultCount: i,
        scannedCount: i * 2,
        timestamp: Date.now(),
        usedIndex: true,
      });
    }

    const stats = profiler.getStats();
    expect(stats.totalQueries).toBe(5);
    expect(stats.avgDurationMs).toBe(10);
    expect(stats.topCollections[0]!.collection).toBe('todos');
    profiler.destroy();
  });

  it('should emit queries via observable', () => {
    const profiler = createQueryProfiler();
    const queries: string[] = [];
    const sub = profiler.queries.subscribe((q) => queries.push(q.collection));

    profiler.record({
      collection: 'notes',
      durationMs: 1,
      resultCount: 0,
      scannedCount: 0,
      timestamp: Date.now(),
      usedIndex: false,
    });

    sub.unsubscribe();
    expect(queries).toEqual(['notes']);
    profiler.destroy();
  });

  it('should respect maxHistory', () => {
    const profiler = createQueryProfiler({ maxHistory: 3 });

    for (let i = 0; i < 5; i++) {
      profiler.record({
        collection: `col-${i}`,
        durationMs: 1,
        resultCount: 0,
        scannedCount: 0,
        timestamp: Date.now(),
        usedIndex: false,
      });
    }

    expect(profiler.getStats().totalQueries).toBe(3);
    profiler.destroy();
  });
});

describe('DataTimeline', () => {
  it('should record operations', () => {
    const timeline = createDataTimeline();
    timeline.record({
      timestamp: Date.now(),
      operation: 'insert',
      collection: 'todos',
      documentId: 'doc-1',
      durationMs: 2,
      source: 'local',
    });

    expect(timeline.size).toBe(1);
    expect(timeline.getEntries()).toHaveLength(1);
  });

  it('should filter entries', () => {
    const timeline = createDataTimeline();
    const now = Date.now();

    timeline.record({
      timestamp: now,
      operation: 'insert',
      collection: 'todos',
      durationMs: 1,
      source: 'local',
    });
    timeline.record({
      timestamp: now,
      operation: 'query',
      collection: 'users',
      durationMs: 5,
      source: 'local',
    });
    timeline.record({
      timestamp: now,
      operation: 'sync-push',
      collection: 'todos',
      durationMs: 50,
      source: 'sync',
    });

    const inserts = timeline.getEntries({ operations: ['insert'] });
    expect(inserts).toHaveLength(1);

    const todoOps = timeline.getEntries({ collections: ['todos'] });
    expect(todoOps).toHaveLength(2);

    const syncOps = timeline.getEntries({ sources: ['sync'] });
    expect(syncOps).toHaveLength(1);
  });

  it('should compute operation breakdown', () => {
    const timeline = createDataTimeline();
    timeline.record({
      timestamp: Date.now(),
      operation: 'insert',
      collection: 'a',
      durationMs: 1,
      source: 'local',
    });
    timeline.record({
      timestamp: Date.now(),
      operation: 'insert',
      collection: 'a',
      durationMs: 1,
      source: 'local',
    });
    timeline.record({
      timestamp: Date.now(),
      operation: 'query',
      collection: 'a',
      durationMs: 1,
      source: 'local',
    });

    const breakdown = timeline.getBreakdown();
    expect(breakdown['insert']).toBe(2);
    expect(breakdown['query']).toBe(1);
  });

  it('should compute ops per second', () => {
    const timeline = createDataTimeline();
    for (let i = 0; i < 10; i++) {
      timeline.record({
        timestamp: Date.now(),
        operation: 'insert',
        collection: 'todos',
        durationMs: 1,
        source: 'local',
      });
    }

    const opsPerSec = timeline.getOpsPerSecond(60_000);
    expect(opsPerSec).toBeGreaterThan(0);
  });

  it('should respect maxEntries', () => {
    const timeline = createDataTimeline({ maxEntries: 5 });
    for (let i = 0; i < 10; i++) {
      timeline.record({
        timestamp: Date.now(),
        operation: 'insert',
        collection: 'todos',
        durationMs: 1,
        source: 'local',
      });
    }

    expect(timeline.size).toBe(5);
  });

  it('should clear all entries', () => {
    const timeline = createDataTimeline();
    timeline.record({
      timestamp: Date.now(),
      operation: 'insert',
      collection: 'a',
      durationMs: 1,
      source: 'local',
    });
    timeline.clear();
    expect(timeline.size).toBe(0);
  });
});
