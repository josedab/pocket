# @pocket/opentelemetry

OpenTelemetry instrumentation for Pocket database.

## Installation

```bash
pnpm add @pocket/opentelemetry
```

## Features

- Drop-in OpenTelemetry plugin for Pocket
- Automatic tracing of database operations with spans
- Built-in metrics (operation timing, document counts, errors)
- Multiple exporter support (OTLP, Prometheus, Datadog, console)
- Metrics dashboard for aggregation and visualization
- Replay debugger for operation history

## Usage

```typescript
import { createOpenTelemetryPlugin } from '@pocket/opentelemetry';

const plugin = createOpenTelemetryPlugin({
  serviceName: 'my-app',
  exporter: 'otlp',
});

const db = createDatabase({ plugins: [plugin] });
```

## API Reference

- `createOpenTelemetryPlugin` — Plugin integrating tracing and metrics
- `createMetrics` — Create Pocket-specific metric instruments
- `createMetricsDashboard` — Aggregated metrics dashboard
- `createReplayDebugger` — Replay and inspect operation history
- `getTracer` / `startSpan` — Manual span management
- `MetricExporter` — Export metrics to external systems

## License

MIT
