/**
 * Edge Replication Manager — distributes data across global edge nodes
 * for ultra-low-latency reads with configurable consistency levels.
 */

import { BehaviorSubject, Subject } from 'rxjs';
import type { CloudRegion, CloudTier } from './types.js';

/** Consistency level for edge reads. */
export type EdgeConsistency = 'eventual' | 'bounded-staleness' | 'strong';

/** Configuration for edge replication. */
export interface EdgeReplicationConfig {
  /** Primary region where writes go. */
  readonly primaryRegion: CloudRegion;
  /** Regions to replicate data to for edge reads. */
  readonly replicaRegions: readonly CloudRegion[];
  /** Consistency level for reads from replica regions. Defaults to 'eventual'. */
  readonly consistency?: EdgeConsistency;
  /** Max staleness in milliseconds for bounded-staleness mode. Defaults to 5000. */
  readonly maxStalenessMs?: number;
  /** Collections to replicate. Empty means all. */
  readonly collections?: readonly string[];
  /** Whether to enable automatic failover to replica. Defaults to true. */
  readonly autoFailover?: boolean;
}

/** Status of a single edge replica. */
export interface ReplicaStatus {
  readonly region: CloudRegion;
  readonly state: 'syncing' | 'healthy' | 'degraded' | 'offline';
  readonly lagMs: number;
  readonly lastSyncTimestamp: number;
  readonly documentsReplicated: number;
}

/** Overall edge replication health. */
export interface EdgeReplicationStatus {
  readonly primaryRegion: CloudRegion;
  readonly replicas: readonly ReplicaStatus[];
  readonly overallHealth: 'healthy' | 'degraded' | 'partial-outage';
  readonly consistency: EdgeConsistency;
}

/** Events emitted during replication. */
export interface EdgeReplicationEvent {
  readonly type: 'replica-synced' | 'replica-degraded' | 'failover' | 'promotion';
  readonly region: CloudRegion;
  readonly timestamp: number;
  readonly details?: string;
}

const REGION_LATENCY_MAP: Record<CloudRegion, Record<CloudRegion, number>> = {
  'us-east-1': {
    'us-east-1': 1,
    'us-west-2': 70,
    'eu-west-1': 80,
    'eu-central-1': 90,
    'ap-southeast-1': 200,
    'ap-northeast-1': 170,
  },
  'us-west-2': {
    'us-east-1': 70,
    'us-west-2': 1,
    'eu-west-1': 140,
    'eu-central-1': 150,
    'ap-southeast-1': 160,
    'ap-northeast-1': 120,
  },
  'eu-west-1': {
    'us-east-1': 80,
    'us-west-2': 140,
    'eu-west-1': 1,
    'eu-central-1': 20,
    'ap-southeast-1': 170,
    'ap-northeast-1': 220,
  },
  'eu-central-1': {
    'us-east-1': 90,
    'us-west-2': 150,
    'eu-west-1': 20,
    'eu-central-1': 1,
    'ap-southeast-1': 160,
    'ap-northeast-1': 210,
  },
  'ap-southeast-1': {
    'us-east-1': 200,
    'us-west-2': 160,
    'eu-west-1': 170,
    'eu-central-1': 160,
    'ap-southeast-1': 1,
    'ap-northeast-1': 70,
  },
  'ap-northeast-1': {
    'us-east-1': 170,
    'us-west-2': 120,
    'eu-west-1': 220,
    'eu-central-1': 210,
    'ap-southeast-1': 70,
    'ap-northeast-1': 1,
  },
};

const TIER_MAX_REPLICAS: Record<CloudTier, number> = {
  free: 0,
  pro: 2,
  enterprise: 5,
};

export class EdgeReplicationManager {
  private readonly config: Required<EdgeReplicationConfig>;
  private readonly replicas = new Map<CloudRegion, ReplicaStatus>();
  private readonly status$: BehaviorSubject<EdgeReplicationStatus>;
  private readonly events$ = new Subject<EdgeReplicationEvent>();
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: EdgeReplicationConfig) {
    this.config = {
      primaryRegion: config.primaryRegion,
      replicaRegions: config.replicaRegions,
      consistency: config.consistency ?? 'eventual',
      maxStalenessMs: config.maxStalenessMs ?? 5000,
      collections: config.collections ?? [],
      autoFailover: config.autoFailover ?? true,
    };

    // Initialize replica statuses
    for (const region of this.config.replicaRegions) {
      this.replicas.set(region, {
        region,
        state: 'syncing',
        lagMs: 0,
        lastSyncTimestamp: 0,
        documentsReplicated: 0,
      });
    }

    this.status$ = new BehaviorSubject<EdgeReplicationStatus>(this.buildStatus());
  }

  /** Validate that the tier supports the requested replicas. */
  validateTier(tier: CloudTier): { valid: boolean; maxAllowed: number } {
    const maxAllowed = TIER_MAX_REPLICAS[tier];
    return {
      valid: this.config.replicaRegions.length <= maxAllowed,
      maxAllowed,
    };
  }

  /** Start replication to all configured edge regions. */
  start(): void {
    for (const region of this.config.replicaRegions) {
      this.replicas.set(region, {
        region,
        state: 'healthy',
        lagMs: REGION_LATENCY_MAP[this.config.primaryRegion]?.[region] ?? 100,
        lastSyncTimestamp: Date.now(),
        documentsReplicated: 0,
      });
      this.emitEvent('replica-synced', region);
    }
    this.emitStatus();

    // Simulate periodic sync checks
    this.syncInterval = setInterval(() => this.checkReplicaHealth(), 30_000);
  }

  /** Find the closest healthy replica to a given target region. */
  getClosestReplica(targetRegion: CloudRegion): CloudRegion {
    const latencies = REGION_LATENCY_MAP[targetRegion];
    if (!latencies) return this.config.primaryRegion;

    let bestRegion = this.config.primaryRegion;
    let bestLatency = latencies[this.config.primaryRegion] ?? Infinity;

    for (const [region, status] of this.replicas) {
      if (status.state === 'offline' || status.state === 'degraded') continue;
      const latency = latencies[region] ?? Infinity;
      if (latency < bestLatency) {
        bestLatency = latency;
        bestRegion = region;
      }
    }

    return bestRegion;
  }

  /** Check if a read from a replica satisfies the given consistency level. */
  isReadConsistent(region: CloudRegion, consistency?: EdgeConsistency): boolean {
    if (region === this.config.primaryRegion) return true;

    const replica = this.replicas.get(region);
    if (!replica) return false;

    const level = consistency ?? this.config.consistency;

    switch (level) {
      case 'strong':
        return false; // Strong consistency only from primary
      case 'bounded-staleness':
        return Date.now() - replica.lastSyncTimestamp <= this.config.maxStalenessMs;
      case 'eventual':
        return replica.state !== 'offline';
    }
  }

  /** Trigger failover: promote a replica to primary. */
  failover(newPrimary: CloudRegion): boolean {
    const replica = this.replicas.get(newPrimary);
    if (!replica || replica.state === 'offline') return false;

    this.emitEvent('failover', this.config.primaryRegion, `Failing over to ${newPrimary}`);
    (this.config as { primaryRegion: CloudRegion }).primaryRegion = newPrimary;
    this.replicas.delete(newPrimary);
    this.emitEvent('promotion', newPrimary, 'Promoted to primary');
    this.emitStatus();
    return true;
  }

  /** Update a replica's replication count. */
  recordReplication(region: CloudRegion, docCount: number): void {
    const existing = this.replicas.get(region);
    if (!existing) return;
    this.replicas.set(region, {
      ...existing,
      documentsReplicated: existing.documentsReplicated + docCount,
      lastSyncTimestamp: Date.now(),
      lagMs: REGION_LATENCY_MAP[this.config.primaryRegion]?.[region] ?? existing.lagMs,
    });
    this.emitStatus();
  }

  /** Observable of replication status changes. */
  get status() {
    return this.status$.asObservable();
  }

  /** Observable of replication events. */
  get events() {
    return this.events$.asObservable();
  }

  /** Current replication status snapshot. */
  getStatus(): EdgeReplicationStatus {
    return this.buildStatus();
  }

  /** Shut down replication. */
  destroy(): void {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.status$.complete();
    this.events$.complete();
  }

  private checkReplicaHealth(): void {
    for (const [region, status] of this.replicas) {
      const staleness = Date.now() - status.lastSyncTimestamp;
      if (staleness > this.config.maxStalenessMs * 3) {
        this.replicas.set(region, { ...status, state: 'degraded' });
        this.emitEvent('replica-degraded', region);
      }
    }
    this.emitStatus();
  }

  private buildStatus(): EdgeReplicationStatus {
    const replicas = Array.from(this.replicas.values());
    const degradedCount = replicas.filter(
      (r) => r.state === 'degraded' || r.state === 'offline'
    ).length;

    return {
      primaryRegion: this.config.primaryRegion,
      replicas,
      overallHealth:
        degradedCount === 0
          ? 'healthy'
          : degradedCount < replicas.length
            ? 'degraded'
            : 'partial-outage',
      consistency: this.config.consistency,
    };
  }

  private emitStatus(): void {
    this.status$.next(this.buildStatus());
  }

  private emitEvent(
    type: EdgeReplicationEvent['type'],
    region: CloudRegion,
    details?: string
  ): void {
    this.events$.next({ type, region, timestamp: Date.now(), details });
  }
}

export function createEdgeReplicationManager(
  config: EdgeReplicationConfig
): EdgeReplicationManager {
  return new EdgeReplicationManager(config);
}
