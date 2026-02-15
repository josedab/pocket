/**
 * SyncVisualizer — real-time sync status visualization data model.
 *
 * Tracks sync events, active connections, and overall sync health
 * to drive visual dashboards and monitoring UIs.
 *
 * @module @pocket/studio
 */

import { BehaviorSubject, type Observable } from 'rxjs';

// ── Types ─────────────────────────────────────────────────

export interface SyncEventData {
  readonly type: 'push' | 'pull' | 'conflict' | 'error';
  readonly collection: string;
  readonly documentCount: number;
  readonly durationMs: number;
  readonly success: boolean;
  readonly timestamp?: number;
}

export interface SyncTimelineEntry {
  readonly id: string;
  readonly type: SyncEventData['type'];
  readonly collection: string;
  readonly documentCount: number;
  readonly durationMs: number;
  readonly success: boolean;
  readonly timestamp: number;
}

export interface ConnectionInfo {
  readonly id: string;
  readonly type: 'websocket' | 'http' | 'webrtc';
  readonly status: 'connected' | 'connecting' | 'disconnected';
  readonly latencyMs: number;
  readonly lastActivity: number;
}

export interface SyncHealthStatus {
  readonly status: 'healthy' | 'degraded' | 'offline';
  readonly successRate: number;
  readonly avgLatencyMs: number;
  readonly lastSyncAt: number | null;
  readonly pendingChanges: number;
}

export interface SyncVisualizerConfig {
  /** Maximum timeline entries to retain (default: 1000) */
  readonly maxHistory?: number;
}

// ── SyncVisualizer ────────────────────────────────────────

export class SyncVisualizer {
  private readonly config: Required<SyncVisualizerConfig>;
  private readonly timelineSubject: BehaviorSubject<SyncTimelineEntry[]>;
  private readonly healthSubject: BehaviorSubject<SyncHealthStatus>;
  private readonly entries: SyncTimelineEntry[] = [];
  private readonly connections = new Map<string, ConnectionInfo>();
  private entryCounter = 0;
  private destroyed = false;
  private pendingChanges = 0;

  constructor(config: SyncVisualizerConfig = {}) {
    this.config = {
      maxHistory: config.maxHistory ?? 1000,
    };

    this.timelineSubject = new BehaviorSubject<SyncTimelineEntry[]>([]);
    this.healthSubject = new BehaviorSubject<SyncHealthStatus>({
      status: 'offline',
      successRate: 0,
      avgLatencyMs: 0,
      lastSyncAt: null,
      pendingChanges: 0,
    });
  }

  // ── Observables ──────────────────────────────────────────

  get timeline$(): Observable<SyncTimelineEntry[]> {
    return this.timelineSubject.asObservable();
  }

  get health$(): Observable<SyncHealthStatus> {
    return this.healthSubject.asObservable();
  }

  // ── Public API ───────────────────────────────────────────

  /** Record a sync event and update health metrics. */
  recordSyncEvent(event: SyncEventData): void {
    if (this.destroyed) return;

    const entry: SyncTimelineEntry = {
      id: `sync-${++this.entryCounter}`,
      type: event.type,
      collection: event.collection,
      documentCount: event.documentCount,
      durationMs: event.durationMs,
      success: event.success,
      timestamp: event.timestamp ?? Date.now(),
    };

    this.entries.push(entry);

    // Trim to maxHistory
    while (this.entries.length > this.config.maxHistory) {
      this.entries.shift();
    }

    this.timelineSubject.next([...this.entries]);
    this.recalculateHealth();
  }

  /** Get the current timeline entries. */
  getTimeline(): SyncTimelineEntry[] {
    return [...this.entries];
  }

  /** Get active connections. */
  getActiveConnections(): ConnectionInfo[] {
    return [...this.connections.values()];
  }

  /** Get current sync health status. */
  getSyncHealth(): SyncHealthStatus {
    return this.healthSubject.getValue();
  }

  /** Register or update a connection. */
  addConnection(connection: ConnectionInfo): void {
    if (this.destroyed) return;
    this.connections.set(connection.id, connection);
    this.recalculateHealth();
  }

  /** Remove a connection. */
  removeConnection(id: string): void {
    this.connections.delete(id);
    this.recalculateHealth();
  }

  /** Set the number of pending changes. */
  setPendingChanges(count: number): void {
    this.pendingChanges = count;
    this.recalculateHealth();
  }

  /** Reset all state. */
  reset(): void {
    this.entries.length = 0;
    this.connections.clear();
    this.entryCounter = 0;
    this.pendingChanges = 0;
    this.timelineSubject.next([]);
    this.healthSubject.next({
      status: 'offline',
      successRate: 0,
      avgLatencyMs: 0,
      lastSyncAt: null,
      pendingChanges: 0,
    });
  }

  /** Destroy the visualizer and release resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.timelineSubject.complete();
    this.healthSubject.complete();
  }

  // ── Private ──────────────────────────────────────────────

  private recalculateHealth(): void {
    if (this.destroyed) return;

    const total = this.entries.length;
    const successful = this.entries.filter((e) => e.success).length;
    const successRate = total > 0 ? successful / total : 0;

    const durations = this.entries.map((e) => e.durationMs);
    const avgLatencyMs =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const lastEntry = this.entries.length > 0 ? this.entries[this.entries.length - 1] : undefined;
    const lastSyncAt = lastEntry?.timestamp ?? null;

    const connectedCount = [...this.connections.values()].filter(
      (c) => c.status === 'connected'
    ).length;

    let status: SyncHealthStatus['status'];
    if (connectedCount === 0 && this.connections.size === 0 && total === 0) {
      status = 'offline';
    } else if (connectedCount === 0 && this.connections.size > 0) {
      status = 'offline';
    } else if (successRate < 0.5 || connectedCount < this.connections.size) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    this.healthSubject.next({
      status,
      successRate: Math.round(successRate * 10000) / 10000,
      avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
      lastSyncAt,
      pendingChanges: this.pendingChanges,
    });
  }
}

/**
 * Create a new SyncVisualizer instance.
 */
export function createSyncVisualizer(config?: SyncVisualizerConfig): SyncVisualizer {
  return new SyncVisualizer(config);
}
