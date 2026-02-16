# @pocket/time-series

[![npm version](https://img.shields.io/npm/v/@pocket/time-series.svg)](https://www.npmjs.com/package/@pocket/time-series)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Time-series optimized storage for Pocket - efficient ingestion, compression, and querying of temporal data

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/time-series
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createTimeSeriesStore } from '@pocket/time-series';

const ts = createTimeSeriesStore({
  database: db,
  collection: 'metrics',
  compression: 'gorilla',
});

// Ingest data points
await ts.insert({ metric: 'cpu_usage', value: 72.5, timestamp: Date.now() });

// Query with time range
const data = await ts.query({
  metric: 'cpu_usage',
  from: Date.now() - 3600_000,
  to: Date.now(),
  downsample: '1m',
});
```

## API

| Export | Description |
|--------|-------------|
| `createTimeSeriesStore(config)` | Optimized time-series data storage |
| `createGorillaCompressor(config)` | Gorilla compression for time-series data |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/time-series

# Test
npx vitest run --project unit packages/time-series/src/__tests__/

# Watch mode
npx vitest --project unit packages/time-series/src/__tests__/
```

## License

MIT
