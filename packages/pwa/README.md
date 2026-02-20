# @pocket/pwa

Offline-first PWA toolkit for Pocket.

## Installation

```bash
pnpm add @pocket/pwa
```

## Features

- Offline mutation queue with automatic retry on reconnect
- Sync status tracking with online/offline detection
- Unified PWA manager for coordinating offline workflows
- Configurable queue strategies

## Usage

```typescript
import { createPWAManager, createOfflineQueue } from '@pocket/pwa';

const pwa = createPWAManager({ db, syncUrl: 'https://api.example.com/sync' });

const queue = createOfflineQueue();
queue.enqueue({ type: 'insert', collection: 'todos', data: { title: 'New' } });
```

## API Reference

- `createPWAManager` / `PWAManager` — Coordinate offline-first workflows
- `createOfflineQueue` / `OfflineQueue` — Queue mutations while offline
- `createSyncStatusTracker` / `SyncStatusTracker` — Track online/offline and sync state

## License

MIT
