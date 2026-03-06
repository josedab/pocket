/**
 * @pocket/opentelemetry - OpenTelemetry Integration
 *
 * Provides automatic tracing and metrics for Pocket database operations.
 *
 * @example
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createOpenTelemetryPlugin } from '@pocket/opentelemetry';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   plugins: [
 *     createOpenTelemetryPlugin({
 *       dbName: 'my-app',
 *       enableTracing: true,
 *       enableMetrics: true,
 *     }),
 *   ],
 * });
 *
 * // All operations are now traced and metriced
 * const users = db.collection('users');
 * await users.insert({ _id: '1', name: 'John' });
 * ```
 *
 * @module @pocket/opentelemetry
 */

// Plugin
export { createOpenTelemetryPlugin, type OpenTelemetryPluginConfig } from './plugin.js';

// Spans
export {
  OPERATIONS,
  SPAN_ATTRIBUTES,
  TRACER_NAME,
  addCollectionAttributes,
  addDocumentAttributes,
  addQueryAttributes,
  getTracer,
  recordError,
  startSpan,
  withSpan,
  withSpanSync,
  type SpanOptions,
} from './spans.js';

// Metrics
export {
  METER_NAME,
  METRIC_ATTRIBUTES,
  METRIC_NAMES,
  createMetrics,
  recordDocumentOperation,
  recordOperationError,
  recordOperationTiming,
  recordQueryMetrics,
  recordSyncMetrics,
  type PocketMetrics,
} from './metrics.js';

// Replay Debugger
export {
  ReplayDebugger,
  createReplayDebugger,
  type ReplayDebuggerConfig,
  type ReplayEvent,
  type ReplaySnapshot,
  type ReplayTimeline,
} from './replay-debugger.js';

// Metrics Dashboard
export {
  MetricsDashboard,
  createMetricsDashboard,
  type DashboardConfig,
  type DashboardSummary,
  type MetricPoint,
  type MetricSeries,
} from './metrics-dashboard.js';

// Exporters & Health Checks
export {
  HealthCheckMonitor,
  MetricExporter,
  createHealthCheckMonitor,
  createMetricExporter,
  createPocketHealthChecks,
} from './exporters.js';
export type {
  ExportResult,
  ExportableMetric,
  ExportableSpan,
  ExporterConfig,
  ExporterType,
  HealthCheck,
  HealthCheckConfig,
  HealthCheckResult,
  NamedHealthCheck,
} from './exporters.js';

// Observability Dashboard
export { ObservabilityDashboard, createObservabilityDashboard } from './observability-dashboard.js';
export type {
  AlertRule,
  DashboardAlert,
  DashboardEvent,
  DashboardSnapshot,
  ObservabilityConfig,
  ObservabilityMetricPoint,
  ObservabilityMetricSeries,
} from './observability-dashboard.js';

// Observability Platform
export * from './observability/index.js';
