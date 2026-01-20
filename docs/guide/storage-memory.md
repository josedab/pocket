# Memory Storage

The memory adapter stores data in JavaScript memory. It's perfect for testing, prototyping, or temporary data that doesn't need persistence.

## Installation

```bash
npm install @pocket/storage-memory
```

## Basic Usage

```typescript
import { Database } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';

const db = await Database.create({
  name: 'my-app',
  storage: createMemoryStorage(),
});
```

## When to Use Memory Storage

### Testing

Perfect for unit and integration tests:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';

describe('TodoService', () => {
  let db: Database;

  beforeEach(async () => {
    // Fresh database for each test
    db = await Database.create({
      name: 'test-db',
      storage: createMemoryStorage(),
    });
  });

  it('should create a todo', async () => {
    const todos = db.collection('todos');
    const todo = await todos.insert({
      _id: '1',
      title: 'Test',
      completed: false,
    });

    expect(todo.title).toBe('Test');
  });
});
```

### Prototyping

Quick setup without browser APIs:

```typescript
// Works in Node.js without polyfills
const db = await Database.create({
  name: 'prototype',
  storage: createMemoryStorage(),
});
```

### Temporary Data

For session-only data:

```typescript
// Shopping cart that clears on page refresh
const cartDb = await Database.create({
  name: 'cart',
  storage: createMemoryStorage(),
});
```

### Fallback Storage

When other adapters aren't available:

```typescript
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';
import { createMemoryStorage } from '@pocket/storage-memory';

const idbStorage = createIndexedDBStorage();
const storage = idbStorage.isAvailable()
  ? idbStorage
  : createMemoryStorage();
```

## Performance

Memory storage is the fastest adapter since it operates entirely in RAM:

| Operation | Memory | IndexedDB | OPFS |
|-----------|--------|-----------|------|
| Insert | 0.01ms | 2ms | 1ms |
| Get by ID | 0.001ms | 2ms | 1ms |
| Query 1000 docs | 1ms | 50ms | 30ms |

## Limitations

1. **No Persistence** - Data lost on page refresh/process exit
2. **Memory Bound** - Limited by available RAM
3. **Single Process** - No sharing between tabs/workers
4. **No Transactions** - Simulated only

## How It Works

Data is stored in JavaScript `Map` objects:

```typescript
// Internal structure (simplified)
class MemoryStore {
  private documents = new Map<string, Document>();
  private indexes = new Map<string, Index>();
}
```

## Configuration Options

```typescript
interface MemoryAdapterOptions {
  /** Pre-populate with initial data */
  initialData?: Record<string, Document[]>;
}
```

### Pre-populated Data

```typescript
const storage = createMemoryStorage({
  initialData: {
    todos: [
      { _id: '1', title: 'First', completed: false },
      { _id: '2', title: 'Second', completed: true },
    ],
    users: [
      { _id: 'u1', name: 'Alice' },
    ],
  },
});
```

## Testing Patterns

### Isolated Tests

```typescript
describe('Collection', () => {
  let db: Database;
  let todos: Collection<Todo>;

  beforeEach(async () => {
    db = await Database.create({
      name: 'test',
      storage: createMemoryStorage(),
    });
    todos = db.collection('todos');
  });

  afterEach(async () => {
    await db.close();
  });

  it('inserts documents', async () => {
    await todos.insert({ _id: '1', title: 'Test', completed: false });
    const doc = await todos.get('1');
    expect(doc?.title).toBe('Test');
  });
});
```

### Shared State Tests

```typescript
describe('Multi-collection operations', () => {
  let db: Database;

  beforeAll(async () => {
    db = await Database.create({
      name: 'shared-test',
      storage: createMemoryStorage(),
    });

    // Seed data
    const todos = db.collection('todos');
    await todos.insertMany([
      { _id: '1', title: 'Task 1', completed: false },
      { _id: '2', title: 'Task 2', completed: true },
    ]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('queries work', async () => {
    const todos = db.collection('todos');
    const incomplete = await todos.find({ completed: false }).exec();
    expect(incomplete).toHaveLength(1);
  });
});
```

### Mock Data Generators

```typescript
function createTestTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    _id: crypto.randomUUID(),
    title: 'Test Todo',
    completed: false,
    createdAt: new Date(),
    ...overrides,
  };
}

it('handles many documents', async () => {
  const todos = db.collection('todos');

  const manyTodos = Array.from({ length: 1000 }, () => createTestTodo());
  await todos.insertMany(manyTodos);

  const count = await todos.count();
  expect(count).toBe(1000);
});
```

## Node.js Usage

Memory storage works great in Node.js:

```typescript
// server.ts
import { Database } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';

async function main() {
  const db = await Database.create({
    name: 'server-cache',
    storage: createMemoryStorage(),
  });

  // Use as application cache
  const cache = db.collection('cache');
  await cache.insert({
    _id: 'user-sessions',
    data: [],
    updatedAt: Date.now(),
  });
}
```

## Hybrid Approach

Use memory for caching with persistent backup:

```typescript
class HybridDatabase {
  private memoryDb: Database;
  private persistentDb: Database;

  async get(id: string) {
    // Try memory first
    let doc = await this.memoryDb.collection('todos').get(id);

    if (!doc) {
      // Fallback to persistent
      doc = await this.persistentDb.collection('todos').get(id);

      if (doc) {
        // Cache in memory
        await this.memoryDb.collection('todos').insert(doc);
      }
    }

    return doc;
  }
}
```

## Next Steps

- [Storage Overview](./storage.md) - Compare all adapters
- [IndexedDB Adapter](./storage-indexeddb.md) - Persistent storage
- [Testing Guide](../api/) - API testing patterns
