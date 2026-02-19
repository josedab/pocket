# @pocket/prefetch

[![npm version](https://img.shields.io/npm/v/@pocket/prefetch.svg)](https://www.npmjs.com/package/@pocket/prefetch)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Predictive data prefetching for Pocket - learn query patterns and prefetch results before they're needed

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/prefetch
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createPrefetchEngine } from '@pocket/prefetch';

const prefetch = createPrefetchEngine({
  database: db,
  maxCacheSize: 100,
});

// Learns access patterns and prefetches predictively
prefetch.observe('todos', { filter: { completed: false } });

// Cached results available instantly
const results = await prefetch.get('todos', { filter: { completed: false } });
```

## API

| Export | Description |
|--------|-------------|
| `createPrefetchEngine(config)` | Predictive prefetching engine |
| `createPatternAnalyzer(config)` | Analyze query access patterns |
| `createPrefetchCache(config)` | LRU cache for prefetched results |
| `createAdaptiveLearningModel(config)` | ML model for prefetch prediction |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/prefetch

# Test
npx vitest run --project unit packages/prefetch/src/__tests__/

# Watch mode
npx vitest --project unit packages/prefetch/src/__tests__/
```

## License

MIT
