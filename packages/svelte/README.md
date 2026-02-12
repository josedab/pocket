# @pocket/svelte

[![npm](https://img.shields.io/npm/v/@pocket/svelte.svg)](https://www.npmjs.com/package/@pocket/svelte)

Svelte stores and utilities for Pocket — reactive queries, mutations, and sync status for local-first apps.

## Installation

```bash
npm install @pocket/svelte @pocket/core
```

**Peer dependency:** `svelte` >= 4.0.0

## Quick Start

### Context Setup

```svelte
<script>
  import { setPocketContext } from '@pocket/svelte';
  import { Database } from '@pocket/core';

  const db = await Database.create({ name: 'my-app', storage });
  setPocketContext({ database: db });
</script>
```

### Using Stores

```svelte
<script>
  import { createLiveQuery, createMutation, createSyncStatus } from '@pocket/svelte';

  const todos = createLiveQuery('todos', {
    filter: { completed: false },
    sort: { field: 'createdAt', direction: 'desc' }
  });

  const { mutate } = createMutation('todos');
  const sync = createSyncStatus();
</script>

{#each $todos.data as todo}
  <p>{todo.title}</p>
{/each}
```

### Single Document

```svelte
<script>
  import { createDocument } from '@pocket/svelte';

  const todo = createDocument('todos', todoId);
</script>
```

## API

| Export | Description |
|--------|-------------|
| `setPocketContext(config)` | Set Pocket context for the component tree |
| `getPocketContext()` | Retrieve the Pocket context |
| `getDatabase()` | Access the database instance |
| `getCollection(name)` | Access a collection |
| `createLiveQuery(collection, opts?)` | Reactive live query store |
| `createQuery(collection, opts?)` | One-time reactive query store |
| `createDocument(collection, id)` | Reactive single document store |
| `createFindOne(collection, filter)` | Reactive find-one store |
| `createMutation(collection)` | Insert, update, and delete operations |
| `createOptimisticMutation(collection)` | Optimistic mutation with rollback |
| `createSyncStatus()` | Reactive sync state store |
| `createOnlineStatus()` | Reactive online/offline store |

## Documentation

- [Full Documentation](https://pocket.dev/docs)
- [API Reference](https://pocket.dev/docs/api/svelte)

## License

MIT
