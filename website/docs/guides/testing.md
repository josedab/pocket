---
sidebar_position: 19
title: Testing
description: Testing patterns for Pocket-based applications
---

# Testing

This guide covers testing strategies for applications using Pocket.

## Test Setup

### In-Memory Storage

Use `createMemoryStorage` for fast, isolated tests:

```typescript
import { Database, createMemoryStorage } from '@pocket/core';

describe('TodoService', () => {
  let db: Database;

  beforeEach(async () => {
    db = await Database.create({
      name: 'test-db',
      storage: createMemoryStorage(),
    });
  });

  afterEach(async () => {
    await db.close();
  });

  test('creates a todo', async () => {
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

### Test Utilities

Create a test helper:

```typescript
// test/helpers.ts
import { Database, createMemoryStorage } from '@pocket/core';

export async function createTestDatabase(name = 'test') {
  return Database.create({
    name: `${name}-${Date.now()}`,
    storage: createMemoryStorage(),
  });
}

export async function withTestDatabase<T>(
  fn: (db: Database) => Promise<T>
): Promise<T> {
  const db = await createTestDatabase();
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}
```

Usage:

```typescript
import { withTestDatabase } from './helpers';

test('queries todos', async () => {
  await withTestDatabase(async (db) => {
    const todos = db.collection('todos');
    await todos.insert({ _id: '1', title: 'A', completed: false });
    await todos.insert({ _id: '2', title: 'B', completed: true });

    const active = await todos.find({ completed: false }).exec();
    expect(active).toHaveLength(1);
  });
});
```

## Testing Queries

### Basic Query Tests

```typescript
describe('Query operations', () => {
  let db: Database;
  let todos: Collection<Todo>;

  beforeEach(async () => {
    db = await createTestDatabase();
    todos = db.collection('todos');

    // Seed test data
    await todos.insertMany([
      { _id: '1', title: 'Task A', priority: 1, completed: false },
      { _id: '2', title: 'Task B', priority: 2, completed: true },
      { _id: '3', title: 'Task C', priority: 1, completed: false },
    ]);
  });

  test('filters by equality', async () => {
    const results = await todos
      .find()
      .where('completed').equals(false)
      .exec();

    expect(results).toHaveLength(2);
    expect(results.every(t => !t.completed)).toBe(true);
  });

  test('sorts results', async () => {
    const results = await todos
      .find()
      .sort('priority', 'asc')
      .exec();

    expect(results[0].priority).toBe(1);
    expect(results[2].priority).toBe(2);
  });

  test('paginates results', async () => {
    const page1 = await todos.find().limit(2).exec();
    const page2 = await todos.find().skip(2).limit(2).exec();

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
  });
});
```

### Testing Complex Queries

```typescript
test('combines multiple conditions', async () => {
  const results = await todos
    .find()
    .where('completed').equals(false)
    .where('priority').lte(2)
    .sort('priority', 'asc')
    .limit(10)
    .exec();

  expect(results.length).toBeGreaterThan(0);
  expect(results.every(t => !t.completed && t.priority <= 2)).toBe(true);
});
```

## Testing React Hooks

### Setup with Testing Library

```typescript
// test/wrapper.tsx
import { render, renderHook } from '@testing-library/react';
import { PocketProvider } from '@pocket/react';
import { Database, createMemoryStorage } from '@pocket/core';

export function createTestWrapper() {
  let db: Database | null = null;

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <PocketProvider database={db!}>
      {children}
    </PocketProvider>
  );

  return {
    async setup() {
      db = await Database.create({
        name: 'test',
        storage: createMemoryStorage(),
      });
      return db;
    },
    async teardown() {
      await db?.close();
    },
    Wrapper,
    renderHook: <T,>(hook: () => T) => renderHook(hook, { wrapper: Wrapper }),
    render: (ui: React.ReactElement) => render(ui, { wrapper: Wrapper }),
  };
}
```

### Testing useLiveQuery

```typescript
import { waitFor } from '@testing-library/react';
import { useLiveQuery } from '@pocket/react';
import { createTestWrapper } from './wrapper';

describe('useLiveQuery', () => {
  const { setup, teardown, renderHook } = createTestWrapper();
  let db: Database;

  beforeEach(async () => {
    db = await setup();
  });

  afterEach(async () => {
    await teardown();
  });

  test('returns query results', async () => {
    const todos = db.collection('todos');
    await todos.insert({ _id: '1', title: 'Test', completed: false });

    const { result } = renderHook(() =>
      useLiveQuery<Todo>('todos')
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].title).toBe('Test');
  });

  test('updates when data changes', async () => {
    const todos = db.collection('todos');

    const { result } = renderHook(() =>
      useLiveQuery<Todo>('todos')
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Insert new data
    await todos.insert({ _id: '1', title: 'New', completed: false });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1);
    });
  });
});
```

### Testing useMutation

```typescript
import { act } from '@testing-library/react';
import { useMutation } from '@pocket/react';

test('mutation inserts document', async () => {
  const { result } = renderHook(() =>
    useMutation(async (db, title: string) =>
      db.collection('todos').insert({
        _id: crypto.randomUUID(),
        title,
        completed: false,
      })
    )
  );

  await act(async () => {
    await result.current.mutate('New Todo');
  });

  const todos = await db.collection('todos').getAll();
  expect(todos).toHaveLength(1);
  expect(todos[0].title).toBe('New Todo');
});
```

## Testing Components

```tsx
import { screen, fireEvent, waitFor } from '@testing-library/react';
import TodoList from './TodoList';

test('displays todos', async () => {
  const db = await setup();
  await db.collection('todos').insertMany([
    { _id: '1', title: 'Task 1', completed: false },
    { _id: '2', title: 'Task 2', completed: true },
  ]);

  render(<TodoList />);

  await waitFor(() => {
    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.getByText('Task 2')).toBeInTheDocument();
  });
});

test('creates a new todo', async () => {
  render(<TodoList />);

  const input = screen.getByPlaceholderText('New todo');
  const button = screen.getByText('Add');

  fireEvent.change(input, { target: { value: 'New Task' } });
  fireEvent.click(button);

  await waitFor(() => {
    expect(screen.getByText('New Task')).toBeInTheDocument();
  });
});

test('toggles todo completion', async () => {
  const db = await setup();
  await db.collection('todos').insert({
    _id: '1',
    title: 'Task',
    completed: false,
  });

  render(<TodoList />);

  await waitFor(() => {
    expect(screen.getByText('Task')).toBeInTheDocument();
  });

  const checkbox = screen.getByRole('checkbox');
  fireEvent.click(checkbox);

  await waitFor(() => {
    expect(checkbox).toBeChecked();
  });

  // Verify in database
  const todo = await db.collection('todos').get('1');
  expect(todo?.completed).toBe(true);
});
```

## Testing with Fixtures

### Fixture Files

```typescript
// test/fixtures/todos.ts
export const todoFixtures = [
  { _id: 'todo-1', title: 'Buy groceries', completed: false, priority: 1 },
  { _id: 'todo-2', title: 'Write tests', completed: true, priority: 2 },
  { _id: 'todo-3', title: 'Deploy app', completed: false, priority: 3 },
];

// test/fixtures/users.ts
export const userFixtures = [
  { _id: 'user-1', name: 'Alice', email: 'alice@example.com' },
  { _id: 'user-2', name: 'Bob', email: 'bob@example.com' },
];
```

### Loading Fixtures

```typescript
import { todoFixtures } from './fixtures/todos';
import { userFixtures } from './fixtures/users';

async function loadFixtures(db: Database) {
  await db.collection('todos').insertMany(todoFixtures);
  await db.collection('users').insertMany(userFixtures);
}

beforeEach(async () => {
  db = await createTestDatabase();
  await loadFixtures(db);
});
```

### Using the Seeder

```typescript
import { createSeeder, defineSeed } from '@pocket/core';

const testSeed = defineSeed({
  environments: ['test'],
  randomSeed: 42, // Reproducible
  collections: {
    todos: {
      factory: (i, ctx) => ({
        _id: ctx.randomId(),
        title: `Todo ${i}`,
        completed: ctx.random() > 0.5,
      }),
      count: 100,
    },
  },
});

beforeEach(async () => {
  db = await createTestDatabase();
  const seeder = createSeeder(testSeed);
  await seeder.seed({ todos: db.collection('todos') }, 'test');
});
```

## Mocking

### Mocking the Database

```typescript
// For unit tests that don't need a real database
const mockCollection = {
  find: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([
      { _id: '1', title: 'Mock Todo' },
    ]),
  }),
  insert: jest.fn().mockResolvedValue({ _id: '1', title: 'New' }),
  update: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
};

const mockDatabase = {
  collection: jest.fn().mockReturnValue(mockCollection),
};

jest.mock('@pocket/core', () => ({
  ...jest.requireActual('@pocket/core'),
  useDatabase: () => mockDatabase,
}));
```

### Mocking Sync

```typescript
const mockSync = {
  getStatus: jest.fn().mockReturnValue({
    subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
  }),
  forceSync: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@pocket/sync', () => ({
  createSyncEngine: () => mockSync,
}));
```

## Integration Tests

### Testing Sync

```typescript
import { createSyncEngine } from '@pocket/sync';
import { createMemoryTransport } from '@pocket/sync/testing';

test('syncs data between clients', async () => {
  const transport = createMemoryTransport();

  // Client 1
  const db1 = await createTestDatabase('client1');
  const sync1 = createSyncEngine(db1, { transport });

  // Client 2
  const db2 = await createTestDatabase('client2');
  const sync2 = createSyncEngine(db2, { transport });

  // Client 1 creates a todo
  await db1.collection('todos').insert({
    _id: '1',
    title: 'Shared Todo',
  });

  // Wait for sync
  await sync1.forceSync();
  await sync2.forceSync();

  // Verify on client 2
  const todo = await db2.collection('todos').get('1');
  expect(todo?.title).toBe('Shared Todo');

  // Cleanup
  sync1.destroy();
  sync2.destroy();
});
```

### Testing Migrations

```typescript
import { MigrationManager } from '@pocket/core';

test('runs migrations', async () => {
  const db = await createTestDatabase();

  const migrations = [
    {
      version: 1,
      name: 'create-users',
      up: async (ctx) => {
        await ctx.createCollection('users', {
          schema: { type: 'object' },
        });
      },
      down: async (ctx) => {
        await ctx.dropCollection('users');
      },
    },
  ];

  const manager = new MigrationManager(db, migrations);

  await manager.up();
  expect(db.hasCollection('users')).toBe(true);

  await manager.down();
  expect(db.hasCollection('users')).toBe(false);
});
```

## Best Practices

### 1. Isolate Tests

Each test should have its own database instance:

```typescript
beforeEach(async () => {
  db = await Database.create({
    name: `test-${Date.now()}-${Math.random()}`,
    storage: createMemoryStorage(),
  });
});
```

### 2. Clean Up Resources

Always close databases after tests:

```typescript
afterEach(async () => {
  await db?.close();
});

afterAll(async () => {
  // Clean up any remaining resources
});
```

### 3. Use Realistic Data

Test with data that resembles production:

```typescript
const realisticTodo = {
  _id: crypto.randomUUID(),
  title: 'Review pull request #123',
  description: 'Check for security issues and code style',
  completed: false,
  priority: 2,
  tags: ['code-review', 'urgent'],
  createdAt: new Date(),
  updatedAt: new Date(),
};
```

### 4. Test Error Cases

```typescript
test('handles missing document', async () => {
  const todo = await todos.get('non-existent');
  expect(todo).toBeNull();
});

test('rejects invalid data', async () => {
  await expect(
    todos.insert({ title: 123 }) // Invalid type
  ).rejects.toThrow();
});
```

### 5. Test Edge Cases

```typescript
test('handles empty collection', async () => {
  const results = await todos.find().exec();
  expect(results).toEqual([]);
});

test('handles special characters', async () => {
  await todos.insert({
    _id: '1',
    title: 'Test with "quotes" and \'apostrophes\'',
  });

  const todo = await todos.get('1');
  expect(todo?.title).toContain('"quotes"');
});
```

## Next Steps

- [Data Seeding](/docs/guides/data-seeding) - Generate test data
- [Schema Validation](/docs/guides/schema-validation) - Validate test data
- [Performance](/docs/guides/performance) - Performance testing
