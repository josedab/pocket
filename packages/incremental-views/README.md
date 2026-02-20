# @pocket/incremental-views

Incremental view maintenance for Pocket — materialized views that automatically update when underlying data changes.

## Installation

```bash
pnpm add @pocket/incremental-views
```

## Features

- Materialized views with automatic incremental updates
- Reactive aggregations (count, sum, average, etc.)
- Dependency graph tracking between views
- Live views with real-time change propagation
- LRU view caching with configurable limits
- View engine for managing multiple views

## Usage

```typescript
import { createViewEngine, createLiveView } from '@pocket/incremental-views';

const engine = createViewEngine(db);

const liveView = createLiveView({
  collection: 'orders',
  aggregate: { total: { fn: 'sum', field: 'amount' } },
});
```

## API Reference

- `createViewEngine` — Manage and coordinate materialized views
- `createLiveView` — Create a reactive live view
- `createIncrementalAggregation` — Incremental aggregation computations
- `createDependencyGraph` — Track view dependencies
- `createViewCache` — LRU cache for view results
- `createMaterializedViewManager` — Full materialized view lifecycle

## License

MIT
