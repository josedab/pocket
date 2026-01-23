---
sidebar_position: 4
title: SyncEngine API
description: SyncEngine class API reference
---

# SyncEngine API

The `SyncEngine` manages client-server synchronization. Import from the sync package:

```typescript
import { createSyncEngine } from 'pocket/sync';
```

## Creating a Sync Engine

### createSyncEngine()

Creates a new sync engine instance.

```typescript
function createSyncEngine(database: Database, config: SyncConfig): SyncEngine
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `database` | `Database` | Pocket database instance |
| `config` | `SyncConfig` | Sync configuration |

#### Example

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  authToken: 'user-token',
  collections: ['todos', 'notes'],
});
```

---

## SyncConfig

```typescript
interface SyncConfig {
  /** Server URL (required) */
  serverUrl: string;

  /** Authentication token */
  authToken?: string;

  /** Collections to sync (empty = all) */
  collections?: string[];

  /** Sync direction: 'push' | 'pull' | 'both' (default: 'both') */
  direction?: 'push' | 'pull' | 'both';

  /** Conflict resolution strategy (default: 'last-write-wins') */
  conflictStrategy?: ConflictStrategy;

  /** Use WebSocket (true) or HTTP (false) (default: true) */
  useWebSocket?: boolean;

  /** Pull interval in ms for HTTP polling (default: 30000) */
  pullInterval?: number;

  /** Auto retry on failure (default: true) */
  autoRetry?: boolean;

  /** Retry delay in ms (default: 1000) */
  retryDelay?: number;

  /** Max retry attempts (default: 5) */
  maxRetryAttempts?: number;

  /** Batch size for push/pull (default: 100) */
  batchSize?: number;

  /** Logger configuration */
  logger?: LoggerOptions | Logger | false;
}
```

---

## Methods

### start()

Starts the sync engine.

```typescript
start(): Promise<void>
```

Connects to the server, subscribes to local changes, and performs an initial sync.

#### Example

```typescript
await sync.start();
console.log('Sync started');
```

---

### stop()

Stops the sync engine.

```typescript
stop(): Promise<void>
```

Disconnects from the server and stops watching for changes.

#### Example

```typescript
await sync.stop();
console.log('Sync stopped');
```

---

### forceSync()

Forces an immediate sync.

```typescript
forceSync(): Promise<void>
```

Pushes local changes and pulls remote changes.

#### Example

```typescript
// Ensure all changes are synced
await sync.forceSync();
```

---

### push()

Pushes local changes to the server.

```typescript
push(): Promise<void>
```

#### Example

```typescript
// Push without pulling
await sync.push();
```

---

### pull()

Pulls remote changes from the server.

```typescript
pull(): Promise<void>
```

#### Example

```typescript
// Pull without pushing
await sync.pull();
```

---

### getStatus()

Gets an observable of the sync status.

```typescript
getStatus(): Observable<SyncStatus>
```

#### Returns

```typescript
type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';
```

#### Example

```typescript
sync.getStatus().subscribe((status) => {
  switch (status) {
    case 'idle':
      console.log('Ready');
      break;
    case 'syncing':
      console.log('Syncing...');
      break;
    case 'error':
      console.log('Sync error');
      break;
    case 'offline':
      console.log('Offline');
      break;
  }
});
```

---

### getStats()

Gets an observable of sync statistics.

```typescript
getStats(): Observable<SyncStats>
```

#### Returns

```typescript
interface SyncStats {
  pushCount: number;        // Total documents pushed
  pullCount: number;        // Total documents pulled
  conflictCount: number;    // Total conflicts resolved
  lastSyncAt: number | null; // Timestamp of last successful sync
  lastError: Error | null;  // Most recent error
}
```

#### Example

```typescript
sync.getStats().subscribe((stats) => {
  console.log('Pushed:', stats.pushCount);
  console.log('Pulled:', stats.pullCount);
  console.log('Conflicts:', stats.conflictCount);

  if (stats.lastSyncAt) {
    console.log('Last sync:', new Date(stats.lastSyncAt));
  }

  if (stats.lastError) {
    console.log('Last error:', stats.lastError.message);
  }
});
```

---

### destroy()

Destroys the sync engine and releases resources.

```typescript
destroy(): void
```

#### Example

```typescript
// When done with sync
sync.destroy();
```

---

## Conflict Strategies

### Built-in Strategies

```typescript
type ConflictStrategy =
  | 'last-write-wins'  // Most recent timestamp wins
  | 'server-wins'      // Server version always wins
  | 'client-wins'      // Client version always wins
  | 'merge'            // Merge non-conflicting fields
  | 'custom';          // Use custom resolver
```

### Custom Resolver

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  conflictStrategy: 'custom',
  conflictResolver: (conflict) => {
    // conflict.localDocument - local version
    // conflict.remoteDocument - server version
    // conflict.documentId - document ID

    // Return resolved document
    return {
      ...conflict.remoteDocument,
      ...conflict.localDocument,
      _rev: conflict.remoteDocument._rev,
    };
  },
});
```

---

## Transport Configuration

### WebSocket (Default)

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  useWebSocket: true,  // Default
});
```

### HTTP Polling

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'https://api.example.com/sync',
  useWebSocket: false,
  pullInterval: 10000,  // Poll every 10 seconds
});
```

---

## Logging

### Enable Logging

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  logger: {
    level: 'debug',  // 'debug' | 'info' | 'warn' | 'error'
    format: 'json',  // 'json' | 'text'
  },
});
```

### Disable Logging

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  logger: false,
});
```

### Custom Logger

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  logger: {
    debug: (msg, data) => myLogger.debug(msg, data),
    info: (msg, data) => myLogger.info(msg, data),
    warn: (msg, data) => myLogger.warn(msg, data),
    error: (msg, error) => myLogger.error(msg, error),
  },
});
```

---

## React Integration

### useSyncStatus Hook

```tsx
import { useSyncStatus } from 'pocket/react';

function SyncIndicator() {
  const { status, stats } = useSyncStatus();

  return (
    <div className={`sync-status sync-status--${status}`}>
      {status === 'syncing' && <Spinner />}
      {status === 'error' && <span>Sync error</span>}
      {status === 'offline' && <span>Offline</span>}
      {status === 'idle' && stats.lastSyncAt && (
        <span>Synced {formatRelative(stats.lastSyncAt)}</span>
      )}
    </div>
  );
}
```

---

## Types

### SyncEngine

```typescript
class SyncEngine {
  start(): Promise<void>;
  stop(): Promise<void>;
  forceSync(): Promise<void>;
  push(): Promise<void>;
  pull(): Promise<void>;
  getStatus(): Observable<SyncStatus>;
  getStats(): Observable<SyncStats>;
  destroy(): void;
}
```

### SyncStatus

```typescript
type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';
```

### SyncStats

```typescript
interface SyncStats {
  pushCount: number;
  pullCount: number;
  conflictCount: number;
  lastSyncAt: number | null;
  lastError: Error | null;
}
```

### Conflict

```typescript
interface Conflict<T> {
  documentId: string;
  localDocument: T;
  remoteDocument: T;
  timestamp: number;
}
```

---

## See Also

- [Sync Setup Guide](/docs/guides/sync-setup) - Step-by-step setup
- [Conflict Resolution](/docs/guides/conflict-resolution) - Handling conflicts
- [Sync Architecture](/docs/concepts/sync-architecture) - How sync works
