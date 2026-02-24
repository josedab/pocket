/**
 * ObservabilityDashboard — Real-time metrics collection and dashboard engine.
 *
 * Collects query performance, sync latency, cache hit rates, RLS evaluations,
 * and streaming pipeline throughput. Emits structured metrics for visualization.
 */

// No external dependencies — uses native event pattern

// ── Types ──────────────────────────────────────────────────

export interface ObservabilityConfig {
  /** Metrics collection interval in ms (default: 1000) */
  collectIntervalMs?: number;
  /** Max data points to retain per metric (default: 300 = 5 min at 1s) */
  maxDataPoints?: number;
  /** Enable alert system (default: true) */
  enableAlerts?: boolean;
}

export interface ObservabilityMetricPoint {
  timestamp: number;
  value: number;
}

export interface ObservabilityMetricSeries {
  name: string;
  unit: string;
  points: ObservabilityMetricPoint[];
  current: number;
  min: number;
  max: number;
  avg: number;
}

export interface DashboardSnapshot {
  timestamp: number;
  metrics: Record<string, ObservabilityMetricSeries>;
  alerts: DashboardAlert[];
  uptime: number;
}

export interface AlertRule {
  name: string;
  metric: string;
  condition: 'above' | 'below';
  threshold: number;
  cooldownMs: number;
}

export interface DashboardAlert {
  rule: string;
  metric: string;
  value: number;
  threshold: number;
  triggeredAt: number;
  message: string;
}

export type DashboardEvent =
  | { type: 'metric:recorded'; metric: string; value: number }
  | { type: 'alert:triggered'; alert: DashboardAlert }
  | { type: 'snapshot:updated'; snapshot: DashboardSnapshot };

// ── Implementation ────────────────────────────────────────

export class ObservabilityDashboard {
  private readonly config: Required<ObservabilityConfig>;
  private readonly metrics = new Map<
    string,
    { points: ObservabilityMetricPoint[]; unit: string }
  >();
  private readonly alertRules = new Map<string, AlertRule>();
  private readonly activeAlerts: DashboardAlert[] = [];
  private readonly lastAlertTime = new Map<string, number>();
  private readonly eventListeners: ((event: DashboardEvent) => void)[] = [];

  private collectTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();
  private destroyed = false;

  constructor(config: ObservabilityConfig = {}) {
    this.config = {
      collectIntervalMs: config.collectIntervalMs ?? 1000,
      maxDataPoints: config.maxDataPoints ?? 300,
      enableAlerts: config.enableAlerts ?? true,
    };

    // Register default metrics
    this.registerMetric('query.latency', 'ms');
    this.registerMetric('query.count', 'ops');
    this.registerMetric('sync.latency', 'ms');
    this.registerMetric('sync.errors', 'count');
    this.registerMetric('cache.hitRate', '%');
    this.registerMetric('rls.evaluations', 'ops');
    this.registerMetric('rls.denials', 'count');
    this.registerMetric('stream.throughput', 'docs/s');
    this.registerMetric('memory.usage', 'MB');
  }

  /**
   * Register a custom metric.
   */
  registerMetric(name: string, unit: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, { points: [], unit });
    }
  }

  /**
   * Record a metric value.
   */
  record(metric: string, value: number): void {
    const series = this.metrics.get(metric);
    if (!series) {
      this.registerMetric(metric, 'unknown');
      this.record(metric, value);
      return;
    }

    series.points.push({ timestamp: Date.now(), value });
    if (series.points.length > this.config.maxDataPoints) {
      series.points.shift();
    }

    this.emit({ type: 'metric:recorded', metric, value });

    // Check alerts
    if (this.config.enableAlerts) {
      this.checkAlerts(metric, value);
    }
  }

  /**
   * Add an alert rule.
   */
  addAlert(rule: AlertRule): void {
    this.alertRules.set(rule.name, rule);
  }

  /**
   * Remove an alert rule.
   */
  removeAlert(name: string): void {
    this.alertRules.delete(name);
  }

  /**
   * Start periodic snapshot collection.
   */
  start(): void {
    if (this.collectTimer) return;
    this.collectTimer = setInterval(() => {
      const snapshot = this.buildSnapshot();
      void 0;
      this.emit({ type: 'snapshot:updated', snapshot });
    }, this.config.collectIntervalMs);
  }

  /**
   * Stop periodic collection.
   */
  stop(): void {
    if (this.collectTimer) {
      clearInterval(this.collectTimer);
      this.collectTimer = null;
    }
  }

  /**
   * Get the current dashboard snapshot.
   */
  getSnapshot(): DashboardSnapshot {
    return this.buildSnapshot();
  }

  /**
   * Get a specific metric series.
   */
  getMetric(name: string): ObservabilityMetricSeries | null {
    const series = this.metrics.get(name);
    if (!series) return null;
    return this.buildSeries(name, series);
  }

  /**
   * Get all active alerts.
   */
  getAlerts(): DashboardAlert[] {
    return [...this.activeAlerts];
  }

  /**
   * Clear all metric data.
   */
  reset(): void {
    for (const series of this.metrics.values()) {
      series.points.length = 0;
    }
    this.activeAlerts.length = 0;
    this.lastAlertTime.clear();
  }

  /**
   * Subscribe to dashboard events.
   */
  onEvent(listener: (event: DashboardEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const idx = this.eventListeners.indexOf(listener);
      if (idx !== -1) this.eventListeners.splice(idx, 1);
    };
  }

  /**
   * Observable-like subscribe for events (compatibility).
   */
  get events$(): {
    subscribe: (listener: (event: DashboardEvent) => void) => { unsubscribe: () => void };
  } {
    return {
      subscribe: (listener: (event: DashboardEvent) => void) => {
        const unsub = this.onEvent(listener);
        return { unsubscribe: unsub };
      },
    };
  }

  /**
   * Destroy the dashboard.
   */
  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.eventListeners.length = 0;
  }

  // ── Private ────────────────────────────────────────────

  private emit(event: DashboardEvent): void {
    if (this.destroyed) return;
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private buildSnapshot(): DashboardSnapshot {
    const metrics: Record<string, ObservabilityMetricSeries> = {};
    for (const [name, series] of this.metrics) {
      metrics[name] = this.buildSeries(name, series);
    }

    return {
      timestamp: Date.now(),
      metrics,
      alerts: [...this.activeAlerts],
      uptime: Date.now() - this.startTime,
    };
  }

  private buildSeries(
    name: string,
    series: { points: ObservabilityMetricPoint[]; unit: string }
  ): ObservabilityMetricSeries {
    const points = series.points;
    const values = points.map((p) => p.value);
    const current = values[values.length - 1] ?? 0;
    const min = values.length > 0 ? Math.min(...values) : 0;
    const max = values.length > 0 ? Math.max(...values) : 0;
    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;

    return { name, unit: series.unit, points: [...points], current, min, max, avg };
  }

  private checkAlerts(metric: string, value: number): void {
    for (const rule of this.alertRules.values()) {
      if (rule.metric !== metric) continue;

      const lastFired = this.lastAlertTime.get(rule.name) ?? 0;
      if (Date.now() - lastFired < rule.cooldownMs) continue;

      let triggered = false;
      if (rule.condition === 'above' && value > rule.threshold) triggered = true;
      if (rule.condition === 'below' && value < rule.threshold) triggered = true;

      if (triggered) {
        const alert: DashboardAlert = {
          rule: rule.name,
          metric,
          value,
          threshold: rule.threshold,
          triggeredAt: Date.now(),
          message: `${metric} is ${rule.condition} threshold: ${value} ${rule.condition} ${rule.threshold}`,
        };
        this.activeAlerts.push(alert);
        this.lastAlertTime.set(rule.name, Date.now());
        this.emit({ type: 'alert:triggered', alert });
      }
    }
  }
}

export function createObservabilityDashboard(config?: ObservabilityConfig): ObservabilityDashboard {
  return new ObservabilityDashboard(config);
}
