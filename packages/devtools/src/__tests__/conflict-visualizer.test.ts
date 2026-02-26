import { beforeEach, describe, expect, it } from 'vitest';
import type { ConflictEvent } from '../conflict-visualizer.js';
import { ConflictVisualizer, createConflictVisualizer } from '../conflict-visualizer.js';

function makeEvent(overrides: Partial<ConflictEvent> = {}): ConflictEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    collection: 'todos',
    documentId: 'doc-1',
    localVersion: { title: 'local' },
    remoteVersion: { title: 'remote' },
    strategy: 'last-write-wins',
    resolution: 'local-wins',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ConflictVisualizer', () => {
  let visualizer: ConflictVisualizer;

  beforeEach(() => {
    visualizer = createConflictVisualizer();
  });

  // ── Record & retrieve ───────────────────────────────────────────

  it('records and retrieves conflicts', () => {
    const event = makeEvent({ id: 'e1', resolvedAt: Date.now() + 100 });
    visualizer.recordConflict(event);

    const timeline = visualizer.getTimeline();
    expect(timeline.totalConflicts).toBe(1);
    expect(timeline.resolvedCount).toBe(1);
    expect(timeline.unresolvedCount).toBe(0);
    expect(timeline.events[0]).toBe(event);
  });

  it('counts unresolved events (no resolvedAt)', () => {
    visualizer.recordConflict(makeEvent({ id: 'u1' }));
    const timeline = visualizer.getTimeline();
    expect(timeline.unresolvedCount).toBe(1);
  });

  // ── Timeline filtering ──────────────────────────────────────────

  it('filters timeline by collection', () => {
    visualizer.recordConflict(makeEvent({ id: 'a', collection: 'todos' }));
    visualizer.recordConflict(makeEvent({ id: 'b', collection: 'notes' }));
    visualizer.recordConflict(makeEvent({ id: 'c', collection: 'todos' }));

    const timeline = visualizer.getTimeline({ collection: 'todos' });
    expect(timeline.totalConflicts).toBe(2);
    expect(timeline.events.every((e) => e.collection === 'todos')).toBe(true);
  });

  it('filters timeline by time range', () => {
    const now = Date.now();
    visualizer.recordConflict(makeEvent({ id: 't1', timestamp: now - 5000 }));
    visualizer.recordConflict(makeEvent({ id: 't2', timestamp: now - 1000 }));
    visualizer.recordConflict(makeEvent({ id: 't3', timestamp: now }));

    const timeline = visualizer.getTimeline({ since: now - 2000 });
    expect(timeline.totalConflicts).toBe(2);
  });

  // ── Document diff ───────────────────────────────────────────────

  it('computes field-level diffs between documents', () => {
    const local = { title: 'A', count: 1, shared: true };
    const remote = { title: 'B', count: 1, extra: 'x', shared: true };
    const resolved = { title: 'A', count: 1, extra: 'x', shared: true };

    const diffs = visualizer.diffDocuments(local, remote, resolved);

    const titleDiff = diffs.find((d) => d.field === 'title');
    expect(titleDiff?.changed).toBe(true);
    expect(titleDiff?.resolvedValue).toBe('A');

    const countDiff = diffs.find((d) => d.field === 'count');
    expect(countDiff?.changed).toBe(false);

    const extraDiff = diffs.find((d) => d.field === 'extra');
    expect(extraDiff?.changed).toBe(true);
    expect(extraDiff?.localValue).toBeUndefined();
  });

  // ── Conflict detail ─────────────────────────────────────────────

  it('returns conflict detail for a known event', () => {
    visualizer.recordConflict(
      makeEvent({
        id: 'd1',
        localVersion: { a: 1 },
        remoteVersion: { a: 2 },
        resolution: 'remote-wins',
      })
    );

    const detail = visualizer.getConflictDetail('d1');
    expect(detail).toBeDefined();
    expect(detail!.resolution).toBe('remote-wins');
    expect(detail!.diffs.length).toBeGreaterThan(0);
  });

  it('returns undefined for unknown event id', () => {
    expect(visualizer.getConflictDetail('nope')).toBeUndefined();
  });

  // ── Stats ───────────────────────────────────────────────────────

  it('aggregates stats by collection and strategy', () => {
    const now = Date.now();
    visualizer.recordConflict(
      makeEvent({
        id: 's1',
        collection: 'todos',
        strategy: 'merge',
        timestamp: now,
        resolvedAt: now + 200,
      })
    );
    visualizer.recordConflict(
      makeEvent({
        id: 's2',
        collection: 'notes',
        strategy: 'merge',
        timestamp: now,
        resolvedAt: now + 400,
      })
    );
    visualizer.recordConflict(
      makeEvent({ id: 's3', collection: 'todos', strategy: 'last-write-wins' })
    );

    const stats = visualizer.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byCollection['todos']).toBe(2);
    expect(stats.byCollection['notes']).toBe(1);
    expect(stats.byStrategy['merge']).toBe(2);
    expect(stats.byStrategy['last-write-wins']).toBe(1);
    expect(stats.avgResolutionMs).toBe(300);
  });

  it('returns zero avg resolution when nothing is resolved', () => {
    visualizer.recordConflict(makeEvent({ id: 'x' }));
    expect(visualizer.getStats().avgResolutionMs).toBe(0);
  });

  // ── Observable emissions ────────────────────────────────────────

  it('emits events through events$ observable', async () => {
    const received: ConflictEvent[] = [];
    const sub = visualizer.events$.subscribe((e) => received.push(e));

    const e1 = makeEvent({ id: 'o1' });
    const e2 = makeEvent({ id: 'o2' });
    visualizer.recordConflict(e1);
    visualizer.recordConflict(e2);

    expect(received).toHaveLength(2);
    expect(received[0]).toBe(e1);
    expect(received[1]).toBe(e2);
    sub.unsubscribe();
  });

  it('completes events$ on dispose', () => {
    let completed = false;
    visualizer.events$.subscribe({ complete: () => (completed = true) });
    visualizer.dispose();
    expect(completed).toBe(true);
  });

  // ── Max events limit ────────────────────────────────────────────

  it('enforces maxEvents by evicting oldest entries', () => {
    const vis = createConflictVisualizer({ maxEvents: 3 });
    for (let i = 0; i < 5; i++) {
      vis.recordConflict(makeEvent({ id: `m${i}` }));
    }

    const timeline = vis.getTimeline();
    expect(timeline.totalConflicts).toBe(3);
    expect(timeline.events[0]!.id).toBe('m2');
    vis.dispose();
  });

  // ── Clear ───────────────────────────────────────────────────────

  it('clears all stored events', () => {
    visualizer.recordConflict(makeEvent({ id: 'c1' }));
    visualizer.recordConflict(makeEvent({ id: 'c2' }));
    visualizer.clear();

    const timeline = visualizer.getTimeline();
    expect(timeline.totalConflicts).toBe(0);
  });
});
