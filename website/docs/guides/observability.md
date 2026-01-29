---
sidebar_position: 12
title: Observability
description: Monitoring and tracing Pocket with OpenTelemetry
---

# Observability

The `@pocket/opentelemetry` package provides automatic instrumentation for Pocket, enabling distributed tracing, metrics, and monitoring through OpenTelemetry.

## Installation

```bash
npm install @pocket/core @pocket/opentelemetry @opentelemetry/api
```

For a complete setup, also install the OpenTelemetry SDK:

```bash
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```

## Quick Start

```typescript
import { Database, createIndexedDBStorage } from '@pocket/core';
import { createOpenTelemetryPlugin } from '@pocket/opentelemetry';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  plugins: [
    createOpenTelemetryPlugin({
      dbName: 'my-app',
      enableTracing: true,
      enableMetrics: true,
    }),
  ],
});

// All operations are now traced
await db.collection('todos').insert({ ... });
```

## OpenTelemetry Setup

### Node.js Setup

```typescript
// tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: 'http://localhost:4318/v1/metrics',
    }),
    exportIntervalMillis: 10000,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
  serviceName: 'my-pocket-app',
});

sdk.start();
```

### Browser Setup

```typescript
// tracing.ts
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';

const provider = new WebTracerProvider();

provider.addSpanProcessor(
  new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: 'https://your-collector.com/v1/traces',
    })
  )
);

provider.register();
```

## Plugin Configuration

```typescript
import { createOpenTelemetryPlugin } from '@pocket/opentelemetry';

createOpenTelemetryPlugin({
  // Database name for span attributes
  dbName: 'my-app',

  // Enable distributed tracing (default: true)
  enableTracing: true,

  // Enable metrics collection (default: true)
  enableMetrics: true,

  // Record query filters in spans (default: false)
  // Warning: May contain sensitive data
  recordQueryFilters: false,

  // Custom tracer (optional)
  tracer: myCustomTracer,

  // Custom meter (optional)
  meter: myCustomMeter,

  // Custom span attributes
  customAttributes: {
    'deployment.environment': 'production',
    'service.version': '1.2.3',
  },
});
```

## Traced Operations

The plugin automatically traces all Pocket operations:

| Operation | Span Name | Key Attributes |
|-----------|-----------|----------------|
| Insert | `pocket.insert` | collection, document_id |
| Update | `pocket.update` | collection, document_id |
| Delete | `pocket.delete` | collection, document_id |
| Query | `pocket.find` | collection, limit, offset |
| Get | `pocket.findOne` | collection, document_id |

### Span Attributes

```typescript
// Standard database semantic conventions
'db.system': 'pocket'
'db.name': 'my-app'
'db.operation': 'insert' | 'update' | 'delete' | 'query' | 'get'

// Pocket-specific attributes
'pocket.collection': 'todos'
'pocket.document.id': 'doc-123'
'pocket.document.count': 10
'pocket.query.limit': 50
'pocket.query.offset': 0
```

## Metrics

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `pocket.operation.duration` | Histogram | Operation duration in ms |
| `pocket.document.operations` | Counter | Document operations by type |
| `pocket.query.duration` | Histogram | Query duration in ms |
| `pocket.query.results` | Histogram | Number of results per query |
| `pocket.errors` | Counter | Errors by operation type |
| `pocket.active_connections` | UpDownCounter | Active database connections |

### Example Prometheus Queries

```promql
# Average insert latency
rate(pocket_operation_duration_sum{operation="insert"}[5m])
/ rate(pocket_operation_duration_count{operation="insert"}[5m])

# Operations per second by type
sum(rate(pocket_document_operations_total[5m])) by (operation)

# Error rate by collection
sum(rate(pocket_errors_total[5m])) by (collection)

# P99 query latency
histogram_quantile(0.99,
  rate(pocket_query_duration_bucket[5m])
)
```

## Jaeger Integration

### Docker Setup

```yaml
# docker-compose.yml
version: '3'
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"  # UI
      - "4318:4318"    # OTLP HTTP
    environment:
      - COLLECTOR_OTLP_ENABLED=true
```

### Configuration

```typescript
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const exporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces',
});
```

### Viewing Traces

1. Open Jaeger UI at `http://localhost:16686`
2. Select your service from the dropdown
3. Click "Find Traces"
4. Click on a trace to see the full waterfall

## Grafana Dashboard

### Import Dashboard

```json
{
  "dashboard": {
    "title": "Pocket Database Metrics",
    "panels": [
      {
        "title": "Operation Latency (P50, P95, P99)",
        "type": "timeseries",
        "targets": [
          {
            "expr": "histogram_quantile(0.5, rate(pocket_operation_duration_bucket[5m]))",
            "legendFormat": "P50"
          },
          {
            "expr": "histogram_quantile(0.95, rate(pocket_operation_duration_bucket[5m]))",
            "legendFormat": "P95"
          },
          {
            "expr": "histogram_quantile(0.99, rate(pocket_operation_duration_bucket[5m]))",
            "legendFormat": "P99"
          }
        ]
      },
      {
        "title": "Operations per Second",
        "type": "timeseries",
        "targets": [
          {
            "expr": "sum(rate(pocket_document_operations_total[5m])) by (operation)",
            "legendFormat": "{{operation}}"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "stat",
        "targets": [
          {
            "expr": "sum(rate(pocket_errors_total[5m]))"
          }
        ]
      }
    ]
  }
}
```

## Custom Spans

### Manual Instrumentation

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-app');

async function processOrder(orderId: string) {
  return tracer.startActiveSpan('processOrder', async (span) => {
    try {
      span.setAttribute('order.id', orderId);

      // Your Pocket operations are automatically traced
      const order = await db.collection('orders').get(orderId);

      span.setAttribute('order.total', order.total);
      span.setStatus({ code: SpanStatusCode.OK });

      return order;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### Context Propagation

```typescript
import { context, propagation } from '@opentelemetry/api';

// Extract context from incoming request
const parentContext = propagation.extract(
  context.active(),
  request.headers
);

// Run with parent context
context.with(parentContext, async () => {
  // Pocket operations are linked to parent span
  await db.collection('todos').insert({ ... });
});
```

## Sampling

### Configure Sampling

```typescript
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

const sdk = new NodeSDK({
  // Sample 10% of traces in production
  sampler: new TraceIdRatioBasedSampler(0.1),
});
```

### Head-Based Sampling

```typescript
import { ParentBasedSampler, AlwaysOnSampler } from '@opentelemetry/sdk-trace-base';

const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(0.1),
  remoteParentSampled: new AlwaysOnSampler(),
  remoteParentNotSampled: new TraceIdRatioBasedSampler(0.01),
});
```

## Alerting

### Example Alert Rules (Prometheus)

```yaml
groups:
  - name: pocket
    rules:
      - alert: HighErrorRate
        expr: sum(rate(pocket_errors_total[5m])) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: High Pocket error rate

      - alert: SlowQueries
        expr: histogram_quantile(0.99, rate(pocket_query_duration_bucket[5m])) > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: Pocket queries are slow (P99 > 1s)

      - alert: NoActiveConnections
        expr: pocket_active_connections == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: No active Pocket connections
```

## Logging Integration

### Structured Logging with Trace Context

```typescript
import { trace, context } from '@opentelemetry/api';

function log(level: string, message: string, data?: Record<string, unknown>) {
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    traceId: spanContext?.traceId,
    spanId: spanContext?.spanId,
    ...data,
  }));
}

// Usage
log('info', 'Processing order', { orderId: '123' });
```

## Performance Impact

The OpenTelemetry plugin adds minimal overhead:

| Operation | Without Plugin | With Plugin | Overhead |
|-----------|---------------|-------------|----------|
| Insert | 0.5ms | 0.55ms | ~10% |
| Query (100 docs) | 2ms | 2.1ms | ~5% |
| Update | 0.4ms | 0.45ms | ~12% |

### Reducing Overhead

```typescript
// Disable in development
createOpenTelemetryPlugin({
  enableTracing: process.env.NODE_ENV === 'production',
  enableMetrics: process.env.NODE_ENV === 'production',
});

// Use sampling in production
const sampler = new TraceIdRatioBasedSampler(
  process.env.NODE_ENV === 'production' ? 0.1 : 1.0
);
```

## Next Steps

- [OpenTelemetry Docs](https://opentelemetry.io/docs/)
- [Jaeger](https://www.jaegertracing.io/)
- [Grafana](https://grafana.com/)
- [Performance Guide](/docs/guides/performance)
