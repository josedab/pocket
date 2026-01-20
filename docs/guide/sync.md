# Sync Overview

Pocket's sync engine enables real-time data synchronization between clients and a server. It supports offline-first workflows with automatic conflict resolution.

## Installation

```bash
npm install @pocket/sync
```

## Quick Start

```typescript
import { Database } from '@pocket/core';
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';
import { createSyncEngine } from '@pocket/sync';

// Create database with sync-enabled collections
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  collections: [{
    name: 'todos',
    sync: true,  // Enable sync for this collection
  }],
});

// Create and start sync engine
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  authToken: 'your-auth-token',
});

await sync.start();
```

## How Sync Works

### 1. Local-First Operations

All operations happen locally first:

```typescript
// This writes to local storage immediately
await todos.insert({ _id: '1', title: 'Task', completed: false });
// UI updates instantly
```

### 2. Background Sync

Changes are synchronized in the background:

```
Client A                    Server                    Client B
   │                          │                          │
   ├─── insert todo ─────────►│                          │
   │    (push change)         │                          │
   │                          ├──── broadcast ──────────►│
   │                          │     (push to B)          │
   │                          │                          ├── apply change
```

### 3. Offline Support

When offline, changes queue locally:

```typescript
// Works offline - stored locally
await todos.insert({ _id: '2', title: 'Offline task', completed: false });

// When back online, sync resumes automatically
sync.getStatus().subscribe((status) => {
  if (status === 'idle') {
    console.log('Synced!');
  }
});
```

## Configuration

### Full Options

```typescript
interface SyncConfig {
  /** Server URL (WebSocket or HTTP) */
  serverUrl: string;

  /** Authentication token */
  authToken?: string;

  /** Collections to sync (empty = all sync-enabled) */
  collections?: string[];

  /** Sync direction: 'push', 'pull', or 'both' */
  direction?: 'push' | 'pull' | 'both';

  /** Conflict resolution strategy */
  conflictStrategy?: 'last-write-wins' | 'server-wins' | 'client-wins' | 'custom';

  /** Auto-retry on failure */
  autoRetry?: boolean;

  /** Retry delay in milliseconds */
  retryDelay?: number;

  /** Maximum retry attempts */
  maxRetryAttempts?: number;

  /** Use WebSocket (true) or HTTP (false) */
  useWebSocket?: boolean;

  /** Poll interval for HTTP pull (milliseconds) */
  pullInterval?: number;

  /** Batch size for sync operations */
  batchSize?: number;
}
```

### Example Configurations

#### Real-time Collaboration

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  authToken: token,
  useWebSocket: true,
  conflictStrategy: 'last-write-wins',
});
```

#### Polling-based Sync

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'https://api.example.com/sync',
  authToken: token,
  useWebSocket: false,
  pullInterval: 30000,  // Poll every 30 seconds
});
```

#### One-way Sync

```typescript
// Server to client only
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  direction: 'pull',
});
```

## Sync Status

Monitor sync state:

```typescript
sync.getStatus().subscribe((status) => {
  switch (status) {
    case 'idle':
      console.log('Synced and waiting');
      break;
    case 'syncing':
      console.log('Synchronizing...');
      break;
    case 'error':
      console.log('Sync error occurred');
      break;
    case 'offline':
      console.log('No connection');
      break;
  }
});
```

### Sync Statistics

```typescript
sync.getStats().subscribe((stats) => {
  console.log({
    pushCount: stats.pushCount,      // Documents pushed
    pullCount: stats.pullCount,      // Documents pulled
    conflictCount: stats.conflictCount,
    lastSyncAt: stats.lastSyncAt,
    lastError: stats.lastError,
  });
});
```

## Manual Sync Control

### Force Sync

```typescript
// Trigger immediate sync
await sync.forceSync();
```

### Push Only

```typescript
await sync.push();
```

### Pull Only

```typescript
await sync.pull();
```

### Stop Sync

```typescript
await sync.stop();
```

### Destroy

```typescript
sync.destroy();
```

## React Integration

```tsx
import { useSyncStatus } from '@pocket/react';

function SyncIndicator() {
  const status = useSyncStatus();

  return (
    <div className={`sync-status sync-${status}`}>
      {status === 'syncing' && <Spinner />}
      {status === 'offline' && <OfflineIcon />}
      {status === 'error' && <ErrorIcon />}
      {status === 'idle' && <CheckIcon />}
    </div>
  );
}
```

## Collection Configuration

Enable sync per collection:

```typescript
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  collections: [
    { name: 'todos', sync: true },      // Synced
    { name: 'settings', sync: true },   // Synced
    { name: 'cache', sync: false },     // Local only
  ],
});
```

## Soft Deletes

Sync-enabled collections use soft deletes:

```typescript
// For sync-enabled collections
await todos.delete('todo-1');
// Document marked as _deleted: true, not removed
// This allows the delete to sync to other clients

// For local-only or to force removal
await todos.hardDelete('todo-1');
```

## Next Steps

- [Server Setup](./sync-server.md) - Set up your sync server
- [Conflict Resolution](./conflict-resolution.md) - Handle conflicts
- [React Integration](./react.md) - React hooks for sync
