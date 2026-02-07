/**
 * Visual Timeline — timeline visualization engine for tracking
 * database changes over time in Pocket Studio.
 *
 * Renders a virtual timeline of database mutations, supports grouping
 * by collection, user, or time period, zoom controls, point-in-time
 * diffs, and full document lifecycle tracking.
 *
 * @module @pocket/studio/visual-timeline
 *
 * @example
 * ```typescript
 * import { createVisualTimeline } from '@pocket/studio';
 *
 * const timeline = createVisualTimeline({ bucketSizeMs: 60_000 });
 *
 * timeline.addChange({
 *   id: 'doc-1',
 *   collection: 'users',
 *   operation: 'insert',
 *   timestamp: Date.now(),
 *   documentId: 'u1',
 *   data: { name: 'Alice' },
 * });
 *
 * const entries = timeline.getEntries();
 * const grouped = timeline.groupBy('collection');
 * ```
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';
import type { StudioEvent } from './types.js';

// ── Types ────────────────────────────────────────────────────────────────

/** A single recorded change in the timeline. */
export interface TimelineChange {
  /** Unique identifier for this change entry */
  id: string;
  /** Collection the change belongs to */
  collection: string;
  /** Type of mutation */
  operation: 'insert' | 'update' | 'delete';
  /** Unix timestamp (ms) when the change occurred */
  timestamp: number;
  /** The document ID affected */
  documentId: string;
  /** Optional snapshot of document data at this point */
  data?: Record<string, unknown>;
  /** Optional user / actor identifier */
  userId?: string;
  /** Optional metadata (e.g. source, revision) */
  metadata?: Record<string, unknown>;
}

/** A time-bounded group of changes. */
export interface TimelineBucket {
  /** Start of the bucket (Unix ms) */
  startTime: number;
  /** End of the bucket (Unix ms) */
  endTime: number;
  /** Changes falling within this bucket */
  changes: TimelineChange[];
  /** Number of changes in this bucket */
  count: number;
}

/** Result of grouping changes by a given dimension. */
export interface TimelineGroup {
  /** The grouping key (e.g. collection name or user ID) */
  key: string;
  /** Changes in this group */
  changes: TimelineChange[];
  /** Total count */
  count: number;
}

/** Diff between two points in time. */
export interface TimelineDiff {
  /** Timestamp of the earlier point */
  fromTime: number;
  /** Timestamp of the later point */
  toTime: number;
  /** Documents inserted between the two points */
  inserted: TimelineChange[];
  /** Documents updated between the two points */
  updated: TimelineChange[];
  /** Documents deleted between the two points */
  deleted: TimelineChange[];
  /** Total number of changes */
  totalChanges: number;
}

/** Lifecycle of a single document through the timeline. */
export interface DocumentLifecycle {
  /** The document ID */
  documentId: string;
  /** Collection the document belongs to */
  collection: string;
  /** Ordered list of changes for this document */
  changes: TimelineChange[];
  /** Current lifecycle state */
  currentState: 'created' | 'modified' | 'deleted';
  /** When the document was first seen (Unix ms) */
  createdAt: number;
  /** When the document was last changed (Unix ms) */
  lastModifiedAt: number;
}

/** The current visible window on the timeline. */
export interface TimelineRange {
  /** Start of the visible range (Unix ms) */
  start: number;
  /** End of the visible range (Unix ms) */
  end: number;
}

/** Configuration for the visual timeline. */
export interface VisualTimelineConfig {
  /** Bucket size in milliseconds for grouping changes (default: 60 000 — 1 minute) */
  bucketSizeMs?: number;
  /** Maximum number of changes to retain (default: 10 000) */
  maxChanges?: number;
}

/** Events emitted when a user interacts with the timeline. */
export interface TimelineInteractionEvent {
  /** Kind of interaction */
  type: 'select' | 'zoom' | 'pan' | 'hover';
  /** Affected change, if any */
  change?: TimelineChange;
  /** Current visible range after the interaction */
  range: TimelineRange;
  /** Unix ms when the interaction occurred */
  timestamp: number;
}

// ── Class ────────────────────────────────────────────────────────────────

/**
 * Visual timeline engine for tracking and visualising database changes.
 */
export class VisualTimeline {
  private readonly config: Required<VisualTimelineConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly events$ = new Subject<StudioEvent>();
  private readonly interactions$ = new Subject<TimelineInteractionEvent>();
  private readonly changes$ = new BehaviorSubject<TimelineChange[]>([]);
  private readonly range$ = new BehaviorSubject<TimelineRange>({
    start: 0,
    end: Date.now(),
  });

  constructor(config: VisualTimelineConfig = {}) {
    this.config = {
      bucketSizeMs: config.bucketSizeMs ?? 60_000,
      maxChanges: config.maxChanges ?? 10_000,
    };
  }

  // ── Mutation ─────────────────────────────────────────────────────────

  /**
   * Record a database change in the timeline.
   */
  addChange(change: TimelineChange): void {
    const changes = this.changes$.getValue();
    const updated = [...changes, change]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-this.config.maxChanges);
    this.changes$.next(updated);

    this.events$.next({
      type: 'document:modified',
      collection: change.collection,
      id: change.documentId,
    });
  }

  /**
   * Record multiple changes at once.
   */
  addChanges(incoming: TimelineChange[]): void {
    if (incoming.length === 0) return;
    const changes = this.changes$.getValue();
    const updated = [...changes, ...incoming]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-this.config.maxChanges);
    this.changes$.next(updated);
  }

  /**
   * Remove all changes from the timeline.
   */
  clearChanges(): void {
    this.changes$.next([]);
  }

  // ── Queries ──────────────────────────────────────────────────────────

  /**
   * Get all recorded entries as an observable.
   */
  getEntries(): Observable<TimelineChange[]> {
    return this.changes$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get a snapshot of all recorded entries.
   */
  getEntriesSnapshot(): TimelineChange[] {
    return this.changes$.getValue();
  }

  /**
   * Get entries within a specific time range.
   */
  getEntriesInRange(start: number, end: number): TimelineChange[] {
    return this.changes$
      .getValue()
      .filter((c) => c.timestamp >= start && c.timestamp <= end);
  }

  // ── Grouping ─────────────────────────────────────────────────────────

  /**
   * Group changes by a dimension: collection, user, or time period.
   */
  groupBy(dimension: 'collection' | 'user' | 'time'): TimelineGroup[] | TimelineBucket[] {
    const changes = this.changes$.getValue();

    switch (dimension) {
      case 'collection':
        return this.groupByKey(changes, (c) => c.collection);
      case 'user':
        return this.groupByKey(changes, (c) => c.userId ?? 'unknown');
      case 'time':
        return this.groupByTimeBuckets(changes);
    }
  }

  /**
   * Group changes into time buckets using the configured bucket size.
   */
  getTimeBuckets(): TimelineBucket[] {
    return this.groupByTimeBuckets(this.changes$.getValue());
  }

  // ── Zoom / range ─────────────────────────────────────────────────────

  /**
   * Set the visible time range.
   */
  setRange(range: TimelineRange): void {
    this.range$.next(range);
    this.interactions$.next({
      type: 'zoom',
      range,
      timestamp: Date.now(),
    });
  }

  /**
   * Zoom in by halving the visible range around its centre.
   */
  zoomIn(): TimelineRange {
    const { start, end } = this.range$.getValue();
    const centre = (start + end) / 2;
    const halfSpan = (end - start) / 4;
    const newRange: TimelineRange = {
      start: Math.round(centre - halfSpan),
      end: Math.round(centre + halfSpan),
    };
    this.setRange(newRange);
    return newRange;
  }

  /**
   * Zoom out by doubling the visible range around its centre.
   */
  zoomOut(): TimelineRange {
    const { start, end } = this.range$.getValue();
    const centre = (start + end) / 2;
    const halfSpan = (end - start);
    const newRange: TimelineRange = {
      start: Math.round(centre - halfSpan),
      end: Math.round(centre + halfSpan),
    };
    this.setRange(newRange);
    return newRange;
  }

  /**
   * Get the current visible range as an observable.
   */
  getRange(): Observable<TimelineRange> {
    return this.range$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get the current visible range snapshot.
   */
  getRangeSnapshot(): TimelineRange {
    return this.range$.getValue();
  }

  // ── Diff ─────────────────────────────────────────────────────────────

  /**
   * Compute a diff between two points in time showing what changed.
   */
  diff(fromTime: number, toTime: number): TimelineDiff {
    if (fromTime > toTime) {
      throw new Error(`fromTime (${fromTime}) must be less than or equal to toTime (${toTime})`);
    }

    const inRange = this.getEntriesInRange(fromTime, toTime);

    return {
      fromTime,
      toTime,
      inserted: inRange.filter((c) => c.operation === 'insert'),
      updated: inRange.filter((c) => c.operation === 'update'),
      deleted: inRange.filter((c) => c.operation === 'delete'),
      totalChanges: inRange.length,
    };
  }

  // ── Document lifecycle ───────────────────────────────────────────────

  /**
   * Trace the full lifecycle of a document through the timeline.
   */
  getDocumentLifecycle(documentId: string): DocumentLifecycle | undefined {
    const all = this.changes$.getValue().filter((c) => c.documentId === documentId);
    if (all.length === 0) return undefined;

    const sorted = [...all].sort((a, b) => a.timestamp - b.timestamp);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;

    let currentState: DocumentLifecycle['currentState'];
    if (last.operation === 'delete') {
      currentState = 'deleted';
    } else if (sorted.length === 1 && first.operation === 'insert') {
      currentState = 'created';
    } else {
      currentState = 'modified';
    }

    return {
      documentId,
      collection: first.collection,
      changes: sorted,
      currentState,
      createdAt: first.timestamp,
      lastModifiedAt: last.timestamp,
    };
  }

  // ── Interaction events ───────────────────────────────────────────────

  /**
   * Emit a timeline interaction event (for UI integration).
   */
  emitInteraction(event: TimelineInteractionEvent): void {
    this.interactions$.next(event);
  }

  /**
   * Subscribe to timeline interaction events.
   */
  getInteractions(): Observable<TimelineInteractionEvent> {
    return this.interactions$.asObservable().pipe(takeUntil(this.destroy$));
  }

  // ── Studio events ────────────────────────────────────────────────────

  /**
   * Get studio events emitted by the timeline.
   */
  getEvents(): Observable<StudioEvent> {
    return this.events$.asObservable().pipe(takeUntil(this.destroy$));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Destroy the timeline and complete all streams.
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.events$.complete();
    this.interactions$.complete();
    this.changes$.complete();
    this.range$.complete();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private groupByKey(
    changes: TimelineChange[],
    keyFn: (c: TimelineChange) => string,
  ): TimelineGroup[] {
    const map = new Map<string, TimelineChange[]>();
    for (const change of changes) {
      const key = keyFn(change);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(change);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      changes: items,
      count: items.length,
    }));
  }

  private groupByTimeBuckets(changes: TimelineChange[]): TimelineBucket[] {
    if (changes.length === 0) return [];

    const bucketMap = new Map<number, TimelineChange[]>();

    for (const change of changes) {
      const bucketStart =
        Math.floor(change.timestamp / this.config.bucketSizeMs) * this.config.bucketSizeMs;
      if (!bucketMap.has(bucketStart)) bucketMap.set(bucketStart, []);
      bucketMap.get(bucketStart)!.push(change);
    }

    return Array.from(bucketMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([startTime, items]) => ({
        startTime,
        endTime: startTime + this.config.bucketSizeMs,
        changes: items,
        count: items.length,
      }));
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

/**
 * Create a new VisualTimeline instance.
 *
 * @param config - Optional timeline configuration
 * @returns A new VisualTimeline
 *
 * @example
 * ```typescript
 * import { createVisualTimeline } from '@pocket/studio';
 *
 * const timeline = createVisualTimeline({ bucketSizeMs: 30_000 });
 *
 * timeline.addChange({
 *   id: 'c1',
 *   collection: 'users',
 *   operation: 'insert',
 *   timestamp: Date.now(),
 *   documentId: 'u1',
 *   data: { name: 'Alice' },
 * });
 *
 * const lifecycle = timeline.getDocumentLifecycle('u1');
 * console.log(lifecycle?.currentState); // 'created'
 * ```
 */
export function createVisualTimeline(config?: VisualTimelineConfig): VisualTimeline {
  return new VisualTimeline(config);
}
