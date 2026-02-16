# @pocket/sync-server

[![npm version](https://img.shields.io/npm/v/@pocket/sync-server.svg)](https://www.npmjs.com/package/@pocket/sync-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Zero-config sync server for Pocket - deploy anywhere with minimal setup

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/sync-server
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createSyncServer } from '@pocket/sync-server';

const server = createSyncServer({
  port: 3001,
  storage: createMemoryStorage(),
});

await server.start();
console.log('Sync server running on port 3001');

// Or deploy to edge with one line
import { createOneLineSync } from '@pocket/sync-server';
export default createOneLineSync();
```

## API

| Export | Description |
|--------|-------------|
| `createSyncServer(config)` | Create a full-featured sync server |
| `createMemoryStorage()` | In-memory server-side storage |
| `createOneLineSync()` | One-line edge-compatible sync endpoint |
| `createEdgeAdapter(config)` | Adapter for edge runtime deployment |
| `createWebhookManager(config)` | Webhook notifications for sync events |
| `createHealthMonitor(config)` | Server health monitoring |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/sync-server

# Test
npx vitest run --project unit packages/sync-server/src/__tests__/

# Watch mode
npx vitest --project unit packages/sync-server/src/__tests__/
```

## License

MIT
