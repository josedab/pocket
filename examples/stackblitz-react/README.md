# Pocket React Example

A simple todo app demonstrating Pocket database with React.

## Features

- Local-first data storage with Pocket
- Live queries with automatic UI updates
- Simple CRUD operations with `useMutation`
- Type-safe document definitions

## Quick Start

```bash
npm install
npm run dev
```

## Open in StackBlitz

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/pocket-db/pocket/tree/main/examples/stackblitz-react)

## Key Concepts

### Database Setup

```typescript
import { createDatabase } from '@pocket-db/core';
import { createMemoryStorage } from '@pocket-db/storage-memory';

const db = await createDatabase({
  name: 'todo-db',
  storage: createMemoryStorage(),
});
```

### Live Queries

```typescript
import { useLiveQuery } from '@pocket-db/react';

const { data: todos, isLoading } = useLiveQuery<Todo>(
  'todos',
  (collection) => collection.find().sort([{ field: 'createdAt', direction: 'desc' }])
);
```

### Mutations

```typescript
import { useMutation } from '@pocket-db/react';

const { insert, update, remove } = useMutation<Todo>('todos');

// Insert
insert({ text: 'New todo', completed: false, createdAt: Date.now() });

// Update
update(todoId, { completed: true });

// Delete
remove(todoId);
```

## Learn More

- [Pocket Documentation](https://pocket-db.github.io/pocket/)
- [GitHub Repository](https://github.com/pocket-db/pocket)
