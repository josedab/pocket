# @pocket/cross-tab

[![npm version](https://img.shields.io/npm/v/@pocket/cross-tab.svg)](https://www.npmjs.com/package/@pocket/cross-tab)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Cross-tab synchronization for Pocket - sync state across browser tabs without network

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/cross-tab
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createCrossTabSync, createLeaderElection } from '@pocket/cross-tab';

const crossTab = createCrossTabSync({ database: db });

// Elect a leader tab for sync coordination
const election = createLeaderElection({ channel: 'pocket-leader' });
election.onLeader(() => {
  console.log('This tab is the leader');
});
```

## API

| Export | Description |
|--------|-------------|
| `createCrossTabSync(config)` | Sync database state across browser tabs |
| `createLeaderElection(config)` | Elect a leader tab via BroadcastChannel |
| `createTabManager(config)` | Track and manage open tabs |
| `createDistributedLockManager(config)` | Distributed locking across tabs |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/cross-tab

# Test
npx vitest run --project unit packages/cross-tab/src/__tests__/

# Watch mode
npx vitest --project unit packages/cross-tab/src/__tests__/
```

## License

MIT
