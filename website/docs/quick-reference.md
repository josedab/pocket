---
sidebar_position: 2
title: Quick Reference
description: Cheatsheet for common Pocket operations
---

# Quick Reference

A condensed reference for common Pocket operations.

## Setup

```typescript
import { Database, createIndexedDBStorage } from 'pocket';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});

const todos = db.collection<Todo>('todos');
```

## CRUD Operations

### Create

```typescript
// Insert one
const doc = await todos.insert({ _id: '1', title: 'Task', completed: false });

// Insert many
const docs = await todos.insertMany([
  { _id: '2', title: 'Task 2' },
  { _id: '3', title: 'Task 3' },
]);

// Upsert (insert or update)
await todos.upsert({ _id: '1', title: 'Updated Task' });
```

### Read

```typescript
// Get by ID
const todo = await todos.get('1');

// Get multiple by IDs
const items = await todos.getMany(['1', '2', '3']);

// Get all
const all = await todos.getAll();

// Check existence
const exists = await todos.has('1');

// Count
const count = await todos.count();
```

### Update

```typescript
// Update by ID
await todos.update('1', { completed: true });

// Update with function
await todos.update('1', (doc) => ({ ...doc, completed: !doc.completed }));
```

### Delete

```typescript
// Delete by ID
await todos.delete('1');

// Delete multiple
await todos.deleteMany(['1', '2', '3']);

// Clear all
await todos.clear();
```

## Queries

### Basic Queries

```typescript
// Find all
const all = await todos.find().exec();

// Find with filter
const active = await todos.find({ completed: false }).exec();

// Query builder
const results = await todos
  .find()
  .where('completed').equals(false)
  .exec();
```

### Operators

```typescript
.where('field').equals(value)        // ==
.where('field').notEquals(value)     // !=
.where('field').gt(value)            // >
.where('field').gte(value)           // >=
.where('field').lt(value)            // <
.where('field').lte(value)           // <=
.where('field').in([a, b, c])        // IN
.where('field').notIn([a, b, c])     // NOT IN
.where('field').contains('text')     // LIKE %text%
.where('field').startsWith('text')   // LIKE text%
.where('field').endsWith('text')     // LIKE %text
.where('field').regex(/pattern/)     // REGEX
.where('field').exists()             // IS NOT NULL
.where('field').notExists()          // IS NULL
```

### Sorting

```typescript
.sort('createdAt', 'desc')           // Single field
.sort('priority', 'asc')
  .sort('createdAt', 'desc')         // Multiple fields
```

### Pagination

```typescript
.limit(10)                           // Limit results
.skip(20)                            // Offset
.skip(page * pageSize).limit(pageSize)  // Page n
```

### Cursor Pagination

```typescript
.after(lastId)                       // After cursor
.before(firstId)                     // Before cursor
.cursor(value, { direction: 'after' })
```

### Projection

```typescript
.select(['title', 'completed'])      // Include fields
.exclude(['_internal'])              // Exclude fields
```

## Live Queries

```typescript
// Subscribe to changes
const subscription = todos
  .find()
  .where('completed').equals(false)
  .live()
  .subscribe((results) => {
    console.log('Updated:', results);
  });

// Unsubscribe
subscription.unsubscribe();
```

## React Hooks

```tsx
import { PocketProvider, useLiveQuery, useMutation, useDocument } from 'pocket/react';

// Provider
<PocketProvider database={db}>
  <App />
</PocketProvider>

// Live query
const { data, isLoading, error, refresh } = useLiveQuery<Todo>(
  'todos',
  (c) => c.find().where('completed').equals(false),
  [/* deps */]
);

// Single document
const { data: todo } = useDocument<Todo>('todos', id);

// Mutations
const { mutate, isLoading } = useMutation(
  async (db, title: string) => {
    return db.collection('todos').insert({ title });
  }
);
```

## Vue Composables

```vue
<script setup>
import { providePocket, useLiveQuery, useMutation } from '@pocket/vue';

providePocket(db);

const { data: todos, isLoading } = useLiveQuery('todos');
const { insert, update, remove } = useMutation('todos');
</script>
```

## Svelte Stores

```svelte
<script>
import { setPocketContext, createLiveQuery, createMutation } from '@pocket/svelte';

setPocketContext(db);

const todos = createLiveQuery('todos');
const mutation = createMutation('todos');
</script>

{#each $todos.data as todo}
  {todo.title}
{/each}
```

## SolidJS Primitives

```tsx
import { PocketProvider, createLiveQuery, createMutation } from '@pocket/solid';

<PocketProvider database={db}>
  <App />
</PocketProvider>

const { data: todos, isLoading } = createLiveQuery<Todo>('todos');
// Access: todos(), isLoading()
```

## Indexes

```typescript
// Create index
await todos.createIndex({ fields: ['completed'] });

// Compound index
await todos.createIndex({ fields: ['userId', 'createdAt'] });

// Unique index
await todos.createIndex({ fields: ['email'], unique: true });

// List indexes
const indexes = await todos.getIndexes();

// Drop index
await todos.dropIndex('completed_idx');
```

## Schema

```typescript
const db = await Database.create({
  collections: [{
    name: 'users',
    schema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email' },
        name: { type: 'string' },
        age: { type: 'number', minimum: 0 },
        role: { type: 'string', enum: ['user', 'admin'] },
        tags: { type: 'array', items: { type: 'string' } },
        profile: {
          type: 'object',
          properties: { bio: { type: 'string' } },
        },
      },
    },
  }],
});
```

## Sync

```typescript
import { createSyncEngine } from '@pocket/sync';

const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  collections: ['todos'],
  authToken: 'your-token',
});

// Status
sync.getStatus().subscribe(console.log);  // 'connecting' | 'connected' | 'disconnected'

// Force sync
await sync.forceSync();

// Cleanup
sync.destroy();
```

## Transactions

```typescript
await db.transaction(['todos', 'users'], 'readwrite', async () => {
  await todos.insert({ title: 'Task' });
  await users.update(userId, { todoCount: 1 });
});
```

## Error Handling

```typescript
import { PocketError } from '@pocket/core';

try {
  await collection.insert(data);
} catch (error) {
  if (PocketError.isPocketError(error)) {
    console.log(error.code);        // POCKET_V100
    console.log(error.message);
    console.log(error.suggestion);
    console.log(error.category);    // 'validation'
  }
}

// Check specific codes
if (PocketError.isCode(error, 'POCKET_D401')) {
  // Document not found
}

// Check categories
if (PocketError.isCategory(error, 'validation')) {
  // Handle validation error
}
```

## TTL

```typescript
import { createTTLManager } from '@pocket/core';

const ttl = createTTLManager();
ttl.register('sessions', sessions, { field: 'expiresAt' });
ttl.start();

// Manual cleanup
await ttl.cleanup('sessions');
```

## Seeding

```typescript
import { createSeeder, defineSeed } from '@pocket/core';

const config = defineSeed({
  environments: ['development'],
  collections: {
    users: {
      factory: (i, ctx) => ({ name: `User ${i}` }),
      count: 10,
    },
  },
});

const seeder = createSeeder(config);
await seeder.seed({ users: db.collection('users') }, 'development');
```

## CLI

```bash
pocket init                          # Initialize project
pocket migrate create <name>         # Create migration
pocket migrate up                    # Run migrations
pocket migrate down                  # Rollback
pocket migrate status                # Show status
pocket studio                        # Data browser
pocket export [collection]           # Export data
pocket import <file>                 # Import data
pocket generate types                # Generate TypeScript
```

## Storage Adapters

```typescript
import {
  createIndexedDBStorage,  // Default, persistent
  createOPFSStorage,       // File system, faster
  createMemoryStorage,     // In-memory, testing
} from 'pocket';

// Check availability
const opfs = createOPFSStorage();
if (opfs.isAvailable()) {
  // Use OPFS
}
```

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
    next: () => setPage(p => p + 1),
    prev: () => setPage(p => Math.max(0, p - 1)),
  };
}
```

### Debounced Search

```tsx
function useSearch<T>(collection: string, debounceMs = 300) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, debounceMs);

  const { data } = useLiveQuery<T>(
    collection,
    (c) => debouncedQuery
      ? c.find().where('title').contains(debouncedQuery)
      : c.find(),
    [debouncedQuery]
  );

  return { data, query, setQuery };
}
```

### Optimistic Toggle

```tsx
function TodoItem({ todo }) {
  const { mutate: toggle } = useMutation(
    (db, id: string) => db.collection('todos').update(id, {
      completed: !todo.completed
    })
  );

  return (
    <div onClick={() => toggle(todo._id)}>
      {todo.completed ? '✓' : '○'} {todo.title}
    </div>
  );
}
```
