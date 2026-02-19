# @pocket/subscriptions

[![npm version](https://img.shields.io/npm/v/@pocket/subscriptions.svg)](https://www.npmjs.com/package/@pocket/subscriptions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Query subscriptions with server push for Pocket - real-time delta delivery over WebSocket

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/subscriptions
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createSubscriptionManager, createDeltaComputer } from '@pocket/subscriptions';

const subs = createSubscriptionManager({
  database: db,
  transport: websocket,
});

// Subscribe to changes
subs.subscribe('todos', {
  filter: { completed: false },
  onDelta: (delta) => {
    console.log('Changes:', delta);
  },
});
```

## API

| Export | Description |
|--------|-------------|
| `createSubscriptionManager(config)` | Manage query subscriptions with server push |
| `createFilterMatcher(filter)` | Client-side filter matching for deltas |
| `createDeltaComputer(config)` | Compute minimal deltas between states |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/subscriptions

# Test
npx vitest run --project unit packages/subscriptions/src/__tests__/

# Watch mode
npx vitest --project unit packages/subscriptions/src/__tests__/
```

## License

MIT
