/**
 * Observability platform types for database performance monitoring,
 * alerting, and OTLP export.
 */

// ── Query Performance ────────────────────────────────────

/** Query performance metrics */
export interface QueryMetrics {
  queryId: string;
  collection: string;
  querySpec: unknown;
  executionTimeMs: number;
  documentsScanned: number;
  documentsReturned: number;
  indexUsed: string | null;
  timestamp: number;
  cached: boolean;
  planDetails?: QueryPlanDetails;
}

export interface QueryPlanDetails {
  type: 'full-scan' | 'index-scan' | 'index-only';
  indexName?: string;
  estimatedCost: number;
  actualCost: number;
  steps: QueryPlanStep[];
}

export interface QueryPlanStep {
  operation: string;
  collection?: string;
  indexUsed?: string;
  estimatedRows: number;
  actualRows: number;
  timeMs: number;
}

// ── Slow Query ───────────────────────────────────────────

/** Slow query entry */
export interface SlowQueryEntry {
  id: string;
  queryMetrics: QueryMetrics;
  threshold: number;
  suggestion: string;
}

// ── Storage ──────────────────────────────────────────────

/** Storage metrics */
export interface StorageMetrics {
  totalSize: number;
  collectionSizes: Record<string, number>;
  indexSizes: Record<string, number>;
  documentCounts: Record<string, number>;
  fragmentationRatio: number;
  timestamp: number;
}

// ── Sync Health ──────────────────────────────────────────

/** Sync health metrics */
export interface SyncHealthMetrics {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastSyncAt: number | null;
  roundTripTimeMs: number | null;
  pendingChanges: number;
  failedSyncs: number;
  successfulSyncs: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  timestamp: number;
}

// ── Cache ────────────────────────────────────────────────

/** Cache metrics */
export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  maxSize: number;
  evictions: number;
  timestamp: number;
}

// ── Alerts ───────────────────────────────────────────────

/** Alert rule definition */
export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  metric: 'query_time' | 'sync_latency' | 'error_rate' | 'storage_size' | 'cache_hit_rate' | 'custom';
  condition: AlertCondition;
  cooldownMs: number;
  enabled: boolean;
  severity: 'info' | 'warning' | 'critical';
  actions: AlertAction[];
}

export interface AlertCondition {
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  threshold: number;
  windowMs?: number;
  aggregation?: 'avg' | 'max' | 'min' | 'sum' | 'count' | 'p95' | 'p99';
}

export type AlertAction =
  | { type: 'log'; level: 'info' | 'warn' | 'error' }
  | { type: 'callback'; fn: (alert: FiredAlert) => void }
  | { type: 'webhook'; url: string; method?: string };

export interface FiredAlert {
  ruleId: string;
  ruleName: string;
  severity: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: number;
}

// ── OTLP Export ──────────────────────────────────────────

/** OTLP export configuration */
export interface OTLPExportConfig {
  endpoint: string;
  protocol: 'http/json' | 'http/protobuf' | 'grpc';
  headers?: Record<string, string>;
  intervalMs?: number;
  batchSize?: number;
  serviceName?: string;
  resourceAttributes?: Record<string, string>;
}

// ── Platform Config ──────────────────────────────────────

/** Observability platform configuration */
export interface ObservabilityPlatformConfig {
  enableQueryMetrics?: boolean;
  enableStorageMetrics?: boolean;
  enableSyncMetrics?: boolean;
  enableCacheMetrics?: boolean;
  slowQueryThresholdMs?: number;
  metricsRetentionCount?: number;
  enableAlerts?: boolean;
  otlpExport?: OTLPExportConfig;
}

/** Observability platform state */
export interface ObservabilityState {
  queryMetricsCount: number;
  slowQueryCount: number;
  alertRuleCount: number;
  firedAlertCount: number;
  isExporting: boolean;
}

/** Dashboard data for real-time UI */
export interface ObservabilityDashboardData {
  queryLatency: { p50: number; p95: number; p99: number; avg: number };
  throughput: { queriesPerSecond: number; writesPerSecond: number };
  syncHealth: SyncHealthMetrics | null;
  storage: StorageMetrics | null;
  cache: CacheMetrics | null;
  recentSlowQueries: SlowQueryEntry[];
  activeAlerts: FiredAlert[];
  topCollections: Array<{ name: string; queryCount: number; avgTimeMs: number }>;
}
