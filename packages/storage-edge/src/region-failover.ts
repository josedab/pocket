/**
 * Automatic region failover for the global sync mesh.
 *
 * Monitors primary region health and automatically promotes a
 * replica when the primary goes down, re-routing all traffic.
 *
 * @module region-failover
 */

import type { EdgeRegion, RegionNodeInfo } from './global-sync-mesh.js';

/** Failover event */
export interface FailoverEvent {
  readonly type: 'failover-started' | 'failover-completed' | 'failover-failed' | 'primary-restored';
  readonly timestamp: number;
  readonly oldPrimary: EdgeRegion;
  readonly newPrimary: EdgeRegion | null;
  readonly reason: string;
  readonly durationMs?: number;
}

/** Failover configuration */
export interface FailoverConfig {
  /** Number of consecutive health check failures before failover (default: 3) */
  readonly failureThreshold?: number;
  /** Minimum time between failover attempts in ms (default: 60000) */
  readonly cooldownMs?: number;
  /** Prefer regions in same continent for failover */
  readonly preferSameContinent?: boolean;
}

/** Failover state */
export interface FailoverState {
  readonly originalPrimary: EdgeRegion;
  readonly currentPrimary: EdgeRegion;
  readonly failoverActive: boolean;
  readonly failoverCount: number;
  readonly lastFailoverAt: number | null;
  readonly consecutiveFailures: number;
}

const CONTINENT_MAP: Record<EdgeRegion, string> = {
  'us-east': 'NA', 'us-west': 'NA',
  'eu-west': 'EU', 'eu-central': 'EU',
  'ap-southeast': 'AP', 'ap-northeast': 'AP',
  'sa-east': 'SA',
  'af-south': 'AF',
};

/**
 * Manages automatic primary region failover.
 *
 * @example
 * ```typescript
 * const failover = new RegionFailoverManager({
 *   failureThreshold: 3,
 *   cooldownMs: 60000,
 * });
 *
 * failover.initialize('us-east', ['eu-west', 'ap-northeast']);
 *
 * // Called on each health check:
 * const event = failover.checkHealth(regions);
 * if (event) {
 *   console.log(`Failover: ${event.oldPrimary} -> ${event.newPrimary}`);
 * }
 * ```
 */
export class RegionFailoverManager {
  private readonly config: Required<FailoverConfig>;
  private originalPrimary: EdgeRegion | null = null;
  private currentPrimary: EdgeRegion | null = null;
  private replicas: EdgeRegion[] = [];
  private consecutiveFailures = 0;
  private failoverCount = 0;
  private lastFailoverAt: number | null = null;
  private readonly eventLog: FailoverEvent[] = [];

  constructor(config: FailoverConfig = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 3,
      cooldownMs: config.cooldownMs ?? 60_000,
      preferSameContinent: config.preferSameContinent ?? true,
    };
  }

  /** Initialize with primary and replicas */
  initialize(primary: EdgeRegion, replicas: EdgeRegion[]): void {
    this.originalPrimary = primary;
    this.currentPrimary = primary;
    this.replicas = [...replicas];
    this.consecutiveFailures = 0;
  }

  /** Check health and trigger failover if needed. Returns event if failover occurred. */
  checkHealth(regions: readonly RegionNodeInfo[]): FailoverEvent | null {
    if (!this.currentPrimary) return null;

    const primary = regions.find((r) => r.region === this.currentPrimary);
    if (!primary) return null;

    // Primary is healthy
    if (primary.status === 'active') {
      if (this.consecutiveFailures > 0) {
        this.consecutiveFailures = 0;
      }
      // Check if we should restore original primary
      if (this.currentPrimary !== this.originalPrimary) {
        const original = regions.find((r) => r.region === this.originalPrimary);
        if (original?.status === 'active') {
          return this.restorePrimary();
        }
      }
      return null;
    }

    // Primary is unhealthy
    this.consecutiveFailures++;

    if (this.consecutiveFailures < this.config.failureThreshold) {
      return null; // Not enough failures yet
    }

    // Check cooldown
    if (this.lastFailoverAt && Date.now() - this.lastFailoverAt < this.config.cooldownMs) {
      return null;
    }

    // Find best replica for promotion
    const candidate = this.selectFailoverCandidate(regions);
    if (!candidate) {
      const event: FailoverEvent = {
        type: 'failover-failed',
        timestamp: Date.now(),
        oldPrimary: this.currentPrimary,
        newPrimary: null,
        reason: 'No healthy replica available for failover',
      };
      this.eventLog.push(event);
      return event;
    }

    return this.executeFailover(candidate);
  }

  /** Get current failover state */
  getState(): FailoverState {
    return {
      originalPrimary: this.originalPrimary ?? ('us-east' as EdgeRegion),
      currentPrimary: this.currentPrimary ?? ('us-east' as EdgeRegion),
      failoverActive: this.currentPrimary !== this.originalPrimary,
      failoverCount: this.failoverCount,
      lastFailoverAt: this.lastFailoverAt,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /** Get failover event history */
  getEventLog(): readonly FailoverEvent[] {
    return this.eventLog;
  }

  /** Get current primary region */
  getCurrentPrimary(): EdgeRegion | null {
    return this.currentPrimary;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private selectFailoverCandidate(regions: readonly RegionNodeInfo[]): EdgeRegion | null {
    const activeReplicas = regions.filter(
      (r) => r.region !== this.currentPrimary && r.status === 'active',
    );

    if (activeReplicas.length === 0) return null;

    if (this.config.preferSameContinent && this.currentPrimary) {
      const continent = CONTINENT_MAP[this.currentPrimary];
      const sameContinent = activeReplicas.filter(
        (r) => CONTINENT_MAP[r.region] === continent,
      );
      if (sameContinent.length > 0) {
        // Pick lowest latency in same continent
        sameContinent.sort((a, b) => a.latencyMs - b.latencyMs);
        return sameContinent[0]!.region;
      }
    }

    // Fall back to lowest latency globally
    activeReplicas.sort((a, b) => a.latencyMs - b.latencyMs);
    return activeReplicas[0]!.region;
  }

  private executeFailover(newPrimary: EdgeRegion): FailoverEvent {
    const start = Date.now();
    const oldPrimary = this.currentPrimary!;

    this.currentPrimary = newPrimary;
    this.consecutiveFailures = 0;
    this.failoverCount++;
    this.lastFailoverAt = start;

    const event: FailoverEvent = {
      type: 'failover-completed',
      timestamp: start,
      oldPrimary,
      newPrimary,
      reason: `Primary ${oldPrimary} failed after ${this.config.failureThreshold} checks`,
      durationMs: Date.now() - start,
    };
    this.eventLog.push(event);
    return event;
  }

  private restorePrimary(): FailoverEvent {
    const oldPrimary = this.currentPrimary!;
    this.currentPrimary = this.originalPrimary;
    this.consecutiveFailures = 0;

    const event: FailoverEvent = {
      type: 'primary-restored',
      timestamp: Date.now(),
      oldPrimary,
      newPrimary: this.originalPrimary!,
      reason: `Original primary ${this.originalPrimary} is healthy again`,
    };
    this.eventLog.push(event);
    return event;
  }
}

/** Factory function */
export function createRegionFailoverManager(config?: FailoverConfig): RegionFailoverManager {
  return new RegionFailoverManager(config);
}
