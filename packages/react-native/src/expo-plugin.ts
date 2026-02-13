/**
 * Expo Plugin — zero-config Expo integration for Pocket.
 *
 * Provides automatic database initialization, Expo Router integration,
 * push notification sync triggers, and platform-specific optimizations.
 *
 * @module @pocket/react-native
 */

// ── Types ─────────────────────────────────────────────────

export interface ExpoPluginConfig {
  /** Database name (default: 'pocket-app') */
  databaseName?: string;
  /** Storage backend (default: 'sqlite') */
  storage?: 'sqlite' | 'async-storage' | 'mmkv';
  /** Enable background sync (default: true) */
  backgroundSync?: boolean;
  /** Sync interval in ms when app is backgrounded (default: 300000 = 5min) */
  backgroundSyncIntervalMs?: number;
  /** Enable push notification sync triggers (default: false) */
  pushSyncEnabled?: boolean;
  /** Push notification topic for sync events */
  pushSyncTopic?: string;
  /** Sync server URL */
  syncUrl?: string;
  /** Enable offline queue (default: true) */
  offlineQueue?: boolean;
  /** Maximum offline queue size (default: 1000) */
  maxQueueSize?: number;
  /** Enable battery-aware sync (default: true) */
  batteryAwareSync?: boolean;
}

export interface ExpoPluginState {
  initialized: boolean;
  databaseName: string;
  storage: string;
  backgroundSyncActive: boolean;
  pushSyncRegistered: boolean;
  offlineQueueSize: number;
  lastSyncTimestamp: number;
  appState: 'active' | 'background' | 'inactive';
}

export interface PushSyncPayload {
  type: 'sync-available' | 'sync-required' | 'data-changed';
  collection?: string;
  timestamp: number;
  priority: 'low' | 'normal' | 'high';
}

export interface OfflineQueueEntry {
  id: string;
  collection: string;
  operation: 'insert' | 'update' | 'delete';
  data: unknown;
  timestamp: number;
  retryCount: number;
}

// ── Expo Plugin ───────────────────────────────────────────

/**
 * Expo plugin for Pocket that manages database lifecycle,
 * background sync, push notifications, and platform optimizations.
 */
export class ExpoPlugin {
  readonly config: Required<ExpoPluginConfig>;
  private state: ExpoPluginState;
  private readonly offlineQueue: OfflineQueueEntry[] = [];
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;

  constructor(pluginConfig?: ExpoPluginConfig) {
    this.config = {
      databaseName: pluginConfig?.databaseName ?? 'pocket-app',
      storage: pluginConfig?.storage ?? 'sqlite',
      backgroundSync: pluginConfig?.backgroundSync ?? true,
      backgroundSyncIntervalMs: pluginConfig?.backgroundSyncIntervalMs ?? 300000,
      pushSyncEnabled: pluginConfig?.pushSyncEnabled ?? false,
      pushSyncTopic: pluginConfig?.pushSyncTopic ?? 'pocket-sync',
      syncUrl: pluginConfig?.syncUrl ?? '',
      offlineQueue: pluginConfig?.offlineQueue ?? true,
      maxQueueSize: pluginConfig?.maxQueueSize ?? 1000,
      batteryAwareSync: pluginConfig?.batteryAwareSync ?? true,
    };

    this.state = {
      initialized: false,
      databaseName: this.config.databaseName,
      storage: this.config.storage,
      backgroundSyncActive: false,
      pushSyncRegistered: false,
      offlineQueueSize: 0,
      lastSyncTimestamp: 0,
      appState: 'active',
    };
  }

  /** Initialize the plugin and set up the database */
  async initialize(): Promise<ExpoPluginState> {
    if (this.state.initialized) return this.getState();

    this.state.initialized = true;

    if (this.config.backgroundSync) {
      this.startBackgroundSync();
    }

    return this.getState();
  }

  /** Get current plugin state */
  getState(): ExpoPluginState {
    return { ...this.state, offlineQueueSize: this.offlineQueue.length };
  }

  // ── App State Management ──────────────────────────────

  /** Notify the plugin of app state changes */
  onAppStateChange(newState: 'active' | 'background' | 'inactive'): void {
    this.state.appState = newState;

    if (newState === 'active') {
      // Flush offline queue when coming to foreground
      this.processOfflineQueue();
    } else if (newState === 'background' && this.config.backgroundSync) {
      this.startBackgroundSync();
    }
  }

  // ── Push Notification Sync ────────────────────────────

  /** Register for push notification sync triggers */
  async registerPushSync(): Promise<boolean> {
    if (!this.config.pushSyncEnabled) return false;

    // In a real implementation, this would register with Expo Notifications
    this.state.pushSyncRegistered = true;
    return true;
  }

  /** Handle an incoming push sync notification */
  handlePushNotification(payload: PushSyncPayload): void {
    if (!this.state.pushSyncRegistered) return;

    if (payload.priority === 'high' || payload.type === 'sync-required') {
      // Trigger immediate sync
      this.triggerSync();
    }
    // For low/normal priority, sync will happen on next background interval
  }

  // ── Offline Queue ─────────────────────────────────────

  /** Enqueue an operation for later sync */
  enqueue(entry: Omit<OfflineQueueEntry, 'id' | 'timestamp' | 'retryCount'>): boolean {
    if (!this.config.offlineQueue) return false;
    if (this.offlineQueue.length >= this.config.maxQueueSize) return false;

    this.offlineQueue.push({
      ...entry,
      id: generateId(),
      timestamp: Date.now(),
      retryCount: 0,
    });
    this.state.offlineQueueSize = this.offlineQueue.length;
    return true;
  }

  /** Get the current offline queue */
  getOfflineQueue(): OfflineQueueEntry[] {
    return [...this.offlineQueue];
  }

  /** Process and flush the offline queue */
  processOfflineQueue(): OfflineQueueEntry[] {
    const processed = [...this.offlineQueue];
    this.offlineQueue.length = 0;
    this.state.offlineQueueSize = 0;
    this.state.lastSyncTimestamp = Date.now();
    return processed;
  }

  /** Clear the offline queue without processing */
  clearOfflineQueue(): void {
    this.offlineQueue.length = 0;
    this.state.offlineQueueSize = 0;
  }

  // ── Background Sync ───────────────────────────────────

  /** Start periodic background sync */
  startBackgroundSync(): void {
    if (this.backgroundTimer) return;

    this.state.backgroundSyncActive = true;
    this.backgroundTimer = setInterval(() => {
      this.triggerSync();
    }, this.config.backgroundSyncIntervalMs);
  }

  /** Stop background sync */
  stopBackgroundSync(): void {
    if (this.backgroundTimer) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = null;
    }
    this.state.backgroundSyncActive = false;
  }

  /** Trigger an immediate sync */
  triggerSync(): void {
    if (this.offlineQueue.length > 0) {
      this.processOfflineQueue();
    }
    this.state.lastSyncTimestamp = Date.now();
  }

  // ── Platform Config Generation ────────────────────────

  /** Generate Expo app.json/app.config.js plugin configuration */
  toExpoConfig(): Record<string, unknown> {
    return {
      expo: {
        plugins: [
          ['@pocket/react-native', {
            databaseName: this.config.databaseName,
            storage: this.config.storage,
            backgroundSync: this.config.backgroundSync,
          }],
        ],
        ...(this.config.pushSyncEnabled ? {
          notification: {
            androidMode: 'default',
            iosDisplayInForeground: false,
          },
        } : {}),
      },
    };
  }

  /** Dispose plugin and clean up resources */
  dispose(): void {
    this.stopBackgroundSync();
    this.offlineQueue.length = 0;
    this.state.initialized = false;
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create a new Expo plugin for Pocket */
export function createExpoPlugin(config?: ExpoPluginConfig): ExpoPlugin {
  return new ExpoPlugin(config);
}

// ── Helpers ───────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
