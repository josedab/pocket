---
sidebar_position: 11
title: Edge Runtime
description: Using Pocket with Cloudflare Workers, D1, and Durable Objects
---

# Edge Runtime

Pocket supports edge computing environments with the `@pocket/storage-edge` package, providing storage adapters for Cloudflare D1 and Durable Objects.

## Installation

```bash
npm install @pocket/core @pocket/storage-edge
```

## Cloudflare D1

### Setup

1. Create a D1 database in your Cloudflare dashboard or using Wrangler:

```bash
wrangler d1 create my-pocket-db
```

2. Add the binding to `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "my-pocket-db"
database_id = "your-database-id"
```

3. Use in your Worker:

```typescript
// src/index.ts
import { Database } from '@pocket/core';
import { createD1Storage } from '@pocket/storage-edge';

export interface Env {
  DB: D1Database;
}

export interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  userId: string;
  createdAt: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const db = await Database.create({
      name: 'my-app',
      storage: createD1Storage({ database: env.DB }),
    });

    const todos = db.collection<Todo>('todos');

    // Handle requests
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/todos') {
      const results = await todos.find().exec();
      return Response.json(results);
    }

    if (request.method === 'POST' && url.pathname === '/todos') {
      const body = await request.json();
      const todo = await todos.insert({
        _id: crypto.randomUUID(),
        ...body,
        completed: false,
        createdAt: new Date().toISOString(),
      });
      return Response.json(todo, { status: 201 });
    }

    return new Response('Not Found', { status: 404 });
  },
};
```

### D1 Configuration

```typescript
import { createD1Storage } from '@pocket/storage-edge';

const storage = createD1Storage({
  // D1 database binding
  database: env.DB,

  // Table prefix (default: 'pocket_')
  tablePrefix: 'app_',

  // Enable batch operations (default: true)
  useBatch: true,
});
```

### Schema Initialization

D1 requires tables to be created. Use migrations or initialize on first request:

```typescript
// migrations/0001_init.sql
CREATE TABLE IF NOT EXISTS pocket_todos (
  _id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_todos_created
ON pocket_todos(json_extract(data, '$._id'));
```

Or initialize programmatically:

```typescript
import { initializeD1Schema } from '@pocket/storage-edge';

// Run once during deployment or first request
await initializeD1Schema(env.DB, {
  collections: ['todos', 'users', 'projects'],
});
```

## Cloudflare Durable Objects

Durable Objects provide strongly consistent, single-instance storage per object.

### Setup

1. Define your Durable Object class:

```typescript
// src/todo-list.ts
import { Database } from '@pocket/core';
import { createDurableObjectStorage } from '@pocket/storage-edge';

export interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: string;
}

export class TodoListDO implements DurableObject {
  private db: Database | null = null;

  constructor(
    private state: DurableObjectState,
    private env: Env
  ) {}

  private async getDb(): Promise<Database> {
    if (!this.db) {
      this.db = await Database.create({
        name: 'todo-list',
        storage: createDurableObjectStorage({
          storage: this.state.storage,
        }),
      });
    }
    return this.db;
  }

  async fetch(request: Request): Promise<Response> {
    const db = await this.getDb();
    const todos = db.collection<Todo>('todos');
    const url = new URL(request.url);

    switch (request.method) {
      case 'GET': {
        if (url.pathname === '/todos') {
          const results = await todos.find().exec();
          return Response.json(results);
        }
        break;
      }

      case 'POST': {
        if (url.pathname === '/todos') {
          const body = await request.json();
          const todo = await todos.insert({
            _id: crypto.randomUUID(),
            title: body.title,
            completed: false,
            createdAt: new Date().toISOString(),
          });
          return Response.json(todo, { status: 201 });
        }
        break;
      }

      case 'PUT': {
        const match = url.pathname.match(/^\/todos\/(.+)$/);
        if (match) {
          const body = await request.json();
          const updated = await todos.update(match[1], body);
          return Response.json(updated);
        }
        break;
      }

      case 'DELETE': {
        const match = url.pathname.match(/^\/todos\/(.+)$/);
        if (match) {
          await todos.delete(match[1]);
          return new Response(null, { status: 204 });
        }
        break;
      }
    }

    return new Response('Not Found', { status: 404 });
  }
}
```

2. Configure Wrangler:

```toml
# wrangler.toml
name = "my-app"
main = "src/index.ts"

[durable_objects]
bindings = [
  { name = "TODO_LIST", class_name = "TodoListDO" }
]

[[migrations]]
tag = "v1"
new_classes = ["TodoListDO"]
```

3. Route requests to Durable Objects:

```typescript
// src/index.ts
import { TodoListDO } from './todo-list';

export { TodoListDO };

export interface Env {
  TODO_LIST: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Get user ID from auth header
    const userId = request.headers.get('x-user-id') || 'anonymous';

    // Route to user's Durable Object
    const id = env.TODO_LIST.idFromName(userId);
    const stub = env.TODO_LIST.get(id);

    return stub.fetch(request);
  },
};
```

### Durable Objects Configuration

```typescript
import { createDurableObjectStorage } from '@pocket/storage-edge';

const storage = createDurableObjectStorage({
  // Durable Object storage
  storage: state.storage,

  // Key prefix for all documents
  keyPrefix: 'pocket:',
});
```

## Hono Framework Integration

Using Pocket with the Hono framework:

```typescript
import { Hono } from 'hono';
import { Database } from '@pocket/core';
import { createD1Storage } from '@pocket/storage-edge';

interface Env {
  DB: D1Database;
}

interface Todo {
  _id: string;
  title: string;
  completed: boolean;
}

const app = new Hono<{ Bindings: Env }>();

// Middleware to initialize database
app.use('*', async (c, next) => {
  const db = await Database.create({
    name: 'my-app',
    storage: createD1Storage({ database: c.env.DB }),
  });
  c.set('db', db);
  await next();
});

// Routes
app.get('/todos', async (c) => {
  const db = c.get('db') as Database;
  const todos = await db.collection<Todo>('todos').find().exec();
  return c.json(todos);
});

app.post('/todos', async (c) => {
  const db = c.get('db') as Database;
  const body = await c.req.json();
  const todo = await db.collection<Todo>('todos').insert({
    _id: crypto.randomUUID(),
    title: body.title,
    completed: false,
  });
  return c.json(todo, 201);
});

app.put('/todos/:id', async (c) => {
  const db = c.get('db') as Database;
  const id = c.req.param('id');
  const body = await c.req.json();
  const todo = await db.collection<Todo>('todos').update(id, body);
  return c.json(todo);
});

app.delete('/todos/:id', async (c) => {
  const db = c.get('db') as Database;
  const id = c.req.param('id');
  await db.collection<Todo>('todos').delete(id);
  return c.body(null, 204);
});

export default app;
```

## Multi-Tenant Architecture

### Per-Tenant Databases

```typescript
// Using D1 with tenant isolation
async function getDb(env: Env, tenantId: string): Promise<Database> {
  return Database.create({
    name: `tenant-${tenantId}`,
    storage: createD1Storage({
      database: env.DB,
      tablePrefix: `tenant_${tenantId}_`,
    }),
  });
}

// Using Durable Objects (each tenant gets their own DO)
function getTenantStub(env: Env, tenantId: string) {
  const id = env.TENANT_DO.idFromName(tenantId);
  return env.TENANT_DO.get(id);
}
```

### Shared Database with Row-Level Security

```typescript
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  tenantId: string; // Tenant identifier
}

// Always filter by tenant
async function getTodos(db: Database, tenantId: string) {
  return db.collection<Todo>('todos')
    .find()
    .where('tenantId').equals(tenantId)
    .exec();
}

// Enforce tenant on insert
async function createTodo(db: Database, tenantId: string, data: Partial<Todo>) {
  return db.collection<Todo>('todos').insert({
    _id: crypto.randomUUID(),
    ...data,
    tenantId, // Always set from authenticated context
  });
}
```

## Caching Strategies

### KV Cache

```typescript
interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
}

async function getCachedTodos(env: Env, userId: string): Promise<Todo[]> {
  const cacheKey = `todos:${userId}`;

  // Check cache
  const cached = await env.CACHE.get(cacheKey, 'json');
  if (cached) return cached as Todo[];

  // Query database
  const db = await Database.create({
    name: 'my-app',
    storage: createD1Storage({ database: env.DB }),
  });

  const todos = await db.collection<Todo>('todos')
    .find()
    .where('userId').equals(userId)
    .exec();

  // Cache for 60 seconds
  await env.CACHE.put(cacheKey, JSON.stringify(todos), { expirationTtl: 60 });

  return todos;
}

// Invalidate cache on mutation
async function invalidateCache(env: Env, userId: string) {
  await env.CACHE.delete(`todos:${userId}`);
}
```

## Error Handling

```typescript
import { PocketError } from '@pocket/core';
import { D1Error } from '@pocket/storage-edge';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const db = await Database.create({
        name: 'my-app',
        storage: createD1Storage({ database: env.DB }),
      });

      // ... handle request
    } catch (error) {
      if (error instanceof D1Error) {
        // D1-specific error
        console.error('D1 error:', error.message);
        return Response.json(
          { error: 'Database error' },
          { status: 503 }
        );
      }

      if (error instanceof PocketError) {
        // Pocket validation/operation error
        return Response.json(
          { error: error.message },
          { status: 400 }
        );
      }

      // Unknown error
      console.error('Unexpected error:', error);
      return Response.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  },
};
```

## Performance Tips

### 1. Reuse Database Instances

```typescript
// Store in Durable Object instance
class MyDO implements DurableObject {
  private db: Database | null = null;

  private async getDb() {
    if (!this.db) {
      this.db = await Database.create({ ... });
    }
    return this.db;
  }
}
```

### 2. Use Batch Operations

```typescript
// Batch multiple inserts
await db.collection('todos').bulkInsert(todos);

// Batch multiple updates
await db.collection('todos').bulkUpdate(updates);
```

### 3. Limit Query Results

```typescript
// Always limit at the edge
const results = await todos
  .find()
  .limit(100)
  .exec();
```

### 4. Create Indexes for D1

```sql
-- Create indexes for frequently queried fields
CREATE INDEX idx_todos_user ON pocket_todos(json_extract(data, '$.userId'));
CREATE INDEX idx_todos_completed ON pocket_todos(json_extract(data, '$.completed'));
```

## Limitations

### D1 Limitations
- 10GB max database size
- 100,000 rows max per query
- No real-time subscriptions (use polling or Durable Objects)

### Durable Objects Limitations
- 128KB max value size
- 10GB max storage per object
- Single-instance (no horizontal scaling per object)

## Next Steps

- [Sync Setup](/docs/guides/sync-setup) - Sync with edge databases
- [Observability](/docs/guides/observability) - Monitor edge deployments
- [Cloudflare D1 Docs](https://developers.cloudflare.com/d1/)
