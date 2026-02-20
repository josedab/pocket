# @pocket/shared-worker

Multi-tab/multi-worker coordination with leader election, SharedWorker DB proxy, query deduplication, and BroadcastChannel sync.

## Installation

```bash
pnpm add @pocket/shared-worker
```

## Features

- Leader election across browser tabs
- SharedWorker database proxy for single-connection sharing
- Query deduplication to avoid redundant work
- BroadcastChannel adapter for cross-tab communication
- Tab coordinator for multi-tab state management
- Write coordinator with lock management
- Sync connection deduplication
- Graceful degradation across browser capabilities
- Unified multi-tab SDK

## Usage

```typescript
import { createMultiTabSDK } from '@pocket/shared-worker';

const sdk = createMultiTabSDK({ dbName: 'myapp' });

// Or use individual primitives
import { createLeaderElection, createTabCoordinator } from '@pocket/shared-worker';

const election = createLeaderElection({ channel: 'myapp' });
const coordinator = createTabCoordinator({ election });
```

## API Reference

- `createMultiTabSDK` — All-in-one multi-tab coordination
- `createLeaderElection` — Tab leader election
- `createTabCoordinator` — Multi-tab state coordination
- `createBroadcastAdapter` — Cross-tab messaging
- `createQueryDeduplicator` — Deduplicate concurrent queries
- `createWorkerDBProxy` / `WorkerDBProxy` — SharedWorker database proxy
- `createWriteCoordinator` — Coordinate writes across tabs
- `createSyncConnectionDedup` — Deduplicate sync connections
- `createGracefulDegradation` — Feature detection and fallbacks

## License

MIT
