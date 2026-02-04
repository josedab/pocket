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
  FunnelStep as AggregationFunnelStep,
  FunnelResult as AggregationFunnelResult,
} from './aggregation-engine.js';

// Dashboard Data Provider
export {
  DashboardDataProvider,
  createDashboardDataProvider,
  type AnalyticsDataSource,
  type AnalyticsDashboardEvent,
  type DashboardDataProviderConfig,
  type DashboardFunnelStep,
  type DashboardRetentionCohort,
  type DashboardSummary,
  type DateRange,
  type EventSummary,
  type TimeSeriesPoint,
} from './dashboard.js';
