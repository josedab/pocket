---
sidebar_position: 3
title: Sync Setup
description: Configure client-server synchronization for multi-device support
---

# Sync Setup

This guide shows how to set up synchronization between Pocket clients and a server.

## Overview

Pocket sync allows:
- Multiple devices to share data
- Offline edits that sync when online
- Real-time updates across clients

## Client Setup

### 1. Install Sync Package

```bash
npm install pocket  # Includes sync
# or
npm install @pocket/sync
```

### 2. Configure Sync Engine

```typescript
import { Database, createIndexedDBStorage } from 'pocket';
import { createSyncEngine } from 'pocket/sync';

// Create database
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  collections: [
    {
      name: 'todos',
      sync: true,  // Enable sync for this collection
    },
  ],
});

// Create sync engine
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  authToken: 'user-auth-token',
  collections: ['todos'],
});

// Start syncing
await sync.start();
```

### 3. Configuration Options

```typescript
const sync = createSyncEngine(db, {
  // Required
  serverUrl: 'wss://api.example.com/sync',

  // Authentication
  authToken: 'user-token',  // JWT or session token

  // What to sync
  collections: ['todos', 'notes'],  // Empty = all collections
  direction: 'both',  // 'push' | 'pull' | 'both'

  // Transport
  useWebSocket: true,   // false for HTTP polling
  pullInterval: 30000,  // Poll interval in ms (HTTP mode)

  // Conflict handling
  conflictStrategy: 'last-write-wins',

  // Retry behavior
  autoRetry: true,
  retryDelay: 1000,
  maxRetryAttempts: 5,

  // Batching
  batchSize: 100,  // Max changes per push/pull

  // Logging
  logger: {
    level: 'info',  // 'debug' | 'info' | 'warn' | 'error'
  },
});
```

## Server Setup

### Using @pocket/server

```typescript
import { createSyncServer } from '@pocket/server';
import { WebSocketServer } from 'ws';

// Create WebSocket server
const wss = new WebSocketServer({ port: 8080 });

// Create sync server
const syncServer = createSyncServer({
  // Your persistence layer
  async getChanges(collection, checkpoint, limit) {
    // Return changes since checkpoint
    return db.query(`
      SELECT * FROM changes
      WHERE collection = ? AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    `, [collection, checkpoint, limit]);
  },

  async applyChanges(collection, changes) {
    // Apply changes to your database
    for (const change of changes) {
      await db.upsert(collection, change.document);
    }
  },

  async getCheckpoint() {
    // Return current server checkpoint
    return { sequence: await db.getMaxSequence() };
  },
});

// Handle connections
wss.on('connection', (ws, req) => {
  // Authenticate the connection
  const token = new URL(req.url, 'http://localhost').searchParams.get('token');
  const user = await validateToken(token);

  if (!user) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  syncServer.handleConnection(ws, { userId: user.id });
});

console.log('Sync server running on ws://localhost:8080');
```

### Custom Server Implementation

If not using `@pocket/server`, implement these message handlers:

```typescript
// Message types
interface PushMessage {
  type: 'push';
  id: string;
  collection: string;
  changes: ChangeEvent[];
  checkpoint: Checkpoint;
}

interface PullMessage {
  type: 'pull';
  id: string;
  collections: string[];
  checkpoint: Checkpoint;
  limit: number;
}

// WebSocket handler
wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    const message = JSON.parse(data.toString());

    if (message.type === 'push') {
      // Validate and store changes
      const conflicts = await processChanges(message.changes);

      ws.send(JSON.stringify({
        type: 'push-response',
        id: message.id,
        success: conflicts.length === 0,
        conflicts,
        checkpoint: getCurrentCheckpoint(),
      }));
    }

    if (message.type === 'pull') {
      // Get changes since client's checkpoint
      const changes = await getChangesSince(
        message.collections,
        message.checkpoint,
        message.limit
      );

      ws.send(JSON.stringify({
        type: 'pull-response',
        id: message.id,
        changes,
        checkpoint: getCurrentCheckpoint(),
        hasMore: changes.length === message.limit,
      }));
    }
  });
});
```

## Authentication

### Token-Based Auth

```typescript
// Client
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  authToken: localStorage.getItem('authToken'),
});

// Update token when it changes
function onLogin(newToken: string) {
  localStorage.setItem('authToken', newToken);
  sync.setAuthToken(newToken);
}
```

### Handling Auth Errors

```typescript
sync.getStatus().subscribe((status) => {
  if (status === 'error') {
    const stats = sync.getStats();
    if (stats.lastError?.message.includes('Unauthorized')) {
      // Redirect to login
      window.location.href = '/login';
    }
  }
});
```

## Monitoring Sync Status

### In React

```tsx
import { useSyncStatus } from 'pocket/react';

function SyncStatusBar() {
  const { status, stats } = useSyncStatus();

  return (
    <div className="sync-status">
      {status === 'syncing' && (
        <span>Syncing...</span>
      )}
      {status === 'idle' && stats.lastSyncAt && (
        <span>Last synced: {new Date(stats.lastSyncAt).toLocaleTimeString()}</span>
      )}
      {status === 'offline' && (
        <span>Offline - changes will sync when connected</span>
      )}
      {status === 'error' && (
        <span>Sync error - retrying...</span>
      )}
    </div>
  );
}
```

### Without React

```typescript
sync.getStatus().subscribe((status) => {
  updateStatusUI(status);
});

sync.getStats().subscribe((stats) => {
  console.log('Sync stats:', {
    pushed: stats.pushCount,
    pulled: stats.pullCount,
    conflicts: stats.conflictCount,
    lastSync: stats.lastSyncAt,
  });
});
```

## Controlling Sync

### Manual Sync

```typescript
// Force immediate sync
await sync.forceSync();

// Push only
await sync.push();

// Pull only
await sync.pull();
```

### Pause and Resume

```typescript
// Stop syncing
await sync.stop();

// Resume syncing
await sync.start();
```

### Clean Up

```typescript
// When user logs out
function onLogout() {
  sync.destroy();
  db.close();
}
```

## Handling Offline

Pocket automatically queues changes when offline:

```typescript
// This works offline
await todos.insert({
  _id: crypto.randomUUID(),
  title: 'Created while offline',
  completed: false,
});

// Change is stored locally
// Automatically synced when connection restored
```

### Checking Connectivity

```typescript
// React
function OfflineIndicator() {
  const { status } = useSyncStatus();

  if (status === 'offline') {
    return <div className="banner">You're offline. Changes will sync when connected.</div>;
  }

  return null;
}
```

## Selective Sync

### Sync Specific Collections

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  collections: ['todos', 'settings'],  // Only these collections
});
```

### Push-Only or Pull-Only

```typescript
// Pull-only (read-only client)
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  direction: 'pull',
});

// Push-only (write-only client)
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  direction: 'push',
});
```

## Conflict Resolution

See [Conflict Resolution Guide](/docs/guides/conflict-resolution) for detailed conflict handling.

Quick setup:

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  conflictStrategy: 'last-write-wins',  // Default
});
```

## Debugging

### Enable Debug Logging

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  logger: {
    level: 'debug',
    format: 'json',  // or 'text'
  },
});
```

### Manual Testing

```typescript
// Check pending changes
const pending = sync.getPendingChanges();
console.log('Pending sync:', pending);

// Check current checkpoint
const checkpoint = sync.getCheckpoint();
console.log('Checkpoint:', checkpoint);
```

## Production Checklist

- [ ] Configure authentication
- [ ] Set up SSL/WSS (not WS)
- [ ] Implement server-side validation
- [ ] Add rate limiting
- [ ] Set up monitoring/alerting
- [ ] Test offline scenarios
- [ ] Test conflict resolution
- [ ] Configure appropriate retry limits
- [ ] Add error tracking

## Next Steps

- [Conflict Resolution](/docs/guides/conflict-resolution) - Handle concurrent edits
- [Sync Architecture](/docs/concepts/sync-architecture) - Understand how sync works
- [SyncEngine API](/docs/api/sync-engine) - Complete API reference
