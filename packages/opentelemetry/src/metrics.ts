/**
 * OpenTelemetry Metrics
 *
 * Metrics collection for Pocket database operations.
 *
 * @module @pocket/opentelemetry
 */

import {
  metrics,
  type Attributes,
  type Counter,
  type Histogram,
  type Meter,
  type UpDownCounter,
} from '@opentelemetry/api';

/**
 * Metric names for Pocket operations
 */
export const METRIC_NAMES = {
  // Operation counters
  OPERATIONS_TOTAL: 'pocket.operations.total',
  OPERATIONS_ERRORS: 'pocket.operations.errors',

  // Duration histograms
  OPERATION_DURATION: 'pocket.operation.duration',
  QUERY_DURATION: 'pocket.query.duration',
  SYNC_DURATION: 'pocket.sync.duration',

  // Document metrics
  DOCUMENTS_INSERTED: 'pocket.documents.inserted',
  DOCUMENTS_UPDATED: 'pocket.documents.updated',
  DOCUMENTS_DELETED: 'pocket.documents.deleted',
  DOCUMENTS_READ: 'pocket.documents.read',

  // Query metrics
  QUERY_RESULTS_SIZE: 'pocket.query.results.size',
  QUERY_RESULTS_COUNT: 'pocket.query.results.count',

  // Sync metrics
  SYNC_CHANGES_PUSHED: 'pocket.sync.changes.pushed',
  SYNC_CHANGES_PULLED: 'pocket.sync.changes.pulled',
  SYNC_CONFLICTS: 'pocket.sync.conflicts',

  // Connection metrics
  ACTIVE_CONNECTIONS: 'pocket.connections.active',
  CONNECTION_ERRORS: 'pocket.connections.errors',

  // Storage metrics
  STORAGE_SIZE_BYTES: 'pocket.storage.size.bytes',
  COLLECTION_COUNT: 'pocket.collections.count',
} as const;

/**
 * Attribute names for metrics
 */
export const METRIC_ATTRIBUTES = {
  DB_NAME: 'db.name',
  COLLECTION_NAME: 'collection.name',
  OPERATION: 'operation',
  STATUS: 'status',
  ERROR_TYPE: 'error.type',
} as const;

/**
 * Default meter name for Pocket
 */
export const METER_NAME = '@pocket/opentelemetry';

/**
 * Pocket metrics collection
 */
export interface PocketMetrics {
  /** Total operations counter */
  operationsTotal: Counter;
  /** Operation errors counter */
  operationsErrors: Counter;
  /** Operation duration histogram */
  operationDuration: Histogram;
  /** Query duration histogram */
  queryDuration: Histogram;
  /** Sync duration histogram */
  syncDuration: Histogram;
  /** Documents inserted counter */
  documentsInserted: Counter;
  /** Documents updated counter */
  documentsUpdated: Counter;
  /** Documents deleted counter */
  documentsDeleted: Counter;
  /** Documents read counter */
  documentsRead: Counter;
  /** Query results count histogram */
  queryResultsCount: Histogram;
  /** Sync changes pushed counter */
  syncChangesPushed: Counter;
  /** Sync changes pulled counter */
  syncChangesPulled: Counter;
  /** Sync conflicts counter */
  syncConflicts: Counter;
  /** Active connections gauge */
  activeConnections: UpDownCounter;
  /** Connection errors counter */
  connectionErrors: Counter;
}

/**
 * Create Pocket metrics instruments
 */
export function createMetrics(meter?: Meter): PocketMetrics {
  const m = meter ?? metrics.getMeter(METER_NAME, '0.1.0');

  return {
    operationsTotal: m.createCounter(METRIC_NAMES.OPERATIONS_TOTAL, {
      description: 'Total number of Pocket operations',
      unit: '{operation}',
    }),

    operationsErrors: m.createCounter(METRIC_NAMES.OPERATIONS_ERRORS, {
      description: 'Total number of Pocket operation errors',
      unit: '{error}',
    }),

    operationDuration: m.createHistogram(METRIC_NAMES.OPERATION_DURATION, {
      description: 'Duration of Pocket operations',
      unit: 'ms',
    }),

    queryDuration: m.createHistogram(METRIC_NAMES.QUERY_DURATION, {
      description: 'Duration of Pocket queries',
      unit: 'ms',
    }),

    syncDuration: m.createHistogram(METRIC_NAMES.SYNC_DURATION, {
      description: 'Duration of sync operations',
      unit: 'ms',
    }),

    documentsInserted: m.createCounter(METRIC_NAMES.DOCUMENTS_INSERTED, {
      description: 'Number of documents inserted',
      unit: '{document}',
    }),

    documentsUpdated: m.createCounter(METRIC_NAMES.DOCUMENTS_UPDATED, {
      description: 'Number of documents updated',
      unit: '{document}',
    }),

    documentsDeleted: m.createCounter(METRIC_NAMES.DOCUMENTS_DELETED, {
      description: 'Number of documents deleted',
      unit: '{document}',
    }),

    documentsRead: m.createCounter(METRIC_NAMES.DOCUMENTS_READ, {
      description: 'Number of documents read',
      unit: '{document}',
    }),

    queryResultsCount: m.createHistogram(METRIC_NAMES.QUERY_RESULTS_COUNT, {
      description: 'Number of results returned by queries',
      unit: '{document}',
    }),

    syncChangesPushed: m.createCounter(METRIC_NAMES.SYNC_CHANGES_PUSHED, {
      description: 'Number of changes pushed during sync',
      unit: '{change}',
    }),

    syncChangesPulled: m.createCounter(METRIC_NAMES.SYNC_CHANGES_PULLED, {
      description: 'Number of changes pulled during sync',
      unit: '{change}',
    }),

    syncConflicts: m.createCounter(METRIC_NAMES.SYNC_CONFLICTS, {
      description: 'Number of sync conflicts',
      unit: '{conflict}',
    }),

    activeConnections: m.createUpDownCounter(METRIC_NAMES.ACTIVE_CONNECTIONS, {
      description: 'Number of active database connections',
      unit: '{connection}',
    }),

    connectionErrors: m.createCounter(METRIC_NAMES.CONNECTION_ERRORS, {
      description: 'Number of connection errors',
      unit: '{error}',
    }),
  };
}

/**
 * Helper to record operation timing
 */
export function recordOperationTiming(
  pocketMetrics: PocketMetrics,
  operation: string,
  durationMs: number,
  attributes: Attributes = {}
): void {
  const attrs = {
    [METRIC_ATTRIBUTES.OPERATION]: operation,
    ...attributes,
  };

  pocketMetrics.operationsTotal.add(1, attrs);
  pocketMetrics.operationDuration.record(durationMs, attrs);
}

/**
 * Helper to record operation error
 */
export function recordOperationError(
  pocketMetrics: PocketMetrics,
  operation: string,
  errorType: string,
  attributes: Attributes = {}
): void {
  const attrs = {
    [METRIC_ATTRIBUTES.OPERATION]: operation,
    [METRIC_ATTRIBUTES.ERROR_TYPE]: errorType,
    ...attributes,
  };

  pocketMetrics.operationsErrors.add(1, attrs);
}

/**
 * Helper to record document operation
 */
export function recordDocumentOperation(
  pocketMetrics: PocketMetrics,
  type: 'insert' | 'update' | 'delete' | 'read',
  count: number,
  attributes: Attributes = {}
): void {
  switch (type) {
    case 'insert':
      pocketMetrics.documentsInserted.add(count, attributes);
      break;
    case 'update':
      pocketMetrics.documentsUpdated.add(count, attributes);
      break;
    case 'delete':
      pocketMetrics.documentsDeleted.add(count, attributes);
      break;
    case 'read':
      pocketMetrics.documentsRead.add(count, attributes);
      break;
  }
}

/**
 * Helper to record query metrics
 */
export function recordQueryMetrics(
  pocketMetrics: PocketMetrics,
  durationMs: number,
  resultCount: number,
  attributes: Attributes = {}
): void {
  pocketMetrics.queryDuration.record(durationMs, attributes);
  pocketMetrics.queryResultsCount.record(resultCount, attributes);
}

/**
 * Helper to record sync metrics
 */
export function recordSyncMetrics(
  pocketMetrics: PocketMetrics,
  direction: 'push' | 'pull',
  changesCount: number,
  durationMs: number,
  conflicts = 0,
  attributes: Attributes = {}
): void {
  pocketMetrics.syncDuration.record(durationMs, attributes);

  if (direction === 'push') {
    pocketMetrics.syncChangesPushed.add(changesCount, attributes);
  } else {
    pocketMetrics.syncChangesPulled.add(changesCount, attributes);
  }

  if (conflicts > 0) {
    pocketMetrics.syncConflicts.add(conflicts, attributes);
  }
}
