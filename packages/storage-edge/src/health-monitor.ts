/**
 * Edge Health Monitor - Monitors health of edge sync server connections.
 *
 * Tracks endpoint health via latency, success rates, and consecutive failures
 * using RxJS observables for reactive health updates.
 *
 * @module @pocket/storage-edge
 */

import type { Observable } from 'rxjs';
import { BehaviorSubject } from 'rxjs';

/**
 * Configuration for the health monitor.
 */
export interface HealthMonitorConfig {
  /** Interval for health check aggregation in ms. @default 30000 */
  checkIntervalMs?: number;
  /** Latency threshold for healthy status in ms. @default 200 */
  healthyThresholdMs?: number;
  /** Number of consecutive failures before marking unhealthy. @default 3 */
  unhealthyAfterFailures?: number;
}

/**
 * Health status of a single endpoint.
 */
export interface EndpointHealth {
  /** Endpoint URL or identifier */
  endpoint: string;
  /** Current health status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Average latency in ms */
  avgLatencyMs: number;
  /** Success rate as a value between 0 and 1 */
  successRate: number;
  /** Timestamp of the last health check */
  lastCheckAt: number;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Total number of checks recorded */
  totalChecks: number;
}

/**
 * Edge health monitor interface.
 */
export interface EdgeHealthMonitor {
  /** Record a health check result */
  recordCheck(endpoint: string, latencyMs: number, success: boolean): void;
  /** Get health for a specific endpoint */
  getEndpointHealth(endpoint: string): EndpointHealth | null;
  /** Get health for all endpoints */
  getAllEndpoints(): EndpointHealth[];
  /** Get overall health across all endpoints */
  getOverallHealth(): 'healthy' | 'degraded' | 'unhealthy';
  /** Observable stream of endpoint health updates */
  health$: Observable<EndpointHealth[]>;
  /** Clean up resources */
  destroy(): void;
}

interface EndpointState {
  endpoint: string;
  totalLatencyMs: number;
  successCount: number;
  totalChecks: number;
  consecutiveFailures: number;
  lastCheckAt: number;
}

/**
 * Create an edge health monitor.
 *
 * @param config - Optional health monitor configuration
 * @returns An EdgeHealthMonitor instance
 */
export function createEdgeHealthMonitor(config?: HealthMonitorConfig): EdgeHealthMonitor {
  const healthyThresholdMs = config?.healthyThresholdMs ?? 200;
  const unhealthyAfterFailures = config?.unhealthyAfterFailures ?? 3;

  const endpoints = new Map<string, EndpointState>();
  const subject = new BehaviorSubject<EndpointHealth[]>([]);

  function computeHealth(state: EndpointState): EndpointHealth {
    const avgLatencyMs =
      state.totalChecks > 0 ? Math.round(state.totalLatencyMs / state.totalChecks) : 0;
    const successRate = state.totalChecks > 0 ? state.successCount / state.totalChecks : 0;

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (state.consecutiveFailures >= unhealthyAfterFailures) {
      status = 'unhealthy';
    } else if (state.consecutiveFailures > 0 || avgLatencyMs > healthyThresholdMs) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      endpoint: state.endpoint,
      status,
      avgLatencyMs,
      successRate: Math.round(successRate * 10000) / 10000,
      lastCheckAt: state.lastCheckAt,
      consecutiveFailures: state.consecutiveFailures,
      totalChecks: state.totalChecks,
    };
  }

  function emitUpdate(): void {
    const healthList = Array.from(endpoints.values()).map(computeHealth);
    subject.next(healthList);
  }

  function recordCheck(endpoint: string, latencyMs: number, success: boolean): void {
    let state = endpoints.get(endpoint);
    if (!state) {
      state = {
        endpoint,
        totalLatencyMs: 0,
        successCount: 0,
        totalChecks: 0,
        consecutiveFailures: 0,
        lastCheckAt: 0,
      };
      endpoints.set(endpoint, state);
    }

    state.totalLatencyMs += latencyMs;
    state.totalChecks += 1;
    state.lastCheckAt = Date.now();

    if (success) {
      state.successCount += 1;
      state.consecutiveFailures = 0;
    } else {
      state.consecutiveFailures += 1;
    }

    emitUpdate();
  }

  function getEndpointHealth(endpoint: string): EndpointHealth | null {
    const state = endpoints.get(endpoint);
    if (!state) return null;
    return computeHealth(state);
  }

  function getAllEndpoints(): EndpointHealth[] {
    return Array.from(endpoints.values()).map(computeHealth);
  }

  function getOverallHealth(): 'healthy' | 'degraded' | 'unhealthy' {
    const all = getAllEndpoints();
    if (all.length === 0) return 'healthy';
    if (all.some((e) => e.status === 'unhealthy')) return 'unhealthy';
    if (all.some((e) => e.status === 'degraded')) return 'degraded';
    return 'healthy';
  }

  function destroy(): void {
    subject.complete();
    endpoints.clear();
  }

  return {
    recordCheck,
    getEndpointHealth,
    getAllEndpoints,
    getOverallHealth,
    health$: subject.asObservable(),
    destroy,
  };
}
