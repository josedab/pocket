---
sidebar_position: 1
title: Getting Started
description: Get up and running with Pocket in under 5 minutes
---

# Getting Started

Pocket is a local-first database for web applications. Your data lives on the client, works offline by default, and syncs when connected.

## Installation

```bash
npm install pocket
```

Or with other package managers:

```bash
pnpm add pocket
yarn add pocket
```

## Quick Start

### 1. Create a Database

```typescript
import { Database, createIndexedDBStorage } from 'pocket';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});
```

### 2. Define Your Data

```typescript
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

const todos = db.collection<Todo>('todos');
```

### 3. Insert Documents

```typescript
await todos.insert({
  _id: crypto.randomUUID(),
  title: 'Learn Pocket',
  completed: false,
  createdAt: new Date(),
});
```

### 4. Query Data

```typescript
// Find all incomplete todos
const incomplete = await todos
  .find()
  .where('completed').equals(false)
  .sort('createdAt', 'desc')
  .exec();
```

### 5. Subscribe to Changes

```typescript
// Live query - automatically updates when data changes
const subscription = todos
  .find()
  .where('completed').equals(false)
  .live()
  .subscribe((results) => {
    console.log('Todos updated:', results);
  });

// Later: clean up
subscription.unsubscribe();
```

## Complete Example

Here's a working todo list in about 30 lines:

```typescript
import { Database, createIndexedDBStorage } from 'pocket';

interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

async function main() {
  // Create database
  const db = await Database.create({
    name: 'todo-app',
    storage: createIndexedDBStorage(),
  });

  const todos = db.collection<Todo>('todos');

  // Add a todo
  const todo = await todos.insert({
    _id: crypto.randomUUID(),
    title: 'Build something awesome',
    completed: false,
    createdAt: new Date(),
  });

  console.log('Created:', todo);

  // Query todos
  const allTodos = await todos.find().exec();
  console.log('All todos:', allTodos);

  // Update a todo
  await todos.update(todo._id, { completed: true });

  // Subscribe to changes
  todos
    .find()
    .live()
    .subscribe((results) => {
      console.log('Live update:', results);
    });
}

main();
```

## Using with React

Pocket has first-class React support:

```tsx
import { PocketProvider, useLiveQuery, useMutation } from 'pocket/react';

function App() {
  return (
    <PocketProvider database={db}>
      <TodoList />
    </PocketProvider>
  );
}

function TodoList() {
  const { data: todos, isLoading } = useLiveQuery('todos');

  const { mutate: addTodo } = useMutation((db, title: string) =>
    db.collection('todos').insert({
      _id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: new Date(),
    })
  );

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <button onClick={() => addTodo('New todo')}>Add</button>
      <ul>
        {todos?.map((todo) => (
          <li key={todo._id}>{todo.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

## Next Steps

- **[Core Concepts](/docs/concepts/local-first)** - Understand how Pocket works
- **[React Integration](/docs/guides/react-integration)** - Deep dive into React hooks
- **[Sync Setup](/docs/guides/sync-setup)** - Add server synchronization
- **[API Reference](/docs/api/database)** - Complete API documentation

## Packages

Pocket is modular. Install what you need:

### All-in-One

| Package | Description |
|---------|-------------|
| `pocket` | All-in-one (core + React + browser storage) |

### Core

| Package | Description | Size |
|---------|-------------|------|
| `@pocket/core` | Core database engine | ~25KB |
| `@pocket/sync` | Sync engine for client-server sync | ~12KB |
| `@pocket/query` | Advanced query utilities | ~4KB |

### Framework SDKs

| Package | Description | Size |
|---------|-------------|------|
| `@pocket/react` | React hooks & components | ~8KB |
| `@pocket/vue` | Vue 3 composables | ~6KB |
| `@pocket/svelte` | Svelte stores | ~5KB |
| `@pocket/solid` | Solid.js primitives | ~5KB |
| `@pocket/angular` | Angular signals & observables | ~7KB |

### Mobile & Desktop

| Package | Description |
|---------|-------------|
| `@pocket/react-native` | React Native with AsyncStorage/MMKV |
| `@pocket/expo` | Expo with expo-sqlite |
| `@pocket/electron` | Electron desktop apps |
| `@pocket/tauri` | Tauri desktop apps |

### Storage Adapters

| Package | Description | Size |
|---------|-------------|------|
| `@pocket/storage-indexeddb` | IndexedDB adapter (browser) | ~5KB |
| `@pocket/storage-opfs` | OPFS adapter (browser) | ~8KB |
| `@pocket/storage-memory` | In-memory adapter | ~3KB |
| `@pocket/storage-sqlite` | SQLite adapter (Node.js) | ~6KB |
| `@pocket/storage-edge` | Cloudflare D1 & Durable Objects | ~5KB |

### Schema & Validation

| Package | Description |
|---------|-------------|
| `@pocket/zod` | Zod schema integration |

### Advanced Features

| Package | Description |
|---------|-------------|
| `@pocket/encryption` | End-to-end encryption |
| `@pocket/crdt` | CRDT conflict resolution |
| `@pocket/vectors` | Vector embeddings for AI |
| `@pocket/time-travel` | Undo/redo & history |
| `@pocket/devtools` | Browser DevTools extension |
| `@pocket/opentelemetry` | OpenTelemetry observability |

### Server

| Package | Description |
|---------|-------------|
| `@pocket/server` | Sync server endpoint |
| `@pocket/sync-server` | WebSocket sync server |

For most projects, just install `pocket` and you're ready to go.
