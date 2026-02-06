/**
 * Replay Debugger — records database state transitions and enables
 * post-mortem analysis by replaying operations step by step.
 */

export interface ReplayEvent {
  id: string;
  type: 'insert' | 'update' | 'delete' | 'query' | 'sync-push' | 'sync-pull' | 'conflict';
  collection: string;
  documentId?: string;
  timestamp: number;
  durationMs: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface ReplaySnapshot {
  id: string;
  timestamp: number;
  eventIndex: number;
  label?: string;
  state: Map<string, Record<string, unknown>[]>;
}

export interface ReplayDebuggerConfig {
  /** Maximum events to retain (default: 5000) */
  maxEvents?: number;
  /** Auto-snapshot every N events (0 to disable, default: 100) */
  autoSnapshotInterval?: number;
  /** Maximum snapshots to retain (default: 50) */
  maxSnapshots?: number;
  /** Enable recording (default: true) */
  enabled?: boolean;
}

export interface ReplayTimeline {
  events: ReplayEvent[];
  snapshots: ReplaySnapshot[];
  startTime: number;
  endTime: number;
  totalDuration: number;
  eventCount: number;
  errorCount: number;
}

/**
 * Records database operations for post-mortem replay and debugging.
 */
export class ReplayDebugger {
  private readonly events: ReplayEvent[] = [];
  private readonly snapshots: ReplaySnapshot[] = [];
  private readonly config: Required<ReplayDebuggerConfig>;
  private eventCounter = 0;

  constructor(config: ReplayDebuggerConfig = {}) {
    this.config = {
      maxEvents: config.maxEvents ?? 5000,
      autoSnapshotInterval: config.autoSnapshotInterval ?? 100,
      maxSnapshots: config.maxSnapshots ?? 50,
      enabled: config.enabled ?? true,
    };
  }

  /**
   * Record a database operation event.
   */
  record(event: Omit<ReplayEvent, 'id'>): void {
    if (!this.config.enabled) return;

    while (this.events.length >= this.config.maxEvents) {
      this.events.shift();
    }

    const fullEvent: ReplayEvent = {
      ...event,
      id: `evt-${++this.eventCounter}`,
    };

    this.events.push(fullEvent);

    // Auto-snapshot
    if (
      this.config.autoSnapshotInterval > 0 &&
      this.eventCounter % this.config.autoSnapshotInterval === 0
    ) {
      this.createSnapshot(`auto-${this.eventCounter}`);
    }
  }

  /**
   * Create a named snapshot of the current event position.
   */
  createSnapshot(label?: string): ReplaySnapshot {
    while (this.snapshots.length >= this.config.maxSnapshots) {
      this.snapshots.shift();
    }

    const snapshot: ReplaySnapshot = {
      id: `snap-${this.snapshots.length + 1}`,
      timestamp: Date.now(),
      eventIndex: this.events.length,
      label,
      state: new Map(),
    };

    this.snapshots.push(snapshot);
    return snapshot;
  }

  /**
   * Get events within a time range.
   */
  getEvents(from?: number, to?: number): ReplayEvent[] {
    return this.events.filter((e) => {
      if (from !== undefined && e.timestamp < from) return false;
      if (to !== undefined && e.timestamp > to) return false;
      return true;
    });
  }

  /**
   * Get events for a specific collection.
   */
  getCollectionEvents(collection: string): ReplayEvent[] {
    return this.events.filter((e) => e.collection === collection);
  }

  /**
   * Get events for a specific document.
   */
  getDocumentHistory(collection: string, documentId: string): ReplayEvent[] {
    return this.events.filter(
      (e) => e.collection === collection && e.documentId === documentId,
    );
  }

  /**
   * Get error events only.
   */
  getErrors(): ReplayEvent[] {
    return this.events.filter((e) => e.error !== undefined);
  }

  /**
   * Get the full timeline summary.
   */
  getTimeline(): ReplayTimeline {
    const first = this.events[0];
    const last = this.events[this.events.length - 1];

    return {
      events: [...this.events],
      snapshots: [...this.snapshots],
      startTime: first?.timestamp ?? 0,
      endTime: last?.timestamp ?? 0,
      totalDuration: first && last ? last.timestamp - first.timestamp : 0,
      eventCount: this.events.length,
      errorCount: this.events.filter((e) => e.error).length,
    };
  }

  /**
   * Get operation statistics grouped by type.
   */
  getOperationStats(): Record<string, { count: number; avgDurationMs: number; errorCount: number }> {
    const stats: Record<string, { count: number; totalDuration: number; errorCount: number }> = {};

    for (const event of this.events) {
      if (!stats[event.type]) {
        stats[event.type] = { count: 0, totalDuration: 0, errorCount: 0 };
      }
      stats[event.type].count++;
      stats[event.type].totalDuration += event.durationMs;
      if (event.error) stats[event.type].errorCount++;
    }

    const result: Record<string, { count: number; avgDurationMs: number; errorCount: number }> = {};
    for (const [type, data] of Object.entries(stats)) {
      result[type] = {
        count: data.count,
        avgDurationMs: data.count > 0 ? data.totalDuration / data.count : 0,
        errorCount: data.errorCount,
      };
    }
    return result;
  }

  /**
   * Replay events from a snapshot point to a target event index.
   */
  replayFrom(snapshotId: string, toEventIndex?: number): ReplayEvent[] {
    const snapshot = this.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) return [];

    const endIdx = toEventIndex ?? this.events.length;
    return this.events.slice(snapshot.eventIndex, endIdx);
  }

  /**
   * Enable or disable recording.
   */
  setEnabled(enabled: boolean): void {
    (this.config as { enabled: boolean }).enabled = enabled;
  }

  /**
   * Clear all recorded events and snapshots.
   */
  clear(): void {
    this.events.length = 0;
    this.snapshots.length = 0;
    this.eventCounter = 0;
  }

  /**
   * Get total event count.
   */
  get eventCount(): number {
    return this.events.length;
  }

  /**
   * Get total snapshot count.
   */
  get snapshotCount(): number {
    return this.snapshots.length;
  }
}

/**
 * Create a ReplayDebugger instance.
 */
export function createReplayDebugger(config?: ReplayDebuggerConfig): ReplayDebugger {
  return new ReplayDebugger(config);
}
