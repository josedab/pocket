/**
 * Observability platform — query analysis, alerting, OTLP export,
 * and unified dashboard for database performance monitoring.
 */

// Types
export type {
  AlertAction,
  AlertCondition,
  AlertRule as ObservabilityAlertRule,
  CacheMetrics,
  FiredAlert,
  ObservabilityDashboardData,
  ObservabilityPlatformConfig,
  ObservabilityState,
  OTLPExportConfig,
  QueryMetrics,
  QueryPlanDetails,
  QueryPlanStep,
  SlowQueryEntry,
  StorageMetrics,
  SyncHealthMetrics,
} from './types.js';

// Query Analyzer
export {
  QueryPerformanceAnalyzer,
  createQueryPerformanceAnalyzer,
  type QueryAnalyzerConfig,
} from './query-analyzer.js';

// Alert Manager
export {
  AlertManager,
  createAlertManager,
  type AlertManagerConfig,
} from './alert-manager.js';

// OTLP Exporter
export {
  OTLPMetricExporter,
  createOTLPMetricExporter,
} from './otlp-exporter.js';

// Platform
export {
  ObservabilityPlatform,
  createObservabilityPlatform,
} from './platform.js';
