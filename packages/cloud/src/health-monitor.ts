/**
 * HealthMonitor - Continuous health monitoring for Pocket Cloud sync.
 *
 * Monitors sync endpoint health, latency, and availability with
 * configurable check intervals and alerting thresholds.
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';
import type { CloudEndpoint } from './types.js';

export interface HealthCheckResult {
  /** Whether the endpoint is reachable */
  healthy: boolean;
  /** Response latency in milliseconds */
  latencyMs: number;
  /** HTTP status code if available */
  statusCode: number | null;
  /** Timestamp of the check */
  checkedAt: number;
  /** Consecutive failures count */
  consecutiveFailures: number;
  /** Error message if unhealthy */
  error: string | null;
}

export interface HealthMonitorConfig {
  /** Interval between health checks in ms. @default 30000 */
  checkIntervalMs?: number;
  /** Request timeout in ms. @default 5000 */
  timeoutMs?: number;
  /** Number of consecutive failures before alerting. @default 3 */
  failureThreshold?: number;
  /** Latency threshold in ms that triggers a warning. @default 1000 */
  latencyWarningMs?: number;
  /** Whether to start monitoring immediately. @default true */
  autoStart?: boolean;
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthSummary {
  status: HealthStatus;
  lastCheck: HealthCheckResult | null;
  uptimePercent: number;
  avgLatencyMs: number;
  totalChecks: number;
  totalFailures: number;
}

export class HealthMonitor {
  private readonly endpoint: CloudEndpoint;
  private readonly config: Required<HealthMonitorConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly status$ = new BehaviorSubject<HealthStatus>('unknown');
  private readonly lastCheck$ = new BehaviorSubject<HealthCheckResult | null>(null);

  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private totalChecks = 0;
  private totalFailures = 0;
  private totalLatency = 0;
  private isRunning = false;

  constructor(endpoint: CloudEndpoint, config: HealthMonitorConfig = {}) {
    this.endpoint = endpoint;
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 30_000,
      timeoutMs: config.timeoutMs ?? 5_000,
      failureThreshold: config.failureThreshold ?? 3,
      latencyWarningMs: config.latencyWarningMs ?? 1_000,
      autoStart: config.autoStart ?? true,
    };

    if (this.config.autoStart) {
      this.start();
    }
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Immediate first check
    void this.performCheck();

    this.checkInterval = setInterval(() => {
      void this.performCheck();
    }, this.config.checkIntervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  getStatus(): Observable<HealthStatus> {
    return this.status$.asObservable().pipe(takeUntil(this.destroy$));
  }

  getLastCheck(): Observable<HealthCheckResult | null> {
    return this.lastCheck$.asObservable().pipe(takeUntil(this.destroy$));
  }

  getCurrentStatus(): HealthStatus {
    return this.status$.getValue();
  }

  getSummary(): HealthSummary {
    return {
      status: this.status$.getValue(),
      lastCheck: this.lastCheck$.getValue(),
      uptimePercent: this.totalChecks > 0
        ? ((this.totalChecks - this.totalFailures) / this.totalChecks) * 100
        : 0,
      avgLatencyMs: this.totalChecks > 0
        ? this.totalLatency / this.totalChecks
        : 0,
      totalChecks: this.totalChecks,
      totalFailures: this.totalFailures,
    };
  }

  async forceCheck(): Promise<HealthCheckResult> {
    return this.performCheck();
  }

  destroy(): void {
    this.stop();
    this.destroy$.next();
    this.destroy$.complete();
    this.status$.complete();
    this.lastCheck$.complete();
  }

  private async performCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    let result: HealthCheckResult;

    try {
      const response = await globalThis.fetch(this.endpoint.httpUrl + '/health', {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      const latencyMs = Date.now() - start;
      this.totalLatency += latencyMs;
      this.totalChecks++;

      if (response.ok) {
        this.consecutiveFailures = 0;
        result = {
          healthy: true,
          latencyMs,
          statusCode: response.status,
          checkedAt: Date.now(),
          consecutiveFailures: 0,
          error: null,
        };
      } else {
        this.consecutiveFailures++;
        this.totalFailures++;
        result = {
          healthy: false,
          latencyMs,
          statusCode: response.status,
          checkedAt: Date.now(),
          consecutiveFailures: this.consecutiveFailures,
          error: `HTTP ${response.status} ${response.statusText}`,
        };
      }
    } catch (error) {
      const latencyMs = Date.now() - start;
      this.totalLatency += latencyMs;
      this.totalChecks++;
      this.consecutiveFailures++;
      this.totalFailures++;

      result = {
        healthy: false,
        latencyMs,
        statusCode: null,
        checkedAt: Date.now(),
        consecutiveFailures: this.consecutiveFailures,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    this.lastCheck$.next(result);
    this.updateStatus(result);
    return result;
  }

  private updateStatus(result: HealthCheckResult): void {
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.status$.next('unhealthy');
    } else if (!result.healthy || result.latencyMs > this.config.latencyWarningMs) {
      this.status$.next('degraded');
    } else {
      this.status$.next('healthy');
    }
  }
}

export function createHealthMonitor(
  endpoint: CloudEndpoint,
  config?: HealthMonitorConfig
): HealthMonitor {
  return new HealthMonitor(endpoint, config);
}
