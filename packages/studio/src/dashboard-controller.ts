/**
 * Studio Dashboard Controller — unified API for building database studio UIs.
 *
 * Aggregates data from DatabaseInspector, SyncInspector, PerformanceProfiler,
 * and QueryPlayground into a single reactive state tree suitable for
 * rendering in a web-based visual dashboard.
 *
 * @module @pocket/studio
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';

// ── Types ─────────────────────────────────────────────────

export interface DashboardPanel {
  readonly id: string;
  readonly title: string;
  readonly type:
    | 'collections'
    | 'documents'
    | 'query'
    | 'sync'
    | 'performance'
    | 'schema'
    | 'custom';
  readonly visible: boolean;
  readonly position: { x: number; y: number; width: number; height: number };
}

export interface DashboardState {
  readonly panels: readonly DashboardPanel[];
  readonly activePanel: string | null;
  readonly theme: 'light' | 'dark' | 'system';
  readonly sidebarOpen: boolean;
  readonly notifications: readonly DashboardNotification[];
  readonly stats: DashboardStats;
}

export interface DashboardNotification {
  readonly id: string;
  readonly type: 'info' | 'warning' | 'error' | 'success';
  readonly title: string;
  readonly message: string;
  readonly timestamp: number;
  readonly dismissed: boolean;
}

export interface DashboardStats {
  readonly totalCollections: number;
  readonly totalDocuments: number;
  readonly syncStatus: 'idle' | 'syncing' | 'error' | 'disconnected';
  readonly syncPendingChanges: number;
  readonly queryCount: number;
  readonly avgQueryMs: number;
  readonly memoryUsageMB: number;
  readonly uptime: number;
}

export interface DashboardConfig {
  /** Refresh interval for stats in ms (default: 5000) */
  readonly refreshIntervalMs?: number;
  /** Default theme (default: 'system') */
  readonly theme?: 'light' | 'dark' | 'system';
  /** Initial panels to show */
  readonly initialPanels?: readonly DashboardPanel[];
}

export interface DashboardCommand {
  readonly type:
    | 'add-panel'
    | 'remove-panel'
    | 'toggle-panel'
    | 'set-active'
    | 'set-theme'
    | 'toggle-sidebar'
    | 'dismiss-notification'
    | 'clear-notifications';
  readonly payload?: unknown;
}

// ── Default Panels ────────────────────────────────────────

const DEFAULT_PANELS: DashboardPanel[] = [
  {
    id: 'collections',
    title: 'Collections',
    type: 'collections',
    visible: true,
    position: { x: 0, y: 0, width: 300, height: 600 },
  },
  {
    id: 'documents',
    title: 'Document Browser',
    type: 'documents',
    visible: true,
    position: { x: 300, y: 0, width: 600, height: 400 },
  },
  {
    id: 'query',
    title: 'Query Playground',
    type: 'query',
    visible: true,
    position: { x: 300, y: 400, width: 600, height: 200 },
  },
  {
    id: 'sync',
    title: 'Sync Inspector',
    type: 'sync',
    visible: false,
    position: { x: 900, y: 0, width: 300, height: 300 },
  },
  {
    id: 'performance',
    title: 'Performance',
    type: 'performance',
    visible: false,
    position: { x: 900, y: 300, width: 300, height: 300 },
  },
  {
    id: 'schema',
    title: 'Schema Designer',
    type: 'schema',
    visible: false,
    position: { x: 0, y: 600, width: 600, height: 300 },
  },
];

// ── DashboardController ───────────────────────────────────

/**
 * DashboardController — manages the entire Studio UI state.
 *
 * Emits a reactive `state$` stream that can drive any rendering framework.
 * Accepts commands to modify the dashboard layout and state.
 *
 * @example
 * ```typescript
 * const dashboard = createDashboardController();
 *
 * dashboard.state$.subscribe(state => renderUI(state));
 *
 * dashboard.dispatch({ type: 'set-active', payload: 'query' });
 * dashboard.dispatch({ type: 'set-theme', payload: 'dark' });
 *
 * dashboard.updateStats({ totalCollections: 5, totalDocuments: 1200 });
 * dashboard.notify('info', 'Connected', 'Database connected successfully');
 *
 * dashboard.destroy();
 * ```
 */
export class DashboardController {
  private readonly stateSubject: BehaviorSubject<DashboardState>;
  private readonly commandSubject: Subject<DashboardCommand>;
  private readonly config: Required<DashboardConfig>;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private notificationCounter = 0;
  private startTime = Date.now();

  constructor(config?: DashboardConfig) {
    this.config = {
      refreshIntervalMs: config?.refreshIntervalMs ?? 5000,
      theme: config?.theme ?? 'system',
      initialPanels: config?.initialPanels ?? DEFAULT_PANELS,
    };

    const initialState: DashboardState = {
      panels: [...this.config.initialPanels],
      activePanel: this.config.initialPanels.find((p) => p.visible)?.id ?? null,
      theme: this.config.theme,
      sidebarOpen: true,
      notifications: [],
      stats: {
        totalCollections: 0,
        totalDocuments: 0,
        syncStatus: 'idle',
        syncPendingChanges: 0,
        queryCount: 0,
        avgQueryMs: 0,
        memoryUsageMB: 0,
        uptime: 0,
      },
    };

    this.stateSubject = new BehaviorSubject(initialState);
    this.commandSubject = new Subject();

    this.startRefreshTimer();
  }

  // ── Observables ──────────────────────────────────────────

  /** Full dashboard state as a reactive stream. */
  get state$(): Observable<DashboardState> {
    return this.stateSubject.asObservable();
  }

  /** Current state snapshot. */
  get state(): DashboardState {
    return this.stateSubject.getValue();
  }

  /** Stream of dispatched commands. */
  get commands$(): Observable<DashboardCommand> {
    return this.commandSubject.asObservable();
  }

  // ── Commands ─────────────────────────────────────────────

  /** Dispatch a command to modify dashboard state. */
  dispatch(command: DashboardCommand): void {
    if (this.destroyed) return;
    this.commandSubject.next(command);
    this.processCommand(command);
  }

  // ── Convenience Methods ──────────────────────────────────

  /** Update dashboard statistics. */
  updateStats(stats: Partial<DashboardStats>): void {
    const current = this.state;
    this.stateSubject.next({
      ...current,
      stats: { ...current.stats, ...stats },
    });
  }

  /** Add a notification. */
  notify(type: DashboardNotification['type'], title: string, message: string): string {
    const id = `notif-${++this.notificationCounter}`;
    const notification: DashboardNotification = {
      id,
      type,
      title,
      message,
      timestamp: Date.now(),
      dismissed: false,
    };
    const current = this.state;
    this.stateSubject.next({
      ...current,
      notifications: [...current.notifications, notification],
    });
    return id;
  }

  /** Get visible panels. */
  getVisiblePanels(): DashboardPanel[] {
    return this.state.panels.filter((p) => p.visible);
  }

  /** Get a panel by ID. */
  getPanel(id: string): DashboardPanel | undefined {
    return this.state.panels.find((p) => p.id === id);
  }

  // ── Lifecycle ────────────────────────────────────────────

  /** Tear down the controller. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.stateSubject.complete();
    this.commandSubject.complete();
  }

  // ── Private ──────────────────────────────────────────────

  private processCommand(command: DashboardCommand): void {
    const current = this.state;

    switch (command.type) {
      case 'add-panel': {
        const panel = command.payload as DashboardPanel;
        this.stateSubject.next({
          ...current,
          panels: [...current.panels, panel],
        });
        break;
      }
      case 'remove-panel': {
        const panelId = command.payload as string;
        this.stateSubject.next({
          ...current,
          panels: current.panels.filter((p) => p.id !== panelId),
          activePanel: current.activePanel === panelId ? null : current.activePanel,
        });
        break;
      }
      case 'toggle-panel': {
        const toggleId = command.payload as string;
        this.stateSubject.next({
          ...current,
          panels: current.panels.map((p) =>
            p.id === toggleId ? { ...p, visible: !p.visible } : p
          ),
        });
        break;
      }
      case 'set-active': {
        const activeId = command.payload as string;
        this.stateSubject.next({
          ...current,
          activePanel: activeId,
        });
        break;
      }
      case 'set-theme': {
        const theme = command.payload as DashboardState['theme'];
        this.stateSubject.next({ ...current, theme });
        break;
      }
      case 'toggle-sidebar': {
        this.stateSubject.next({
          ...current,
          sidebarOpen: !current.sidebarOpen,
        });
        break;
      }
      case 'dismiss-notification': {
        const notifId = command.payload as string;
        this.stateSubject.next({
          ...current,
          notifications: current.notifications.map((n) =>
            n.id === notifId ? { ...n, dismissed: true } : n
          ),
        });
        break;
      }
      case 'clear-notifications': {
        this.stateSubject.next({
          ...current,
          notifications: [],
        });
        break;
      }
    }
  }

  private startRefreshTimer(): void {
    this.refreshTimer = setInterval(() => {
      if (this.destroyed) return;
      this.updateStats({
        uptime: Date.now() - this.startTime,
      });
    }, this.config.refreshIntervalMs);
  }
}

/**
 * Create a new DashboardController.
 */
export function createDashboardController(config?: DashboardConfig): DashboardController {
  return new DashboardController(config);
}
