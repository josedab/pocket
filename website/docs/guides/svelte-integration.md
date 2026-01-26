---
sidebar_position: 3
title: Svelte Integration
description: Using Pocket with Svelte stores for reactive data
---

# Svelte Integration

Pocket provides first-class Svelte support with stores that integrate seamlessly with Svelte's reactivity system.

## Installation

```bash
npm install @pocket/svelte @pocket/core
```

## Setup

### 1. Create Your Database

```typescript
// src/lib/db.ts
import { Database, createIndexedDBStorage } from '@pocket/core';

export interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

export const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});
```

### 2. Set the Context

In your root component, set the Pocket context:

```svelte
<!-- src/App.svelte -->
<script>
  import { setPocketContext } from '@pocket/svelte';
  import { db } from './lib/db';
  import TodoList from './TodoList.svelte';

  setPocketContext(db);
</script>

<TodoList />
```

## Stores

### createLiveQuery

Create a live-updating query store:

```svelte
<script>
  import { createLiveQuery } from '@pocket/svelte';

  const todos = createLiveQuery('todos', (collection) =>
    collection.find().where('completed').equals(false)
  );
</script>

{#if $todos.isLoading}
  <p>Loading...</p>
{:else if $todos.error}
  <p>Error: {$todos.error.message}</p>
{:else}
  <ul>
    {#each $todos.data as todo (todo._id)}
      <li>{todo.title}</li>
    {/each}
  </ul>
{/if}
```

#### Parameters

```typescript
createLiveQuery<T>(
  collectionName: string,
  queryFn?: (collection: Collection<T>) => QueryBuilder<T>,
  options?: CreateLiveQueryOptions
): LiveQueryStore<T>
```

| Parameter | Description |
|-----------|-------------|
| `collectionName` | Name of the collection to query |
| `queryFn` | Function that builds the query (optional) |
| `options` | Additional options |

#### Options

```typescript
interface CreateLiveQueryOptions {
  enabled?: boolean;        // Enable/disable query (default: true)
  debounceMs?: number;      // Debounce updates (default: 0)
}
```

#### Store Value

```typescript
interface LiveQueryStore<T> {
  data: T[];           // Query results
  isLoading: boolean;  // True during initial load
  error: Error | null; // Any error that occurred
}
```

### createQuery

For non-live queries with simple filtering:

```svelte
<script>
  import { createQuery } from '@pocket/svelte';

  const completedTodos = createQuery('todos', { completed: true });
</script>

<ul>
  {#each $completedTodos.data as todo (todo._id)}
    <li>{todo.title}</li>
  {/each}
</ul>
```

### createMutation

Create a mutation store for write operations:

```svelte
<script>
  import { createMutation } from '@pocket/svelte';

  const mutation = createMutation('todos');

  async function addTodo(title) {
    await mutation.insert({
      _id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: new Date(),
    });
  }

  async function toggleTodo(id, completed) {
    await mutation.update(id, { completed: !completed });
  }

  async function deleteTodo(id) {
    await mutation.remove(id);
  }
</script>

<button on:click={() => addTodo('New todo')} disabled={$mutation.isLoading}>
  {$mutation.isLoading ? 'Adding...' : 'Add Todo'}
</button>
```

### createDocument

Create a store for a single document:

```svelte
<script>
  import { createDocument } from '@pocket/svelte';

  export let id;

  $: todoStore = createDocument('todos', id);
</script>

{#if $todoStore.isLoading}
  <p>Loading...</p>
{:else if !$todoStore.data}
  <p>Not found</p>
{:else}
  <h2>{$todoStore.data.title}</h2>
  <p>Status: {$todoStore.data.completed ? 'Done' : 'Pending'}</p>
{/if}
```

### createFindOne

Find the first document matching a query:

```svelte
<script>
  import { createFindOne } from '@pocket/svelte';

  const activeUser = createFindOne('users', (c) =>
    c.find().where('status').equals('active')
  );
</script>

{#if $activeUser.data}
  <p>Welcome, {$activeUser.data.name}!</p>
{/if}
```

### createSyncStatus

Monitor sync status when using the sync engine:

```svelte
<script>
  import { createSyncStatus } from '@pocket/svelte';

  const syncStatus = createSyncStatus();
</script>

<div class="sync-indicator">
  {#if $syncStatus.syncing}
    <span>Syncing...</span>
  {:else if !$syncStatus.connected}
    <span>Offline</span>
  {:else}
    <span>Synced</span>
  {/if}
  <small>Last sync: {$syncStatus.stats.lastSyncAt}</small>
</div>
```

### createOnlineStatus

Track browser online/offline status:

```svelte
<script>
  import { createOnlineStatus } from '@pocket/svelte';

  const isOnline = createOnlineStatus();
</script>

<span class:online={$isOnline} class:offline={!$isOnline}>
  {$isOnline ? 'Online' : 'Offline'}
</span>
```

### getDatabase / getCollection

Get direct access to database or collection:

```svelte
<script>
  import { getDatabase, getCollection } from '@pocket/svelte';

  const db = getDatabase();
  const todos = getCollection('todos');

  async function exportData() {
    const allTodos = await $todos?.getAll();
    console.log(allTodos);
  }
</script>
```

## Reactive Stores

### createReactiveQuery

For more control, use reactive stores that take Svelte stores as parameters:

```svelte
<script>
  import { writable } from 'svelte/store';
  import { createReactiveQuery } from '@pocket/svelte';

  const showCompleted = writable(false);
  const searchTerm = writable('');

  const todos = createReactiveQuery(
    'todos',
    [showCompleted, searchTerm],
    (collection, [$showCompleted, $searchTerm]) => {
      let query = collection.find();

      if (!$showCompleted) {
        query = query.where('completed').equals(false);
      }

      if ($searchTerm) {
        query = query.where('title').contains($searchTerm);
      }

      return query;
    }
  );
</script>

<input bind:value={$searchTerm} placeholder="Search..." />
<label>
  <input type="checkbox" bind:checked={$showCompleted} />
  Show completed
</label>

<ul>
  {#each $todos.data as todo (todo._id)}
    <li>{todo.title}</li>
  {/each}
</ul>
```

### createReactiveDocument

Reactive document store that updates when the ID changes:

```svelte
<script>
  import { writable } from 'svelte/store';
  import { createReactiveDocument } from '@pocket/svelte';

  const selectedId = writable(null);
  const selectedTodo = createReactiveDocument('todos', selectedId);
</script>

{#if $selectedTodo.data}
  <TodoDetail todo={$selectedTodo.data} />
{/if}
```

## Patterns

### Pagination

```svelte
<script>
  import { writable } from 'svelte/store';
  import { createReactiveQuery } from '@pocket/svelte';

  const page = writable(0);
  const pageSize = 10;

  const todos = createReactiveQuery(
    'todos',
    [page],
    (c, [$page]) => c.find()
      .sort('createdAt', 'desc')
      .skip($page * pageSize)
      .limit(pageSize)
  );
</script>

<ul>
  {#each $todos.data as todo (todo._id)}
    <li>{todo.title}</li>
  {/each}
</ul>

<div class="pagination">
  <button on:click={() => $page--} disabled={$page === 0}>Previous</button>
  <span>Page {$page + 1}</span>
  <button on:click={() => $page++}>Next</button>
</div>
```

### Optimistic Updates

Mutations are already optimistic - the local database updates immediately:

```svelte
<script>
  import { createLiveQuery, createMutation } from '@pocket/svelte';

  const todos = createLiveQuery('todos');
  const mutation = createMutation('todos');

  function toggleTodo(todo) {
    // UI updates instantly, no loading state needed
    mutation.update(todo._id, { completed: !todo.completed });
  }
</script>

{#each $todos.data as todo (todo._id)}
  <div class="todo-item" on:click={() => toggleTodo(todo)}>
    <span>{todo.completed ? '✓' : '○'}</span>
    <span>{todo.title}</span>
  </div>
{/each}
```

### Derived Stores

Combine Pocket stores with Svelte's derived stores:

```svelte
<script>
  import { derived } from 'svelte/store';
  import { createLiveQuery } from '@pocket/svelte';

  const todos = createLiveQuery('todos');

  const stats = derived(todos, ($todos) => ({
    total: $todos.data.length,
    completed: $todos.data.filter(t => t.completed).length,
    pending: $todos.data.filter(t => !t.completed).length,
  }));
</script>

<div class="stats">
  <span>Total: {$stats.total}</span>
  <span>Completed: {$stats.completed}</span>
  <span>Pending: {$stats.pending}</span>
</div>
```

## TypeScript

All stores are fully typed:

```typescript
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
}

// $todos.data is Todo[]
const todos = createLiveQuery<Todo>('todos');

// TypeScript enforces the document shape
const mutation = createMutation<Todo>('todos');
mutation.insert({ title: 'Test', completed: false }); // OK
mutation.insert({ name: 'Test' }); // Error: 'name' doesn't exist
```

## Complete Example

```svelte
<!-- TodoApp.svelte -->
<script lang="ts">
  import { createLiveQuery, createMutation } from '@pocket/svelte';

  interface Todo {
    _id: string;
    title: string;
    completed: boolean;
    createdAt: Date;
  }

  let newTodoTitle = '';

  const todos = createLiveQuery<Todo>('todos', (c) =>
    c.find().sort('createdAt', 'desc')
  );

  const mutation = createMutation<Todo>('todos');

  async function addTodo() {
    if (!newTodoTitle.trim()) return;

    await mutation.insert({
      _id: crypto.randomUUID(),
      title: newTodoTitle,
      completed: false,
      createdAt: new Date(),
    });

    newTodoTitle = '';
  }
</script>

<div class="todo-app">
  <h1>Todos</h1>

  <form on:submit|preventDefault={addTodo}>
    <input bind:value={newTodoTitle} placeholder="What needs to be done?" />
    <button type="submit">Add</button>
  </form>

  {#if $todos.isLoading}
    <p>Loading...</p>
  {:else}
    <ul>
      {#each $todos.data as todo (todo._id)}
        <li>
          <input
            type="checkbox"
            checked={todo.completed}
            on:change={() => mutation.update(todo._id, { completed: !todo.completed })}
          />
          <span class:completed={todo.completed}>{todo.title}</span>
          <button on:click={() => mutation.remove(todo._id)}>Delete</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .completed {
    text-decoration: line-through;
    opacity: 0.6;
  }
</style>
```

## SvelteKit

For SvelteKit, initialize the database in a layout:

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { browser } from '$app/environment';
  import { setPocketContext } from '@pocket/svelte';
  import { onMount } from 'svelte';

  let ready = false;

  onMount(async () => {
    if (browser) {
      const { Database, createIndexedDBStorage } = await import('@pocket/core');
      const db = await Database.create({
        name: 'my-app',
        storage: createIndexedDBStorage(),
      });
      setPocketContext(db);
      ready = true;
    }
  });
</script>

{#if ready}
  <slot />
{:else}
  <p>Loading...</p>
{/if}
```

## Next Steps

- [Sync Setup](/docs/guides/sync-setup) - Add server synchronization
- [Schema Validation](/docs/guides/schema-validation) - Validate your data
- [Offline-First App](/docs/guides/offline-first-app) - Build a complete offline app
