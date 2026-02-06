/**
 * Metrics Dashboard — aggregates operation metrics into a queryable
 * dashboard data provider for real-time performance monitoring.
 */

export interface MetricPoint {
  timestamp: number;
  value: number;
}

export interface MetricSeries {
  name: string;
  points: MetricPoint[];
  unit: string;
}

export interface DashboardConfig {
  /** Aggregation window in ms (default: 60000 — 1 minute) */
  windowMs?: number;
  /** Maximum data points per series (default: 60) */
  maxPoints?: number;
  /** Metrics to track (default: all) */
  enabledMetrics?: string[];
}

export interface DashboardSummary {
  opsPerSecond: number;
  avgLatencyMs: number;
  errorRate: number;
  activeCollections: number;
  totalOps: number;
  uptime: number;
}

/**
 * Aggregates database operation metrics for dashboard visualization.
 */
export class MetricsDashboard {
  private readonly config: Required<DashboardConfig>;
  private readonly series = new Map<string, MetricPoint[]>();
  private readonly counters = new Map<string, number>();
  private totalOps = 0;
  private totalErrors = 0;
  private totalLatency = 0;
  private readonly activeCollections = new Set<string>();
  private readonly startTime = Date.now();

  constructor(config: DashboardConfig = {}) {
    this.config = {
      windowMs: config.windowMs ?? 60_000,
      maxPoints: config.maxPoints ?? 60,
      enabledMetrics: config.enabledMetrics ?? [],
    };
  }

  /**
   * Record an operation metric.
   */
  recordOperation(
    collection: string,
    operation: string,
    durationMs: number,
    success: boolean,
  ): void {
    this.totalOps++;
    this.totalLatency += durationMs;
    this.activeCollections.add(collection);

    if (!success) this.totalErrors++;

    const key = `${collection}.${operation}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);

    // Record latency series
    this.addPoint(`latency.${operation}`, durationMs);
    this.addPoint('ops.total', 1);

    if (!success) {
      this.addPoint('errors.total', 1);
    }
  }

  /**
   * Record a sync metric.
   */
  recordSync(direction: 'push' | 'pull', durationMs: number, docCount: number): void {
    this.addPoint(`sync.${direction}.duration`, durationMs);
    this.addPoint(`sync.${direction}.docs`, docCount);
  }

  /**
   * Get the current dashboard summary.
   */
  getSummary(): DashboardSummary {
    const uptime = (Date.now() - this.startTime) / 1000;
    return {
      opsPerSecond: uptime > 0 ? this.totalOps / uptime : 0,
      avgLatencyMs: this.totalOps > 0 ? this.totalLatency / this.totalOps : 0,
      errorRate: this.totalOps > 0 ? this.totalErrors / this.totalOps : 0,
      activeCollections: this.activeCollections.size,
      totalOps: this.totalOps,
      uptime,
    };
  }

  /**
   * Get a specific metric series.
   */
  getSeries(name: string): MetricSeries | undefined {
    const points = this.series.get(name);
    if (!points) return undefined;
    return { name, points: [...points], unit: this.inferUnit(name) };
  }

  /**
   * Get all available series names.
   */
  getSeriesNames(): string[] {
    return Array.from(this.series.keys());
  }

  /**
   * Get operation counts grouped by collection and operation.
   */
  getOperationCounts(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  /**
   * Get a time-windowed view of recent operations.
   */
  getRecentWindow(windowMs?: number): MetricPoint[] {
    const window = windowMs ?? this.config.windowMs;
    const cutoff = Date.now() - window;
    const totalSeries = this.series.get('ops.total') ?? [];
    return totalSeries.filter((p) => p.timestamp >= cutoff);
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.series.clear();
    this.counters.clear();
    this.totalOps = 0;
    this.totalErrors = 0;
    this.totalLatency = 0;
    this.activeCollections.clear();
  }

  private addPoint(seriesName: string, value: number): void {
    if (
      this.config.enabledMetrics.length > 0 &&
      !this.config.enabledMetrics.some((m) => seriesName.startsWith(m))
    ) {
      return;
    }

    if (!this.series.has(seriesName)) {
      this.series.set(seriesName, []);
    }

    const points = this.series.get(seriesName)!;
    points.push({ timestamp: Date.now(), value });

    while (points.length > this.config.maxPoints) {
      points.shift();
    }
  }

  private inferUnit(name: string): string {
    if (name.includes('latency') || name.includes('duration')) return 'ms';
    if (name.includes('rate') || name.includes('error')) return '%';
    return 'count';
  }
}

/**
 * Create a MetricsDashboard instance.
 */
export function createMetricsDashboard(config?: DashboardConfig): MetricsDashboard {
  return new MetricsDashboard(config);
}
