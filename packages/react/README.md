# @pocket/react

React hooks and components for Pocket - seamless integration with React applications.

## Installation

```bash
npm install @pocket/react @pocket/core
```

## Quick Start

```tsx
import { PocketProvider, useLiveQuery, useMutation } from '@pocket/react';
import { Database } from '@pocket/core';

// Wrap your app
function App() {
  const db = useDatabase(); // Your database instance

  return (
    <PocketProvider database={db}>
      <TodoApp />
    </PocketProvider>
  );
}

// Use hooks in components
function TodoApp() {
  const { data: todos, isLoading } = useLiveQuery<Todo>('todos');
  const { insert, remove } = useMutation<Todo>('todos');

  if (isLoading) return <Spinner />;

  return (
    <div>
      <button onClick={() => insert({ title: 'New todo' })}>
        Add Todo
      </button>
      {todos.map(todo => (
        <TodoItem
          key={todo._id}
          todo={todo}
          onDelete={() => remove(todo._id)}
        />
      ))}
    </div>
  );
}
```

## Hooks

### useLiveQuery

Subscribe to reactive query updates:

```tsx
// Basic query
const { data, isLoading, error } = useLiveQuery<Todo>('todos');

// With filter and options
const { data } = useLiveQuery<Todo>('todos', {
  filter: { completed: false },
  sort: { field: 'createdAt', direction: 'desc' },
  limit: 10
});
```

### useDocument

Fetch and observe a single document:

```tsx
const { data: todo, isLoading, update, remove } = useDocument<Todo>(
  'todos',
  todoId
);

// Update the document
await update({ completed: true });

// Delete the document
await remove();
```

### useMutation

Perform insert, update, and delete operations:

```tsx
const { insert, update, remove, isMutating } = useMutation<Todo>('todos');

// Insert
const newTodo = await insert({ title: 'Learn React' });

// Update
await update(newTodo._id, { completed: true });

// Delete
await remove(newTodo._id);
```

### useSuspenseQuery

React Suspense integration:

```tsx
function TodoList() {
  // Suspends until data is ready
  const { data: todos } = useSuspenseQuery<Todo>('todos');

  return todos.map(todo => <TodoItem key={todo._id} todo={todo} />);
}

// Wrap with Suspense
<Suspense fallback={<Spinner />}>
  <TodoList />
</Suspense>
```

### useSyncStatus

Monitor sync engine status:

```tsx
const { state, pendingChanges, lastSyncedAt } = useSyncStatus();

if (state === 'syncing') {
  return <SyncIndicator />;
}
```

## Provider

The `PocketProvider` makes the database available to all hooks:

```tsx
<PocketProvider
  database={db}
  loading={<LoadingScreen />}
  errorComponent={(error) => <ErrorScreen error={error} />}
>
  <App />
</PocketProvider>
```

### Async Initialization

Handle async database creation:

```tsx
const dbPromise = Database.create({ name: 'my-app', storage });

<PocketProvider database={dbPromise} loading={<Splash />}>
  <App />
</PocketProvider>
```

## TypeScript

All hooks are fully typed:

```tsx
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
}

// Type-safe queries
const { data } = useLiveQuery<Todo>('todos', {
  filter: { completed: false } // Type-checked
});

// Type-safe mutations
const { update } = useMutation<Todo>('todos');
await update(id, { completed: true }); // Type-checked
```

## Documentation

- [React Guide](https://pocket.dev/docs/react)
- [Hooks Reference](https://pocket.dev/docs/api/react)
- [Examples](https://pocket.dev/examples/react)

## License

MIT
