/**
 * Network connectivity manager for cross-platform mobile applications.
 *
 * Monitors network state changes and provides connection-aware sync strategies.
 * Queues operations when offline and replays them on reconnection.
 * Uses RxJS observables for reactive network state updates.
 *
 * @module network-manager
 *
 * @example
 * ```typescript
 * import { createNetworkManager } from '@pocket/mobile';
 *
 * const manager = createNetworkManager({
 *   strategies: {
 *     wifi: { enabled: true, batchSize: 100, intervalMs: 30_000 },
 *     cellular: { enabled: true, batchSize: 25, intervalMs: 120_000 },
 *     offline: { enabled: false, batchSize: 0, intervalMs: 0 },
 *   },
 * });
 *
 * manager.state$.subscribe((state) => {
 *   console.log('Network:', state.status, state.connectionType);
 * });
 *
 * // Clean up
 * manager.destroy();
 * ```
 */

import { BehaviorSubject, type Observable } from 'rxjs';

import type {
  NetworkState,
  NetworkStatus,
  ConnectionType,
  NetworkSyncStrategies,
  SyncStrategy,
} from './types.js';

// ────────────────────────────── Types ──────────────────────────────

/**
 * Configuration for {@link NetworkManager}.
 */
export interface NetworkManagerConfig {
  /** Sync strategies per connection type */
  strategies?: NetworkSyncStrategies;

  /** Initial connection type (default: 'unknown') */
  initialConnectionType?: ConnectionType;

  /** Initial online status (default: true) */
  initialOnline?: boolean;
}

// ────────────────────────────── Constants ──────────────────────────────

const DEFAULT_STRATEGIES: NetworkSyncStrategies = {
  wifi: { enabled: true, batchSize: 100, intervalMs: 30_000 },
  cellular: { enabled: true, batchSize: 25, intervalMs: 120_000 },
  offline: { enabled: false, batchSize: 0, intervalMs: 0 },
};

// ────────────────────────────── NetworkManager ──────────────────────────────

/**
 * Monitors network connectivity and provides connection-aware sync strategies.
 *
 * Tracks online/offline/metered state, exposes reactive updates via RxJS,
 * and allows queuing operations when the device is offline.
 *
 * @example
 * ```typescript
 * const manager = new NetworkManager();
 *
 * manager.state$.subscribe((state) => {
 *   console.log('Status:', state.status);
 * });
 *
 * // Simulate going offline
 * manager.updateConnectionType('none');
 *
 * // Check current strategy
 * const strategy = manager.getCurrentStrategy();
 * console.log('Sync enabled:', strategy.enabled);
 * ```
 */
export class NetworkManager {
  private readonly strategies: NetworkSyncStrategies;
  private readonly _state$: BehaviorSubject<NetworkState>;
  private readonly _pendingOperations: (() => Promise<void>)[] = [];

  constructor(config?: NetworkManagerConfig) {
    this.strategies = config?.strategies ?? DEFAULT_STRATEGIES;

    const connectionType = config?.initialConnectionType ?? 'unknown';
    const isOnline = config?.initialOnline ?? true;
    const isMetered = connectionType === 'cellular';

    this._state$ = new BehaviorSubject<NetworkState>({
      status: isOnline ? (isMetered ? 'metered' : 'online') : 'offline',
      connectionType,
      isMetered,
      lastChanged: Date.now(),
    });
  }

  // ────────────────────────────── Public API ──────────────────────────────

  /**
   * Observable of network state changes.
   */
  get state$(): Observable<NetworkState> {
    return this._state$.asObservable();
  }

  /**
   * Current network state snapshot.
   */
  getState(): NetworkState {
    return this._state$.value;
  }

  /**
   * Whether the device is currently online (wifi or cellular).
   */
  isOnline(): boolean {
    return this._state$.value.status !== 'offline';
  }

  /**
   * Whether the current connection is metered.
   */
  isMetered(): boolean {
    return this._state$.value.isMetered;
  }

  /**
   * Update the connection type and recalculate network state.
   *
   * @param connectionType - The new connection type
   */
  updateConnectionType(connectionType: ConnectionType): void {
    const isMetered = connectionType === 'cellular';
    let status: NetworkStatus;

    if (connectionType === 'none') {
      status = 'offline';
    } else if (isMetered) {
      status = 'metered';
    } else {
      status = 'online';
    }

    this._state$.next({
      status,
      connectionType,
      isMetered,
      lastChanged: Date.now(),
    });

    // Replay pending operations if we're back online
    if (status !== 'offline' && this._pendingOperations.length > 0) {
      void this.replayPendingOperations();
    }
  }

  /**
   * Update the online/offline status directly.
   *
   * @param online - Whether the device is online
   */
  setOnline(online: boolean): void {
    const current = this._state$.value;

    if (online && current.status === 'offline') {
      this.updateConnectionType(current.connectionType === 'none' ? 'unknown' : current.connectionType);
    } else if (!online) {
      this._state$.next({
        status: 'offline',
        connectionType: 'none',
        isMetered: false,
        lastChanged: Date.now(),
      });
    }
  }

  /**
   * Get the sync strategy for the current connection type.
   *
   * @returns The active sync strategy
   */
  getCurrentStrategy(): SyncStrategy {
    return this.getStrategyForConnection(this._state$.value.connectionType);
  }

  /**
   * Get the sync strategy for a specific connection type.
   *
   * @param connectionType - The connection type to get a strategy for
   * @returns The matching sync strategy
   */
  getStrategyForConnection(connectionType: ConnectionType): SyncStrategy {
    switch (connectionType) {
      case 'wifi':
        return this.strategies.wifi;
      case 'cellular':
        return this.strategies.cellular;
      case 'none':
      case 'unknown':
        return this.strategies.offline;
    }
  }

  /**
   * Queue an operation to be executed when the device is back online.
   *
   * @param operation - Async operation to queue
   */
  queueOperation(operation: () => Promise<void>): void {
    this._pendingOperations.push(operation);
  }

  /**
   * Number of operations waiting in the offline queue.
   */
  getPendingOperationCount(): number {
    return this._pendingOperations.length;
  }

  /**
   * Destroy the manager and release resources.
   */
  destroy(): void {
    this._pendingOperations.length = 0;
    this._state$.complete();
  }

  // ────────────────────────────── Private helpers ──────────────────────────────

  private async replayPendingOperations(): Promise<void> {
    const operations = this._pendingOperations.splice(0);

    for (const operation of operations) {
      try {
        await operation();
      } catch {
        // Re-queue failed operations
        this._pendingOperations.push(operation);
      }
    }
  }
}

// ────────────────────────────── Factory Function ──────────────────────────────

/**
 * Creates a new {@link NetworkManager} instance.
 *
 * @param config - Optional network manager configuration
 * @returns A new NetworkManager
 *
 * @example
 * ```typescript
 * const manager = createNetworkManager({
 *   initialConnectionType: 'wifi',
 *   strategies: {
 *     wifi: { enabled: true, batchSize: 100, intervalMs: 30_000 },
 *     cellular: { enabled: true, batchSize: 25, intervalMs: 120_000 },
 *     offline: { enabled: false, batchSize: 0, intervalMs: 0 },
 *   },
 * });
 *
 * manager.state$.subscribe(console.log);
 * ```
 */
export function createNetworkManager(config?: NetworkManagerConfig): NetworkManager {
  return new NetworkManager(config);
}
