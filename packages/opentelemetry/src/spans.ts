/**
 * OpenTelemetry Span Helpers
 *
 * Utilities for creating and managing spans for Pocket operations.
 *
 * @module @pocket/opentelemetry
 */

import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type Tracer,
} from '@opentelemetry/api';

/**
 * Span attribute names for Pocket operations
 */
export const SPAN_ATTRIBUTES = {
  // Database attributes
  DB_SYSTEM: 'db.system',
  DB_NAME: 'db.name',
  DB_OPERATION: 'db.operation',
  DB_STATEMENT: 'db.statement',

  // Collection attributes
  COLLECTION_NAME: 'pocket.collection.name',

  // Document attributes
  DOCUMENT_ID: 'pocket.document.id',
  DOCUMENT_COUNT: 'pocket.document.count',

  // Query attributes
  QUERY_FILTER: 'pocket.query.filter',
  QUERY_LIMIT: 'pocket.query.limit',
  QUERY_OFFSET: 'pocket.query.offset',
  QUERY_SORT: 'pocket.query.sort',

  // Sync attributes
  SYNC_DIRECTION: 'pocket.sync.direction',
  SYNC_CHANGES_COUNT: 'pocket.sync.changes_count',

  // Error attributes
  ERROR_TYPE: 'pocket.error.type',
  ERROR_CODE: 'pocket.error.code',
} as const;

/**
 * Operation names for spans
 */
export const OPERATIONS = {
  // Document operations
  GET: 'pocket.document.get',
  GET_MANY: 'pocket.document.getMany',
  INSERT: 'pocket.document.insert',
  UPDATE: 'pocket.document.update',
  UPSERT: 'pocket.document.upsert',
  DELETE: 'pocket.document.delete',
  BULK_INSERT: 'pocket.document.bulkInsert',
  BULK_DELETE: 'pocket.document.bulkDelete',

  // Query operations
  FIND: 'pocket.query.find',
  FIND_ONE: 'pocket.query.findOne',
  COUNT: 'pocket.query.count',

  // Collection operations
  CREATE_COLLECTION: 'pocket.collection.create',
  DROP_COLLECTION: 'pocket.collection.drop',
  LIST_COLLECTIONS: 'pocket.collection.list',

  // Index operations
  CREATE_INDEX: 'pocket.index.create',
  DROP_INDEX: 'pocket.index.drop',

  // Sync operations
  SYNC_PUSH: 'pocket.sync.push',
  SYNC_PULL: 'pocket.sync.pull',
  SYNC_FULL: 'pocket.sync.full',

  // Transaction operations
  TRANSACTION_START: 'pocket.transaction.start',
  TRANSACTION_COMMIT: 'pocket.transaction.commit',
  TRANSACTION_ROLLBACK: 'pocket.transaction.rollback',
} as const;

/**
 * Default tracer name for Pocket
 */
export const TRACER_NAME = '@pocket/opentelemetry';

/**
 * Get the Pocket tracer
 */
export function getTracer(name?: string, version?: string): Tracer {
  return trace.getTracer(name ?? TRACER_NAME, version ?? '0.1.0');
}

/**
 * Options for starting a span
 */
export interface SpanOptions {
  /** Parent context (optional) */
  parentContext?: Context;
  /** Span kind (defaults to INTERNAL) */
  kind?: SpanKind;
  /** Additional attributes */
  attributes?: Record<string, string | number | boolean | string[]>;
}

/**
 * Start a new span for a Pocket operation
 */
export function startSpan(tracer: Tracer, operation: string, options: SpanOptions = {}): Span {
  const { parentContext, kind = SpanKind.INTERNAL, attributes = {} } = options;

  const ctx = parentContext ?? context.active();

  return tracer.startSpan(
    operation,
    {
      kind,
      attributes: {
        [SPAN_ATTRIBUTES.DB_SYSTEM]: 'pocket',
        [SPAN_ATTRIBUTES.DB_OPERATION]: operation,
        ...attributes,
      },
    },
    ctx
  );
}

/**
 * Execute a function within a span context
 */
export async function withSpan<T>(
  tracer: Tracer,
  operation: string,
  fn: (span: Span) => Promise<T>,
  options: SpanOptions = {}
): Promise<T> {
  const span = startSpan(tracer, operation, options);

  try {
    const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    recordError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Execute a synchronous function within a span context
 */
export function withSpanSync<T>(
  tracer: Tracer,
  operation: string,
  fn: (span: Span) => T,
  options: SpanOptions = {}
): T {
  const span = startSpan(tracer, operation, options);

  try {
    const result = context.with(trace.setSpan(context.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    recordError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Record an error on a span
 */
export function recordError(span: Span, error: unknown): void {
  if (error instanceof Error) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });

    // Add error attributes
    span.setAttribute(SPAN_ATTRIBUTES.ERROR_TYPE, error.name);

    // Check for Pocket error codes
    if ('code' in error && typeof error.code === 'string') {
      span.setAttribute(SPAN_ATTRIBUTES.ERROR_CODE, error.code);
    }
  } else {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: String(error),
    });
  }
}

/**
 * Add collection attributes to a span
 */
export function addCollectionAttributes(span: Span, collectionName: string, dbName?: string): void {
  span.setAttribute(SPAN_ATTRIBUTES.COLLECTION_NAME, collectionName);
  if (dbName) {
    span.setAttribute(SPAN_ATTRIBUTES.DB_NAME, dbName);
  }
}

/**
 * Add document attributes to a span
 */
export function addDocumentAttributes(
  span: Span,
  documentId?: string,
  documentCount?: number
): void {
  if (documentId) {
    span.setAttribute(SPAN_ATTRIBUTES.DOCUMENT_ID, documentId);
  }
  if (documentCount !== undefined) {
    span.setAttribute(SPAN_ATTRIBUTES.DOCUMENT_COUNT, documentCount);
  }
}

/**
 * Add query attributes to a span
 */
export function addQueryAttributes(
  span: Span,
  query: {
    filter?: unknown;
    limit?: number;
    offset?: number;
    sort?: unknown;
  }
): void {
  if (query.filter) {
    span.setAttribute(SPAN_ATTRIBUTES.QUERY_FILTER, JSON.stringify(query.filter));
  }
  if (query.limit !== undefined) {
    span.setAttribute(SPAN_ATTRIBUTES.QUERY_LIMIT, query.limit);
  }
  if (query.offset !== undefined) {
    span.setAttribute(SPAN_ATTRIBUTES.QUERY_OFFSET, query.offset);
  }
  if (query.sort) {
    span.setAttribute(SPAN_ATTRIBUTES.QUERY_SORT, JSON.stringify(query.sort));
  }
}
