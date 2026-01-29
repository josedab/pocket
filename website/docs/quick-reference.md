---
sidebar_position: 2
title: Quick Reference
description: Cheatsheet for common Pocket operations
---

# Quick Reference

A scannable cheatsheet for common Pocket operations. Copy, paste, and go.

:::tip Bookmark this page
Press `Ctrl+D` (or `Cmd+D` on Mac) to bookmark for quick access.
:::

---

## Installation

```bash
npm install pocket          # All-in-one
npm install @pocket/core    # Core only
```

---

## Setup

```typescript
import { Database, createIndexedDBStorage } from 'pocket';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});

interface Todo {
  _id: string;
  title: string;
  completed: boolean;
}

const todos = db.collection<Todo>('todos');
```

---

## CRUD Operations

### Create

| Operation | Code |
|-----------|------|
| Insert one | `await todos.insert({ _id: '1', title: 'Task' })` |
| Insert many | `await todos.insertMany([{ _id: '1' }, { _id: '2' }])` |
| Upsert | `await todos.upsert({ _id: '1', title: 'Updated' })` |
| Auto-generate ID | `await todos.insert({ _id: crypto.randomUUID(), ... })` |

### Read

| Operation | Code |
|-----------|------|
| Get by ID | `await todos.get('1')` |
| Get many | `await todos.getMany(['1', '2'])` |
| Get all | `await todos.getAll()` |
| Check exists | `await todos.has('1')` |
| Count | `await todos.count()` |
| Count with filter | `await todos.count({ completed: false })` |

### Update

| Operation | Code |
|-----------|------|
| Update fields | `await todos.update('1', { completed: true })` |
| Update with function | `await todos.update('1', doc => ({ ...doc, count: doc.count + 1 }))` |
| Replace | `await todos.replace('1', newDoc)` |

### Delete

| Operation | Code |
|-----------|------|
| Delete one | `await todos.delete('1')` |
| Delete many | `await todos.deleteMany(['1', '2'])` |
| Clear all | `await todos.clear()` |

---

## Query Builder

### Basic Query Structure

```typescript
const results = await todos
  .find()                              // Start query
  .where('field').equals(value)        // Filter
  .sort('field', 'desc')               // Sort
  .limit(10)                           // Limit
  .exec();                             // Execute
```

### Comparison Operators

```typescript
.where('field').equals(value)          // field == value
.where('field').notEquals(value)       // field != value
.where('field').gt(value)              // field > value
.where('field').gte(value)             // field >= value
.where('field').lt(value)              // field < value
.where('field').lte(value)             // field <= value
.where('field').between(min, max)      // min <= field <= max
```

### Array Operators

```typescript
.where('field').in(['a', 'b', 'c'])    // field IN (a, b, c)
.where('field').notIn(['a', 'b'])      // field NOT IN (a, b)
.where('tags').contains('urgent')      // 'urgent' in tags array
.where('tags').containsAll(['a','b'])  // all values in array
```

### String Operators

```typescript
.where('name').contains('john')        // LIKE %john%
.where('name').startsWith('Dr.')       // LIKE Dr.%
.where('name').endsWith('.com')        // LIKE %.com
.where('name').regex(/pattern/i)       // Regex match
```

### Existence Operators

```typescript
.where('field').exists()               // field IS NOT NULL
.where('field').notExists()            // field IS NULL
```

### Logical Operators

```typescript
// AND (default - chain where clauses)
.where('status').equals('active')
.where('age').gte(18)

// OR
.or([
  { status: 'active' },
  { role: 'admin' }
])
```

### Sorting

```typescript
.sort('createdAt', 'desc')             // Single field
.sort('priority', 'asc')               // Secondary sort
  .sort('createdAt', 'desc')
```

### Pagination

```typescript
.limit(10)                             // Max results
.skip(20)                              // Offset
.skip(page * pageSize).limit(pageSize) // Page N
```

### Cursor Pagination

```typescript
.after(lastId)                         // After cursor (forward)
.before(firstId)                       // Before cursor (backward)
```

### Projection

```typescript
.select(['title', 'status'])           // Include only these fields
.exclude(['_internal', 'temp'])        // Exclude these fields
```

---

## Live Queries

```typescript
// Subscribe to real-time updates
const subscription = todos
  .find()
  .where('completed').equals(false)
  .live()
  .subscribe((results) => {
    console.log('Updated:', results);
  });

// Always clean up
subscription.unsubscribe();
```

---

## React Hooks

### Setup

```tsx
import { PocketProvider, useLiveQuery, useMutation, useDocument } from 'pocket/react';

function App() {
  return (
    <PocketProvider database={db}>
      <MyComponent />
    </PocketProvider>
  );
}
```

### useLiveQuery

```tsx
// Basic usage
const { data, isLoading, error } = useLiveQuery<Todo>('todos');

// With query
const { data } = useLiveQuery<Todo>(
  'todos',
  (c) => c.find().where('completed').equals(false),
  [/* dependencies */]
);

// Destructured result
const {
  data,        // Todo[] | undefined
  isLoading,   // boolean
  error,       // Error | null
  refresh,     // () => void
} = useLiveQuery<Todo>('todos');
```

### useDocument

```tsx
const { data: todo, isLoading } = useDocument<Todo>('todos', todoId);
```

### useMutation

```tsx
const { mutate, isLoading, error } = useMutation(
  async (db, title: string) => {
    return db.collection('todos').insert({
      _id: crypto.randomUUID(),
      title,
      completed: false,
    });
  }
);

// Usage
<button onClick={() => mutate('New Task')}>Add</button>
```

### useSyncStatus

```tsx
const { status, lastSynced, error } = useSyncStatus();
// status: 'connected' | 'connecting' | 'disconnected' | 'error'
```

---

## Indexes

```typescript
// Single field index
await todos.createIndex({ fields: ['completed'] });

// Compound index
await todos.createIndex({
  fields: ['userId', 'createdAt'],
  name: 'user_date_idx'
});

// Unique index
await todos.createIndex({
  fields: ['email'],
  unique: true
});

// List indexes
const indexes = await todos.getIndexes();

// Drop index
await todos.dropIndex('user_date_idx');
```

---

## Sync

### Setup

```typescript
import { createSyncEngine } from '@pocket/sync';

const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  collections: ['todos', 'users'],
  authToken: 'your-jwt-token',
});
```

### Operations

```typescript
// Start sync
await sync.start();

// Check status
sync.getStatus().subscribe((status) => {
  // 'connecting' | 'connected' | 'disconnected' | 'error'
});

// Force sync now
await sync.forceSync();

// Pause/resume
sync.pause();
sync.resume();

// Cleanup
sync.destroy();
```

---

## Schema Validation

```typescript
const db = await Database.create({
  collections: [{
    name: 'users',
    schema: {
      type: 'object',
      required: ['email', 'name'],
      properties: {
        email: { type: 'string', format: 'email' },
        name: { type: 'string', minLength: 1 },
        age: { type: 'number', minimum: 0 },
        role: { type: 'string', enum: ['user', 'admin'] },
        tags: {
          type: 'array',
          items: { type: 'string' }
        },
      },
    },
  }],
});
```

---

## Transactions

```typescript
await db.transaction(['todos', 'users'], 'readwrite', async () => {
  const todo = await todos.insert({ title: 'New Task' });
  await users.update(userId, {
    todoCount: (user.todoCount || 0) + 1
  });
  // Automatically commits or rolls back
});
```

---

## Error Handling

```typescript
import { PocketError } from '@pocket/core';

try {
  await collection.insert(data);
} catch (error) {
  if (PocketError.isPocketError(error)) {
    console.log(error.code);       // 'POCKET_V100'
    console.log(error.message);    // Human-readable message
    console.log(error.suggestion); // How to fix
    console.log(error.category);   // 'validation' | 'storage' | ...
  }
}

// Check specific error codes
if (PocketError.isCode(error, 'POCKET_D404')) {
  // Document not found
}
```

### Common Error Codes

| Code | Meaning |
|------|---------|
| `POCKET_V100` | Schema validation failed |
| `POCKET_D404` | Document not found |
| `POCKET_D409` | Duplicate key/conflict |
| `POCKET_S500` | Storage error |
| `POCKET_N001` | Network/sync error |

---

## Storage Adapters

```typescript
import {
  createIndexedDBStorage,  // Default, all browsers
  createOPFSStorage,       // Faster, modern browsers
  createMemoryStorage,     // Testing only
} from 'pocket';

// Check OPFS availability
if (await createOPFSStorage().isAvailable()) {
  // Use OPFS for better performance
}
```

---

## CLI Commands

```bash
# Project setup
pocket init                     # Initialize project

# Migrations
pocket migrate create <name>    # Create migration
pocket migrate up               # Run pending migrations
pocket migrate down             # Rollback last migration
pocket migrate status           # Show migration status

# Data management
pocket studio                   # Open data browser UI
pocket export todos             # Export collection to JSON
pocket export --all             # Export all collections
pocket import data.json         # Import from JSON

# Development
pocket generate types           # Generate TypeScript types
pocket generate schema          # Generate JSON schema
```

---

## Common Patterns

### Pagination Hook

```tsx
function usePagination<T>(collection: string, pageSize = 10) {
  const [page, setPage] = useState(0);

  const { data, isLoading } = useLiveQuery<T>(
    collection,
    (c) => c.find().skip(page * pageSize).limit(pageSize),
    [page]
  );

  return {
    data,
    isLoading,
    page,
    hasMore: data?.length === pageSize,
    next: () => setPage(p => p + 1),
    prev: () => setPage(p => Math.max(0, p - 1)),
  };
}
```

### Debounced Search

```tsx
function useSearch<T>(collection: string, field = 'title') {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  const { data } = useLiveQuery<T>(
    collection,
    (c) => debouncedQuery
      ? c.find().where(field).contains(debouncedQuery)
      : c.find().limit(50),
    [debouncedQuery]
  );

  return { data, query, setQuery };
}
```

### Optimistic Update

```tsx
function TodoItem({ todo }: { todo: Todo }) {
  const [optimistic, setOptimistic] = useState(todo.completed);

  const { mutate } = useMutation(async (db, completed: boolean) => {
    await db.collection('todos').update(todo._id, { completed });
  });

  const toggle = () => {
    setOptimistic(!optimistic);  // Immediate UI update
    mutate(!todo.completed);     // Persist in background
  };

  return (
    <div onClick={toggle}>
      {optimistic ? '✓' : '○'} {todo.title}
    </div>
  );
}
```

### Singleton Database

```typescript
// db.ts
let dbInstance: Database | null = null;

export async function getDatabase(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = await Database.create({
      name: 'my-app',
      storage: createIndexedDBStorage(),
    });
  }
  return dbInstance;
}
```

### Type-Safe Collections

```typescript
// types.ts
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  userId: string;
}

interface User {
  _id: string;
  name: string;
  email: string;
}

// collections.ts
export const getTodos = (db: Database) => db.collection<Todo>('todos');
export const getUsers = (db: Database) => db.collection<User>('users');
```

---

## Quick Recipes

### Filter by date range

```typescript
const thisWeek = await todos
  .find()
  .where('createdAt').gte(weekStart)
  .where('createdAt').lte(weekEnd)
  .exec();
```

### Sort by multiple fields

```typescript
const sorted = await todos
  .find()
  .sort('priority', 'desc')
  .sort('createdAt', 'asc')
  .exec();
```

### Count with condition

```typescript
const activeCount = await todos.count({ completed: false });
```

### Check before insert

```typescript
const exists = await users.has(email);
if (!exists) {
  await users.insert({ _id: email, ... });
}
```

### Batch update

```typescript
const ids = ['1', '2', '3'];
await Promise.all(
  ids.map(id => todos.update(id, { archived: true }))
);
```

---

## See Also

- [Getting Started](/docs/intro) - Full tutorial
- [API Reference](/docs/api/database) - Complete API docs
- [React Integration](/docs/guides/react-integration) - React deep dive
- [Troubleshooting](/docs/troubleshooting) - Common issues
