import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import {
  VisualTimeline,
  createVisualTimeline,
  type TimelineChange,
  type TimelineGroup,
  type TimelineBucket,
} from '../visual-timeline.js';

describe('VisualTimeline', () => {
  let timeline: VisualTimeline;

  const BASE_TIME = 1_700_000_000_000;

  function makeChange(overrides: Partial<TimelineChange> = {}): TimelineChange {
    return {
      id: `c-${Math.random().toString(36).slice(2, 8)}`,
      collection: 'users',
      operation: 'insert',
      timestamp: BASE_TIME,
      documentId: 'doc-1',
      data: { name: 'Alice' },
      ...overrides,
    };
  }

  beforeEach(() => {
    timeline = createVisualTimeline({ bucketSizeMs: 60_000 });
  });

  afterEach(() => {
    timeline.destroy();
  });

  describe('createVisualTimeline', () => {
    it('should return a VisualTimeline instance', () => {
      const t = createVisualTimeline();
      expect(t).toBeInstanceOf(VisualTimeline);
      t.destroy();
    });

    it('should accept optional config', () => {
      const t = createVisualTimeline({ bucketSizeMs: 30_000, maxChanges: 500 });
      expect(t).toBeInstanceOf(VisualTimeline);
      t.destroy();
    });
  });

  describe('addChange', () => {
    it('should add a single entry', async () => {
      const change = makeChange();
      timeline.addChange(change);

      const entries = await firstValueFrom(timeline.getEntries().pipe(take(1)));
      expect(entries).toHaveLength(1);
      expect(entries[0]!.documentId).toBe('doc-1');
    });

    it('should sort entries by timestamp', async () => {
      timeline.addChange(makeChange({ id: 'c2', timestamp: BASE_TIME + 200 }));
      timeline.addChange(makeChange({ id: 'c1', timestamp: BASE_TIME + 100 }));

      const entries = await firstValueFrom(timeline.getEntries().pipe(take(1)));
      expect(entries[0]!.id).toBe('c1');
      expect(entries[1]!.id).toBe('c2');
    });
  });

  describe('addChanges', () => {
    it('should batch add multiple entries', async () => {
      const changes = [
        makeChange({ id: 'c1', timestamp: BASE_TIME }),
        makeChange({ id: 'c2', timestamp: BASE_TIME + 1000 }),
        makeChange({ id: 'c3', timestamp: BASE_TIME + 2000 }),
      ];
      timeline.addChanges(changes);

      const entries = await firstValueFrom(timeline.getEntries().pipe(take(1)));
      expect(entries).toHaveLength(3);
    });

    it('should not emit for empty array', async () => {
      timeline.addChange(makeChange());
      timeline.addChanges([]);

      const entries = await firstValueFrom(timeline.getEntries().pipe(take(1)));
      expect(entries).toHaveLength(1);
    });
  });

  describe('getEntries', () => {
    it('should return all changes as observable', async () => {
      timeline.addChange(makeChange({ id: 'c1' }));
      timeline.addChange(makeChange({ id: 'c2', timestamp: BASE_TIME + 100 }));

      const entries = await firstValueFrom(timeline.getEntries().pipe(take(1)));
      expect(entries).toHaveLength(2);
    });
  });

  describe('getEntriesInRange', () => {
    it('should filter by time range', () => {
      timeline.addChanges([
        makeChange({ id: 'c1', timestamp: BASE_TIME }),
        makeChange({ id: 'c2', timestamp: BASE_TIME + 1000 }),
        makeChange({ id: 'c3', timestamp: BASE_TIME + 5000 }),
      ]);

      const inRange = timeline.getEntriesInRange(BASE_TIME, BASE_TIME + 2000);
      expect(inRange).toHaveLength(2);
      expect(inRange.map((c) => c.id)).toEqual(['c1', 'c2']);
    });

    it('should return empty array when no entries match', () => {
      timeline.addChange(makeChange({ timestamp: BASE_TIME }));
      const inRange = timeline.getEntriesInRange(BASE_TIME + 10_000, BASE_TIME + 20_000);
      expect(inRange).toEqual([]);
    });
  });

  describe('groupBy', () => {
    beforeEach(() => {
      timeline.addChanges([
        makeChange({ id: 'c1', collection: 'users', userId: 'u1', timestamp: BASE_TIME }),
        makeChange({ id: 'c2', collection: 'users', userId: 'u2', timestamp: BASE_TIME + 100 }),
        makeChange({ id: 'c3', collection: 'posts', userId: 'u1', timestamp: BASE_TIME + 200 }),
      ]);
    });

    it('should group by collection', () => {
      const groups = timeline.groupBy('collection') as TimelineGroup[];
      expect(groups).toHaveLength(2);

      const usersGroup = groups.find((g) => g.key === 'users');
      expect(usersGroup).toBeDefined();
      expect(usersGroup!.count).toBe(2);

      const postsGroup = groups.find((g) => g.key === 'posts');
      expect(postsGroup).toBeDefined();
      expect(postsGroup!.count).toBe(1);
    });

    it('should group by user', () => {
      const groups = timeline.groupBy('user') as TimelineGroup[];
      expect(groups).toHaveLength(2);

      const u1Group = groups.find((g) => g.key === 'u1');
      expect(u1Group).toBeDefined();
      expect(u1Group!.count).toBe(2);
    });

    it('should group by time into buckets', () => {
      const buckets = timeline.groupBy('time') as TimelineBucket[];
      expect(buckets.length).toBeGreaterThanOrEqual(1);
      // All changes within same minute should be in same bucket
      expect(buckets[0]!.count).toBe(3);
      expect(buckets[0]!.endTime - buckets[0]!.startTime).toBe(60_000);
    });
  });

  describe('setRange', () => {
    it('should update the visible range', async () => {
      const newRange = { start: BASE_TIME, end: BASE_TIME + 60_000 };
      timeline.setRange(newRange);

      const range = await firstValueFrom(timeline.getRange().pipe(take(1)));
      expect(range).toEqual(newRange);
    });
  });

  describe('zoomIn', () => {
    it('should narrow the range by half', () => {
      timeline.setRange({ start: 0, end: 1000 });
      const newRange = timeline.zoomIn();
      const span = newRange.end - newRange.start;
      expect(span).toBe(500);
    });
  });

  describe('zoomOut', () => {
    it('should expand the range by double', () => {
      timeline.setRange({ start: 0, end: 1000 });
      const newRange = timeline.zoomOut();
      const span = newRange.end - newRange.start;
      expect(span).toBe(2000);
    });
  });

  describe('diff', () => {
    it('should return changes between two timestamps', () => {
      timeline.addChanges([
        makeChange({ id: 'c1', operation: 'insert', timestamp: BASE_TIME }),
        makeChange({ id: 'c2', operation: 'update', timestamp: BASE_TIME + 1000 }),
        makeChange({ id: 'c3', operation: 'delete', timestamp: BASE_TIME + 2000 }),
        makeChange({ id: 'c4', operation: 'insert', timestamp: BASE_TIME + 5000 }),
      ]);

      const result = timeline.diff(BASE_TIME, BASE_TIME + 3000);
      expect(result.fromTime).toBe(BASE_TIME);
      expect(result.toTime).toBe(BASE_TIME + 3000);
      expect(result.inserted).toHaveLength(1);
      expect(result.updated).toHaveLength(1);
      expect(result.deleted).toHaveLength(1);
      expect(result.totalChanges).toBe(3);
    });

    it('should throw when fromTime > toTime', () => {
      expect(() => timeline.diff(2000, 1000)).toThrow();
    });
  });

  describe('getDocumentLifecycle', () => {
    it('should track create state for single insert', () => {
      timeline.addChange(makeChange({
        id: 'c1',
        operation: 'insert',
        documentId: 'doc-1',
        timestamp: BASE_TIME,
      }));

      const lifecycle = timeline.getDocumentLifecycle('doc-1');
      expect(lifecycle).toBeDefined();
      expect(lifecycle!.currentState).toBe('created');
      expect(lifecycle!.documentId).toBe('doc-1');
      expect(lifecycle!.changes).toHaveLength(1);
    });

    it('should track modified state for insert then update', () => {
      timeline.addChanges([
        makeChange({ id: 'c1', operation: 'insert', documentId: 'doc-1', timestamp: BASE_TIME }),
        makeChange({ id: 'c2', operation: 'update', documentId: 'doc-1', timestamp: BASE_TIME + 1000 }),
      ]);

      const lifecycle = timeline.getDocumentLifecycle('doc-1');
      expect(lifecycle!.currentState).toBe('modified');
      expect(lifecycle!.changes).toHaveLength(2);
    });

    it('should track deleted state', () => {
      timeline.addChanges([
        makeChange({ id: 'c1', operation: 'insert', documentId: 'doc-1', timestamp: BASE_TIME }),
        makeChange({ id: 'c2', operation: 'update', documentId: 'doc-1', timestamp: BASE_TIME + 1000 }),
        makeChange({ id: 'c3', operation: 'delete', documentId: 'doc-1', timestamp: BASE_TIME + 2000 }),
      ]);

      const lifecycle = timeline.getDocumentLifecycle('doc-1');
      expect(lifecycle!.currentState).toBe('deleted');
      expect(lifecycle!.createdAt).toBe(BASE_TIME);
      expect(lifecycle!.lastModifiedAt).toBe(BASE_TIME + 2000);
    });

    it('should return undefined for unknown document', () => {
      const lifecycle = timeline.getDocumentLifecycle('nonexistent');
      expect(lifecycle).toBeUndefined();
    });
  });

  describe('destroy', () => {
    it('should complete all streams on destroy', async () => {
      let completed = false;
      timeline.getEntries().subscribe({ complete: () => { completed = true; } });
      timeline.destroy();
      expect(completed).toBe(true);
    });
  });
});
