/**
 * @pocket/analytics - Offline-First Analytics
 *
 * Client-side analytics with local storage, batched sync, and React hooks.
 */

// Types
export type {
  AnalyticsConfig,
  AnalyticsEvent,
  AnalyticsEventType,
  EventContext,
  FunnelResult,
  FunnelStep,
  InternalAnalyticsEvent,
  Metric,
  MetricAggregation,
  Session,
  SyncStatus,
  UserTraits,
} from './types.js';

// Event Store
export { EventStore, createEventStore } from './event-store.js';

// Analytics Tracker
export { AnalyticsTracker, createAnalyticsTracker } from './analytics-tracker.js';

// React Hooks
export type {
  ReactHooks,
  UseAnalyticsEventsReturn,
  UseAnalyticsReturn,
  UseSyncStatusReturn,
} from './hooks.js';

export {
  createUseAnalyticsEventsHook,
  createUseAnalyticsHook,
  createUseEventTrackingHook,
  createUseMetricHook,
  createUsePageTrackingHook,
  createUseSyncStatusHook,
} from './hooks.js';

// Aggregation Engine
export {
  AggregationEngine,
  createAggregationEngine,
  type AggregationConfig,
  type AggregationSummary,
  type MetricDefinition,
  type MetricResult,
  type RetentionCohort,
} from './aggregation-engine.js';

export type {
  AnalyticsEvent as AggregationAnalyticsEvent,
  FunnelResult as AggregationFunnelResult,
  FunnelStep as AggregationFunnelStep,
} from './aggregation-engine.js';

// Dashboard Data Provider
export {
  DashboardDataProvider,
  createDashboardDataProvider,
  type AnalyticsDashboardEvent,
  type AnalyticsDataSource,
  type DashboardDataProviderConfig,
  type DashboardFunnelStep,
  type DashboardRetentionCohort,
  type DashboardSummary,
  type DateRange,
  type EventSummary,
  type TimeSeriesPoint,
} from './dashboard.js';

// Visualization Engine
export {
  DEFAULT_COLOR_PALETTE,
  VisualizationEngine,
  createVisualizationEngine,
  type ChartConfig,
  type ChartDataPoint,
  type ChartSeries,
  type ChartType,
  type FunnelChartData,
  type MetricCardData,
  type RetentionGridData,
  type VisualizationConfig,
} from './visualization-engine.js';

// Report Exporter
export {
  ReportExporter,
  createReportExporter,
  type ExportConfig,
  type ExportEvent,
  type ExportFormat,
  type ExportResult,
  type ScheduledExport,
} from './report-exporter.js';

// Session Recorder
export {
  SessionRecorder,
  createSessionRecorder,
  type InteractionEvent,
  type InteractionType,
  type RecordedSession,
  type RecorderStatus,
  type SessionRecorderConfig,
} from './session-recorder.js';

// Dashboard Components (framework-agnostic render descriptors)
export {
  buildChart,
  buildFunnel,
  buildMetricCard,
  buildTopEvents,
  type ChartDescriptor,
  type ChartPoint,
  type DashboardLayoutDescriptor,
  type FunnelDescriptor,
  type FunnelStepDescriptor,
  type MetricCardDescriptor,
  type TimeRangePreset,
  type TopEventsDescriptor,
} from './dashboard-components.js';

// Dashboard React Hooks
export {
  createUseDashboardHook,
  type DashboardReactHooks,
  type UseDashboardConfig,
  type UseDashboardReturn,
} from './dashboard-hooks.js';

// Funnel Computation Engine
export {
  computeFunnel,
  computeFunnels,
  type FunnelDefinition,
  type FunnelResult as ComputedFunnelResult,
  type FunnelStepResult,
} from './funnel-engine.js';

// Retention Engine
export {
  RetentionEngine,
  createRetentionEngine,
  type PruneResult,
  type RetentionPolicyConfig,
} from './retention-engine.js';

// A/B Testing
export {
  ABTestEngine,
  createABTestEngine,
  type Experiment,
  type ExperimentResults,
  type ExperimentVariant,
  type VariantAssignment,
  type VariantMetrics,
} from './ab-testing.js';
