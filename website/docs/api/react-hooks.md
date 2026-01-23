---
sidebar_position: 5
title: React Hooks API
description: React hooks API reference
---

# React Hooks API

Pocket provides React hooks for reactive data fetching. Import from the react package:

```typescript
import { PocketProvider, useLiveQuery, useMutation } from 'pocket/react';
```

## Setup

### PocketProvider

Provides the database context to child components.

```tsx
import { PocketProvider } from 'pocket/react';
import { db } from './db';

function App() {
  return (
    <PocketProvider database={db}>
      <YourApp />
    </PocketProvider>
  );
}
```

#### Props

| Prop | Type | Description |
|------|------|-------------|
| `database` | `Database` | Pocket database instance |
| `children` | `ReactNode` | Child components |

---

## Hooks

### useLiveQuery

Subscribes to live-updating query results.

```typescript
function useLiveQuery<T extends Document>(
  collectionName: string,
  queryFn?: (collection: Collection<T>) => QueryBuilder<T>,
  deps?: unknown[],
  options?: UseLiveQueryOptions,
): LiveQueryResult<T>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `collectionName` | `string` | Name of the collection |
| `queryFn` | `(collection) => QueryBuilder` | Query builder function (optional) |
| `deps` | `unknown[]` | Dependency array for query recreation |
| `options` | `UseLiveQueryOptions` | Additional options |

#### Options

```typescript
interface UseLiveQueryOptions {
  debounceMs?: number;      // Batch rapid updates (default: 0)
  enabled?: boolean;        // Enable/disable query (default: true)
  useEventReduce?: boolean; // Use optimization (default: true)
}
```

#### Returns

```typescript
interface LiveQueryResult<T> {
  data: T[];           // Query results
  isLoading: boolean;  // True during initial load
  error: Error | null; // Error if query failed
  refresh: () => void; // Force refresh
}
```

#### Examples

```tsx
// All documents
const { data: todos } = useLiveQuery<Todo>('todos');

// With filter
const { data: incomplete } = useLiveQuery<Todo>(
  'todos',
  (c) => c.find().where('completed').equals(false),
);

// With dependencies
const { data: userTodos } = useLiveQuery<Todo>(
  'todos',
  (c) => c.find().where('userId').equals(userId),
  [userId],
);

// With options
const { data, isLoading, error, refresh } = useLiveQuery<Todo>(
  'todos',
  (c) => c.find().sort('createdAt', 'desc'),
  [],
  { debounceMs: 100, enabled: isVisible },
);
```

---

### useQuery

Simplified hook with filter object.

```typescript
function useQuery<T extends Document>(
  collectionName: string,
  filter?: Partial<T>,
  options?: UseLiveQueryOptions,
): LiveQueryResult<T>
```

#### Example

```tsx
// Simple filter
const { data: incomplete } = useQuery<Todo>('todos', { completed: false });

// All documents
const { data: allTodos } = useQuery<Todo>('todos');
```

---

### useMutation

Executes write operations with loading and error states.

```typescript
function useMutation<TArgs extends unknown[], TResult>(
  mutationFn: (database: Database, ...args: TArgs) => Promise<TResult>,
): MutationResult<TArgs, TResult>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `mutationFn` | `(db, ...args) => Promise<T>` | Function that performs the mutation |

#### Returns

```typescript
interface MutationResult<TArgs, TResult> {
  mutate: (...args: TArgs) => Promise<TResult>;
  isLoading: boolean;
  error: Error | null;
  reset: () => void;
}
```

#### Examples

```tsx
// Insert
const { mutate: addTodo, isLoading } = useMutation(
  async (db, title: string) => {
    return db.collection<Todo>('todos').insert({
      _id: crypto.randomUUID(),
      title,
      completed: false,
    });
  }
);

// Usage
await addTodo('New todo');

// Update
const { mutate: toggleTodo } = useMutation(
  async (db, id: string) => {
    const todo = await db.collection<Todo>('todos').get(id);
    if (todo) {
      return db.collection<Todo>('todos').update(id, {
        completed: !todo.completed,
      });
    }
  }
);

// Delete
const { mutate: deleteTodo } = useMutation(
  async (db, id: string) => {
    await db.collection<Todo>('todos').delete(id);
  }
);
```

---

### useDocument

Fetches and subscribes to a single document.

```typescript
function useDocument<T extends Document>(
  collectionName: string,
  id: string | null,
  options?: UseDocumentOptions,
): DocumentResult<T>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `collectionName` | `string` | Name of the collection |
| `id` | `string \| null` | Document ID (null to skip) |
| `options` | `UseDocumentOptions` | Additional options |

#### Returns

```typescript
interface DocumentResult<T> {
  data: T | null;      // The document
  isLoading: boolean;  // True during initial load
  error: Error | null; // Error if fetch failed
}
```

#### Example

```tsx
function TodoDetail({ id }: { id: string }) {
  const { data: todo, isLoading, error } = useDocument<Todo>('todos', id);

  if (isLoading) return <Loading />;
  if (error) return <Error message={error.message} />;
  if (!todo) return <NotFound />;

  return <TodoCard todo={todo} />;
}
```

---

### useCollection

Gets direct access to a collection.

```typescript
function useCollection<T extends Document>(
  collectionName: string,
): Collection<T>
```

#### Example

```tsx
function TodoActions({ id }: { id: string }) {
  const todos = useCollection<Todo>('todos');

  const handleComplete = async () => {
    const todo = await todos.get(id);
    if (todo) {
      await todos.update(id, { completed: !todo.completed });
    }
  };

  return <button onClick={handleComplete}>Toggle</button>;
}
```

---

### useDatabase

Gets the database instance.

```typescript
function useDatabase(): Database
```

#### Example

```tsx
function DatabaseInfo() {
  const db = useDatabase();

  const [stats, setStats] = useState<DatabaseStats | null>(null);

  useEffect(() => {
    db.getStats().then(setStats);
  }, [db]);

  return <pre>{JSON.stringify(stats, null, 2)}</pre>;
}
```

---

### useSyncStatus

Monitors sync status (requires sync engine).

```typescript
function useSyncStatus(): SyncStatusResult
```

#### Returns

```typescript
interface SyncStatusResult {
  status: SyncStatus;   // 'idle' | 'syncing' | 'error' | 'offline'
  stats: SyncStats;     // Sync statistics
}
```

#### Example

```tsx
function SyncIndicator() {
  const { status, stats } = useSyncStatus();

  return (
    <div className="sync-status">
      {status === 'syncing' && <Spinner />}
      {status === 'offline' && <CloudOff />}
      {status === 'error' && <AlertCircle />}
      {status === 'idle' && <CloudCheck />}

      {stats.lastSyncAt && (
        <span>Last: {formatDate(stats.lastSyncAt)}</span>
      )}
    </div>
  );
}
```

---

## Patterns

### Conditional Fetching

```tsx
function ConditionalData({ shouldFetch }: { shouldFetch: boolean }) {
  const { data } = useLiveQuery<Todo>(
    'todos',
    (c) => c.find(),
    [],
    { enabled: shouldFetch },
  );
}
```

### Dependent Queries

```tsx
function UserTodos({ userId }: { userId: string | null }) {
  // Only query when userId is available
  const { data: todos } = useLiveQuery<Todo>(
    'todos',
    userId ? (c) => c.find().where('userId').equals(userId) : undefined,
    [userId],
    { enabled: !!userId },
  );
}
```

### Error Handling

```tsx
function SafeQuery() {
  const { data, error, isLoading } = useLiveQuery<Todo>('todos');

  if (error) {
    return (
      <div className="error">
        <p>Failed to load todos: {error.message}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  if (isLoading) {
    return <Skeleton />;
  }

  return <TodoList todos={data} />;
}
```

### Optimistic Updates

```tsx
function OptimisticToggle({ todo }: { todo: Todo }) {
  // Local state for immediate UI feedback
  const [optimisticCompleted, setOptimisticCompleted] = useState(todo.completed);

  const { mutate: toggle } = useMutation(async (db, id: string) => {
    await db.collection<Todo>('todos').update(id, {
      completed: !todo.completed,
    });
  });

  const handleClick = async () => {
    // Update UI immediately
    setOptimisticCompleted(!optimisticCompleted);

    try {
      await toggle(todo._id);
    } catch (error) {
      // Revert on error
      setOptimisticCompleted(todo.completed);
    }
  };

  // Note: With Pocket's local-first approach, the mutation
  // already updates locally first, so optimistic state
  // is often unnecessary
}
```

---

## Types

### LiveQueryResult

```typescript
interface LiveQueryResult<T> {
  data: T[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}
```

### MutationResult

```typescript
interface MutationResult<TArgs extends unknown[], TResult> {
  mutate: (...args: TArgs) => Promise<TResult>;
  isLoading: boolean;
  error: Error | null;
  reset: () => void;
}
```

### DocumentResult

```typescript
interface DocumentResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
}
```

### UseLiveQueryOptions

```typescript
interface UseLiveQueryOptions {
  debounceMs?: number;
  enabled?: boolean;
  useEventReduce?: boolean;
}
```

---

## See Also

- [React Integration Guide](/docs/guides/react-integration) - Detailed guide
- [Reactive Queries](/docs/concepts/reactive-queries) - How queries work
- [Collection API](/docs/api/collection) - Collection methods
