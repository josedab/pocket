---
sidebar_position: 4
title: SolidJS Integration
description: Using Pocket with SolidJS primitives for reactive data
---

# SolidJS Integration

Pocket provides first-class SolidJS support with primitives that integrate seamlessly with Solid's fine-grained reactivity system.

## Installation

```bash
npm install @pocket/solid @pocket/core
```

## Setup

### 1. Create Your Database

```typescript
// src/db.ts
import { Database, createIndexedDBStorage } from '@pocket/core';

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
import { PocketProvider } from '@pocket/solid';
import { db } from './db';
import TodoList from './TodoList';

function App() {
  return (
    <PocketProvider database={db}>
      <TodoList />
    </PocketProvider>
  );
}

export default App;
```

## Primitives

### createLiveQuery

Create a live-updating query with automatic subscriptions:

```tsx
import { createLiveQuery } from '@pocket/solid';
import { Show, For } from 'solid-js';
import type { Todo } from './db';

function TodoList() {
  const { data: todos, isLoading, error } = createLiveQuery<Todo>(
    'todos',
    (collection) => collection.find().where('completed').equals(false)
  );

  return (
    <Show when={!isLoading()} fallback={<p>Loading...</p>}>
      <Show when={!error()} fallback={<p>Error: {error()?.message}</p>}>
        <ul>
          <For each={todos()}>
            {(todo) => <li>{todo.title}</li>}
          </For>
        </ul>
      </Show>
    </Show>
  );
}
```

#### Parameters

```typescript
createLiveQuery<T>(
  collectionName: string,
  queryFn?: (collection: Collection<T>) => QueryBuilder<T>,
  options?: CreateLiveQueryOptions
): LiveQueryResult<T>
```

| Parameter | Description |
|-----------|-------------|
| `collectionName` | Name of the collection to query |
| `queryFn` | Function that builds the query (optional) |
| `options` | Additional options |

#### Options

```typescript
interface CreateLiveQueryOptions {
  enabled?: boolean;        // Enable/disable query (default: true)
  debounceMs?: number;      // Debounce updates (default: 0)
}
```

#### Return Value

```typescript
interface LiveQueryResult<T> {
  data: Accessor<T[]>;           // Reactive query results (call to get value)
  isLoading: Accessor<boolean>;  // True during initial load
  error: Accessor<Error | null>; // Any error that occurred
  refresh: () => void;           // Force refresh the query
}
```

:::tip
In SolidJS, reactive values are accessed by calling them as functions: `todos()`, `isLoading()`, etc.
:::

### createQuery

For non-live queries with simple filtering:

```tsx
import { createQuery } from '@pocket/solid';

function CompletedTodos() {
  const { data: todos } = createQuery<Todo>('todos', { completed: true });

  return (
    <ul>
      <For each={todos()}>
        {(todo) => <li>{todo.title}</li>}
      </For>
    </ul>
  );
}
```

### createMutation

Create mutations for write operations:

```tsx
import { createMutation } from '@pocket/solid';
import type { Todo } from './db';

function AddTodoButton() {
  const { insert, update, remove, isLoading, error } = createMutation<Todo>('todos');

  async function addTodo(title: string) {
    await insert({
      _id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: new Date(),
    });
  }

  return (
    <button onClick={() => addTodo('New todo')} disabled={isLoading()}>
      {isLoading() ? 'Adding...' : 'Add Todo'}
    </button>
  );
}
```

### createDocument

Create a reactive reference to a single document:

```tsx
import { createDocument } from '@pocket/solid';
import { Show } from 'solid-js';
import type { Todo } from './db';

function TodoDetail(props: { id: string }) {
  const { data: todo, isLoading } = createDocument<Todo>('todos', () => props.id);

  return (
    <Show when={!isLoading()} fallback={<p>Loading...</p>}>
      <Show when={todo()} fallback={<p>Not found</p>}>
        {(todo) => (
          <div>
            <h2>{todo().title}</h2>
            <p>Status: {todo().completed ? 'Done' : 'Pending'}</p>
          </div>
        )}
      </Show>
    </Show>
  );
}
```

### createFindOne

Find the first document matching a query:

```tsx
import { createFindOne } from '@pocket/solid';

function ActiveUser() {
  const { data: user } = createFindOne<User>(
    'users',
    (c) => c.find().where('status').equals('active')
  );

  return (
    <Show when={user()}>
      {(user) => <p>Welcome, {user().name}!</p>}
    </Show>
  );
}
```

### createSyncStatus

Monitor sync status when using the sync engine:

```tsx
import { createSyncStatus } from '@pocket/solid';

function SyncIndicator() {
  const { status, stats, isOnline, isSyncing } = createSyncStatus();

  return (
    <div class="sync-indicator">
      <Show when={isSyncing()} fallback={
        <Show when={isOnline()} fallback={<span>Offline</span>}>
          <span>Synced</span>
        </Show>
      }>
        <span>Syncing...</span>
      </Show>
      <small>Last sync: {stats().lastSyncAt}</small>
    </div>
  );
}
```

### createOnlineStatus

Track browser online/offline status:

```tsx
import { createOnlineStatus } from '@pocket/solid';

function OnlineIndicator() {
  const isOnline = createOnlineStatus();

  return (
    <span classList={{ online: isOnline(), offline: !isOnline() }}>
      {isOnline() ? 'Online' : 'Offline'}
    </span>
  );
}
```

### useDatabase / useCollection

Get direct access to database or collection:

```tsx
import { useDatabase, useCollection } from '@pocket/solid';

function ExportButton() {
  const db = useDatabase();
  const todos = useCollection<Todo>('todos');

  async function exportData() {
    const allTodos = await todos()?.getAll();
    console.log(allTodos);
  }

  return <button onClick={exportData}>Export</button>;
}
```

## Patterns

### Reactive Query Parameters

Use signals for reactive query parameters:

```tsx
import { createSignal } from 'solid-js';
import { createLiveQuery } from '@pocket/solid';

function FilteredTodos() {
  const [showCompleted, setShowCompleted] = createSignal(false);
  const [searchTerm, setSearchTerm] = createSignal('');

  const { data: todos } = createLiveQuery<Todo>(
    'todos',
    (c) => {
      let query = c.find();

      if (!showCompleted()) {
        query = query.where('completed').equals(false);
      }

      if (searchTerm()) {
        query = query.where('title').contains(searchTerm());
      }

      return query;
    }
  );

  return (
    <div>
      <input
        value={searchTerm()}
        onInput={(e) => setSearchTerm(e.currentTarget.value)}
        placeholder="Search..."
      />
      <label>
        <input
          type="checkbox"
          checked={showCompleted()}
          onChange={(e) => setShowCompleted(e.currentTarget.checked)}
        />
        Show completed
      </label>

      <For each={todos()}>
        {(todo) => <TodoItem todo={todo} />}
      </For>
    </div>
  );
}
```

### Pagination

```tsx
import { createSignal } from 'solid-js';
import { createLiveQuery } from '@pocket/solid';

function PaginatedTodos() {
  const [page, setPage] = createSignal(0);
  const pageSize = 10;

  const { data: todos } = createLiveQuery<Todo>(
    'todos',
    (c) => c.find()
      .sort('createdAt', 'desc')
      .skip(page() * pageSize)
      .limit(pageSize)
  );

  return (
    <div>
      <For each={todos()}>
        {(todo) => <TodoItem todo={todo} />}
      </For>

      <div class="pagination">
        <button onClick={() => setPage(p => p - 1)} disabled={page() === 0}>
          Previous
        </button>
        <span>Page {page() + 1}</span>
        <button onClick={() => setPage(p => p + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
```

### Optimistic Updates

Mutations are already optimistic - the local database updates immediately:

```tsx
import { createLiveQuery, createMutation } from '@pocket/solid';

function TodoList() {
  const { data: todos } = createLiveQuery<Todo>('todos');
  const { update } = createMutation<Todo>('todos');

  function toggleTodo(todo: Todo) {
    // UI updates instantly, no loading state needed
    update(todo._id, { completed: !todo.completed });
  }

  return (
    <For each={todos()}>
      {(todo) => (
        <div class="todo-item" onClick={() => toggleTodo(todo)}>
          <span>{todo.completed ? '✓' : '○'}</span>
          <span>{todo.title}</span>
        </div>
      )}
    </For>
  );
}
```

### Derived Values

Use `createMemo` to derive values from query results:

```tsx
import { createMemo } from 'solid-js';
import { createLiveQuery } from '@pocket/solid';

function TodoStats() {
  const { data: todos } = createLiveQuery<Todo>('todos');

  const stats = createMemo(() => ({
    total: todos().length,
    completed: todos().filter(t => t.completed).length,
    pending: todos().filter(t => !t.completed).length,
  }));

  return (
    <div class="stats">
      <span>Total: {stats().total}</span>
      <span>Completed: {stats().completed}</span>
      <span>Pending: {stats().pending}</span>
    </div>
  );
}
```

## TypeScript

All primitives are fully typed:

```typescript
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
}

// todos() returns Todo[]
const { data: todos } = createLiveQuery<Todo>('todos');

// TypeScript enforces the document shape
const { insert } = createMutation<Todo>('todos');
insert({ title: 'Test', completed: false }); // OK
insert({ name: 'Test' }); // Error: 'name' doesn't exist
```

## Complete Example

```tsx
// TodoApp.tsx
import { createSignal, Show, For } from 'solid-js';
import { createLiveQuery, createMutation } from '@pocket/solid';

interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

function TodoApp() {
  const [newTodoTitle, setNewTodoTitle] = createSignal('');

  const { data: todos, isLoading } = createLiveQuery<Todo>(
    'todos',
    (c) => c.find().sort('createdAt', 'desc')
  );

  const { insert, update, remove } = createMutation<Todo>('todos');

  async function addTodo(e: Event) {
    e.preventDefault();
    if (!newTodoTitle().trim()) return;

    await insert({
      _id: crypto.randomUUID(),
      title: newTodoTitle(),
      completed: false,
      createdAt: new Date(),
    });

    setNewTodoTitle('');
  }

  return (
    <div class="todo-app">
      <h1>Todos</h1>

      <form onSubmit={addTodo}>
        <input
          value={newTodoTitle()}
          onInput={(e) => setNewTodoTitle(e.currentTarget.value)}
          placeholder="What needs to be done?"
        />
        <button type="submit">Add</button>
      </form>

      <Show when={!isLoading()} fallback={<p>Loading...</p>}>
        <ul>
          <For each={todos()}>
            {(todo) => (
              <li>
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => update(todo._id, { completed: !todo.completed })}
                />
                <span classList={{ completed: todo.completed }}>
                  {todo.title}
                </span>
                <button onClick={() => remove(todo._id)}>Delete</button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

export default TodoApp;
```

## Solid Start

For Solid Start, initialize the database client-side:

```tsx
// src/routes/index.tsx
import { createResource, Show } from 'solid-js';
import { PocketProvider } from '@pocket/solid';
import { isServer } from 'solid-js/web';
import TodoApp from '~/components/TodoApp';

async function initDatabase() {
  if (isServer) return null;

  const { Database, createIndexedDBStorage } = await import('@pocket/core');
  return Database.create({
    name: 'my-app',
    storage: createIndexedDBStorage(),
  });
}

export default function Home() {
  const [db] = createResource(initDatabase);

  return (
    <Show when={db()} fallback={<p>Loading...</p>}>
      {(database) => (
        <PocketProvider database={database()}>
          <TodoApp />
        </PocketProvider>
      )}
    </Show>
  );
}
```

## Next Steps

- [Sync Setup](/docs/guides/sync-setup) - Add server synchronization
- [Schema Validation](/docs/guides/schema-validation) - Validate your data
- [Offline-First App](/docs/guides/offline-first-app) - Build a complete offline app
