# @pocket/storage-memory

In-memory storage adapter for Pocket - perfect for testing and development.

## Installation

```bash
npm install @pocket/storage-memory
```

## Quick Start

```typescript
import { Database } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';

const db = await Database.create({
  name: 'test-db',
  storage: createMemoryStorage()
});

// Fast, instant operations
const todos = db.collection<Todo>('todos');
await todos.insert({ title: 'Test todo' });
```

## Features

- **Instant Operations**: No I/O latency
- **No Dependencies**: Pure JavaScript
- **Perfect for Testing**: Easy setup/teardown
- **Full API Support**: Implements complete StorageAdapter interface

## Testing Example

```typescript
import { describe, it, beforeEach, expect } from 'vitest';
import { Database } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';

describe('TodoService', () => {
  let db: Database;
  let storage: MemoryStorageAdapter;

  beforeEach(async () => {
    storage = createMemoryStorage();
    db = await Database.create({ name: 'test', storage });
  });

  it('should create todo', async () => {
    const todos = db.collection<Todo>('todos');
    const todo = await todos.insert({ title: 'Test' });
    expect(todo._id).toBeDefined();
  });

  it('should query todos', async () => {
    const todos = db.collection<Todo>('todos');
    await todos.insert({ title: 'One', completed: false });
    await todos.insert({ title: 'Two', completed: true });

    const incomplete = await todos.find({ completed: false }).exec();
    expect(incomplete).toHaveLength(1);
  });
});
```

## React Testing

```tsx
import { render, screen } from '@testing-library/react';
import { PocketProvider } from '@pocket/react';
import { createMemoryStorage } from '@pocket/storage-memory';

function renderWithPocket(ui: React.ReactElement) {
  const db = await Database.create({
    name: 'test',
    storage: createMemoryStorage()
  });

  return render(
    <PocketProvider database={db}>
      {ui}
    </PocketProvider>
  );
}

test('displays todos', async () => {
  await renderWithPocket(<TodoList />);
  // Your assertions
});
```

## When to Use

**Use Memory Storage when:**
- Writing unit tests
- Writing integration tests
- Quick prototyping
- Development without persistence

**Don't use when:**
- Need data persistence
- Production applications
- Large datasets (limited by RAM)

## API Reference

### createMemoryStorage()

Creates an in-memory storage adapter.

**Returns:** `MemoryStorageAdapter`

### MemoryStorageAdapter

| Method | Description |
|--------|-------------|
| `getStore(name)` | Get document store |
| `hasStore(name)` | Check if store exists |
| `listStores()` | List all stores |
| `deleteStore(name)` | Delete a store |
| `clear()` | Clear all data |
| `getStats()` | Get storage statistics |

## Documentation

- [Testing Guide](https://pocket.dev/docs/testing)
- [Storage Reference](https://pocket.dev/docs/storage/memory)

## License

MIT
