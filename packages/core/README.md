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

## Documentation

- [Full Documentation](https://pocket.dev/docs)
- [API Reference](https://pocket.dev/docs/api/core)
- [Architecture](../../ARCHITECTURE.md)

## License

MIT
