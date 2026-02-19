# @pocket/mobile

[![npm version](https://img.shields.io/npm/v/@pocket/mobile.svg)](https://www.npmjs.com/package/@pocket/mobile)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Cross-platform mobile abstractions for Pocket local-first database

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/mobile
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createNetworkManager, createPushSync } from '@pocket/mobile';

const network = createNetworkManager();
network.onStatusChange((status) => {
  console.log('Network:', status.isConnected ? 'online' : 'offline');
});

const pushSync = createPushSync({
  database: db,
  networkManager: network,
});
```

## API

| Export | Description |
|--------|-------------|
| `createNetworkManager()` | Cross-platform network status monitoring |
| `createPushSync(config)` | Push notification triggered sync |
| `createSecureStorage(config)` | Platform-native secure storage |
| `createBackgroundSync(config)` | Background sync for mobile platforms |
| `createOfflineQueue(config)` | Queue operations while offline |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/mobile

# Test
npx vitest run --project unit packages/mobile/src/__tests__/

# Watch mode
npx vitest --project unit packages/mobile/src/__tests__/
```

## License

MIT
