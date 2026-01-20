# Sync Server Setup

Pocket includes a server package for building sync endpoints. This guide covers setting up a sync server using `@pocket/server`.

## Installation

```bash
npm install @pocket/server
```

## Quick Start

### Basic Server

```typescript
import { createServer } from 'http';
import { PocketServer } from '@pocket/server';

const pocket = new PocketServer({
  // Optional: custom storage for server-side data
});

const server = createServer();
pocket.attach(server);

server.listen(3000, () => {
  console.log('Sync server running on port 3000');
});
```

### With Express

```typescript
import express from 'express';
import { createServer } from 'http';
import { PocketServer } from '@pocket/server';

const app = express();
const server = createServer(app);

const pocket = new PocketServer();
pocket.attach(server);

// Your other routes
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

server.listen(3000);
```

### With WebSocket

```typescript
import { WebSocketServer } from 'ws';
import { PocketServer } from '@pocket/server';

const wss = new WebSocketServer({ port: 3000 });
const pocket = new PocketServer();

pocket.attachWebSocket(wss);
```

## Authentication

### Token-based Authentication

```typescript
const pocket = new PocketServer({
  authenticate: async (token) => {
    // Verify JWT or session token
    const user = await verifyToken(token);
    if (!user) {
      throw new Error('Invalid token');
    }
    return { userId: user.id, role: user.role };
  },
});
```

### With Express Middleware

```typescript
import jwt from 'jsonwebtoken';

app.use('/sync', (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

const pocket = new PocketServer({
  authenticate: async (token, req) => {
    return req.user;  // Already verified by middleware
  },
});
```

## Authorization

Control access per collection:

```typescript
const pocket = new PocketServer({
  authorize: async (user, collection, operation, document) => {
    // Admin can do anything
    if (user.role === 'admin') return true;

    // Users can only access their own data
    if (collection === 'todos') {
      if (operation === 'read') {
        return document?.userId === user.id;
      }
      if (operation === 'write') {
        return document?.userId === user.id;
      }
    }

    return false;
  },
});
```

## Server Configuration

```typescript
interface ServerConfig {
  /** Authentication function */
  authenticate?: (token: string) => Promise<User>;

  /** Authorization function */
  authorize?: (user: User, collection: string, op: string, doc: any) => Promise<boolean>;

  /** Change log storage */
  changeLog?: ChangeLog;

  /** Maximum connections per user */
  maxConnectionsPerUser?: number;

  /** Heartbeat interval (ms) */
  heartbeatInterval?: number;

  /** Client timeout (ms) */
  clientTimeout?: number;
}
```

## Change Log

The server maintains a log of all changes for synchronization:

### Memory Change Log (Default)

```typescript
const pocket = new PocketServer();
// Uses MemoryChangeLog - data lost on restart
```

### Custom Change Log

Implement `ChangeLog` interface for persistence:

```typescript
interface ChangeLog {
  append(change: ChangeEntry): Promise<void>;
  getSince(sequence: number, limit?: number): Promise<ChangeEntry[]>;
  getForCollection(collection: string, since: number): Promise<ChangeEntry[]>;
  get(id: string): Promise<ChangeEntry | null>;
  getCurrentSequence(): Promise<number>;
  compact(): Promise<void>;
  clear(): Promise<void>;
}
```

### PostgreSQL Example

```typescript
class PostgresChangeLog implements ChangeLog {
  constructor(private pool: Pool) {}

  async append(change: ChangeEntry): Promise<void> {
    await this.pool.query(
      'INSERT INTO changes (id, collection, document_id, operation, data, sequence) VALUES ($1, $2, $3, $4, $5, $6)',
      [change.id, change.collection, change.documentId, change.operation, change.data, change.sequence]
    );
  }

  async getSince(sequence: number, limit = 100): Promise<ChangeEntry[]> {
    const result = await this.pool.query(
      'SELECT * FROM changes WHERE sequence > $1 ORDER BY sequence LIMIT $2',
      [sequence, limit]
    );
    return result.rows;
  }

  // ... implement other methods
}
```

## Client Management

### Track Connected Clients

```typescript
const pocket = new PocketServer({
  onClientConnect: (client) => {
    console.log(`Client connected: ${client.id}`);
  },
  onClientDisconnect: (client) => {
    console.log(`Client disconnected: ${client.id}`);
  },
});
```

### Get Active Clients

```typescript
const clients = pocket.getClients();
console.log(`${clients.length} clients connected`);
```

### Disconnect Client

```typescript
pocket.disconnectClient(clientId);
```

## Message Protocol

### Push Message (Client → Server)

```json
{
  "type": "push",
  "id": "msg-123",
  "timestamp": 1704067200000,
  "collection": "todos",
  "changes": [
    {
      "operation": "insert",
      "documentId": "todo-1",
      "document": { "_id": "todo-1", "title": "Task" },
      "timestamp": 1704067200000,
      "sequence": 1
    }
  ],
  "checkpoint": { "global": 100 }
}
```

### Push Response (Server → Client)

```json
{
  "type": "push-response",
  "id": "msg-123",
  "success": true,
  "checkpoint": { "global": 101 }
}
```

### Pull Message (Client → Server)

```json
{
  "type": "pull",
  "id": "msg-456",
  "timestamp": 1704067200000,
  "collections": ["todos"],
  "checkpoint": { "global": 95 },
  "limit": 100
}
```

### Pull Response (Server → Client)

```json
{
  "type": "pull-response",
  "id": "msg-456",
  "changes": {
    "todos": [
      {
        "operation": "update",
        "documentId": "todo-1",
        "document": { "_id": "todo-1", "title": "Updated" },
        "timestamp": 1704067200000,
        "sequence": 96
      }
    ]
  },
  "checkpoint": { "global": 101 },
  "hasMore": false
}
```

## Scaling

### Horizontal Scaling with Redis

```typescript
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

const pocket = new PocketServer({
  changeLog: new RedisChangeLog(redis),
  pubsub: new RedisPubSub(redis),
});
```

### Load Balancing

With sticky sessions:

```nginx
upstream sync_servers {
    ip_hash;  # Sticky sessions
    server sync1.example.com:3000;
    server sync2.example.com:3000;
}

server {
    location /sync {
        proxy_pass http://sync_servers;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Monitoring

### Health Check Endpoint

```typescript
app.get('/health', async (req, res) => {
  const health = await pocket.healthCheck();
  res.json({
    status: health.healthy ? 'ok' : 'degraded',
    clients: health.clientCount,
    pendingChanges: health.pendingChanges,
    lastSync: health.lastSyncTime,
  });
});
```

### Metrics

```typescript
const pocket = new PocketServer({
  onMetric: (metric) => {
    // Send to your metrics system
    prometheus.gauge('pocket_connected_clients', metric.clientCount);
    prometheus.counter('pocket_sync_operations', metric.operations);
  },
});
```

## Security Best Practices

1. **Always use TLS** - Use `wss://` for WebSocket connections
2. **Validate tokens** - Verify authentication on every connection
3. **Authorize operations** - Check permissions for each write
4. **Rate limit** - Prevent abuse with connection and message limits
5. **Sanitize data** - Validate incoming documents
6. **Audit logs** - Track who changed what

## Next Steps

- [Conflict Resolution](./conflict-resolution.md) - Handle sync conflicts
- [Sync Overview](./sync.md) - Client-side sync setup
- [Authentication](../api/) - API authentication patterns
