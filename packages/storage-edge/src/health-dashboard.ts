/**
 * Health dashboard data provider for the global sync mesh.
 *
 * Aggregates region health data, computes latency percentiles,
 * tracks replication lag trends, and provides alerting thresholds.
 *
 * @module health-dashboard
 */

import type { RegionNodeInfo, MeshMetrics, EdgeRegion } from './global-sync-mesh.js';

/** Latency percentile statistics */
export interface LatencyPercentiles {
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/** Health alert */
export interface HealthAlert {
  readonly id: string;
  readonly severity: 'critical' | 'warning' | 'info';
  readonly region: EdgeRegion;
  readonly message: string;
  readonly timestamp: number;
  readonly metric: string;
  readonly value: number;
  readonly threshold: number;
}

/** Health dashboard snapshot */
export interface HealthDashboardSnapshot {
  readonly timestamp: number;
  readonly overallHealth: 'healthy' | 'degraded' | 'critical';
  readonly regions: readonly RegionHealthSummary[];
  readonly alerts: readonly HealthAlert[];
  readonly latencyPercentiles: LatencyPercentiles;
  readonly meshMetrics: MeshMetrics;
}

/** Per-region health summary */
export interface RegionHealthSummary {
  readonly region: EdgeRegion;
  readonly status: string;
  readonly isPrimary: boolean;
  readonly latencyMs: number;
  readonly replicationLagMs: number;
  readonly documentCount: number;
  readonly healthScore: number;
}

/** Alert thresholds */
export interface AlertThresholds {
  readonly maxLatencyMs?: number;
  readonly maxReplicationLagMs?: number;
  readonly minActiveRegions?: number;
}

const DEFAULT_THRESHOLDS: Required<AlertThresholds> = {
  maxLatencyMs: 200,
  maxReplicationLagMs: 10_000,
  minActiveRegions: 2,
};

/**
 * Builds health dashboard data from mesh state.
 *
 * @example
 * ```typescript
 * import { buildHealthDashboard } from '@pocket/storage-edge';
 *
 * const snapshot = buildHealthDashboard(mesh.getRegions(), mesh.getMetrics());
 * console.log(`Overall: ${snapshot.overallHealth}`);
 * for (const alert of snapshot.alerts) {
 *   console.log(`[${alert.severity}] ${alert.region}: ${alert.message}`);
 * }
 * ```
 */
export function buildHealthDashboard(
  regions: readonly RegionNodeInfo[],
  meshMetrics: MeshMetrics,
  thresholds: AlertThresholds = {},
): HealthDashboardSnapshot {
  const effectiveThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const alerts: HealthAlert[] = [];

  // Compute per-region health
  const regionSummaries: RegionHealthSummary[] = regions.map((r) => {
    let healthScore = 100;
    if (r.status === 'degraded') healthScore -= 40;
    if (r.status === 'offline') healthScore = 0;
    if (r.latencyMs > effectiveThresholds.maxLatencyMs) healthScore -= 20;
    if (r.replicationLagMs > effectiveThresholds.maxReplicationLagMs) healthScore -= 30;

    // Generate alerts
    if (r.latencyMs > effectiveThresholds.maxLatencyMs) {
      alerts.push({
        id: `alert_lat_${r.region}`,
        severity: r.latencyMs > effectiveThresholds.maxLatencyMs * 2 ? 'critical' : 'warning',
        region: r.region,
        message: `Latency ${r.latencyMs}ms exceeds threshold ${effectiveThresholds.maxLatencyMs}ms`,
        timestamp: Date.now(),
        metric: 'latency',
        value: r.latencyMs,
        threshold: effectiveThresholds.maxLatencyMs,
      });
    }

    if (r.replicationLagMs > effectiveThresholds.maxReplicationLagMs && !r.isPrimary) {
      alerts.push({
        id: `alert_lag_${r.region}`,
        severity: 'warning',
        region: r.region,
        message: `Replication lag ${r.replicationLagMs}ms exceeds threshold`,
        timestamp: Date.now(),
        metric: 'replicationLag',
        value: r.replicationLagMs,
        threshold: effectiveThresholds.maxReplicationLagMs,
      });
    }

    if (r.status === 'offline') {
      alerts.push({
        id: `alert_offline_${r.region}`,
        severity: 'critical',
        region: r.region,
        message: `Region ${r.region} is offline`,
        timestamp: Date.now(),
        metric: 'status',
        value: 0,
        threshold: 1,
      });
    }

    return {
      region: r.region,
      status: r.status,
      isPrimary: r.isPrimary,
      latencyMs: r.latencyMs,
      replicationLagMs: r.replicationLagMs,
      documentCount: r.documentCount,
      healthScore: Math.max(0, healthScore),
    };
  });

  // Check minimum active regions
  const activeCount = regionSummaries.filter((r) => r.status === 'active').length;
  if (activeCount < effectiveThresholds.minActiveRegions) {
    alerts.push({
      id: 'alert_min_regions',
      severity: 'critical',
      region: 'us-east' as EdgeRegion,
      message: `Only ${activeCount} active regions (minimum: ${effectiveThresholds.minActiveRegions})`,
      timestamp: Date.now(),
      metric: 'activeRegions',
      value: activeCount,
      threshold: effectiveThresholds.minActiveRegions,
    });
  }

  // Compute latency percentiles
  const latencies = regions.map((r) => r.latencyMs).sort((a, b) => a - b);
  const latencyPercentiles = computePercentiles(latencies);

  // Overall health
  const hasCritical = alerts.some((a) => a.severity === 'critical');
  const hasWarning = alerts.some((a) => a.severity === 'warning');
  const overallHealth = hasCritical ? 'critical' : hasWarning ? 'degraded' : 'healthy';

  return {
    timestamp: Date.now(),
    overallHealth,
    regions: regionSummaries,
    alerts,
    latencyPercentiles,
    meshMetrics,
  };
}

function computePercentiles(sorted: number[]): LatencyPercentiles {
  if (sorted.length === 0) return { p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  const percentile = (p: number) => {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)]!;
  };
  return {
    p50: percentile(50),
    p90: percentile(90),
    p95: percentile(95),
    p99: percentile(99),
    max: sorted[sorted.length - 1]!,
  };
}
