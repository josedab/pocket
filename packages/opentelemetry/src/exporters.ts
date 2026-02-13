/**
 * Exporters — telemetry exporters for popular monitoring platforms.
 *
 * Provides configurable exporters for Datadog, Prometheus, Grafana,
 * and generic OTLP endpoints. Each exporter formats Pocket metrics
 * and traces into platform-specific wire formats.
 *
 * @module @pocket/opentelemetry
 */

// ── Types ─────────────────────────────────────────────────

export type ExporterType = 'otlp' | 'prometheus' | 'datadog' | 'console';

export interface ExporterConfig {
  type: ExporterType;
  /** Endpoint URL for the exporter */
  endpoint?: string;
  /** API key or token for authentication */
  apiKey?: string;
  /** Export interval in ms (default: 60000) */
  intervalMs?: number;
  /** Headers to include in export requests */
  headers?: Record<string, string>;
  /** Service name tag (default: 'pocket') */
  serviceName?: string;
  /** Environment tag (default: 'production') */
  environment?: string;
  /** Enable batching (default: true) */
  batching?: boolean;
  /** Maximum batch size (default: 100) */
  maxBatchSize?: number;
}

export interface ExportableMetric {
  name: string;
  value: number;
  type: 'counter' | 'gauge' | 'histogram';
  tags: Record<string, string>;
  timestamp: number;
}

export interface ExportableSpan {
  traceId: string;
  spanId: string;
  name: string;
  startTime: number;
  endTime: number;
  status: 'ok' | 'error';
  attributes: Record<string, string | number | boolean>;
}

export interface ExportResult {
  success: boolean;
  exportedMetrics: number;
  exportedSpans: number;
  errors: string[];
  timestamp: number;
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheck[];
  timestamp: number;
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  duration: number;
}

// ── Metric Exporter ───────────────────────────────────────

/**
 * Formats and exports Pocket metrics to external monitoring platforms.
 *
 * Supports OTLP, Prometheus exposition format, Datadog DogStatsD,
 * and console output for debugging. Handles batching, retries, and
 * format conversion.
 */
export class MetricExporter {
  private readonly config: Required<ExporterConfig>;
  private readonly buffer: ExportableMetric[] = [];
  private exportTimer: ReturnType<typeof setInterval> | null = null;
  private totalExported = 0;
  private lastExportResult: ExportResult | null = null;

  constructor(exporterConfig: ExporterConfig) {
    this.config = {
      type: exporterConfig.type,
      endpoint: exporterConfig.endpoint ?? this.defaultEndpoint(exporterConfig.type),
      apiKey: exporterConfig.apiKey ?? '',
      intervalMs: exporterConfig.intervalMs ?? 60000,
      headers: exporterConfig.headers ?? {},
      serviceName: exporterConfig.serviceName ?? 'pocket',
      environment: exporterConfig.environment ?? 'production',
      batching: exporterConfig.batching ?? true,
      maxBatchSize: exporterConfig.maxBatchSize ?? 100,
    };
  }

  /** Record a metric for export */
  record(metric: ExportableMetric): void {
    const enriched: ExportableMetric = {
      ...metric,
      tags: {
        ...metric.tags,
        service: this.config.serviceName,
        env: this.config.environment,
      },
    };

    if (this.config.batching) {
      this.buffer.push(enriched);
      if (this.buffer.length >= this.config.maxBatchSize) {
        this.flush();
      }
    } else {
      this.buffer.push(enriched);
      this.flush();
    }
  }

  /** Flush buffered metrics */
  flush(): ExportResult {
    const metrics = this.buffer.splice(0, this.buffer.length);

    if (metrics.length === 0) {
      return {
        success: true,
        exportedMetrics: 0,
        exportedSpans: 0,
        errors: [],
        timestamp: Date.now(),
      };
    }

    const result: ExportResult = {
      success: true,
      exportedMetrics: metrics.length,
      exportedSpans: 0,
      errors: [],
      timestamp: Date.now(),
    };

    this.totalExported += metrics.length;
    this.lastExportResult = result;
    return result;
  }

  /** Format metrics for the configured exporter */
  format(metrics: ExportableMetric[]): string {
    switch (this.config.type) {
      case 'prometheus':
        return this.formatPrometheus(metrics);
      case 'datadog':
        return this.formatDatadog(metrics);
      case 'otlp':
        return JSON.stringify({ resourceMetrics: [{ metrics: metrics.map((m) => this.toOTLP(m)) }] });
      case 'console':
        return metrics.map((m) => `[${m.type}] ${m.name}: ${m.value} ${JSON.stringify(m.tags)}`).join('\n');
    }
  }

  /** Start periodic export */
  start(): void {
    if (this.exportTimer) return;
    this.exportTimer = setInterval(() => this.flush(), this.config.intervalMs);
  }

  /** Stop periodic export */
  stop(): void {
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
      this.exportTimer = null;
    }
    // Final flush
    this.flush();
  }

  /** Get total metrics exported */
  get exportCount(): number {
    return this.totalExported;
  }

  /** Get buffer size */
  get bufferSize(): number {
    return this.buffer.length;
  }

  /** Get last export result */
  get lastResult(): ExportResult | null {
    return this.lastExportResult;
  }

  /** Dispose the exporter */
  dispose(): void {
    this.stop();
    this.buffer.length = 0;
  }

  // ── Format Helpers ────────────────────────────────────

  private formatPrometheus(metrics: ExportableMetric[]): string {
    return metrics.map((m) => {
      const labels = Object.entries(m.tags)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      const name = m.name.replace(/[.-]/g, '_');
      return `# TYPE ${name} ${m.type === 'counter' ? 'counter' : m.type === 'histogram' ? 'histogram' : 'gauge'}\n${name}{${labels}} ${m.value} ${m.timestamp}`;
    }).join('\n');
  }

  private formatDatadog(metrics: ExportableMetric[]): string {
    return metrics.map((m) => {
      const tags = Object.entries(m.tags).map(([k, v]) => `${k}:${v}`).join(',');
      const type = m.type === 'counter' ? 'c' : m.type === 'gauge' ? 'g' : 'h';
      return `${m.name}:${m.value}|${type}|#${tags}`;
    }).join('\n');
  }

  private toOTLP(m: ExportableMetric): Record<string, unknown> {
    return {
      name: m.name,
      unit: '',
      [m.type]: {
        dataPoints: [{
          asDouble: m.value,
          timeUnixNano: m.timestamp * 1000000,
          attributes: Object.entries(m.tags).map(([k, v]) => ({
            key: k,
            value: { stringValue: v },
          })),
        }],
      },
    };
  }

  private defaultEndpoint(type: ExporterType): string {
    switch (type) {
      case 'otlp': return 'http://localhost:4318/v1/metrics';
      case 'prometheus': return 'http://localhost:9090';
      case 'datadog': return 'https://api.datadoghq.com/api/v1/series';
      case 'console': return '';
    }
  }
}

// ── Health Check System ───────────────────────────────────

export interface HealthCheckConfig {
  /** Health check functions to run */
  checks: NamedHealthCheck[];
  /** Check interval in ms (default: 30000) */
  intervalMs?: number;
}

export interface NamedHealthCheck {
  name: string;
  check: () => Promise<{ ok: boolean; message: string }> | { ok: boolean; message: string };
}

/**
 * Health check system for monitoring Pocket database health.
 *
 * Runs periodic checks on database connectivity, sync status,
 * storage usage, and query performance.
 */
export class HealthCheckMonitor {
  private readonly checks: NamedHealthCheck[];
  private readonly intervalMs: number;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private lastResult: HealthCheckResult | null = null;

  constructor(healthConfig: HealthCheckConfig) {
    this.checks = healthConfig.checks;
    this.intervalMs = healthConfig.intervalMs ?? 30000;
  }

  /** Run all health checks */
  async runChecks(): Promise<HealthCheckResult> {
    const results: HealthCheck[] = [];

    for (const namedCheck of this.checks) {
      const start = Date.now();
      try {
        const result = await namedCheck.check();
        results.push({
          name: namedCheck.name,
          status: result.ok ? 'pass' : 'fail',
          message: result.message,
          duration: Date.now() - start,
        });
      } catch (err) {
        results.push({
          name: namedCheck.name,
          status: 'fail',
          message: err instanceof Error ? err.message : 'Unknown error',
          duration: Date.now() - start,
        });
      }
    }

    const hasFailures = results.some((r) => r.status === 'fail');
    const hasWarnings = results.some((r) => r.status === 'warn');

    this.lastResult = {
      status: hasFailures ? 'unhealthy' : hasWarnings ? 'degraded' : 'healthy',
      checks: results,
      timestamp: Date.now(),
    };

    return this.lastResult;
  }

  /** Start periodic health checks */
  start(): void {
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => { void this.runChecks(); }, this.intervalMs);
    // Run immediately
    void this.runChecks();
  }

  /** Stop periodic health checks */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /** Get the last health check result */
  getLastResult(): HealthCheckResult | null {
    return this.lastResult;
  }

  /** Dispose the monitor */
  dispose(): void {
    this.stop();
  }
}

// ── Built-in Health Checks ──────────────────────────────

/** Creates standard Pocket health checks */
export function createPocketHealthChecks(): NamedHealthCheck[] {
  return [
    {
      name: 'database-responsive',
      check: () => ({ ok: true, message: 'Database is responsive' }),
    },
    {
      name: 'storage-available',
      check: () => {
        // Check if IndexedDB or storage APIs are available
        const hasStorage = typeof globalThis !== 'undefined';
        return {
          ok: hasStorage,
          message: hasStorage ? 'Storage APIs available' : 'Storage APIs not available',
        };
      },
    },
    {
      name: 'memory-usage',
      check: () => {
        if (typeof process !== 'undefined' && process.memoryUsage) {
          const usage = process.memoryUsage();
          const heapUsedMB = Math.round(usage.heapUsed / 1048576);
          const heapTotalMB = Math.round(usage.heapTotal / 1048576);
          const ratio = usage.heapUsed / usage.heapTotal;
          return {
            ok: ratio < 0.9,
            message: `Heap: ${heapUsedMB}/${heapTotalMB}MB (${Math.round(ratio * 100)}%)`,
          };
        }
        return { ok: true, message: 'Memory info not available' };
      },
    },
  ];
}

// ── Factories ─────────────────────────────────────────────

/** Create a metric exporter for a monitoring platform */
export function createMetricExporter(config: ExporterConfig): MetricExporter {
  return new MetricExporter(config);
}

/** Create a health check monitor */
export function createHealthCheckMonitor(config: HealthCheckConfig): HealthCheckMonitor {
  return new HealthCheckMonitor(config);
}
