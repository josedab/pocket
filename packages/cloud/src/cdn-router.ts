/**
 * Global CDN Routing — intelligent request routing based on user
 * location, replica health, and consistency requirements.
 */

import type { EdgeConsistency, EdgeReplicationManager } from './edge-replication.js';
import type { CloudRegion } from './types.js';

/** Request routing decision. */
export interface RoutingDecision {
  readonly targetRegion: CloudRegion;
  readonly latencyEstimateMs: number;
  readonly consistency: EdgeConsistency;
  readonly fromCache: boolean;
  readonly reason: string;
}

/** CDN routing configuration. */
export interface CDNRoutingConfig {
  /** The edge replication manager to query for replica status. */
  readonly replicationManager: EdgeReplicationManager;
  /** Default consistency for routing decisions. */
  readonly defaultConsistency?: EdgeConsistency;
  /** Cache routing decisions for this many ms. Defaults to 10000. */
  readonly cacheDurationMs?: number;
}

/** User location hint for routing. */
export interface LocationHint {
  readonly region?: CloudRegion;
  readonly latitude?: number;
  readonly longitude?: number;
}

// Region approximate centroids for geo-routing
const REGION_COORDS: Record<CloudRegion, { lat: number; lng: number }> = {
  'us-east-1': { lat: 39.0, lng: -77.5 },
  'us-west-2': { lat: 46.2, lng: -122.4 },
  'eu-west-1': { lat: 53.3, lng: -6.3 },
  'eu-central-1': { lat: 50.1, lng: 8.7 },
  'ap-southeast-1': { lat: 1.35, lng: 103.8 },
  'ap-northeast-1': { lat: 35.7, lng: 139.7 },
};

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class CDNRouter {
  private readonly config: Required<CDNRoutingConfig>;
  private readonly routeCache = new Map<string, { decision: RoutingDecision; timestamp: number }>();

  constructor(config: CDNRoutingConfig) {
    this.config = {
      replicationManager: config.replicationManager,
      defaultConsistency: config.defaultConsistency ?? 'eventual',
      cacheDurationMs: config.cacheDurationMs ?? 10_000,
    };
  }

  /**
   * Route a request to the optimal region based on user location,
   * replica health, and consistency requirements.
   */
  route(location: LocationHint, consistency?: EdgeConsistency): RoutingDecision {
    const effectiveConsistency = consistency ?? this.config.defaultConsistency;
    const cacheKey = `${location.region ?? ''}:${location.latitude ?? ''}:${location.longitude ?? ''}:${effectiveConsistency}`;

    // Check route cache
    const cached = this.routeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.config.cacheDurationMs) {
      return { ...cached.decision, fromCache: true };
    }

    // Determine closest region
    const targetRegion = location.region
      ? this.config.replicationManager.getClosestReplica(location.region)
      : this.findClosestByCoords(location.latitude, location.longitude);

    // Check consistency
    const isConsistent = this.config.replicationManager.isReadConsistent(
      targetRegion,
      effectiveConsistency
    );
    const status = this.config.replicationManager.getStatus();
    const replica = status.replicas.find((r) => r.region === targetRegion);

    let finalRegion = targetRegion;
    let reason = `Closest healthy replica: ${targetRegion}`;

    if (effectiveConsistency === 'strong' && !isConsistent) {
      finalRegion = status.primaryRegion;
      reason = `Strong consistency required, routing to primary: ${finalRegion}`;
    } else if (effectiveConsistency === 'bounded-staleness' && !isConsistent) {
      finalRegion = status.primaryRegion;
      reason = `Replica stale beyond threshold, routing to primary: ${finalRegion}`;
    }

    const decision: RoutingDecision = {
      targetRegion: finalRegion,
      latencyEstimateMs: replica?.lagMs ?? 50,
      consistency: effectiveConsistency,
      fromCache: false,
      reason,
    };

    this.routeCache.set(cacheKey, { decision, timestamp: Date.now() });
    return decision;
  }

  /** Clear the routing cache (e.g., after topology changes). */
  invalidateCache(): void {
    this.routeCache.clear();
  }

  private findClosestByCoords(lat?: number, lng?: number): CloudRegion {
    if (lat === undefined || lng === undefined) {
      return this.config.replicationManager.getStatus().primaryRegion;
    }

    let closest: CloudRegion = 'us-east-1';
    let minDist = Infinity;

    for (const [region, coords] of Object.entries(REGION_COORDS)) {
      const dist = haversineDistance(lat, lng, coords.lat, coords.lng);
      if (dist < minDist) {
        minDist = dist;
        closest = region as CloudRegion;
      }
    }

    // Verify the closest region is available
    return this.config.replicationManager.getClosestReplica(closest);
  }
}

export function createCDNRouter(config: CDNRoutingConfig): CDNRouter {
  return new CDNRouter(config);
}
