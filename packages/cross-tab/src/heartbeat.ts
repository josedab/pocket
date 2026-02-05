/**
 * HeartbeatMonitor - Periodic heartbeat monitoring for leader liveness.
 *
 * Sends periodic heartbeat signals to verify the leader tab is alive,
 * and detects when heartbeats are missed to trigger leader-lost events.
 *
 * @packageDocumentation
 * @module @pocket/cross-tab/heartbeat
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

/** Heartbeat status */
export type HeartbeatStatus = 'healthy' | 'degraded' | 'leader-lost';

/** Heartbeat message sent via BroadcastChannel */
export interface HeartbeatMessage {
  type: 'heartbeat';
  timestamp: number;
}

/** Configuration for the heartbeat monitor */
export interface HeartbeatMonitorConfig {
  /** Interval between heartbeats in ms. @default 2000 */
  heartbeatIntervalMs?: number;
  /** Number of missed heartbeats before declaring leader lost. @default 3 */
  missedHeartbeatsThreshold?: number;
  /** BroadcastChannel name. @default 'pocket-heartbeat' */
  channelName?: string;
  /** Enable debug logging. @default false */
  debug?: boolean;
}

/**
 * Monitors leader liveness via periodic heartbeat signals.
 *
 * @example
 * ```typescript
 * import { createHeartbeatMonitor } from '@pocket/cross-tab';
 *
 * const monitor = createHeartbeatMonitor();
 * monitor.onLeaderLost(() => console.log('Leader lost!'));
 * monitor.onLeaderRecovered(() => console.log('Leader recovered!'));
 * monitor.start(false); // start as follower
 * ```
 */
export class HeartbeatMonitor {
  private readonly config: Required<HeartbeatMonitorConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly status$$ = new BehaviorSubject<HeartbeatStatus>('healthy');
  private readonly leaderLostCallbacks = new Set<() => void>();
  private readonly leaderRecoveredCallbacks = new Set<() => void>();
  private channel: BroadcastChannel | null = null;
  private sendTimer: ReturnType<typeof setInterval> | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAt = 0;
  private missedCount = 0;
  private isRunning = false;
  private isLeaderMode = false;
  private destroyed = false;
  private hasBroadcastChannel: boolean;

  constructor(config: HeartbeatMonitorConfig = {}) {
    this.config = {
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 2000,
      missedHeartbeatsThreshold: config.missedHeartbeatsThreshold ?? 3,
      channelName: config.channelName ?? 'pocket-heartbeat',
      debug: config.debug ?? false,
    };

    this.hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';
  }

  /**
   * Start heartbeat sending (if leader) or monitoring (if follower).
   *
   * @param isLeader - Whether this instance is the leader
   */
  start(isLeader: boolean): void {
    if (this.destroyed || this.isRunning) return;

    this.isRunning = true;
    this.isLeaderMode = isLeader;
    this.missedCount = 0;
    this.lastHeartbeatAt = Date.now();
    this.status$$.next('healthy');

    if (this.hasBroadcastChannel) {
      this.channel = new BroadcastChannel(this.config.channelName);
    }

    if (isLeader) {
      this.startSending();
    } else {
      this.startMonitoring();
    }

    this.log('Started as', isLeader ? 'leader' : 'follower');
  }

  /**
   * Stop heartbeat sending or monitoring.
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = null;
    }

    this.log('Stopped');
  }

  /**
   * Register a callback for when the leader is detected as lost.
   *
   * @param callback - Function to call when leader heartbeats are missed
   * @returns Unsubscribe function
   */
  onLeaderLost(callback: () => void): () => void {
    this.leaderLostCallbacks.add(callback);
    return () => {
      this.leaderLostCallbacks.delete(callback);
    };
  }

  /**
   * Register a callback for when the leader recovers after being lost.
   *
   * @param callback - Function to call when leader responds again
   * @returns Unsubscribe function
   */
  onLeaderRecovered(callback: () => void): () => void {
    this.leaderRecoveredCallbacks.add(callback);
    return () => {
      this.leaderRecoveredCallbacks.delete(callback);
    };
  }

  /**
   * Check if the leader is currently considered alive.
   */
  isLeaderAlive(): boolean {
    return this.status$$.value !== 'leader-lost';
  }

  /**
   * Observable of heartbeat status changes.
   */
  get status$(): Observable<HeartbeatStatus> {
    return this.status$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get the current heartbeat status.
   */
  getStatus(): HeartbeatStatus {
    return this.status$$.value;
  }

  /**
   * Destroy the monitor and clean up all resources.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.stop();
    this.leaderLostCallbacks.clear();
    this.leaderRecoveredCallbacks.clear();

    this.destroy$.next();
    this.destroy$.complete();
    this.status$$.complete();

    this.log('HeartbeatMonitor destroyed');
  }

  private startSending(): void {
    this.sendHeartbeat();

    this.sendTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatIntervalMs);
  }

  private sendHeartbeat(): void {
    if (!this.isRunning || this.destroyed) return;

    const message: HeartbeatMessage = {
      type: 'heartbeat',
      timestamp: Date.now(),
    };

    if (this.channel) {
      try {
        this.channel.postMessage(message);
        this.log('Heartbeat sent');
      } catch (error) {
        this.log('Failed to send heartbeat:', error);
      }
    }
  }

  private startMonitoring(): void {
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<HeartbeatMessage>) => {
        this.handleHeartbeat(event.data);
      };
    }

    this.checkTimer = setInterval(() => {
      this.checkHeartbeat();
    }, this.config.heartbeatIntervalMs);
  }

  private handleHeartbeat(message: HeartbeatMessage): void {
    if (message?.type !== 'heartbeat') return;

    const previousStatus = this.status$$.value;
    this.lastHeartbeatAt = Date.now();
    this.missedCount = 0;

    this.updateStatus('healthy');

    if (previousStatus === 'leader-lost') {
      this.log('Leader recovered');
      for (const cb of this.leaderRecoveredCallbacks) {
        try {
          cb();
        } catch (error) {
          this.log('Leader recovered callback error:', error);
        }
      }
    }
  }

  private checkHeartbeat(): void {
    if (!this.isRunning || this.destroyed || this.isLeaderMode) return;

    const elapsed = Date.now() - this.lastHeartbeatAt;
    const expectedInterval = this.config.heartbeatIntervalMs;

    if (elapsed > expectedInterval * 1.5) {
      this.missedCount++;
      this.log('Missed heartbeat count:', this.missedCount);

      if (this.missedCount >= this.config.missedHeartbeatsThreshold) {
        if (this.status$$.value !== 'leader-lost') {
          this.updateStatus('leader-lost');
          this.log('Leader lost');
          for (const cb of this.leaderLostCallbacks) {
            try {
              cb();
            } catch (error) {
              this.log('Leader lost callback error:', error);
            }
          }
        }
      } else {
        this.updateStatus('degraded');
      }
    }
  }

  private updateStatus(status: HeartbeatStatus): void {
    if (this.status$$.value !== status) {
      this.status$$.next(status);
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[HeartbeatMonitor]', ...args);
    }
  }
}

/**
 * Create a new HeartbeatMonitor instance.
 *
 * @param config - Optional heartbeat configuration
 * @returns A new HeartbeatMonitor
 *
 * @example
 * ```typescript
 * import { createHeartbeatMonitor } from '@pocket/cross-tab';
 *
 * const monitor = createHeartbeatMonitor({ heartbeatIntervalMs: 1000 });
 * monitor.start(true); // start as leader
 * ```
 */
export function createHeartbeatMonitor(config?: HeartbeatMonitorConfig): HeartbeatMonitor {
  return new HeartbeatMonitor(config);
}
