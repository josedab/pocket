import { Subject } from 'rxjs';

// ── Types ────────────────────────────────────────────────────────────

export interface ConflictEvent {
  id: string;
  collection: string;
  documentId: string;
  localVersion: Record<string, unknown>;
  remoteVersion: Record<string, unknown>;
  strategy: string;
  resolution: 'local-wins' | 'remote-wins' | 'merged' | 'custom';
  timestamp: number;
  resolvedAt?: number;
}

export interface ConflictTimeline {
  events: ConflictEvent[];
  totalConflicts: number;
  resolvedCount: number;
  unresolvedCount: number;
}

export interface DocumentDiff {
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  resolvedValue: unknown;
  changed: boolean;
}

export interface ConflictDetail {
  event: ConflictEvent;
  diffs: DocumentDiff[];
  resolution: 'local-wins' | 'remote-wins' | 'merged' | 'custom';
}

export interface ConflictVisualizerConfig {
  maxEvents?: number;
  retentionMs?: number;
}

export interface TimelineFilter {
  collection?: string;
  since?: number;
  until?: number;
}

// ── Implementation ───────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<ConflictVisualizerConfig> = {
  maxEvents: 1000,
  retentionMs: 24 * 60 * 60 * 1000, // 24 hours
};

export class ConflictVisualizer {
  private readonly config: Required<ConflictVisualizerConfig>;
  private readonly storedEvents: ConflictEvent[] = [];
  private readonly eventsSubject = new Subject<ConflictEvent>();

  readonly events$ = this.eventsSubject.asObservable();

  constructor(config?: ConflictVisualizerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  recordConflict(event: ConflictEvent): void {
    this.pruneExpired();
    if (this.storedEvents.length >= this.config.maxEvents) {
      this.storedEvents.shift();
    }
    this.storedEvents.push(event);
    this.eventsSubject.next(event);
  }

  getTimeline(filter?: TimelineFilter): ConflictTimeline {
    this.pruneExpired();
    let events = this.storedEvents;

    if (filter?.collection) {
      events = events.filter((e) => e.collection === filter.collection);
    }
    if (filter?.since !== undefined) {
      events = events.filter((e) => e.timestamp >= filter.since!);
    }
    if (filter?.until !== undefined) {
      events = events.filter((e) => e.timestamp <= filter.until!);
    }

    const resolvedCount = events.filter((e) => e.resolvedAt !== undefined).length;
    return {
      events,
      totalConflicts: events.length,
      resolvedCount,
      unresolvedCount: events.length - resolvedCount,
    };
  }

  getConflictDetail(eventId: string): ConflictDetail | undefined {
    const event = this.storedEvents.find((e) => e.id === eventId);
    if (!event) return undefined;

    const resolved =
      event.resolution === 'local-wins'
        ? event.localVersion
        : event.resolution === 'remote-wins'
          ? event.remoteVersion
          : { ...event.localVersion, ...event.remoteVersion };

    const diffs = this.diffDocuments(event.localVersion, event.remoteVersion, resolved);
    return { event, diffs, resolution: event.resolution };
  }

  diffDocuments(
    local: Record<string, unknown>,
    remote: Record<string, unknown>,
    resolved: Record<string, unknown>,
  ): DocumentDiff[] {
    const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);
    const diffs: DocumentDiff[] = [];

    for (const field of allKeys) {
      const localValue = local[field];
      const remoteValue = remote[field];
      const resolvedValue = resolved[field];
      diffs.push({
        field,
        localValue,
        remoteValue,
        resolvedValue,
        changed: localValue !== remoteValue,
      });
    }
    return diffs;
  }

  getStats(): {
    total: number;
    byCollection: Record<string, number>;
    byStrategy: Record<string, number>;
    avgResolutionMs: number;
  } {
    this.pruneExpired();

    const byCollection: Record<string, number> = {};
    const byStrategy: Record<string, number> = {};
    let totalResolutionMs = 0;
    let resolvedCount = 0;

    for (const event of this.storedEvents) {
      byCollection[event.collection] = (byCollection[event.collection] ?? 0) + 1;
      byStrategy[event.strategy] = (byStrategy[event.strategy] ?? 0) + 1;
      if (event.resolvedAt !== undefined) {
        totalResolutionMs += event.resolvedAt - event.timestamp;
        resolvedCount++;
      }
    }

    return {
      total: this.storedEvents.length,
      byCollection,
      byStrategy,
      avgResolutionMs: resolvedCount > 0 ? totalResolutionMs / resolvedCount : 0,
    };
  }

  clear(): void {
    this.storedEvents.length = 0;
  }

  dispose(): void {
    this.eventsSubject.complete();
    this.storedEvents.length = 0;
  }

  private pruneExpired(): void {
    const cutoff = Date.now() - this.config.retentionMs;
    while (this.storedEvents.length > 0 && this.storedEvents[0]!.timestamp < cutoff) {
      this.storedEvents.shift();
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export function createConflictVisualizer(config?: ConflictVisualizerConfig): ConflictVisualizer {
  return new ConflictVisualizer(config);
}
