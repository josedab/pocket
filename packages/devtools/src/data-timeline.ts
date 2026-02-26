/**
 * Data Timeline — records all database operations chronologically
 * for time-travel debugging in the DevTools extension.
 */

/** A single operation in the timeline. */
export interface TimelineEntry {
  readonly id: number;
  readonly timestamp: number;
  readonly operation: 'insert' | 'update' | 'delete' | 'query' | 'sync-push' | 'sync-pull';
  readonly collection: string;
  readonly documentId?: string;
  readonly durationMs: number;
  readonly details?: Record<string, unknown>;
  readonly source: 'local' | 'remote' | 'sync';
}

/** Timeline filter options. */
export interface TimelineFilter {
  readonly operations?: readonly TimelineEntry['operation'][];
  readonly collections?: readonly string[];
  readonly sources?: readonly TimelineEntry['source'][];
  readonly fromTimestamp?: number;
  readonly toTimestamp?: number;
}

/** Timeline configuration. */
export interface DataTimelineConfig {
  /** Maximum entries to retain. Defaults to 1000. */
  readonly maxEntries?: number;
}

export class DataTimeline {
  private readonly entries: TimelineEntry[] = [];
  private readonly maxEntries: number;
  private entryCounter = 0;

  constructor(config: DataTimelineConfig = {}) {
    this.maxEntries = config.maxEntries ?? 1000;
  }

  /** Record an operation. */
  record(entry: Omit<TimelineEntry, 'id'>): void {
    const timelineEntry: TimelineEntry = {
      ...entry,
      id: ++this.entryCounter,
    };

    this.entries.push(timelineEntry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  /** Get all entries, optionally filtered. */
  getEntries(filter?: TimelineFilter): readonly TimelineEntry[] {
    if (!filter) return [...this.entries];

    return this.entries.filter((e) => {
      if (filter.operations && !filter.operations.includes(e.operation)) return false;
      if (filter.collections && !filter.collections.includes(e.collection)) return false;
      if (filter.sources && !filter.sources.includes(e.source)) return false;
      if (filter.fromTimestamp && e.timestamp < filter.fromTimestamp) return false;
      if (filter.toTimestamp && e.timestamp > filter.toTimestamp) return false;
      return true;
    });
  }

  /** Get operations per second over a time window. */
  getOpsPerSecond(windowMs = 60_000): number {
    const cutoff = Date.now() - windowMs;
    const recent = this.entries.filter((e) => e.timestamp >= cutoff);
    return recent.length / (windowMs / 1000);
  }

  /** Get operation breakdown by type. */
  getBreakdown(): Record<string, number> {
    const breakdown: Record<string, number> = {};
    for (const entry of this.entries) {
      breakdown[entry.operation] = (breakdown[entry.operation] ?? 0) + 1;
    }
    return breakdown;
  }

  /** Clear all entries. */
  clear(): void {
    this.entries.length = 0;
  }

  /** Total entry count. */
  get size(): number {
    return this.entries.length;
  }
}

export function createDataTimeline(config?: DataTimelineConfig): DataTimeline {
  return new DataTimeline(config);
}
