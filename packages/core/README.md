# @pocket/core

The core database engine for Pocket - a local-first database for web applications.

## Installation

```bash
npm install @pocket/core
```

## Quick Start

```typescript
import { Database } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';

// Create a database
const db = await Database.create({
  name: 'my-app',
  storage: createMemoryStorage()
});

// Define your document type
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
}

// Get a collection
const todos = db.collection<Todo>('todos');

// CRUD operations
const todo = await todos.insert({ title: 'Learn Pocket', completed: false });
const found = await todos.get(todo._id);
await todos.update(todo._id, { completed: true });
await todos.delete(todo._id);
```

## Features

### Reactive Queries

Subscribe to live query updates:

```typescript
import { useLiveQuery } from '@pocket/react';

function TodoList() {
  const { data: todos } = useLiveQuery<Todo>('todos', {
    filter: { completed: false },
    sort: { field: 'createdAt', direction: 'desc' }
  });

  return todos.map(todo => <TodoItem key={todo._id} todo={todo} />);
}
```

### Query Builder

Fluent API for building queries:

```typescript
const results = await todos
  .find({ completed: false })
  .sort('createdAt', 'desc')
  .limit(10)
  .exec();
```

### Plugin System

Extend functionality with plugins:

```typescript
import { timestampsPlugin, softDeletePlugin } from '@pocket/core';

const db = await Database.create({
  name: 'my-app',
  storage,
  plugins: [timestampsPlugin(), softDeletePlugin()]
});
```

## API Reference

### Database

| Method | Description |
|--------|-------------|
| `Database.create(config)` | Create a new database |
| `db.collection<T>(name)` | Get or create a collection |
| `db.close()` | Close the database |

### Collection

| Method | Description |
|--------|-------------|
| `insert(doc)` | Insert a document |
| `get(id)` | Get document by ID |
| `update(id, changes)` | Partial update |
| `delete(id)` | Delete document |
| `find(filter?)` | Create a query |
| `count(filter?)` | Count documents |

### QueryBuilder

| Method | Description |
|--------|-------------|
| `where(field, operator, value)` | Add filter |
| `sort(field, direction)` | Add sorting |
| `limit(n)` | Limit results |
| `skip(n)` | Skip results |
| `exec()` | Execute query |
| `$` | Observable stream |

## Advanced Features

### TTL & Soft Delete

Automatically expire documents with configurable TTL policies. Supports soft delete with a grace period before permanent removal.

```typescript
import { createTTLManager } from '@pocket/core';

const ttl = createTTLManager();
ttl.register('sessions', sessionsCollection, {
  field: 'expiresAt',
  softDelete: true,
  gracePeriodMs: 24 * 60 * 60 * 1000, // 24h recovery window
});
ttl.start();
```

### Spaces (Logical Partitioning)

Group collections into isolated spaces for multi-tenant or multi-context applications. Supports cross-space queries.

```typescript
import { createSpaceManager } from '@pocket/core';

const spaces = createSpaceManager({ allowCrossSpaceQueries: true });
const space = spaces.createSpace('team-alpha', ownerId);
spaces.registerCollection(space.id, 'tasks');

const results = await spaces.queryAcrossSpaces(
  { collection: 'tasks', filter: { status: 'open' } },
  async (resolvedName, filter) => db.collection(resolvedName).find(filter).exec()
);
```

### Relations & Population

Define relationships between collections and batch-resolve related documents efficiently.

```typescript
import { resolveRelationsBatch } from '@pocket/core';

const populated = await resolveRelationsBatch(orders, ['customer', 'items'], 'orders', context);
```

### Streaming Pipelines

Build reactive data pipelines with tumbling, sliding, and session windows.

```typescript
import { createStreamingPipeline } from '@pocket/core';

const pipeline = createStreamingPipeline<Order>()
  .filter({ status: 'completed' })
  .aggregate('sum', 'amount')
  .window({ type: 'session', durationMs: 60000, gapMs: 5000 })
  .build();
```

### Database Branching

Git-like branching for data with merge strategies (fast-forward, three-way, rebase).

```typescript
const manager = createBranchManager();
manager.branch('experiment', { from: 'main' });
manager.checkout('experiment');
// ... make changes ...
manager.merge('experiment', { strategy: 'rebase' });
```

### Full-Text Search

Built-in BM25 search with Porter stemming, fuzzy matching, and highlighting.

### Schema Evolution

Safe schema migrations with backward/forward compatibility checking and automatic type coercion.

## Documentation

- [Full Documentation](https://pocket.dev/docs)
- [API Reference](https://pocket.dev/docs/api/core)
- [Architecture](../../ARCHITECTURE.md)

## License

MIT
