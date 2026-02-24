/**
 * DevToolsPanel — Chrome DevTools panel bridge for Pocket database inspection.
 *
 * Aggregates database state (collections, documents, queries, sync status,
 * performance metrics) into a serializable format suitable for rendering
 * in a Chrome DevTools panel or standalone inspector UI.
 *
 * @example
 * ```typescript
 * import { DevToolsPanel } from '@pocket/studio';
 *
 * const panel = new DevToolsPanel();
 * panel.connectDatabase(db);
 *
 * // Get full snapshot for rendering
 * const snapshot = await panel.getSnapshot();
 * console.log(snapshot.collections, snapshot.metrics);
 *
 * // Subscribe to live updates
 * panel.updates$.subscribe(update => renderUpdate(update));
 *
 * // Execute inspector commands
 * const result = await panel.executeCommand({
 *   type: 'query',
 *   collection: 'todos',
 *   filter: { completed: false },
 * });
 * ```
 */

import { Subject, type Observable } from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export interface PanelConfig {
  /** Max change events to buffer (default: 500) */
  maxEventBuffer?: number;
  /** Snapshot refresh interval in ms (default: 2000) */
  refreshIntervalMs?: number;
}

export interface PanelSnapshot {
  /** Database name */
  databaseName: string;
  /** All collections with metadata */
  collections: PanelCollectionInfo[];
  /** Performance metrics */
  metrics: PanelMetrics;
  /** Recent change events */
  recentChanges: PanelChangeEvent[];
  /** Timestamp of snapshot */
  timestamp: number;
}

export interface PanelCollectionInfo {
  name: string;
  documentCount: number;
  indexes: string[];
  lastModified: number | null;
  sizeEstimateBytes: number;
}

export interface PanelMetrics {
  totalQueries: number;
  totalWrites: number;
  avgQueryTimeMs: number;
  cacheHitRate: number;
  activeSubscriptions: number;
  uptime: number;
}

export interface PanelChangeEvent {
  id: string;
  collection: string;
  operation: 'insert' | 'update' | 'delete';
  documentId: string;
  timestamp: number;
}

export type PanelCommand =
  | { type: 'query'; collection: string; filter?: Record<string, unknown>; limit?: number }
  | { type: 'get-document'; collection: string; documentId: string }
  | { type: 'list-collections' }
  | { type: 'get-metrics' }
  | { type: 'clear-events' };

export interface PanelCommandResult {
  command: PanelCommand;
  success: boolean;
  data: unknown;
  executionTimeMs: number;
}

export type PanelUpdate =
  | { type: 'change'; event: PanelChangeEvent }
  | { type: 'metrics'; metrics: PanelMetrics }
  | { type: 'snapshot'; snapshot: PanelSnapshot };

/** Minimal database interface for devtools. */
export interface InspectableDatabase {
  name: string;
  listCollections(): Promise<string[]>;
  collection(name: string): {
    find(filter?: Record<string, unknown>): { exec(): Promise<Record<string, unknown>[]> };
    count?(): Promise<number>;
    get?(id: string): Promise<Record<string, unknown> | null>;
  };
}

// ── Implementation ────────────────────────────────────────

export class DevToolsPanel {
  private readonly config: Required<PanelConfig>;
  private readonly updatesSubject = new Subject<PanelUpdate>();
  private readonly eventBuffer: PanelChangeEvent[] = [];

  private database: InspectableDatabase | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();
  private totalQueries = 0;
  private totalWrites = 0;
  private queryTimes: number[] = [];
  private changeCounter = 0;
  private destroyed = false;

  /** Observable of live updates for the panel UI. */
  readonly updates$: Observable<PanelUpdate> = this.updatesSubject.asObservable();

  constructor(config: PanelConfig = {}) {
    this.config = {
      maxEventBuffer: config.maxEventBuffer ?? 500,
      refreshIntervalMs: config.refreshIntervalMs ?? 2000,
    };
  }

  /**
   * Connect a database for inspection.
   */
  connectDatabase(database: InspectableDatabase): void {
    if (this.destroyed) throw new Error('DevToolsPanel has been destroyed');
    this.database = database;
    this.startRefreshLoop();
  }

  /**
   * Get a full snapshot of the database state.
   */
  async getSnapshot(): Promise<PanelSnapshot> {
    if (!this.database) {
      return {
        databaseName: '',
        collections: [],
        metrics: this.buildMetrics(),
        recentChanges: [...this.eventBuffer],
        timestamp: Date.now(),
      };
    }

    const collectionNames = await this.database.listCollections();
    const collections: PanelCollectionInfo[] = [];

    for (const name of collectionNames) {
      const col = this.database.collection(name);
      let count = 0;
      try {
        if (col.count) {
          count = await col.count();
        } else {
          const docs = await col.find().exec();
          count = docs.length;
        }
      } catch {
        // Count may fail for some adapters
      }

      collections.push({
        name,
        documentCount: count,
        indexes: [],
        lastModified: null,
        sizeEstimateBytes: count * 256, // rough estimate
      });
    }

    return {
      databaseName: this.database.name,
      collections,
      metrics: this.buildMetrics(),
      recentChanges: [...this.eventBuffer].slice(-50),
      timestamp: Date.now(),
    };
  }

  /**
   * Execute an inspector command.
   */
  async executeCommand(command: PanelCommand): Promise<PanelCommandResult> {
    const start = performance.now();

    try {
      const data = await this.processCommand(command);
      const executionTimeMs = performance.now() - start;

      if (command.type === 'query') {
        this.totalQueries++;
        this.queryTimes.push(executionTimeMs);
        if (this.queryTimes.length > 100) this.queryTimes.shift();
      }

      return { command, success: true, data, executionTimeMs };
    } catch (error) {
      return {
        command,
        success: false,
        data: error instanceof Error ? error.message : String(error),
        executionTimeMs: performance.now() - start,
      };
    }
  }

  /**
   * Record a change event (called by database hooks).
   */
  recordChange(
    collection: string,
    operation: 'insert' | 'update' | 'delete',
    documentId: string
  ): void {
    if (this.destroyed) return;

    if (operation !== 'insert' && operation !== 'update' && operation !== 'delete') return;

    const event: PanelChangeEvent = {
      id: `change_${++this.changeCounter}`,
      collection,
      operation,
      documentId,
      timestamp: Date.now(),
    };

    this.eventBuffer.push(event);
    if (this.eventBuffer.length > this.config.maxEventBuffer) {
      this.eventBuffer.shift();
    }

    if (operation === 'insert' || operation === 'update' || operation === 'delete') {
      this.totalWrites++;
    }

    this.updatesSubject.next({ type: 'change', event });
  }

  /**
   * Destroy the panel and release resources.
   */
  destroy(): void {
    this.destroyed = true;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.updatesSubject.complete();
    this.eventBuffer.length = 0;
    this.database = null;
  }

  // ── Private ────────────────────────────────────────────

  private async processCommand(command: PanelCommand): Promise<unknown> {
    switch (command.type) {
      case 'list-collections':
        return this.database ? await this.database.listCollections() : [];

      case 'query': {
        if (!this.database) return [];
        const col = this.database.collection(command.collection);
        const docs = await col.find(command.filter).exec();
        return command.limit ? docs.slice(0, command.limit) : docs;
      }

      case 'get-document': {
        if (!this.database) return null;
        const col = this.database.collection(command.collection);
        if (col.get) return await col.get(command.documentId);
        const all = await col.find({ _id: command.documentId }).exec();
        return all[0] ?? null;
      }

      case 'get-metrics':
        return this.buildMetrics();

      case 'clear-events':
        this.eventBuffer.length = 0;
        return { cleared: true };

      default:
        throw new Error(`Unknown command type: ${(command as PanelCommand).type}`);
    }
  }

  private buildMetrics(): PanelMetrics {
    return {
      totalQueries: this.totalQueries,
      totalWrites: this.totalWrites,
      avgQueryTimeMs:
        this.queryTimes.length > 0
          ? this.queryTimes.reduce((a, b) => a + b, 0) / this.queryTimes.length
          : 0,
      cacheHitRate: 0,
      activeSubscriptions: 0,
      uptime: Date.now() - this.startTime,
    };
  }

  private startRefreshLoop(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      if (this.destroyed) return;
      this.updatesSubject.next({ type: 'metrics', metrics: this.buildMetrics() });
    }, this.config.refreshIntervalMs);
  }
}

/**
 * Create a DevToolsPanel instance.
 */
export function createDevToolsPanel(config?: PanelConfig): DevToolsPanel {
  return new DevToolsPanel(config);
}
