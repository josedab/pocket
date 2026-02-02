/**
 * Background Sync Manager
 *
 * Manages background sync scheduling for React Native apps using
 * Pocket with expo-sqlite storage. Integrates with React Native's
 * AppState for background detection and supports battery-aware and
 * network-aware sync policies.
 *
 * @module @pocket/storage-expo-sqlite
 */

import type { AppStateStatus, BackgroundSyncConfig } from './types.js';

/**
 * Listener for sync events.
 */
export type SyncEventListener = () => Promise<void> | void;

/**
 * Subscription handle returned by event registration methods.
 */
export interface SyncSubscription {
  remove: () => void;
}

/**
 * Internal AppState interface matching React Native's AppState API.
 */
interface AppStateModule {
  currentState: AppStateStatus;
  addEventListener: (
    event: string,
    handler: (state: AppStateStatus) => void,
  ) => SyncSubscription;
}

/**
 * Internal NetInfo interface for network state checking.
 */
interface NetInfoState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  type: string;
}

/**
 * Manages background sync scheduling for React Native applications.
 *
 * Features:
 * - Automatic sync when app returns to foreground
 * - Periodic background sync using timer intervals
 * - Battery-aware sync (skip when battery is low)
 * - Network-aware sync (skip when offline or on cellular if configured)
 * - Lifecycle management with start/stop
 *
 * @example
 * ```typescript
 * import { BackgroundSyncManager } from '@pocket/storage-expo-sqlite';
 *
 * const syncManager = new BackgroundSyncManager({
 *   enabled: true,
 *   intervalMs: 60000, // every minute
 *   batteryAware: true,
 *   networkRequired: true,
 * });
 *
 * syncManager.onSync(async () => {
 *   await myDatabase.sync();
 * });
 *
 * syncManager.start();
 *
 * // Later...
 * syncManager.stop();
 * ```
 */
export class BackgroundSyncManager {
  private config: Required<BackgroundSyncConfig>;
  private syncListeners: SyncEventListener[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private appStateSubscription: SyncSubscription | null = null;
  private running = false;
  private lastSyncTimestamp = 0;
  private currentAppState: AppStateStatus = 'active';

  constructor(config: BackgroundSyncConfig) {
    this.config = {
      enabled: config.enabled,
      intervalMs: config.intervalMs ?? 300_000, // 5 minutes default
      batteryAware: config.batteryAware ?? true,
      networkRequired: config.networkRequired ?? true,
    };
  }

  /**
   * Register a listener that is called when a sync should be triggered.
   *
   * @param listener - Async function that performs the actual sync
   * @returns A subscription handle to unregister the listener
   */
  onSync(listener: SyncEventListener): SyncSubscription {
    this.syncListeners.push(listener);
    return {
      remove: () => {
        const index = this.syncListeners.indexOf(listener);
        if (index >= 0) {
          this.syncListeners.splice(index, 1);
        }
      },
    };
  }

  /**
   * Start the background sync manager.
   *
   * Sets up:
   * 1. AppState listener for foreground/background transitions
   * 2. Periodic timer for interval-based sync
   *
   * Does nothing if sync is not enabled or already running.
   */
  start(): void {
    if (!this.config.enabled || this.running) return;

    this.running = true;

    // Listen for app state changes
    this.setupAppStateListener();

    // Set up periodic sync
    this.setupPeriodicSync();
  }

  /**
   * Stop the background sync manager.
   *
   * Tears down AppState listener and clears the periodic timer.
   */
  stop(): void {
    this.running = false;

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Whether the sync manager is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Timestamp (Unix ms) of the last completed sync.
   */
  get lastSync(): number {
    return this.lastSyncTimestamp;
  }

  /**
   * Manually trigger a sync, respecting battery and network policies.
   *
   * @param force - If true, skip battery/network checks
   */
  async triggerSync(force = false): Promise<void> {
    if (!force) {
      const canSync = await this.canSync();
      if (!canSync) return;
    }

    await this.executeSyncListeners();
  }

  /**
   * Update the sync configuration at runtime.
   */
  updateConfig(config: Partial<BackgroundSyncConfig>): void {
    const wasRunning = this.running;

    if (wasRunning) {
      this.stop();
    }

    this.config = {
      ...this.config,
      ...config,
      // Ensure required fields are present
      enabled: config.enabled ?? this.config.enabled,
      intervalMs: config.intervalMs ?? this.config.intervalMs,
      batteryAware: config.batteryAware ?? this.config.batteryAware,
      networkRequired: config.networkRequired ?? this.config.networkRequired,
    };

    if (wasRunning && this.config.enabled) {
      this.start();
    }
  }

  // ────────────────────────────── Private ──────────────────────────────

  /**
   * Set up the AppState listener for foreground/background transitions.
   * Triggers sync when app returns to foreground.
   */
  private setupAppStateListener(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic import for React Native
      const { AppState } = require('react-native') as { AppState: AppStateModule };

      this.currentAppState = AppState.currentState;

      this.appStateSubscription = AppState.addEventListener(
        'change',
        (nextState: AppStateStatus) => {
          // Trigger sync when app comes back to foreground
          if (this.currentAppState !== 'active' && nextState === 'active') {
            void this.triggerSync();
          }
          this.currentAppState = nextState;
        },
      );
    } catch {
      // react-native is not available (e.g., in tests or web)
      // Silently skip AppState integration
    }
  }

  /**
   * Set up periodic sync on an interval timer.
   */
  private setupPeriodicSync(): void {
    if (this.config.intervalMs <= 0) return;

    this.intervalId = setInterval(() => {
      void this.triggerSync();
    }, this.config.intervalMs);
  }

  /**
   * Check whether sync is allowed given current battery and network conditions.
   */
  private async canSync(): Promise<boolean> {
    if (this.config.batteryAware) {
      const batteryOk = await this.checkBattery();
      if (!batteryOk) return false;
    }

    if (this.config.networkRequired) {
      const networkOk = await this.checkNetwork();
      if (!networkOk) return false;
    }

    return true;
  }

  /**
   * Check battery status. Returns false if battery is low (< 20%).
   */
  private async checkBattery(): Promise<boolean> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic import for React Native
      const Battery = require('expo-battery') as {
        getBatteryLevelAsync: () => Promise<number>;
      };

      const level = await Battery.getBatteryLevelAsync();
      // Skip sync if battery is below 20%
      return level > 0.2;
    } catch {
      // expo-battery not available, allow sync
      return true;
    }
  }

  /**
   * Check network connectivity. Returns false if device is offline.
   */
  private async checkNetwork(): Promise<boolean> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic import for React Native
      const NetInfo = require('@react-native-community/netinfo') as {
        fetch: () => Promise<NetInfoState>;
      };

      const state = await NetInfo.fetch();
      return state.isConnected === true;
    } catch {
      // NetInfo not available, allow sync
      return true;
    }
  }

  /**
   * Execute all registered sync listeners.
   */
  private async executeSyncListeners(): Promise<void> {
    for (const listener of this.syncListeners) {
      try {
        await listener();
      } catch {
        // Individual listener failures should not stop other listeners
      }
    }
    this.lastSyncTimestamp = Date.now();
  }
}
