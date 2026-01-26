# @pocket/sync

Synchronization engine for Pocket databases - enables multi-device sync and real-time collaboration.

## Installation

```bash
npm install @pocket/sync
```

## Quick Start

```typescript
import { Database } from '@pocket/core';
import { createSyncEngine } from '@pocket/sync';

const db = await Database.create({ name: 'my-app', storage });

// Create sync engine
const sync = createSyncEngine(db, {
  serverUrl: 'wss://sync.example.com',
  authToken: userToken,
  collections: ['todos', 'notes'],
  conflictStrategy: 'last-write-wins'
});

// Start syncing
await sync.start();

// Monitor sync status
sync.status$.subscribe(status => {
  console.log(`Sync: ${status.state}`); // 'idle' | 'syncing' | 'error'
});
```

## Features

### Conflict Resolution

Built-in strategies for handling conflicts:

```typescript
const sync = createSyncEngine(db, {
  // Choose a strategy
  conflictStrategy: 'last-write-wins',  // Default
  // conflictStrategy: 'server-wins',
  // conflictStrategy: 'client-wins',

  // Or provide custom resolver
  conflictResolver: (local, remote) => {
    // Merge logic
    return { ...remote, ...local, merged: true };
  }
});
```

### Optimistic Updates

Changes are applied locally immediately:

```typescript
// This returns instantly
await todos.insert({ title: 'New todo' });

// Sync happens in background
// If sync fails, changes are rolled back
```

### Selective Sync

Sync only what you need:

```typescript
const sync = createSyncEngine(db, {
  collections: ['todos'],
  filters: {
    todos: { userId: currentUser.id }
  }
});
```

### Transport Options

WebSocket (real-time) or HTTP (polling):

```typescript
import { createWebSocketTransport, createHttpTransport } from '@pocket/sync';

// WebSocket (default, recommended)
const wsTransport = createWebSocketTransport({
  serverUrl: 'wss://sync.example.com',
  authToken: token
});

// HTTP fallback
const httpTransport = createHttpTransport({
  serverUrl: 'https://api.example.com/sync',
  authToken: token,
  pollInterval: 5000
});
```

## Sync Protocol

| Message | Direction | Purpose |
|---------|-----------|---------|
| `push` | Client → Server | Send local changes |
| `push-response` | Server → Client | Confirm/reject |
| `pull` | Client → Server | Request changes |
| `pull-response` | Server → Client | Send changes |

## API Reference

### SyncEngine

| Method | Description |
|--------|-------------|
| `start()` | Start synchronization |
| `stop()` | Stop synchronization |
| `push()` | Force push local changes |
| `pull()` | Force pull remote changes |
| `status$` | Observable sync status |

### SyncConfig

| Option | Type | Description |
|--------|------|-------------|
| `serverUrl` | string | Sync server URL |
| `authToken` | string | Authentication token |
| `collections` | string[] | Collections to sync |
| `conflictStrategy` | string | Conflict resolution strategy |
| `transport` | Transport | Custom transport |

## Documentation

- [Sync Guide](https://pocket.dev/docs/sync)
- [Conflict Resolution](https://pocket.dev/docs/sync/conflicts)
- [Architecture](../../ARCHITECTURE.md)

## License

MIT
