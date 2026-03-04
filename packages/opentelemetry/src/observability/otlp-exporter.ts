/**
 * OTLPMetricExporter — exports metrics to an OpenTelemetry Collector
 * or compatible OTLP endpoint using HTTP/JSON.
 */

import type { OTLPExportConfig } from './types.js';

// ── Types ────────────────────────────────────────────────

interface BufferedMetric {
  name: string;
  value: number;
  attributes: Record<string, string>;
  timestamp: number;
}

interface ExportStats {
  exported: number;
  failed: number;
  buffered: number;
}

// ── OTLPMetricExporter ───────────────────────────────────

export class OTLPMetricExporter {
  private readonly config: Required<
    Pick<OTLPExportConfig, 'endpoint' | 'protocol' | 'intervalMs' | 'batchSize' | 'serviceName'>
  > & { headers: Record<string, string>; resourceAttributes: Record<string, string> };

  private readonly buffer: BufferedMetric[] = [];
  private exportedCount = 0;
  private failedCount = 0;
  private autoExportTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(config: OTLPExportConfig) {
    this.config = {
      endpoint: config.endpoint,
      protocol: config.protocol,
      headers: config.headers ?? {},
      intervalMs: config.intervalMs ?? 60_000,
      batchSize: config.batchSize ?? 100,
      serviceName: config.serviceName ?? 'pocket',
      resourceAttributes: config.resourceAttributes ?? {},
    };
  }

  /**
   * Export a set of metrics to the OTLP endpoint.
   */
  async exportMetrics(
    metrics: Record<string, number | Record<string, number>>,
  ): Promise<{ success: boolean; error?: string }> {
    if (this.destroyed) return { success: false, error: 'Exporter destroyed' };

    const payload = this.buildPayload(metrics);

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        this.exportedCount += Object.keys(metrics).length;
        return { success: true };
      }

      const errorText = await response.text().catch(() => 'Unknown error');
      this.failedCount += Object.keys(metrics).length;
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    } catch (err) {
      this.failedCount += Object.keys(metrics).length;
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Flush all buffered metrics to the endpoint.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const metrics: Record<string, number> = {};
    for (const m of this.buffer.splice(0)) {
      metrics[m.name] = m.value;
    }

    await this.exportMetrics(metrics);
  }

  /**
   * Add a metric to the internal buffer.
   */
  addToBuffer(metric: string, value: number, attributes?: Record<string, string>): void {
    if (this.destroyed) return;

    this.buffer.push({
      name: metric,
      value,
      attributes: attributes ?? {},
      timestamp: Date.now(),
    });

    // Auto-flush when batch size is reached
    if (this.buffer.length >= this.config.batchSize) {
      void this.flush();
    }
  }

  /**
   * Start automatic periodic export of buffered metrics.
   */
  startAutoExport(): void {
    if (this.autoExportTimer || this.destroyed) return;
    this.autoExportTimer = setInterval(() => void this.flush(), this.config.intervalMs);
  }

  /**
   * Stop automatic export.
   */
  stopAutoExport(): void {
    if (this.autoExportTimer) {
      clearInterval(this.autoExportTimer);
      this.autoExportTimer = null;
    }
  }

  /**
   * Get export statistics.
   */
  getExportStats(): ExportStats {
    return {
      exported: this.exportedCount,
      failed: this.failedCount,
      buffered: this.buffer.length,
    };
  }

  /**
   * Destroy the exporter and release resources.
   */
  destroy(): void {
    this.destroyed = true;
    this.stopAutoExport();
    this.buffer.length = 0;
  }

  // ── Private ────────────────────────────────────────────

  private buildPayload(
    metrics: Record<string, number | Record<string, number>>,
  ): Record<string, unknown> {
    const now = Date.now() * 1_000_000; // nanoseconds
    const dataPoints: Array<Record<string, unknown>> = [];

    for (const [name, value] of Object.entries(metrics)) {
      if (typeof value === 'number') {
        dataPoints.push({
          name,
          gauge: {
            dataPoints: [
              {
                asDouble: value,
                timeUnixNano: now,
                attributes: this.buildAttributes(),
              },
            ],
          },
        });
      } else {
        // Nested record: expand to individual metrics
        for (const [subKey, subValue] of Object.entries(value)) {
          dataPoints.push({
            name: `${name}.${subKey}`,
            gauge: {
              dataPoints: [
                {
                  asDouble: subValue,
                  timeUnixNano: now,
                  attributes: this.buildAttributes(),
                },
              ],
            },
          });
        }
      }
    }

    return {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: this.config.serviceName } },
              ...Object.entries(this.config.resourceAttributes).map(([key, val]) => ({
                key,
                value: { stringValue: val },
              })),
            ],
          },
          scopeMetrics: [
            {
              scope: { name: '@pocket/opentelemetry', version: '0.1.0' },
              metrics: dataPoints,
            },
          ],
        },
      ],
    };
  }

  private buildAttributes(): Array<{ key: string; value: { stringValue: string } }> {
    return Object.entries(this.config.resourceAttributes).map(([key, val]) => ({
      key,
      value: { stringValue: val },
    }));
  }
}

/**
 * Create an OTLPMetricExporter instance.
 */
export function createOTLPMetricExporter(config: OTLPExportConfig): OTLPMetricExporter {
  return new OTLPMetricExporter(config);
}
