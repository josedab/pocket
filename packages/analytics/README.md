# @pocket/analytics

[![npm version](https://img.shields.io/npm/v/@pocket/analytics.svg)](https://www.npmjs.com/package/@pocket/analytics)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Offline-first analytics for Pocket - track events locally and sync when online

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/analytics
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createAnalyticsTracker, createEventStore } from '@pocket/analytics';

const tracker = createAnalyticsTracker({
  database: db,
  flushInterval: 30_000, // sync every 30s when online
});

tracker.track('page_view', { path: '/dashboard' });
tracker.track('button_click', { id: 'submit' });
```

## API

| Export | Description |
|--------|-------------|
| `createAnalyticsTracker(config)` | Create an offline-first analytics tracker |
| `createEventStore(config)` | Low-level event storage and retrieval |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/analytics

# Test
npx vitest run --project unit packages/analytics/src/__tests__/

# Watch mode
npx vitest --project unit packages/analytics/src/__tests__/
```

## License

MIT
