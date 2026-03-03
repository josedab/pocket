/**
 * Pocket Studio Desktop — Tauri Application Shell
 *
 * Provides the desktop application layer for Pocket Studio including:
 * - Database file picker and connection management
 * - Query playground with explain plans
 * - Document editor with real-time updates
 * - Sync dashboard with conflict viewer
 * - Performance profiler
 *
 * @module @pocket/tauri/studio
 */

import type { Observable } from 'rxjs';
import { BehaviorSubject, Subject } from 'rxjs';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Configuration for the Studio desktop app. */
export interface StudioDesktopConfig {
  /** Window title. */
  readonly title?: string;
  /** Default database file path. */
  readonly defaultDbPath?: string;
  /** Recent database paths for quick access. */
  readonly recentDatabases?: readonly string[];
  /** Enable performance profiling. */
  readonly profiling?: boolean;
  /** Theme preference. */
  readonly theme?: 'light' | 'dark' | 'system';
}

/** Represents a connected database. */
export interface DatabaseConnection {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly collections: readonly string[];
  readonly connectedAt: number;
}

/** Query execution result with explain plan. */
export interface QueryResult {
  readonly id: string;
  readonly query: string;
  readonly collection: string;
  readonly documents: readonly Record<string, unknown>[];
  readonly count: number;
  readonly executionTimeMs: number;
  readonly explainPlan: ExplainPlan | null;
  readonly timestamp: number;
}

/** Query explain plan for performance analysis. */
export interface ExplainPlan {
  readonly strategy: 'full-scan' | 'index-scan' | 'primary-key';
  readonly indexUsed: string | null;
  readonly estimatedCost: number;
  readonly documentsScanned: number;
  readonly documentsReturned: number;
}

/** Sync status for the dashboard. */
export interface SyncDashboardState {
  readonly isConnected: boolean;
  readonly lastSyncAt: number | null;
  readonly pendingChanges: number;
  readonly conflicts: readonly SyncConflict[];
  readonly syncHistory: readonly SyncEvent[];
}

/** Sync conflict record. */
export interface SyncConflict {
  readonly id: string;
  readonly collection: string;
  readonly documentId: string;
  readonly localVersion: Record<string, unknown>;
  readonly remoteVersion: Record<string, unknown>;
  readonly detectedAt: number;
  readonly resolution: 'pending' | 'local-wins' | 'remote-wins' | 'merged' | 'manual';
}

/** A sync event for the history timeline. */
export interface SyncEvent {
  readonly type: 'push' | 'pull' | 'conflict' | 'error';
  readonly timestamp: number;
  readonly changes: number;
  readonly details: string;
}

/** Performance profiler snapshot. */
export interface ProfilerSnapshot {
  readonly queryCount: number;
  readonly avgQueryTimeMs: number;
  readonly slowQueries: readonly { query: string; timeMs: number }[];
  readonly cacheHitRate: number;
  readonly memoryUsageMB: number;
  readonly collectionsStats: readonly {
    name: string;
    documentCount: number;
    sizeBytes: number;
    indexCount: number;
  }[];
}

/** Studio desktop app state. */
export interface StudioDesktopState {
  readonly connection: DatabaseConnection | null;
  readonly recentDatabases: readonly string[];
  readonly queryHistory: readonly QueryResult[];
  readonly syncDashboard: SyncDashboardState;
  readonly profiler: ProfilerSnapshot | null;
  readonly theme: 'light' | 'dark' | 'system';
}

// ─── Studio Desktop App ───────────────────────────────────────────────────────

export class StudioDesktopApp {
  private readonly stateSubject: BehaviorSubject<StudioDesktopState>;
  private readonly eventSubject = new Subject<{ type: string; payload: unknown }>();
  private queryHistory: QueryResult[] = [];
  private queryCounter = 0;

  constructor(config?: StudioDesktopConfig) {
    this.stateSubject = new BehaviorSubject<StudioDesktopState>({
      connection: null,
      recentDatabases: config?.recentDatabases ? [...config.recentDatabases] : [],
      queryHistory: [],
      syncDashboard: {
        isConnected: false,
        lastSyncAt: null,
        pendingChanges: 0,
        conflicts: [],
        syncHistory: [],
      },
      profiler: null,
      theme: config?.theme ?? 'system',
    });
  }

  /** Observable of app state. */
  get state$(): Observable<StudioDesktopState> {
    return this.stateSubject.asObservable();
  }

  /** Current state snapshot. */
  get state(): StudioDesktopState {
    return this.stateSubject.getValue();
  }

  /** Observable of app events (for Tauri IPC bridging). */
  get events$(): Observable<{ type: string; payload: unknown }> {
    return this.eventSubject.asObservable();
  }

  private updateState(partial: Partial<StudioDesktopState>): void {
    this.stateSubject.next({ ...this.stateSubject.getValue(), ...partial });
  }

  /**
   * Open a database file. In Tauri, this triggers the native file dialog.
   * The `opener` callback abstracts the Tauri file dialog API.
   */
  async openDatabase(
    opener: () => Promise<{ path: string; name: string; sizeBytes: number; collections: string[] }>
  ): Promise<DatabaseConnection> {
    const dbInfo = await opener();
    const connection: DatabaseConnection = {
      id: `db-${Date.now().toString(36)}`,
      path: dbInfo.path,
      name: dbInfo.name,
      sizeBytes: dbInfo.sizeBytes,
      collections: dbInfo.collections,
      connectedAt: Date.now(),
    };

    const current = this.stateSubject.getValue();
    const recent = [dbInfo.path, ...current.recentDatabases.filter((p) => p !== dbInfo.path)].slice(
      0,
      10
    );

    this.updateState({ connection, recentDatabases: recent });
    this.eventSubject.next({ type: 'database:opened', payload: connection });

    return connection;
  }

  /** Disconnect from the current database. */
  closeDatabase(): void {
    this.updateState({ connection: null });
    this.queryHistory = [];
    this.eventSubject.next({ type: 'database:closed', payload: null });
  }

  /**
   * Execute a query in the playground.
   * The `executor` callback abstracts the actual database query execution.
   */
  async executeQuery(
    collection: string,
    query: string,
    executor: (
      collection: string,
      query: string
    ) => Promise<{
      documents: Record<string, unknown>[];
      executionTimeMs: number;
      explain?: ExplainPlan;
    }>
  ): Promise<QueryResult> {
    const result = await executor(collection, query);

    const queryResult: QueryResult = {
      id: `q-${++this.queryCounter}`,
      query,
      collection,
      documents: result.documents,
      count: result.documents.length,
      executionTimeMs: result.executionTimeMs,
      explainPlan: result.explain ?? null,
      timestamp: Date.now(),
    };

    this.queryHistory.push(queryResult);
    if (this.queryHistory.length > 100) {
      this.queryHistory.shift();
    }

    this.updateState({ queryHistory: [...this.queryHistory] });
    return queryResult;
  }

  /** Resolve a sync conflict. */
  resolveConflict(conflictId: string, resolution: SyncConflict['resolution']): void {
    const current = this.stateSubject.getValue();
    const conflicts = current.syncDashboard.conflicts.map((c) =>
      c.id === conflictId ? { ...c, resolution } : c
    );

    this.updateState({
      syncDashboard: { ...current.syncDashboard, conflicts },
    });

    this.eventSubject.next({
      type: 'sync:conflict-resolved',
      payload: { conflictId, resolution },
    });
  }

  /** Update sync dashboard state (called by sync engine observers). */
  updateSyncState(partial: Partial<SyncDashboardState>): void {
    const current = this.stateSubject.getValue();
    this.updateState({
      syncDashboard: { ...current.syncDashboard, ...partial },
    });
  }

  /** Update profiler snapshot. */
  updateProfiler(snapshot: ProfilerSnapshot): void {
    this.updateState({ profiler: snapshot });
  }

  /** Change theme. */
  setTheme(theme: 'light' | 'dark' | 'system'): void {
    this.updateState({ theme });
    this.eventSubject.next({ type: 'theme:changed', payload: theme });
  }

  /** Clean up resources. */
  destroy(): void {
    this.stateSubject.complete();
    this.eventSubject.complete();
  }
}

/** Create a Studio Desktop App instance. */
export function createStudioDesktop(config?: StudioDesktopConfig): StudioDesktopApp {
  return new StudioDesktopApp(config);
}
