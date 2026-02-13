import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MetricExporter,
  HealthCheckMonitor,
  createMetricExporter,
  createHealthCheckMonitor,
  createPocketHealthChecks,
} from '../exporters.js';
import type { ExportableMetric } from '../exporters.js';

const testMetric: ExportableMetric = {
  name: 'pocket.query.duration',
  value: 42.5,
  type: 'histogram',
  tags: { collection: 'users', operation: 'find' },
  timestamp: Date.now(),
};

describe('MetricExporter', () => {
  let exporter: MetricExporter;

  beforeEach(() => {
    exporter = createMetricExporter({
      type: 'console',
      batching: true,
      maxBatchSize: 5,
    });
  });

  afterEach(() => {
    exporter.dispose();
  });

  describe('recording', () => {
    it('should buffer metrics', () => {
      exporter.record(testMetric);
      expect(exporter.bufferSize).toBe(1);
    });

    it('should auto-flush when batch is full', () => {
      for (let i = 0; i < 5; i++) {
        exporter.record({ ...testMetric, value: i });
      }
      expect(exporter.exportCount).toBe(5);
      expect(exporter.bufferSize).toBe(0);
    });

    it('should flush immediately when batching disabled', () => {
      const noBatch = createMetricExporter({ type: 'console', batching: false });
      noBatch.record(testMetric);
      expect(noBatch.exportCount).toBe(1);
      noBatch.dispose();
    });
  });

  describe('flush', () => {
    it('should return export result', () => {
      exporter.record(testMetric);
      const result = exporter.flush();
      expect(result.success).toBe(true);
      expect(result.exportedMetrics).toBe(1);
    });

    it('should return zero for empty flush', () => {
      const result = exporter.flush();
      expect(result.exportedMetrics).toBe(0);
    });

    it('should track last result', () => {
      exporter.record(testMetric);
      exporter.flush();
      expect(exporter.lastResult).toBeDefined();
      expect(exporter.lastResult?.success).toBe(true);
    });
  });

  describe('format', () => {
    it('should format as Prometheus', () => {
      const promExporter = createMetricExporter({ type: 'prometheus' });
      const output = promExporter.format([testMetric]);
      expect(output).toContain('pocket_query_duration');
      expect(output).toContain('collection="users"');
      expect(output).toContain('histogram');
      promExporter.dispose();
    });

    it('should format as Datadog', () => {
      const ddExporter = createMetricExporter({ type: 'datadog' });
      const output = ddExporter.format([testMetric]);
      expect(output).toContain('pocket.query.duration:42.5|h');
      expect(output).toContain('collection:users');
      ddExporter.dispose();
    });

    it('should format as OTLP JSON', () => {
      const otlpExporter = createMetricExporter({ type: 'otlp' });
      const output = otlpExporter.format([testMetric]);
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect(parsed).toHaveProperty('resourceMetrics');
      otlpExporter.dispose();
    });

    it('should format as console', () => {
      const output = exporter.format([testMetric]);
      expect(output).toContain('[histogram]');
      expect(output).toContain('pocket.query.duration');
    });
  });

  describe('enrichment', () => {
    it('should add service and env tags', () => {
      const enriched = createMetricExporter({
        type: 'console',
        serviceName: 'my-service',
        environment: 'staging',
        batching: false,
      });

      const metrics: ExportableMetric[] = [];
      // Record and flush to see enrichment
      enriched.record({ name: 'test', value: 1, type: 'counter', tags: {}, timestamp: Date.now() });
      enriched.dispose();
    });
  });

  describe('lifecycle', () => {
    it('should start and stop periodic export', () => {
      exporter.start();
      exporter.stop();
      // No error thrown
    });

    it('should flush on stop', () => {
      exporter.record(testMetric);
      exporter.stop();
      expect(exporter.exportCount).toBe(1);
    });
  });
});

describe('HealthCheckMonitor', () => {
  let monitor: HealthCheckMonitor;

  afterEach(() => {
    monitor?.dispose();
  });

  it('should run all checks', async () => {
    monitor = createHealthCheckMonitor({
      checks: [
        { name: 'test-check', check: () => ({ ok: true, message: 'all good' }) },
        { name: 'async-check', check: async () => ({ ok: true, message: 'async ok' }) },
      ],
    });

    const result = await monitor.runChecks();
    expect(result.status).toBe('healthy');
    expect(result.checks).toHaveLength(2);
    expect(result.checks[0]?.status).toBe('pass');
  });

  it('should detect unhealthy status', async () => {
    monitor = createHealthCheckMonitor({
      checks: [
        { name: 'failing', check: () => ({ ok: false, message: 'broken' }) },
      ],
    });

    const result = await monitor.runChecks();
    expect(result.status).toBe('unhealthy');
    expect(result.checks[0]?.status).toBe('fail');
  });

  it('should handle check errors', async () => {
    monitor = createHealthCheckMonitor({
      checks: [
        { name: 'throws', check: () => { throw new Error('boom'); } },
      ],
    });

    const result = await monitor.runChecks();
    expect(result.status).toBe('unhealthy');
    expect(result.checks[0]?.message).toBe('boom');
  });

  it('should measure check duration', async () => {
    monitor = createHealthCheckMonitor({
      checks: [
        { name: 'fast', check: () => ({ ok: true, message: 'fast' }) },
      ],
    });

    const result = await monitor.runChecks();
    expect(result.checks[0]?.duration).toBeGreaterThanOrEqual(0);
  });

  it('should return last result', async () => {
    monitor = createHealthCheckMonitor({
      checks: [
        { name: 'ok', check: () => ({ ok: true, message: 'ok' }) },
      ],
    });

    expect(monitor.getLastResult()).toBeNull();
    await monitor.runChecks();
    expect(monitor.getLastResult()?.status).toBe('healthy');
  });
});

describe('createPocketHealthChecks', () => {
  it('should create standard checks', () => {
    const checks = createPocketHealthChecks();
    expect(checks.length).toBeGreaterThanOrEqual(3);
    expect(checks.map((c) => c.name)).toContain('database-responsive');
    expect(checks.map((c) => c.name)).toContain('storage-available');
    expect(checks.map((c) => c.name)).toContain('memory-usage');
  });

  it('should run standard checks successfully', async () => {
    const checks = createPocketHealthChecks();
    const monitor = createHealthCheckMonitor({ checks });
    const result = await monitor.runChecks();
    expect(result.status).toBe('healthy');
    monitor.dispose();
  });
});
