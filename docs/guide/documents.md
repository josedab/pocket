# Documents

Documents are the fundamental data units in Pocket. They are JSON objects with a required `_id` field and optional metadata for sync and change tracking.

## Document Structure

Every document has these fields:

```typescript
interface Document {
  /** Unique identifier (required) */
  _id: string;

  /** Revision number (auto-managed) */
  _rev?: number;

  /** Soft delete flag */
  _deleted?: boolean;

  /** Last modified timestamp */
  _updatedAt?: number;

  /** Creation timestamp */
  _createdAt?: number;

  /** Vector clock for sync (auto-managed) */
  _clock?: VectorClock;
}
```

## Defining Document Types

Use TypeScript interfaces for type safety:

```typescript
interface Todo {
  _id: string;
  title: string;
  description?: string;
  completed: boolean;
  priority: number;
  tags: string[];
  createdAt: Date;
}

const todos = db.collection<Todo>('todos');
```

## Creating Documents

### With Manual ID

```typescript
await todos.insert({
  _id: 'todo-123',
  title: 'My Task',
  completed: false,
  priority: 1,
  tags: ['work'],
  createdAt: new Date(),
});
```

### With Generated ID

```typescript
await todos.insert({
  _id: crypto.randomUUID(),
  title: 'My Task',
  completed: false,
  priority: 1,
  tags: [],
  createdAt: new Date(),
});
```

## Document Metadata

### Timestamps

Pocket automatically manages timestamps:

```typescript
const todo = await todos.insert({
  _id: '1',
  title: 'Task',
  completed: false,
  priority: 0,
  tags: [],
  createdAt: new Date(),
});

console.log(todo._createdAt); // Unix timestamp
console.log(todo._updatedAt); // Unix timestamp
```

### Revisions

Each update increments the revision:

```typescript
const todo = await todos.get('todo-1');
console.log(todo._rev); // 1

await todos.update('todo-1', { completed: true });

const updated = await todos.get('todo-1');
console.log(updated._rev); // 2
```

### Soft Deletes

When sync is enabled, deletes are soft:

```typescript
await todos.delete('todo-1');

// Document still exists with _deleted: true
const raw = await todos.get('todo-1'); // Returns null (filtered)

// Access deleted documents via storage directly if needed
```

## Supported Data Types

| Type | Description |
|------|-------------|
| `string` | Text values |
| `number` | Integers and floats |
| `boolean` | `true` or `false` |
| `null` | Null value |
| `Date` | JavaScript Date objects |
| `Array` | Arrays of any supported type |
| `Object` | Nested objects |

### Date Handling

Dates are serialized to ISO strings in storage:

```typescript
await todos.insert({
  _id: '1',
  title: 'Task',
  completed: false,
  priority: 0,
  tags: [],
  createdAt: new Date('2024-01-15'),
});

// When retrieved, dates are deserialized back
const todo = await todos.get('1');
console.log(todo.createdAt instanceof Date); // true
```

## Document Updates

### Partial Updates

Only specified fields are changed:

```typescript
await todos.update('todo-1', {
  completed: true,
  // Other fields remain unchanged
});
```

### Replacing Nested Objects

Nested objects are merged shallowly:

```typescript
interface Settings {
  _id: string;
  preferences: {
    theme: string;
    notifications: boolean;
  };
}

await settings.update('user-settings', {
  preferences: { theme: 'dark' },
  // notifications field is lost!
});

// To preserve nested fields:
const current = await settings.get('user-settings');
await settings.update('user-settings', {
  preferences: { ...current.preferences, theme: 'dark' },
});
```

## Type Safety Tips

### Use NewDocument for Inserts

```typescript
import type { NewDocument } from '@pocket/core';

type NewTodo = NewDocument<Todo>;

function createTodo(data: Omit<NewTodo, '_id'>): NewTodo {
  return {
    _id: crypto.randomUUID(),
    ...data,
  };
}
```

### Use DocumentUpdate for Updates

```typescript
import type { DocumentUpdate } from '@pocket/core';

type TodoUpdate = DocumentUpdate<Todo>;

async function completeTodo(id: string): Promise<Todo> {
  const update: TodoUpdate = { completed: true };
  return todos.update(id, update);
}
```

## Next Steps

- [Queries](./queries.md) - Query documents
- [Collections](./collections.md) - Collection operations
- [Sync](./sync.md) - Document synchronization
