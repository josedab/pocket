/**
 * Battery-aware sync strategy for React Native.
 *
 * Monitors battery state and dynamically adjusts sync behavior to
 * balance data freshness with power consumption. Automatically reduces
 * sync frequency and batch sizes when battery is low, and disables
 * sync entirely at critical levels.
 *
 * ## Features
 *
 * - **Adaptive Strategy**: Sync parameters adjust to battery level
 * - **Charging Detection**: Full-speed sync while plugged in
 * - **Critical Threshold**: Automatically disables sync to preserve battery
 * - **Reactive Updates**: Observe battery state and strategy via RxJS
 *
 * @module battery-aware-sync
 *
 * @example
 * ```typescript
 * import { createBatteryAwareSync } from '@pocket/react-native';
 *
 * const batterySync = createBatteryAwareSync({
 *   lowBatteryThreshold: 0.20,
 *   disableSyncOnCritical: true,
 * });
 *
 * batterySync.updateBatteryInfo({ level: 0.85, isCharging: false });
 *
 * const strategy = batterySync.getSyncStrategy();
 * console.log('Sync enabled:', strategy.syncEnabled);
 * console.log('Interval:', strategy.intervalMs);
 *
 * batterySync.strategy$.subscribe((s) => {
 *   console.log('Strategy changed:', s.reason);
 * });
 * ```
 */

import { BehaviorSubject, type Observable } from 'rxjs';

// ────────────────────────────── Types ──────────────────────────────

/**
 * Configuration for {@link BatteryAwareSync}.
 */
export interface BatteryAwareSyncConfig {
  /** Battery level at which sync is considered "low" (default: 0.15 / 15%) */
  lowBatteryThreshold?: number;

  /** Battery level at which sync is considered "critical" (default: 0.05 / 5%) */
  criticalBatteryThreshold?: number;

  /** Minimum battery level for full sync operations (default: 0.50 / 50%) */
  fullSyncBatteryThreshold?: number;

  /** Sync interval when battery is low (ms, default: 1800000 / 30 min) */
  reducedSyncIntervalMs?: number;

  /** Sync interval under normal conditions (ms, default: 300000 / 5 min) */
  normalSyncIntervalMs?: number;

  /** Whether to disable sync entirely at critical battery (default: true) */
  disableSyncOnCritical?: boolean;
}

/**
 * Discrete battery state levels.
 */
export type BatteryState = 'charging' | 'full' | 'normal' | 'low' | 'critical';

/**
 * Current battery information.
 */
export interface BatteryInfo {
  /** Battery level from 0.0 (empty) to 1.0 (full) */
  level: number;

  /** Whether the device is currently charging */
  isCharging: boolean;

  /** Computed discrete battery state */
  state: BatteryState;
}

/**
 * Sync strategy derived from the current battery state.
 */
export interface SyncStrategy {
  /** Whether sync is currently allowed */
  syncEnabled: boolean;

  /** Recommended interval between syncs in milliseconds */
  intervalMs: number;

  /** Recommended batch size for sync operations */
  batchSize: number;

  /** Whether a full (non-incremental) sync is allowed */
  fullSyncAllowed: boolean;

  /** Human-readable reason for the current strategy */
  reason: string;
}

// ────────────────────────────── Constants ──────────────────────────────

const DEFAULT_LOW_BATTERY_THRESHOLD = 0.15;
const DEFAULT_CRITICAL_BATTERY_THRESHOLD = 0.05;
const DEFAULT_FULL_SYNC_BATTERY_THRESHOLD = 0.50;
const DEFAULT_REDUCED_SYNC_INTERVAL_MS = 1_800_000; // 30 minutes
const DEFAULT_NORMAL_SYNC_INTERVAL_MS = 300_000;     // 5 minutes
const DEFAULT_MAX_BATCH_SIZE = 100;
const DEFAULT_NORMAL_BATCH_SIZE = 50;
const DEFAULT_LOW_BATCH_SIZE = 10;

// ────────────────────────────── BatteryAwareSync ──────────────────────────────

/**
 * Battery-conscious sync strategy manager.
 *
 * Tracks battery state and computes an optimal sync strategy based on
 * configurable thresholds. Exposes reactive observables so consumers
 * can adapt in real time.
 *
 * @example
 * ```typescript
 * const bas = new BatteryAwareSync({ lowBatteryThreshold: 0.20 });
 *
 * bas.updateBatteryInfo({ level: 0.10, isCharging: false });
 * console.log(bas.shouldSync());       // true (low, not critical)
 * console.log(bas.getSyncStrategy());  // reduced interval, small batch
 *
 * bas.battery$.subscribe((info) => console.log('Battery:', info.state));
 * bas.strategy$.subscribe((s) => console.log('Strategy:', s.reason));
 *
 * bas.destroy();
 * ```
 */
export class BatteryAwareSync {
  private readonly lowBatteryThreshold: number;
  private readonly criticalBatteryThreshold: number;
  private readonly fullSyncBatteryThreshold: number;
  private readonly reducedSyncIntervalMs: number;
  private readonly normalSyncIntervalMs: number;
  private readonly disableSyncOnCritical: boolean;

  private readonly _battery$ = new BehaviorSubject<BatteryInfo>({
    level: 1.0,
    isCharging: false,
    state: 'full',
  });

  private readonly _strategy$ = new BehaviorSubject<SyncStrategy>(
    this.buildStrategy({
      level: 1.0,
      isCharging: false,
      state: 'full',
    })
  );

  constructor(config?: BatteryAwareSyncConfig) {
    this.lowBatteryThreshold = config?.lowBatteryThreshold ?? DEFAULT_LOW_BATTERY_THRESHOLD;
    this.criticalBatteryThreshold = config?.criticalBatteryThreshold ?? DEFAULT_CRITICAL_BATTERY_THRESHOLD;
    this.fullSyncBatteryThreshold = config?.fullSyncBatteryThreshold ?? DEFAULT_FULL_SYNC_BATTERY_THRESHOLD;
    this.reducedSyncIntervalMs = config?.reducedSyncIntervalMs ?? DEFAULT_REDUCED_SYNC_INTERVAL_MS;
    this.normalSyncIntervalMs = config?.normalSyncIntervalMs ?? DEFAULT_NORMAL_SYNC_INTERVAL_MS;
    this.disableSyncOnCritical = config?.disableSyncOnCritical ?? true;
  }

  // ────────────────────────────── Public API ──────────────────────────────

  /**
   * Observable of battery information changes.
   */
  get battery$(): Observable<BatteryInfo> {
    return this._battery$.asObservable();
  }

  /**
   * Observable of sync strategy changes.
   */
  get strategy$(): Observable<SyncStrategy> {
    return this._strategy$.asObservable();
  }

  /**
   * Update the current battery information.
   *
   * Recomputes the discrete battery state and sync strategy.
   *
   * @param info - Current battery info (level and charging status)
   */
  updateBatteryInfo(info: BatteryInfo): void {
    const state = this.computeBatteryState(info.level, info.isCharging);
    const enriched: BatteryInfo = { ...info, state };

    this._battery$.next(enriched);
    this._strategy$.next(this.buildStrategy(enriched));
  }

  /**
   * Get the current battery information.
   */
  getBatteryInfo(): BatteryInfo {
    return this._battery$.value;
  }

  /**
   * Get the current sync strategy based on battery state.
   */
  getSyncStrategy(): SyncStrategy {
    return this._strategy$.value;
  }

  /**
   * Quick check whether sync is currently advisable.
   *
   * @returns `true` if the current strategy allows syncing
   */
  shouldSync(): boolean {
    return this._strategy$.value.syncEnabled;
  }

  /**
   * Get the recommended batch size for the current battery state.
   */
  getRecommendedBatchSize(): number {
    return this._strategy$.value.batchSize;
  }

  /**
   * Destroy the manager, completing all observables.
   */
  destroy(): void {
    this._battery$.complete();
    this._strategy$.complete();
  }

  // ────────────────────────────── Private helpers ──────────────────────────────

  private computeBatteryState(level: number, isCharging: boolean): BatteryState {
    if (isCharging) return 'charging';
    if (level >= this.fullSyncBatteryThreshold) return 'full';
    if (level >= this.lowBatteryThreshold) return 'normal';
    if (level >= this.criticalBatteryThreshold) return 'low';
    return 'critical';
  }

  private buildStrategy(info: BatteryInfo): SyncStrategy {
    switch (info.state) {
      case 'charging':
        return {
          syncEnabled: true,
          intervalMs: this.normalSyncIntervalMs,
          batchSize: DEFAULT_MAX_BATCH_SIZE,
          fullSyncAllowed: true,
          reason: 'Device is charging — full sync allowed',
        };

      case 'full':
        return {
          syncEnabled: true,
          intervalMs: this.normalSyncIntervalMs,
          batchSize: DEFAULT_MAX_BATCH_SIZE,
          fullSyncAllowed: true,
          reason: `Battery above ${this.fullSyncBatteryThreshold * 100}% — full sync allowed`,
        };

      case 'normal':
        return {
          syncEnabled: true,
          intervalMs: this.normalSyncIntervalMs,
          batchSize: DEFAULT_NORMAL_BATCH_SIZE,
          fullSyncAllowed: false,
          reason: `Battery between ${this.lowBatteryThreshold * 100}% and ${this.fullSyncBatteryThreshold * 100}% — normal sync`,
        };

      case 'low':
        return {
          syncEnabled: true,
          intervalMs: this.reducedSyncIntervalMs,
          batchSize: DEFAULT_LOW_BATCH_SIZE,
          fullSyncAllowed: false,
          reason: `Battery between ${this.criticalBatteryThreshold * 100}% and ${this.lowBatteryThreshold * 100}% — reduced sync`,
        };

      case 'critical':
        return {
          syncEnabled: !this.disableSyncOnCritical,
          intervalMs: this.reducedSyncIntervalMs,
          batchSize: DEFAULT_LOW_BATCH_SIZE,
          fullSyncAllowed: false,
          reason: this.disableSyncOnCritical
            ? `Battery below ${this.criticalBatteryThreshold * 100}% — sync disabled`
            : `Battery below ${this.criticalBatteryThreshold * 100}% — minimal sync`,
        };
    }
  }
}

// ────────────────────────────── Factory Function ──────────────────────────────

/**
 * Creates a new {@link BatteryAwareSync} instance.
 *
 * @param config - Optional battery-aware sync configuration
 * @returns A new BatteryAwareSync instance
 *
 * @example
 * ```typescript
 * const batterySync = createBatteryAwareSync({
 *   lowBatteryThreshold: 0.20,
 *   criticalBatteryThreshold: 0.10,
 *   disableSyncOnCritical: true,
 * });
 *
 * batterySync.updateBatteryInfo({ level: 0.75, isCharging: false, state: 'full' });
 * console.log(batterySync.getSyncStrategy());
 * ```
 */
export function createBatteryAwareSync(
  config?: BatteryAwareSyncConfig
): BatteryAwareSync {
  return new BatteryAwareSync(config);
}
