# @pocket/server

Server-side sync infrastructure for Pocket - enables multi-device synchronization.

## Installation

```bash
npm install @pocket/server
```

## Quick Start

```typescript
import { createSyncServer } from '@pocket/server';
import { WebSocketServer } from 'ws';

// Create sync server
const syncServer = createSyncServer({
  storage: createServerStorage(), // Your server storage
  auth: async (token) => {
    // Verify token and return user
    return { userId: '123', permissions: ['read', 'write'] };
  }
});

// Attach to WebSocket server
const wss = new WebSocketServer({ port: 8080 });
wss.on('connection', (ws, req) => {
  syncServer.handleConnection(ws, req);
});

console.log('Sync server running on ws://localhost:8080');
```

## Features

- **Real-time Sync**: WebSocket-based bidirectional communication
- **Conflict Resolution**: Configurable conflict handling strategies
- **Authentication**: Pluggable auth middleware
- **Selective Sync**: Filter what data syncs to each client
- **Horizontal Scaling**: Redis adapter for multi-server deployments

## Express Integration

```typescript
import express from 'express';
import { createSyncServer, createHttpHandler } from '@pocket/server';

const app = express();
const syncServer = createSyncServer({ storage, auth });

// HTTP endpoint for polling
app.post('/sync', createHttpHandler(syncServer));

// WebSocket upgrade
app.on('upgrade', (req, socket, head) => {
  syncServer.handleUpgrade(req, socket, head);
});

app.listen(3000);
```

## Authentication

```typescript
const syncServer = createSyncServer({
  storage,
  auth: async (token, req) => {
    // Verify JWT
    const decoded = jwt.verify(token, SECRET);
    return {
      userId: decoded.sub,
      permissions: decoded.permissions
    };
  },
  // Optional: permission check per document
  authorize: async (user, collection, doc, operation) => {
    if (collection === 'todos') {
      return doc.userId === user.userId;
    }
    return true;
  }
});
```

## Conflict Resolution

```typescript
const syncServer = createSyncServer({
  storage,
  auth,
  conflictStrategy: 'last-write-wins', // Default
  // Or custom resolver
  conflictResolver: async (serverDoc, clientDoc) => {
    // Merge logic
    return {
      ...serverDoc,
      ...clientDoc,
      _resolved: true
    };
  }
});
```

## Scaling with Redis

```typescript
import { createRedisAdapter } from '@pocket/server';
import Redis from 'ioredis';

const redis = new Redis();

const syncServer = createSyncServer({
  storage,
  auth,
  pubsub: createRedisAdapter(redis)
});
```

## API Reference

### createSyncServer(config)

**Config:**
| Option | Type | Description |
|--------|------|-------------|
| `storage` | StorageAdapter | Server storage adapter |
| `auth` | Function | Authentication handler |
| `authorize` | Function | Authorization handler |
| `conflictStrategy` | string | Conflict resolution strategy |
| `pubsub` | PubSubAdapter | For horizontal scaling |

### SyncServer Methods

| Method | Description |
|--------|-------------|
| `handleConnection(ws, req)` | Handle WebSocket connection |
| `handleUpgrade(req, socket, head)` | Handle HTTP upgrade |
| `broadcast(collection, change)` | Broadcast change to clients |
| `close()` | Shutdown server |

## Documentation

- [Server Guide](https://pocket.dev/docs/server)
- [Deployment](https://pocket.dev/docs/server/deployment)
- [Scaling](https://pocket.dev/docs/server/scaling)

## License

MIT
