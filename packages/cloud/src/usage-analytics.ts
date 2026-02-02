/**
 * Usage Analytics — tracks and aggregates cloud usage metrics over time.
 */

import type { CloudTier } from './types.js';
import { TIER_LIMITS } from './types.js';

export interface UsageDataPoint {
  timestamp: number;
  operations: number;
  bytesTransferred: number;
  activeConnections: number;
  errors: number;
}

export interface UsageSummary {
  totalOperations: number;
  totalBytesTransferred: number;
  totalErrors: number;
  peakConnections: number;
  avgOperationsPerHour: number;
  errorRate: number;
  periodStart: number;
  periodEnd: number;
  dataPoints: number;
}

export interface UsageAlert {
  type: 'warning' | 'critical';
  metric: 'operations' | 'storage' | 'connections' | 'errors';
  message: string;
  currentValue: number;
  threshold: number;
  timestamp: number;
}

/**
 * Tracks, aggregates, and alerts on cloud usage metrics.
 *
 * @example
 * ```typescript
 * const analytics = new UsageAnalytics('pro');
 * analytics.record({ operations: 100, bytesTransferred: 50000, activeConnections: 3, errors: 0 });
 * const summary = analytics.getSummary();
 * const alerts = analytics.checkAlerts();
 * ```
 */
export class UsageAnalytics {
  private readonly dataPoints: UsageDataPoint[] = [];
  private readonly alerts: UsageAlert[] = [];
  private readonly tier: CloudTier;
  private totalOperations = 0;
  private totalBytes = 0;
  private totalErrors = 0;
  private peakConnections = 0;

  /** Warning threshold as fraction of limit. @default 0.8 */
  warningThreshold = 0.8;
  /** Critical threshold as fraction of limit. @default 0.95 */
  criticalThreshold = 0.95;

  constructor(tier: CloudTier = 'free') {
    this.tier = tier;
  }

  /**
   * Record a usage data point.
   */
  record(data: Omit<UsageDataPoint, 'timestamp'>): void {
    const point: UsageDataPoint = {
      ...data,
      timestamp: Date.now(),
    };

    this.dataPoints.push(point);
    this.totalOperations += data.operations;
    this.totalBytes += data.bytesTransferred;
    this.totalErrors += data.errors;
    if (data.activeConnections > this.peakConnections) {
      this.peakConnections = data.activeConnections;
    }

    // Keep last 10,000 data points
    if (this.dataPoints.length > 10_000) {
      this.dataPoints.splice(0, this.dataPoints.length - 10_000);
    }
  }

  /**
   * Get a usage summary for a time range.
   */
  getSummary(since?: number): UsageSummary {
    const cutoff = since ?? 0;
    const filtered = this.dataPoints.filter((p) => p.timestamp >= cutoff);

    if (filtered.length === 0) {
      return {
        totalOperations: 0,
        totalBytesTransferred: 0,
        totalErrors: 0,
        peakConnections: 0,
        avgOperationsPerHour: 0,
        errorRate: 0,
        periodStart: cutoff,
        periodEnd: Date.now(),
        dataPoints: 0,
      };
    }

    const ops = filtered.reduce((s, p) => s + p.operations, 0);
    const bytes = filtered.reduce((s, p) => s + p.bytesTransferred, 0);
    const errors = filtered.reduce((s, p) => s + p.errors, 0);
    const peak = Math.max(...filtered.map((p) => p.activeConnections));

    const start = filtered[0]!.timestamp;
    const end = filtered[filtered.length - 1]!.timestamp;
    const hours = Math.max((end - start) / (1000 * 60 * 60), 1);

    return {
      totalOperations: ops,
      totalBytesTransferred: bytes,
      totalErrors: errors,
      peakConnections: peak,
      avgOperationsPerHour: ops / hours,
      errorRate: ops > 0 ? errors / ops : 0,
      periodStart: start,
      periodEnd: end,
      dataPoints: filtered.length,
    };
  }

  /**
   * Check for usage alerts based on tier limits.
   */
  checkAlerts(): UsageAlert[] {
    const newAlerts: UsageAlert[] = [];
    const limits = TIER_LIMITS[this.tier];
    const now = Date.now();

    // Operations check
    if (limits.maxOperations !== Infinity) {
      const ratio = this.totalOperations / limits.maxOperations;
      if (ratio >= this.criticalThreshold) {
        newAlerts.push({
          type: 'critical',
          metric: 'operations',
          message: `Operations at ${(ratio * 100).toFixed(1)}% of limit`,
          currentValue: this.totalOperations,
          threshold: limits.maxOperations,
          timestamp: now,
        });
      } else if (ratio >= this.warningThreshold) {
        newAlerts.push({
          type: 'warning',
          metric: 'operations',
          message: `Operations at ${(ratio * 100).toFixed(1)}% of limit`,
          currentValue: this.totalOperations,
          threshold: limits.maxOperations,
          timestamp: now,
        });
      }
    }

    // Connections check
    if (limits.maxConnections !== Infinity) {
      const ratio = this.peakConnections / limits.maxConnections;
      if (ratio >= this.criticalThreshold) {
        newAlerts.push({
          type: 'critical',
          metric: 'connections',
          message: `Peak connections at ${(ratio * 100).toFixed(1)}% of limit`,
          currentValue: this.peakConnections,
          threshold: limits.maxConnections,
          timestamp: now,
        });
      } else if (ratio >= this.warningThreshold) {
        newAlerts.push({
          type: 'warning',
          metric: 'connections',
          message: `Peak connections at ${(ratio * 100).toFixed(1)}% of limit`,
          currentValue: this.peakConnections,
          threshold: limits.maxConnections,
          timestamp: now,
        });
      }
    }

    // Error rate check (> 5% is warning, > 10% is critical)
    if (this.totalOperations > 0) {
      const errorRate = this.totalErrors / this.totalOperations;
      if (errorRate >= 0.1) {
        newAlerts.push({
          type: 'critical',
          metric: 'errors',
          message: `Error rate at ${(errorRate * 100).toFixed(1)}%`,
          currentValue: this.totalErrors,
          threshold: this.totalOperations * 0.1,
          timestamp: now,
        });
      } else if (errorRate >= 0.05) {
        newAlerts.push({
          type: 'warning',
          metric: 'errors',
          message: `Error rate at ${(errorRate * 100).toFixed(1)}%`,
          currentValue: this.totalErrors,
          threshold: this.totalOperations * 0.05,
          timestamp: now,
        });
      }
    }

    this.alerts.push(...newAlerts);
    return newAlerts;
  }

  /**
   * Get all historical alerts.
   */
  getAlertHistory(): readonly UsageAlert[] {
    return this.alerts;
  }

  /**
   * Get raw data points.
   */
  getDataPoints(since?: number): UsageDataPoint[] {
    if (!since) return [...this.dataPoints];
    return this.dataPoints.filter((p) => p.timestamp >= since);
  }

  /**
   * Get current totals.
   */
  getTotals(): { operations: number; bytes: number; errors: number; peakConnections: number } {
    return {
      operations: this.totalOperations,
      bytes: this.totalBytes,
      errors: this.totalErrors,
      peakConnections: this.peakConnections,
    };
  }

  /**
   * Reset all counters and data.
   */
  reset(): void {
    this.dataPoints.length = 0;
    this.alerts.length = 0;
    this.totalOperations = 0;
    this.totalBytes = 0;
    this.totalErrors = 0;
    this.peakConnections = 0;
  }
}

/**
 * Create a UsageAnalytics instance.
 */
export function createUsageAnalytics(tier?: CloudTier): UsageAnalytics {
  return new UsageAnalytics(tier);
}
