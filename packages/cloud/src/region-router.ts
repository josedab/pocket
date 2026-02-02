/**
 * RegionRouter - Latency-aware endpoint routing with failover.
 *
 * Provides intelligent routing to the lowest-latency healthy endpoint
 * with periodic health checks and automatic failover.
 *
 * @module region-router
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';
import type { CloudRegion } from './types.js';

/**
 * Configuration for the region router.
 *
 * @example
 * ```typescript
 * const config: RegionRouterConfig = {
 *   regions: [
 *     { region: 'us-east-1', url: 'https://us-east-1.cloud.pocket-db.dev' },
 *     { region: 'eu-west-1', url: 'https://eu-west-1.cloud.pocket-db.dev' },
 *   ],
 *   healthCheckIntervalMs: 30_000,
 *   latencyThresholdMs: 500,
 * };
 * ```
 *
 * @see {@link RegionRouter}
 */
export interface RegionRouterConfig {
  /** Region endpoints to route between */
  readonly regions: readonly { region: CloudRegion; url: string }[];

  /** Interval between health checks in milliseconds. @default 30000 */
  readonly healthCheckIntervalMs?: number;

  /** Latency threshold in ms above which an endpoint is considered degraded. @default 500 */
  readonly latencyThresholdMs?: number;
}

/**
 * A region endpoint with health and latency information.
 *
 * @see {@link RegionRouter.getBestEndpoint}
 * @see {@link RegionRouter.getEndpointForRegion}
 */
export interface RegionEndpoint {
  /** Cloud region identifier */
  region: CloudRegion;

  /** Endpoint URL */
  url: string;

  /** Last measured latency in milliseconds */
  latencyMs: number;

  /** Whether the endpoint is currently healthy */
  healthy: boolean;

  /** Timestamp of the last health check */
  lastCheckedAt: number;
}

/** @internal Resolved configuration with all defaults applied. */
interface ResolvedRegionRouterConfig {
  regions: { region: CloudRegion; url: string }[];
  healthCheckIntervalMs: number;
  latencyThresholdMs: number;
}

/**
 * Latency-aware endpoint router with failover.
 *
 * RegionRouter provides:
 * - Latency-based endpoint selection (lowest latency wins)
 * - Periodic health checks using RxJS interval
 * - Automatic failover when primary region is unhealthy
 * - Observable endpoint state via RxJS BehaviorSubject
 *
 * @example Basic usage
 * ```typescript
 * import { createRegionRouter } from '@pocket/cloud';
 *
 * const router = createRegionRouter({
 *   regions: [
 *     { region: 'us-east-1', url: 'https://us-east-1.cloud.pocket-db.dev' },
 *     { region: 'eu-west-1', url: 'https://eu-west-1.cloud.pocket-db.dev' },
 *   ],
 *   healthCheckIntervalMs: 30_000,
 *   latencyThresholdMs: 500,
 * });
 *
 * await router.start();
 *
 * const best = router.getBestEndpoint();
 * console.log('Best endpoint:', best?.url, 'latency:', best?.latencyMs);
 *
 * router.destroy();
 * ```
 *
 * @example Failover
 * ```typescript
 * const router = createRegionRouter({
 *   regions: [
 *     { region: 'us-east-1', url: 'https://us-east-1.cloud.pocket-db.dev' },
 *     { region: 'us-west-2', url: 'https://us-west-2.cloud.pocket-db.dev' },
 *   ],
 * });
 *
 * await router.start();
 *
 * // If us-east-1 goes down, getBestEndpoint() automatically returns us-west-2
 * const endpoint = router.getBestEndpoint();
 * console.log('Routed to:', endpoint?.region);
 * ```
 *
 * @see {@link createRegionRouter}
 * @see {@link RegionRouterConfig}
 */
export class RegionRouter {
  private readonly config: ResolvedRegionRouterConfig;
  private readonly destroy$ = new Subject<void>();
  private readonly endpoints$ = new BehaviorSubject<RegionEndpoint[]>([]);

  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(config: RegionRouterConfig) {
    this.config = {
      regions: [...config.regions],
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 30_000,
      latencyThresholdMs: config.latencyThresholdMs ?? 500,
    };

    // Initialize endpoints with default state
    const initial: RegionEndpoint[] = this.config.regions.map((r) => ({
      region: r.region,
      url: r.url,
      latencyMs: Infinity,
      healthy: true,
      lastCheckedAt: 0,
    }));
    this.endpoints$.next(initial);
  }

  /**
   * Start periodic health checks.
   *
   * Performs an immediate health check on all endpoints, then schedules
   * periodic checks at the configured interval.
   *
   * @example
   * ```typescript
   * await router.start();
   * ```
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Immediate first check
    await this.checkAllEndpoints();

    this.healthCheckInterval = setInterval(() => {
      void this.checkAllEndpoints();
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Stop periodic health checks.
   *
   * @example
   * ```typescript
   * router.stop();
   * ```
   */
  stop(): void {
    this.isRunning = false;
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get the best (lowest-latency healthy) endpoint.
   *
   * Returns the healthy endpoint with the lowest measured latency.
   * If no healthy endpoints exist, returns the endpoint with the
   * lowest latency regardless of health status (failover).
   *
   * @returns The best endpoint, or null if no endpoints are configured
   *
   * @example
   * ```typescript
   * const best = router.getBestEndpoint();
   * if (best) {
   *   console.log('Using:', best.region, 'at', best.latencyMs, 'ms');
   * }
   * ```
   */
  getBestEndpoint(): RegionEndpoint | null {
    const endpoints = this.endpoints$.getValue();
    if (endpoints.length === 0) return null;

    // Prefer healthy endpoints sorted by latency
    const healthy = endpoints
      .filter((e) => e.healthy)
      .sort((a, b) => a.latencyMs - b.latencyMs);

    if (healthy.length > 0) {
      return healthy[0] ?? null;
    }

    // Failover: return lowest latency regardless of health
    const sorted = [...endpoints].sort((a, b) => a.latencyMs - b.latencyMs);
    return sorted[0] ?? null;
  }

  /**
   * Get the endpoint for a specific region.
   *
   * @param region - The cloud region to look up
   * @returns The endpoint for the region, or null if not configured
   *
   * @example
   * ```typescript
   * const ep = router.getEndpointForRegion('eu-west-1');
   * if (ep?.healthy) {
   *   console.log('EU West endpoint latency:', ep.latencyMs, 'ms');
   * }
   * ```
   */
  getEndpointForRegion(region: CloudRegion): RegionEndpoint | null {
    const endpoints = this.endpoints$.getValue();
    return endpoints.find((e) => e.region === region) ?? null;
  }

  /**
   * Check latency for a single URL.
   *
   * Measures the round-trip time to the given URL's health endpoint.
   *
   * @param url - The endpoint URL to check
   * @returns Latency in milliseconds, or Infinity on failure
   *
   * @example
   * ```typescript
   * const latency = await router.checkLatency('https://us-east-1.cloud.pocket-db.dev');
   * console.log('Latency:', latency, 'ms');
   * ```
   */
  async checkLatency(url: string): Promise<number> {
    const start = Date.now();

    try {
      await globalThis.fetch(`${url}/health`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5_000),
      });
      return Date.now() - start;
    } catch {
      return Infinity;
    }
  }

  /**
   * Get an observable of all endpoint states.
   *
   * @returns Observable that emits the current endpoint array on changes
   *
   * @example
   * ```typescript
   * router.getEndpoints$().subscribe(endpoints => {
   *   for (const ep of endpoints) {
   *     console.log(`${ep.region}: ${ep.healthy ? 'UP' : 'DOWN'} (${ep.latencyMs}ms)`);
   *   }
   * });
   * ```
   */
  getEndpoints$(): Observable<RegionEndpoint[]> {
    return this.endpoints$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get a snapshot of all endpoints.
   *
   * @returns Current array of all region endpoints
   */
  getEndpoints(): RegionEndpoint[] {
    return [...this.endpoints$.getValue()];
  }

  /**
   * Permanently destroy the router and release all resources.
   *
   * Stops health checks and completes all observables.
   * After calling destroy(), the router cannot be restarted.
   *
   * @example
   * ```typescript
   * router.stop();
   * router.destroy();
   * ```
   */
  destroy(): void {
    this.stop();
    this.destroy$.next();
    this.destroy$.complete();
    this.endpoints$.complete();
  }

  private async checkAllEndpoints(): Promise<void> {
    const current = this.endpoints$.getValue();
    const now = Date.now();

    const updated = await Promise.all(
      current.map(async (endpoint) => {
        const latencyMs = await this.checkLatency(endpoint.url);
        const healthy = latencyMs !== Infinity && latencyMs <= this.config.latencyThresholdMs;

        return {
          ...endpoint,
          latencyMs,
          healthy,
          lastCheckedAt: now,
        };
      }),
    );

    this.endpoints$.next(updated);
  }
}

/**
 * Create a region router instance.
 *
 * Factory function that creates a configured {@link RegionRouter}.
 *
 * @param config - Region router configuration
 * @returns A new RegionRouter instance
 *
 * @example Using custom regions
 * ```typescript
 * import { createRegionRouter } from '@pocket/cloud';
 *
 * const router = createRegionRouter({
 *   regions: [
 *     { region: 'us-east-1', url: 'https://us-east-1.cloud.pocket-db.dev' },
 *     { region: 'eu-west-1', url: 'https://eu-west-1.cloud.pocket-db.dev' },
 *   ],
 *   healthCheckIntervalMs: 15_000,
 * });
 *
 * await router.start();
 * ```
 *
 * @example Using all default regions
 * ```typescript
 * import { createRegionRouter, REGION_ENDPOINTS } from '@pocket/cloud';
 *
 * const router = createRegionRouter({
 *   regions: Object.entries(REGION_ENDPOINTS).map(([region, url]) => ({
 *     region: region as CloudRegion,
 *     url,
 *   })),
 * });
 * ```
 *
 * @see {@link RegionRouter}
 * @see {@link RegionRouterConfig}
 */
export function createRegionRouter(config: RegionRouterConfig): RegionRouter {
  return new RegionRouter(config);
}
