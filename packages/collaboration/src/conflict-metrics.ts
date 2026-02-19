/**
 * Conflict resolution metrics and telemetry for document sync.
 *
 * Tracks conflict occurrences, resolution strategies used, merge success
 * rates, and provides audit-level logging of conflict resolution decisions.
 *
 * @module conflict-metrics
 */

/** Conflict resolution strategy type */
export type ConflictResolutionStrategy = 'last-write-wins' | 'merge' | 'custom' | 'remote-priority' | 'local-priority';

/** A single conflict event record */
export interface ConflictEvent {
  readonly conflictId: string;
  readonly documentId: string;
  readonly collection: string;
  readonly timestamp: number;
  readonly strategy: ConflictResolutionStrategy;
  readonly resolved: boolean;
  readonly localVersion: number;
  readonly remoteVersion: number;
  readonly fieldsConflicted: readonly string[];
  readonly resolutionDurationMs: number;
}

/** Aggregate conflict metrics */
export interface ConflictMetrics {
  readonly totalConflicts: number;
  readonly resolvedConflicts: number;
  readonly unresolvedConflicts: number;
  readonly strategyBreakdown: Record<ConflictResolutionStrategy, number>;
  readonly avgResolutionMs: number;
  readonly conflictsPerMinute: number;
  readonly topConflictedFields: readonly { field: string; count: number }[];
  readonly topConflictedCollections: readonly { collection: string; count: number }[];
}

/**
 * Tracks and aggregates conflict resolution metrics.
 *
 * @example
 * ```typescript
 * import { ConflictMetricsTracker } from '@pocket/collaboration';
 *
 * const tracker = new ConflictMetricsTracker();
 *
 * tracker.recordConflict({
 *   documentId: 'doc-1',
 *   collection: 'notes',
 *   strategy: 'last-write-wins',
 *   resolved: true,
 *   fieldsConflicted: ['title', 'body'],
 *   resolutionDurationMs: 5,
 * });
 *
 * const metrics = tracker.getMetrics();
 * console.log(`${metrics.totalConflicts} conflicts, ${metrics.avgResolutionMs}ms avg`);
 * ```
 */
export class ConflictMetricsTracker {
  private readonly events: ConflictEvent[] = [];
  private readonly maxEvents: number;

  constructor(maxEvents = 10_000) {
    this.maxEvents = maxEvents;
  }

  /** Record a conflict event */
  recordConflict(input: {
    documentId: string;
    collection: string;
    strategy: ConflictResolutionStrategy;
    resolved: boolean;
    fieldsConflicted: string[];
    resolutionDurationMs: number;
    localVersion?: number;
    remoteVersion?: number;
  }): ConflictEvent {
    const event: ConflictEvent = {
      conflictId: `conflict_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      documentId: input.documentId,
      collection: input.collection,
      timestamp: Date.now(),
      strategy: input.strategy,
      resolved: input.resolved,
      localVersion: input.localVersion ?? 0,
      remoteVersion: input.remoteVersion ?? 0,
      fieldsConflicted: input.fieldsConflicted,
      resolutionDurationMs: input.resolutionDurationMs,
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    return event;
  }

  /** Get aggregate metrics */
  getMetrics(): ConflictMetrics {
    const total = this.events.length;
    const resolved = this.events.filter((e) => e.resolved).length;

    // Strategy breakdown
    const strategyBreakdown: Record<ConflictResolutionStrategy, number> = {
      'last-write-wins': 0, merge: 0, custom: 0, 'remote-priority': 0, 'local-priority': 0,
    };
    for (const e of this.events) {
      strategyBreakdown[e.strategy]++;
    }

    // Average resolution time
    const resolvedEvents = this.events.filter((e) => e.resolved);
    const avgResolutionMs = resolvedEvents.length > 0
      ? Math.round(resolvedEvents.reduce((sum, e) => sum + e.resolutionDurationMs, 0) / resolvedEvents.length)
      : 0;

    // Conflicts per minute
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    const recentConflicts = this.events.filter((e) => e.timestamp >= oneMinuteAgo).length;

    // Top conflicted fields
    const fieldCounts = new Map<string, number>();
    for (const e of this.events) {
      for (const f of e.fieldsConflicted) {
        fieldCounts.set(f, (fieldCounts.get(f) ?? 0) + 1);
      }
    }
    const topFields = Array.from(fieldCounts.entries())
      .map(([field, count]) => ({ field, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top conflicted collections
    const collCounts = new Map<string, number>();
    for (const e of this.events) {
      collCounts.set(e.collection, (collCounts.get(e.collection) ?? 0) + 1);
    }
    const topCollections = Array.from(collCounts.entries())
      .map(([collection, count]) => ({ collection, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalConflicts: total,
      resolvedConflicts: resolved,
      unresolvedConflicts: total - resolved,
      strategyBreakdown,
      avgResolutionMs,
      conflictsPerMinute: recentConflicts,
      topConflictedFields: topFields,
      topConflictedCollections: topCollections,
    };
  }

  /** Get all conflict events for a specific document */
  getDocumentConflicts(documentId: string): readonly ConflictEvent[] {
    return this.events.filter((e) => e.documentId === documentId);
  }

  /** Get conflict events within a time range */
  getConflictsByTimeRange(startMs: number, endMs: number): readonly ConflictEvent[] {
    return this.events.filter((e) => e.timestamp >= startMs && e.timestamp <= endMs);
  }

  /** Get total event count */
  getEventCount(): number {
    return this.events.length;
  }

  /** Clear all tracked events */
  clear(): void {
    this.events.length = 0;
  }
}

/** Factory function */
export function createConflictMetricsTracker(maxEvents?: number): ConflictMetricsTracker {
  return new ConflictMetricsTracker(maxEvents);
}
