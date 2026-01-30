---
sidebar_position: 1
title: React Integration
description: Using Pocket with React hooks for reactive data
---

# React Integration

Pocket provides first-class React support with hooks for reactive data fetching and mutations.

## Installation

If you installed `pocket`, React bindings are included:

```bash
npm install pocket
```

Or install just the React package:

```bash
npm install @pocket/core @pocket/react
```

## Setup

### 1. Create Your Database

```typescript
// src/db.ts
import { Database, createIndexedDBStorage } from 'pocket';

export interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

export const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});
```

### 2. Add the Provider

Wrap your app with `PocketProvider`:

```tsx
// src/App.tsx
import { PocketProvider } from 'pocket/react';
import { db } from './db';

function App() {
  return (
    <PocketProvider database={db}>
      <TodoApp />
    </PocketProvider>
  );
}
```

## Hooks

### useLiveQuery

Subscribe to live-updating query results:

```tsx
import { useLiveQuery } from 'pocket/react';
import type { Todo } from './db';

function TodoList() {
  const { data: todos, isLoading, error } = useLiveQuery<Todo>(
    'todos',
    (collection) => collection.find().where('completed').equals(false),
    [], // dependencies
  );

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo._id}>{todo.title}</li>
      ))}
    </ul>
  );
}
```

#### Parameters

```typescript
useLiveQuery<T>(
  collectionName: string,
  queryFn?: (collection: Collection<T>) => QueryBuilder<T>,
  deps?: unknown[],
  options?: UseLiveQueryOptions,
): LiveQueryResult<T>
```

| Parameter | Description |
|-----------|-------------|
| `collectionName` | Name of the collection to query |
| `queryFn` | Function that builds the query (optional) |
| `deps` | Dependency array for query recreation |
| `options` | Additional options |

#### Options

```typescript
interface UseLiveQueryOptions {
  debounceMs?: number;      // Debounce updates (default: 0)
  enabled?: boolean;        // Enable/disable query (default: true)
  useEventReduce?: boolean; // Use EventReduce optimization (default: true)
}
```

#### Return Value

```typescript
interface LiveQueryResult<T> {
  data: T[];           // Query results
  isLoading: boolean;  // True during initial load
  error: Error | null; // Any error that occurred
  refresh: () => void; // Force refresh the query
}
```

### useQuery (Simplified)

A simpler hook when you just need basic filtering:

```tsx
import { useQuery } from 'pocket/react';

function CompletedTodos() {
  const { data: todos } = useQuery<Todo>('todos', { completed: true });

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo._id}>{todo.title}</li>
      ))}
    </ul>
  );
}
```

### useMutation

Execute write operations with loading and error states:

```tsx
import { useMutation } from 'pocket/react';

function AddTodoButton() {
  const { mutate, isLoading, error } = useMutation(
    async (db, title: string) => {
      return db.collection('todos').insert({
        _id: crypto.randomUUID(),
        title,
        completed: false,
        createdAt: new Date(),
      });
    }
  );

  return (
    <button
      onClick={() => mutate('New todo')}
      disabled={isLoading}
    >
      {isLoading ? 'Adding...' : 'Add Todo'}
    </button>
  );
}
```

#### Type-Safe Mutations

```tsx
// Define the mutation function type for better inference
const { mutate: addTodo } = useMutation(
  async (db, params: { title: string; priority: 'low' | 'high' }) => {
    return db.collection<Todo>('todos').insert({
      _id: crypto.randomUUID(),
      title: params.title,
      completed: false,
      createdAt: new Date(),
    });
  }
);

// TypeScript knows the parameter types
addTodo({ title: 'Learn Pocket', priority: 'high' });
```

### useDocument

Fetch and subscribe to a single document:

```tsx
import { useDocument } from 'pocket/react';

function TodoDetail({ id }: { id: string }) {
  const { data: todo, isLoading } = useDocument<Todo>('todos', id);

  if (isLoading) return <div>Loading...</div>;
  if (!todo) return <div>Not found</div>;

  return (
    <div>
      <h2>{todo.title}</h2>
      <p>Status: {todo.completed ? 'Done' : 'Pending'}</p>
    </div>
  );
}
```

### useSyncStatus

Monitor sync status when using the sync engine:

```tsx
import { useSyncStatus } from 'pocket/react';

function SyncIndicator() {
  const { status, stats } = useSyncStatus();

  return (
    <div>
      <span>Status: {status}</span>
      {status === 'syncing' && <span>Syncing...</span>}
      {status === 'error' && <span>Sync error</span>}
      {status === 'offline' && <span>Offline</span>}
      <span>Last sync: {stats.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleString() : 'Never'}</span>
    </div>
  );
}
```

### useCollection

Get direct access to a collection:

```tsx
import { useCollection } from 'pocket/react';

function TodoActions({ id }: { id: string }) {
  const todos = useCollection<Todo>('todos');

  const handleComplete = async () => {
    await todos.update(id, { completed: true });
  };

  const handleDelete = async () => {
    await todos.delete(id);
  };

  return (
    <div>
      <button onClick={handleComplete}>Complete</button>
      <button onClick={handleDelete}>Delete</button>
    </div>
  );
}
```

## Patterns

### Conditional Queries

```tsx
function FilteredTodos({ showCompleted }: { showCompleted: boolean }) {
  const { data: todos } = useLiveQuery<Todo>(
    'todos',
    (c) => showCompleted
      ? c.find()
      : c.find().where('completed').equals(false),
    [showCompleted], // Re-run when filter changes
  );

  return <TodoList todos={todos} />;
}
```

### Search with Debounce

```tsx
function SearchTodos() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const { data: todos } = useLiveQuery<Todo>(
    'todos',
    (c) => debouncedSearch
      ? c.find().where('title').contains(debouncedSearch)
      : c.find(),
    [debouncedSearch],
  );

  return (
    <div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search todos..."
      />
      <TodoList todos={todos} />
    </div>
  );
}
```

### Pagination

```tsx
function PaginatedTodos() {
  const [page, setPage] = useState(0);
  const pageSize = 10;

  const { data: todos } = useLiveQuery<Todo>(
    'todos',
    (c) => c.find()
      .sort('createdAt', 'desc')
      .skip(page * pageSize)
      .limit(pageSize),
    [page],
  );

  return (
    <div>
      <TodoList todos={todos} />
      <button onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</button>
      <button onClick={() => setPage((p) => p + 1)}>Next</button>
    </div>
  );
}
```

### Optimistic Updates

Mutations are already optimistic - the local database updates immediately:

```tsx
function TodoItem({ todo }: { todo: Todo }) {
  const { mutate: toggle } = useMutation(
    async (db, id: string) => {
      const current = await db.collection<Todo>('todos').get(id);
      if (current) {
        await db.collection<Todo>('todos').update(id, {
          completed: !current.completed,
        });
      }
    }
  );

  return (
    <div onClick={() => toggle(todo._id)}>
      {/* UI updates instantly, no loading state needed */}
      <span>{todo.completed ? '✓' : '○'}</span>
      <span>{todo.title}</span>
    </div>
  );
}
```

### Combining Multiple Queries

```tsx
function Dashboard() {
  const { data: incomplete } = useLiveQuery<Todo>(
    'todos',
    (c) => c.find().where('completed').equals(false),
  );

  const { data: completed } = useLiveQuery<Todo>(
    'todos',
    (c) => c.find().where('completed').equals(true),
  );

  return (
    <div>
      <h2>Incomplete ({incomplete.length})</h2>
      <TodoList todos={incomplete} />

      <h2>Completed ({completed.length})</h2>
      <TodoList todos={completed} />
    </div>
  );
}
```

## Performance Tips

### 1. Use Dependencies Correctly

```tsx
// Bad: Query recreated every render
useLiveQuery('todos', (c) => c.find().where('userId').equals(userId));

// Good: Query only recreated when userId changes
useLiveQuery('todos', (c) => c.find().where('userId').equals(userId), [userId]);
```

### 2. Disable Unused Queries

```tsx
function ConditionalQuery({ shouldFetch }: { shouldFetch: boolean }) {
  const { data } = useLiveQuery(
    'todos',
    (c) => c.find(),
    [],
    { enabled: shouldFetch }, // Query only runs when true
  );
}
```

### 3. Use Debouncing for Rapid Updates

```tsx
// Debounce live updates to avoid excessive re-renders
const { data } = useLiveQuery(
  'todos',
  (c) => c.find(),
  [],
  { debounceMs: 100 },
);
```

### 4. Query Only What You Need

```tsx
// Bad: Fetching all todos when we only need 5
useLiveQuery('todos', (c) => c.find());

// Good: Limit the query
useLiveQuery('todos', (c) => c.find().limit(5));
```

## TypeScript

### Typed Collections

```tsx
// Define your types
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
}

// Type is inferred from the generic
const { data: todos } = useLiveQuery<Todo>('todos');
// todos is typed as Todo[]
```

### Typed Mutations

```tsx
const { mutate } = useMutation(
  async (db, params: { title: string }) => {
    return db.collection<Todo>('todos').insert({
      _id: crypto.randomUUID(),
      title: params.title,
      completed: false,
    });
  }
);

// TypeScript enforces parameter types
mutate({ title: 'Test' }); // OK
mutate({ name: 'Test' }); // Error: 'name' doesn't exist
```

## Try It Online

Experiment with Pocket React hooks in interactive sandboxes:

| Example | Description |
|---------|-------------|
| [Basic Hooks](https://stackblitz.com/edit/pocket-react-hooks?file=src%2FApp.tsx) | useLiveQuery, useMutation basics |
| [Todo App](https://stackblitz.com/edit/pocket-todo-app?file=src%2FApp.tsx) | Complete todo application |
| [Search & Filter](https://stackblitz.com/edit/pocket-search-filter?file=src%2FApp.tsx) | Debounced search with filtering |
| [Pagination](https://stackblitz.com/edit/pocket-pagination?file=src%2FApp.tsx) | Cursor and offset pagination |
| [Sync Status](https://stackblitz.com/edit/pocket-sync-status?file=src%2FApp.tsx) | Monitoring sync with useSyncStatus |

:::tip
Open these in a new tab to edit and experiment with the code.
:::

## Next Steps

- [Offline-First App Guide](/docs/guides/offline-first-app) - Build a complete offline app
- [Sync Setup](/docs/guides/sync-setup) - Add synchronization
- [React Hooks API](/docs/api/react-hooks) - Complete API reference
