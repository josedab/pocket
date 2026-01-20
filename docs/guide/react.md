# React Integration

Pocket provides first-class React support with hooks for live queries, mutations, and database access.

<div style="margin: 1.5rem 0;">
  <a href="https://stackblitz.com/github/pocket-db/pocket/tree/main/examples/stackblitz-react" target="_blank" rel="noopener noreferrer">
    <img src="https://developer.stackblitz.com/img/open_in_stackblitz.svg" alt="Open in StackBlitz" />
  </a>
</div>

::: tip Live Example
Try the interactive React example above to see hooks in action with a working todo app!
:::

## Installation

```bash
npm install @pocket/react
```

## Setup

### Provider

Wrap your app with `PocketProvider`:

```tsx
import { Database } from '@pocket/core';
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';
import { PocketProvider } from '@pocket/react';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});

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

Subscribe to live query results:

```tsx
import { useLiveQuery } from '@pocket/react';

interface Todo {
  _id: string;
  title: string;
  completed: boolean;
}

function TodoList() {
  const { data, isLoading, error } = useLiveQuery<Todo>(
    'todos',
    (collection) => collection
      .find()
      .where('completed').equals(false)
      .sort('createdAt', 'desc'),
    [] // dependency array
  );

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {data.map((todo) => (
        <li key={todo._id}>{todo.title}</li>
      ))}
    </ul>
  );
}
```

### useQuery (Simplified)

For simple filter-based queries:

```tsx
import { useQuery } from '@pocket/react';

function IncompleteTodos() {
  const { data, isLoading } = useQuery<Todo>('todos', {
    completed: false,
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <ul>
      {data.map((todo) => (
        <li key={todo._id}>{todo.title}</li>
      ))}
    </ul>
  );
}
```

### useCollection

Access a collection directly:

```tsx
import { useCollection } from '@pocket/react';

function TodoActions() {
  const todos = useCollection<Todo>('todos');

  const addTodo = async (title: string) => {
    await todos.insert({
      _id: crypto.randomUUID(),
      title,
      completed: false,
    });
  };

  return <button onClick={() => addTodo('New Task')}>Add</button>;
}
```

### useDatabase

Access the database instance:

```tsx
import { useDatabase } from '@pocket/react';

function DatabaseInfo() {
  const db = useDatabase();

  const [stats, setStats] = useState(null);

  useEffect(() => {
    db.getStats().then(setStats);
  }, [db]);

  return <pre>{JSON.stringify(stats, null, 2)}</pre>;
}
```

## Live Query Options

### Dependencies

Re-run query when dependencies change:

```tsx
function FilteredTodos({ filter }: { filter: string }) {
  const { data } = useLiveQuery<Todo>(
    'todos',
    (collection) => collection
      .find()
      .where('title').contains(filter),
    [filter] // Re-query when filter changes
  );

  return <TodoList todos={data} />;
}
```

### Debouncing

Reduce update frequency:

```tsx
const { data } = useLiveQuery<Todo>(
  'todos',
  (collection) => collection.find(),
  [],
  { debounceMs: 100 }
);
```

### Disable Query

Conditionally disable:

```tsx
const { data } = useLiveQuery<Todo>(
  'todos',
  (collection) => collection.find(),
  [],
  { enabled: isLoggedIn }
);
```

### Event Reduce

Enable incremental updates:

```tsx
const { data } = useLiveQuery<Todo>(
  'todos',
  (collection) => collection.find(),
  [],
  { useEventReduce: true }
);
```

## Return Value

```typescript
interface LiveQueryResult<T> {
  /** Query results */
  data: T[];
  /** Initial loading state */
  isLoading: boolean;
  /** Error if query failed */
  error: Error | null;
  /** Force refresh */
  refresh: () => void;
}
```

## Mutation Patterns

### Direct Collection Access

```tsx
function TodoItem({ todo }: { todo: Todo }) {
  const todos = useCollection<Todo>('todos');

  const toggleComplete = async () => {
    await todos.update(todo._id, {
      completed: !todo.completed,
    });
    // UI updates automatically via live query
  };

  const deleteTodo = async () => {
    await todos.delete(todo._id);
  };

  return (
    <li>
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={toggleComplete}
      />
      <span>{todo.title}</span>
      <button onClick={deleteTodo}>Delete</button>
    </li>
  );
}
```

### Custom Hook Pattern

```tsx
function useTodoActions() {
  const todos = useCollection<Todo>('todos');

  return {
    add: async (title: string) => {
      return todos.insert({
        _id: crypto.randomUUID(),
        title,
        completed: false,
      });
    },
    toggle: async (id: string, completed: boolean) => {
      return todos.update(id, { completed: !completed });
    },
    remove: async (id: string) => {
      return todos.delete(id);
    },
  };
}

function TodoApp() {
  const { data: todos, isLoading } = useQuery<Todo>('todos');
  const actions = useTodoActions();

  // ...
}
```

## Complete Example

```tsx
import { Database } from '@pocket/core';
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';
import { PocketProvider, useCollection, useQuery } from '@pocket/react';
import { useState } from 'react';

interface Todo {
  _id: string;
  title: string;
  completed: boolean;
}

// Initialize database
const db = await Database.create({
  name: 'todo-app',
  storage: createIndexedDBStorage(),
});

function TodoApp() {
  const { data: todos, isLoading } = useQuery<Todo>('todos');
  const collection = useCollection<Todo>('todos');
  const [newTitle, setNewTitle] = useState('');

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    await collection.insert({
      _id: crypto.randomUUID(),
      title: newTitle,
      completed: false,
    });
    setNewTitle('');
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <form onSubmit={addTodo}>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="What needs to be done?"
        />
        <button type="submit">Add</button>
      </form>

      <ul>
        {todos.map((todo) => (
          <li key={todo._id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() =>
                collection.update(todo._id, { completed: !todo.completed })
              }
            />
            <span style={{
              textDecoration: todo.completed ? 'line-through' : 'none'
            }}>
              {todo.title}
            </span>
            <button onClick={() => collection.delete(todo._id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function App() {
  return (
    <PocketProvider database={db}>
      <TodoApp />
    </PocketProvider>
  );
}
```

## Next Steps

- [Live Queries](./live-queries.md) - Core live query concepts
- [Queries](./queries.md) - Query builder reference
- [Sync](./sync.md) - Adding real-time sync
