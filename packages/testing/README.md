# @pocket/testing

Offline-first E2E testing framework with network simulation, conflict injection, and eventual consistency assertions.

## Installation

```bash
pnpm add @pocket/testing
```

## Features

- Network simulator for testing offline/online transitions
- Conflict injector for generating sync conflicts
- Consistency checker for verifying eventual consistency
- Sync test harness for end-to-end sync scenarios

## Usage

```typescript
import { createNetworkSimulator, createSyncTestHarness } from '@pocket/testing';

const network = createNetworkSimulator();
network.goOffline();

const harness = createSyncTestHarness({ peers: 2 });
await harness.simulateConflict('todos', { title: 'A' }, { title: 'B' });
await harness.assertEventualConsistency();
```

## API Reference

- `createNetworkSimulator` — Simulate network conditions (offline, latency, partitions)
- `createConflictInjector` / `ConflictInjector` — Inject sync conflicts for testing
- `createConsistencyChecker` / `ConsistencyChecker` — Assert eventual consistency
- `createSyncTestHarness` — Full sync testing harness with multiple peers

## License

MIT
