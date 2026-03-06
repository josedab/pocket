/**
 * ObservabilityPlatform — unified facade for database observability,
 * combining query analysis, alerting, metrics export, and dashboard data.
 */

import { BehaviorSubject, type Observable, Subject } from 'rxjs';

import { AlertManager } from './alert-manager.js';
import { OTLPMetricExporter } from './otlp-exporter.js';
import { QueryPerformanceAnalyzer } from './query-analyzer.js';
import type {
  CacheMetrics,
  ObservabilityDashboardData,
  ObservabilityPlatformConfig,
  ObservabilityState,
  QueryMetrics,
  StorageMetrics,
  SyncHealthMetrics,
} from './types.js';

// ── ObservabilityPlatform ────────────────────────────────

export class ObservabilityPlatform {
  private readonly config: Required<
    Omit<ObservabilityPlatformConfig, 'otlpExport'>
  >;

  private readonly _queryAnalyzer: QueryPerformanceAnalyzer;
  private readonly _alertManager: AlertManager;
  private readonly _exporter: OTLPMetricExporter | null;

  private latestSyncHealth: SyncHealthMetrics | null = null;
  private latestStorage: StorageMetrics | null = null;
  private latestCache: CacheMetrics | null = null;
  private writeCount = 0;
  private queryCount = 0;
  private startTime = Date.now();

  private readonly dashboardSubject = new Subject<ObservabilityDashboardData>();
  private readonly stateSubject: BehaviorSubject<ObservabilityState>;
  private destroyed = false;

  constructor(config: ObservabilityPlatformConfig = {}) {
    this.config = {
      enableQueryMetrics: config.enableQueryMetrics ?? true,
      enableStorageMetrics: config.enableStorageMetrics ?? true,
      enableSyncMetrics: config.enableSyncMetrics ?? true,
      enableCacheMetrics: config.enableCacheMetrics ?? true,
      slowQueryThresholdMs: config.slowQueryThresholdMs ?? 100,
      metricsRetentionCount: config.metricsRetentionCount ?? 10_000,
      enableAlerts: config.enableAlerts ?? true,
    };

    this._queryAnalyzer = new QueryPerformanceAnalyzer({
      slowQueryThresholdMs: this.config.slowQueryThresholdMs,
      maxLogSize: this.config.metricsRetentionCount,
    });

    this._alertManager = new AlertManager();

    this._exporter = config.otlpExport
      ? new OTLPMetricExporter(config.otlpExport)
      : null;

    this.stateSubject = new BehaviorSubject<ObservabilityState>(this.buildState());
  }

  /** The query performance analyzer. */
  get queryAnalyzer(): QueryPerformanceAnalyzer {
    return this._queryAnalyzer;
  }

  /** The alert manager. */
  get alertManager(): AlertManager {
    return this._alertManager;
  }

  /** The OTLP exporter (null if not configured). */
  get exporter(): OTLPMetricExporter | null {
    return this._exporter;
  }

  /**
   * Record query metrics and evaluate alert rules.
   */
  recordQueryMetrics(metrics: QueryMetrics): void {
    if (this.destroyed || !this.config.enableQueryMetrics) return;

    this._queryAnalyzer.recordQuery(metrics);
    this.queryCount++;

    if (this.config.enableAlerts) {
      this._alertManager.evaluate('query_time', metrics.executionTimeMs);
    }

    this.emitUpdate();
  }

  /**
   * Record sync health metrics.
   */
  recordSyncMetrics(metrics: SyncHealthMetrics): void {
    if (this.destroyed || !this.config.enableSyncMetrics) return;

    this.latestSyncHealth = metrics;

    if (this.config.enableAlerts && metrics.averageLatencyMs > 0) {
      this._alertManager.evaluate('sync_latency', metrics.averageLatencyMs);
    }

    this.emitUpdate();
  }

  /**
   * Record storage metrics.
   */
  recordStorageMetrics(metrics: StorageMetrics): void {
    if (this.destroyed || !this.config.enableStorageMetrics) return;

    this.latestStorage = metrics;

    if (this.config.enableAlerts) {
      this._alertManager.evaluate('storage_size', metrics.totalSize);
    }

    this.emitUpdate();
  }

  /**
   * Record cache metrics.
   */
  recordCacheMetrics(metrics: CacheMetrics): void {
    if (this.destroyed || !this.config.enableCacheMetrics) return;

    this.latestCache = metrics;

    if (this.config.enableAlerts) {
      this._alertManager.evaluate('cache_hit_rate', metrics.hitRate);
    }

    this.emitUpdate();
  }

  /**
   * Get a snapshot of the current dashboard data.
   */
  getDashboardData(): ObservabilityDashboardData {
    const stats = this._queryAnalyzer.getQueryStats();
    const elapsedSec = Math.max(1, (Date.now() - this.startTime) / 1000);

    const topQueries = this._queryAnalyzer.getTopQueries(10);
    const collectionMap = new Map<string, { queryCount: number; totalMs: number }>();

    // Build top collections from slow query entries
    for (const sq of this._queryAnalyzer.getSlowQueries(1000)) {
      const col = sq.queryMetrics.collection;
      const existing = collectionMap.get(col);
      if (existing) {
        existing.queryCount++;
        existing.totalMs += sq.queryMetrics.executionTimeMs;
      } else {
        collectionMap.set(col, { queryCount: 1, totalMs: sq.queryMetrics.executionTimeMs });
      }
    }

    const topCollections = Array.from(collectionMap.entries())
      .map(([name, data]) => ({
        name,
        queryCount: data.queryCount,
        avgTimeMs: data.queryCount > 0 ? data.totalMs / data.queryCount : 0,
      }))
      .sort((a, b) => b.queryCount - a.queryCount)
      .slice(0, 10);

    return {
      queryLatency: {
        p50: stats.p50,
        p95: stats.p95,
        p99: stats.p99,
        avg: stats.avgTimeMs,
      },
      throughput: {
        queriesPerSecond: this.queryCount / elapsedSec,
        writesPerSecond: this.writeCount / elapsedSec,
      },
      syncHealth: this.latestSyncHealth,
      storage: this.latestStorage,
      cache: this.latestCache,
      recentSlowQueries: this._queryAnalyzer.getSlowQueries(20),
      activeAlerts: this._alertManager.getActiveAlerts(),
      topCollections,
    };
  }

  /**
   * Observable stream of dashboard data updates.
   */
  get dashboard$(): Observable<ObservabilityDashboardData> {
    return this.dashboardSubject.asObservable();
  }

  /**
   * Observable of the platform state.
   */
  get state(): Observable<ObservabilityState> {
    return this.stateSubject.asObservable();
  }

  /**
   * Destroy the platform and all sub-components.
   */
  destroy(): void {
    this.destroyed = true;
    this._queryAnalyzer.destroy();
    this._alertManager.destroy();
    this._exporter?.destroy();
    this.dashboardSubject.complete();
    this.stateSubject.complete();
  }

  // ── Private ────────────────────────────────────────────

  private emitUpdate(): void {
    if (this.destroyed) return;
    this.dashboardSubject.next(this.getDashboardData());
    this.stateSubject.next(this.buildState());
  }

  private buildState(): ObservabilityState {
    return {
      queryMetricsCount: this._queryAnalyzer.getQueryStats().totalQueries,
      slowQueryCount: this._queryAnalyzer.getSlowQueries().length,
      alertRuleCount: this._alertManager.getRules().length,
      firedAlertCount: this._alertManager.getActiveAlerts().length,
      isExporting: this._exporter !== null,
    };
  }
}

/**
 * Create an ObservabilityPlatform instance.
 */
export function createObservabilityPlatform(
  config?: ObservabilityPlatformConfig,
): ObservabilityPlatform {
  return new ObservabilityPlatform(config);
}
