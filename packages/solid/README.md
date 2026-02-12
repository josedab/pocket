# @pocket/solid

[![npm](https://img.shields.io/npm/v/@pocket/solid.svg)](https://www.npmjs.com/package/@pocket/solid)

SolidJS primitives for Pocket — reactive signals, mutations, and sync status for local-first apps.

## Installation

```bash
npm install @pocket/solid @pocket/core
```

**Peer dependency:** `solid-js` >= 1.8.0

## Quick Start

### Provider Setup

```tsx
import { PocketProvider } from '@pocket/solid';

function App() {
  return (
    <PocketProvider name="my-app">
      <TodoList />
    </PocketProvider>
  );
}
```

### Using Primitives

```tsx
import { createLiveQuery, createMutation, createSyncStatus } from '@pocket/solid';

function TodoList() {
  const todos = createLiveQuery<Todo>('todos', {
    filter: { completed: false },
    sort: { field: 'createdAt', direction: 'desc' }
  });

  const { mutate } = createMutation<Todo>('todos');
  const sync = createSyncStatus();

  return (
    <For each={todos().data}>
      {(todo) => <p>{todo.title}</p>}
    </For>
  );
}
```

### Single Document

```tsx
import { createDocument } from '@pocket/solid';

function TodoDetail(props: { id: string }) {
  const todo = createDocument<Todo>('todos', () => props.id);
  return <p>{todo().data?.title}</p>;
}
```

## API

| Export | Description |
|--------|-------------|
| `PocketProvider` | Context provider component |
| `useDatabase()` | Access the database instance |
| `useCollection(name)` | Access a collection |
| `createLiveQuery(collection, opts?)` | Reactive live query signal |
| `createQuery(collection, opts?)` | One-time reactive query signal |
| `createDocument(collection, id)` | Reactive single document signal |
| `createFindOne(collection, filter)` | Reactive find-one signal |
| `createMutation(collection)` | Insert, update, and delete operations |
| `createOptimisticMutation(collection)` | Optimistic mutation with rollback |
| `createSyncStatus()` | Reactive sync state signal |
| `createOnlineStatus()` | Reactive online/offline signal |

## Documentation

- [Full Documentation](https://pocket.dev/docs)
- [API Reference](https://pocket.dev/docs/api/solid)

## License

MIT
