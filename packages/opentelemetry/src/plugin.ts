/**
 * OpenTelemetry Plugin for Pocket
 *
 * Provides automatic tracing and metrics for all Pocket operations.
 *
 * @module @pocket/opentelemetry
 */

import {
  type Meter,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  metrics,
  trace,
} from '@opentelemetry/api';
import type { Document, PluginDefinition } from '@pocket/core';
import {
  METER_NAME,
  type PocketMetrics,
  createMetrics,
  recordDocumentOperation,
  recordOperationError,
  recordOperationTiming,
  recordQueryMetrics,
} from './metrics.js';
import {
  OPERATIONS,
  SPAN_ATTRIBUTES,
  TRACER_NAME,
  addCollectionAttributes,
  addDocumentAttributes,
  addQueryAttributes,
} from './spans.js';

/**
 * Configuration for the OpenTelemetry plugin
 */
export interface OpenTelemetryPluginConfig {
  /** Custom tracer (optional) */
  tracer?: Tracer;
  /** Custom meter (optional) */
  meter?: Meter;
  /** Whether to enable tracing (default: true) */
  enableTracing?: boolean;
  /** Whether to enable metrics (default: true) */
  enableMetrics?: boolean;
  /** Whether to record query filters in spans (may contain sensitive data) */
  recordQueryFilters?: boolean;
  /** Database name for attributes */
  dbName?: string;
  /** Custom span attributes */
  customAttributes?: Record<string, string | number | boolean>;
}

/**
 * Internal state for tracking operation timing
 */
interface OperationState {
  startTime: number;
  operation: string;
  collection: string;
}

/**
 * Create an OpenTelemetry plugin for Pocket
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
 * await db.collection('users').insert({ _id: '1', name: 'John' });
 * ```
 */
export function createOpenTelemetryPlugin<T extends Document = Document>(
  config: OpenTelemetryPluginConfig = {}
): PluginDefinition<T> {
  const {
    enableTracing = true,
    enableMetrics = true,
    recordQueryFilters = false,
    dbName,
    customAttributes = {},
  } = config;

  const tracer = config.tracer ?? trace.getTracer(TRACER_NAME, '0.1.0');
  const pocketMetrics: PocketMetrics | null = enableMetrics
    ? createMetrics(config.meter ?? metrics.getMeter(METER_NAME, '0.1.0'))
    : null;

  // Track ongoing operations for timing
  const operationStates = new Map<string, OperationState>();

  const createOperationKey = (operation: string, collection: string, id?: string) =>
    `${operation}:${collection}:${id ?? 'all'}:${Date.now()}`;

  return {
    name: 'opentelemetry',
    version: '0.1.0',
    priority: 1000, // Run early to capture all operations

    onInit: () => {
      if (pocketMetrics) {
        pocketMetrics.activeConnections.add(1, { [SPAN_ATTRIBUTES.DB_NAME]: dbName ?? 'unknown' });
      }
    },

    onDestroy: () => {
      if (pocketMetrics) {
        pocketMetrics.activeConnections.add(-1, { [SPAN_ATTRIBUTES.DB_NAME]: dbName ?? 'unknown' });
      }
    },

    beforeInsert: (ctx) => {
      const opKey = createOperationKey(OPERATIONS.INSERT, ctx.collection, ctx.document._id);
      operationStates.set(opKey, {
        startTime: Date.now(),
        operation: OPERATIONS.INSERT,
        collection: ctx.collection,
      });

      if (!enableTracing) return undefined;

      const span = tracer.startSpan(OPERATIONS.INSERT, {
        kind: SpanKind.CLIENT,
        attributes: {
          [SPAN_ATTRIBUTES.DB_SYSTEM]: 'pocket',
          [SPAN_ATTRIBUTES.DB_OPERATION]: 'insert',
          ...customAttributes,
        },
      });

      addCollectionAttributes(span, ctx.collection, dbName);
      if (ctx.document._id) {
        addDocumentAttributes(span, ctx.document._id);
      }

      // Store span in context for afterInsert
      (ctx as unknown as { __otelSpan: unknown }).__otelSpan = span;
      (ctx as unknown as { __opKey: string }).__opKey = opKey;

      return undefined;
    },

    afterInsert: (doc, ctx) => {
      const opKey = (ctx as unknown as { __opKey: string }).__opKey;
      const state = operationStates.get(opKey);

      if (state && pocketMetrics) {
        const duration = Date.now() - state.startTime;
        recordOperationTiming(pocketMetrics, state.operation, duration, {
          collection: state.collection,
        });
        recordDocumentOperation(pocketMetrics, 'insert', 1, {
          collection: state.collection,
        });
        operationStates.delete(opKey);
      }

      if (!enableTracing) return;

      const span = (ctx as unknown as { __otelSpan: unknown }).__otelSpan;
      if (span && typeof (span as { end: () => void }).end === 'function') {
        addDocumentAttributes(span as ReturnType<Tracer['startSpan']>, doc._id);
        (span as ReturnType<Tracer['startSpan']>).setStatus({ code: SpanStatusCode.OK });
        (span as { end: () => void }).end();
      }
    },

    beforeUpdate: (ctx) => {
      const opKey = createOperationKey(OPERATIONS.UPDATE, ctx.collection, ctx.documentId);
      operationStates.set(opKey, {
        startTime: Date.now(),
        operation: OPERATIONS.UPDATE,
        collection: ctx.collection,
      });

      if (!enableTracing) return undefined;

      const span = tracer.startSpan(OPERATIONS.UPDATE, {
        kind: SpanKind.CLIENT,
        attributes: {
          [SPAN_ATTRIBUTES.DB_SYSTEM]: 'pocket',
          [SPAN_ATTRIBUTES.DB_OPERATION]: 'update',
          ...customAttributes,
        },
      });

      addCollectionAttributes(span, ctx.collection, dbName);
      addDocumentAttributes(span, ctx.documentId);

      (ctx as unknown as { __otelSpan: unknown }).__otelSpan = span;
      (ctx as unknown as { __opKey: string }).__opKey = opKey;

      return undefined;
    },

    afterUpdate: (doc, ctx) => {
      const opKey = (ctx as unknown as { __opKey: string }).__opKey;
      const state = operationStates.get(opKey);

      if (state && pocketMetrics) {
        const duration = Date.now() - state.startTime;
        recordOperationTiming(pocketMetrics, state.operation, duration, {
          collection: state.collection,
        });
        recordDocumentOperation(pocketMetrics, 'update', 1, {
          collection: state.collection,
        });
        operationStates.delete(opKey);
      }

      if (!enableTracing) return;

      const span = (ctx as unknown as { __otelSpan: unknown }).__otelSpan;
      if (span && typeof (span as { end: () => void }).end === 'function') {
        (span as ReturnType<Tracer['startSpan']>).setStatus({ code: SpanStatusCode.OK });
        (span as { end: () => void }).end();
      }
    },

    beforeDelete: (ctx) => {
      const opKey = createOperationKey(OPERATIONS.DELETE, ctx.collection, ctx.documentId);
      operationStates.set(opKey, {
        startTime: Date.now(),
        operation: OPERATIONS.DELETE,
        collection: ctx.collection,
      });

      if (!enableTracing) return undefined;

      const span = tracer.startSpan(OPERATIONS.DELETE, {
        kind: SpanKind.CLIENT,
        attributes: {
          [SPAN_ATTRIBUTES.DB_SYSTEM]: 'pocket',
          [SPAN_ATTRIBUTES.DB_OPERATION]: 'delete',
          ...customAttributes,
        },
      });

      addCollectionAttributes(span, ctx.collection, dbName);
      addDocumentAttributes(span, ctx.documentId);

      (ctx as unknown as { __otelSpan: unknown }).__otelSpan = span;
      (ctx as unknown as { __opKey: string }).__opKey = opKey;

      return undefined;
    },

    afterDelete: (ctx) => {
      const opKey = (ctx as unknown as { __opKey: string }).__opKey;
      const state = operationStates.get(opKey);

      if (state && pocketMetrics) {
        const duration = Date.now() - state.startTime;
        recordOperationTiming(pocketMetrics, state.operation, duration, {
          collection: state.collection,
        });
        recordDocumentOperation(pocketMetrics, 'delete', 1, {
          collection: state.collection,
        });
        operationStates.delete(opKey);
      }

      if (!enableTracing) return;

      const span = (ctx as unknown as { __otelSpan: unknown }).__otelSpan;
      if (span && typeof (span as { end: () => void }).end === 'function') {
        (span as ReturnType<Tracer['startSpan']>).setStatus({ code: SpanStatusCode.OK });
        (span as { end: () => void }).end();
      }
    },

    beforeQuery: (ctx) => {
      const opKey = createOperationKey(OPERATIONS.FIND, ctx.collection);
      operationStates.set(opKey, {
        startTime: Date.now(),
        operation: OPERATIONS.FIND,
        collection: ctx.collection,
      });

      if (!enableTracing) return undefined;

      const span = tracer.startSpan(OPERATIONS.FIND, {
        kind: SpanKind.CLIENT,
        attributes: {
          [SPAN_ATTRIBUTES.DB_SYSTEM]: 'pocket',
          [SPAN_ATTRIBUTES.DB_OPERATION]: 'query',
          ...customAttributes,
        },
      });

      addCollectionAttributes(span, ctx.collection, dbName);

      if (recordQueryFilters) {
        addQueryAttributes(span, {
          filter: ctx.spec.filter,
          limit: ctx.spec.limit,
          offset: ctx.spec.skip,
          sort: ctx.spec.sort,
        });
      } else {
        addQueryAttributes(span, {
          limit: ctx.spec.limit,
          offset: ctx.spec.skip,
        });
      }

      (ctx as unknown as { __otelSpan: unknown }).__otelSpan = span;
      (ctx as unknown as { __opKey: string }).__opKey = opKey;

      return undefined;
    },

    afterQuery: (results, ctx) => {
      const opKey = (ctx as unknown as { __opKey: string }).__opKey;
      const state = operationStates.get(opKey);

      if (state && pocketMetrics) {
        const duration = Date.now() - state.startTime;
        recordQueryMetrics(pocketMetrics, duration, results.length, {
          collection: state.collection,
        });
        recordDocumentOperation(pocketMetrics, 'read', results.length, {
          collection: state.collection,
        });
        operationStates.delete(opKey);
      }

      if (!enableTracing) return results;

      const span = (ctx as unknown as { __otelSpan: unknown }).__otelSpan;
      if (span && typeof (span as { end: () => void }).end === 'function') {
        addDocumentAttributes(span as ReturnType<Tracer['startSpan']>, undefined, results.length);
        (span as ReturnType<Tracer['startSpan']>).setStatus({ code: SpanStatusCode.OK });
        (span as { end: () => void }).end();
      }

      return results;
    },

    beforeGet: (ctx) => {
      const opKey = createOperationKey(OPERATIONS.FIND_ONE, ctx.collection, ctx.documentId);
      operationStates.set(opKey, {
        startTime: Date.now(),
        operation: OPERATIONS.FIND_ONE,
        collection: ctx.collection,
      });

      if (!enableTracing) return undefined;

      const span = tracer.startSpan(OPERATIONS.FIND_ONE, {
        kind: SpanKind.CLIENT,
        attributes: {
          [SPAN_ATTRIBUTES.DB_SYSTEM]: 'pocket',
          [SPAN_ATTRIBUTES.DB_OPERATION]: 'get',
          ...customAttributes,
        },
      });

      addCollectionAttributes(span, ctx.collection, dbName);
      addDocumentAttributes(span, ctx.documentId);

      (ctx as unknown as { __otelSpan: unknown }).__otelSpan = span;
      (ctx as unknown as { __opKey: string }).__opKey = opKey;

      return undefined;
    },

    afterGet: (doc, ctx) => {
      const opKey = (ctx as unknown as { __opKey: string }).__opKey;
      const state = operationStates.get(opKey);

      if (state && pocketMetrics) {
        const duration = Date.now() - state.startTime;
        recordOperationTiming(pocketMetrics, state.operation, duration, {
          collection: state.collection,
        });
        if (doc) {
          recordDocumentOperation(pocketMetrics, 'read', 1, {
            collection: state.collection,
          });
        }
        operationStates.delete(opKey);
      }

      if (!enableTracing) return doc;

      const span = (ctx as unknown as { __otelSpan: unknown }).__otelSpan;
      if (span && typeof (span as { end: () => void }).end === 'function') {
        (span as ReturnType<Tracer['startSpan']>).setAttribute(
          'pocket.document.found',
          doc !== null
        );
        (span as ReturnType<Tracer['startSpan']>).setStatus({ code: SpanStatusCode.OK });
        (span as { end: () => void }).end();
      }

      return doc;
    },

    onError: (ctx) => {
      if (pocketMetrics) {
        recordOperationError(pocketMetrics, ctx.operation, ctx.error.name, {
          collection: ctx.collection,
        });
      }

      // Note: The span should already be ended by the operation that failed
      // This hook is for additional error tracking
    },
  };
}
