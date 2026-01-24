---
sidebar_position: 2
title: Vue Integration
description: Using Pocket with Vue 3 composables for reactive data
---

# Vue Integration

Pocket provides first-class Vue 3 support with composables that integrate seamlessly with Vue's reactivity system.

## Installation

```bash
npm install @pocket/vue @pocket/core
```

## Setup

### 1. Create Your Database

```typescript
// src/db.ts
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

### 2. Provide the Database

You can provide Pocket to your app in two ways:

#### Option A: Using `providePocket` (Composition API)

```vue
<!-- App.vue -->
<script setup lang="ts">
import { providePocket } from '@pocket/vue';
import { db } from './db';

providePocket(db);
</script>

<template>
  <TodoList />
</template>
```

#### Option B: Using the Vue Plugin

```typescript
// main.ts
import { createApp } from 'vue';
import { createPocketPlugin } from '@pocket/vue';
import App from './App.vue';
import { db } from './db';

const app = createApp(App);
app.use(createPocketPlugin({ database: db }));
app.mount('#app');
```

## Composables

### useLiveQuery

Subscribe to live-updating query results:

```vue
<script setup lang="ts">
import { useLiveQuery } from '@pocket/vue';
import type { Todo } from './db';

const { data: todos, isLoading, error } = useLiveQuery<Todo>(
  'todos',
  (collection) => collection.find().where('completed').equals(false)
);
</script>

<template>
  <div v-if="isLoading">Loading...</div>
  <div v-else-if="error">Error: {{ error.message }}</div>
  <ul v-else>
    <li v-for="todo in todos" :key="todo._id">
      {{ todo.title }}
    </li>
  </ul>
</template>
```

#### Parameters

```typescript
useLiveQuery<T>(
  collectionName: string,
  queryFn?: (collection: Collection<T>) => QueryBuilder<T>,
  options?: UseLiveQueryOptions
): LiveQueryResult<T>
```

| Parameter | Description |
|-----------|-------------|
| `collectionName` | Name of the collection to query |
| `queryFn` | Function that builds the query (optional) |
| `options` | Additional options |

#### Options

```typescript
interface UseLiveQueryOptions {
  enabled?: boolean;        // Enable/disable query (default: true)
  debounceMs?: number;      // Debounce updates (default: 0)
}
```

#### Return Value

```typescript
interface LiveQueryResult<T> {
  data: Ref<T[]>;           // Reactive query results
  isLoading: Ref<boolean>;  // True during initial load
  error: Ref<Error | null>; // Any error that occurred
  refresh: () => void;      // Force refresh the query
}
```

### useQuery

For non-live queries with simple filtering:

```vue
<script setup lang="ts">
import { useQuery } from '@pocket/vue';

const { data: completedTodos } = useQuery<Todo>('todos', { completed: true });
</script>
```

### useMutation

Execute write operations with loading and error states:

```vue
<script setup lang="ts">
import { useMutation } from '@pocket/vue';
import type { Todo } from './db';

const { insert, update, remove, isLoading, error } = useMutation<Todo>('todos');

async function addTodo(title: string) {
  await insert({
    _id: crypto.randomUUID(),
    title,
    completed: false,
    createdAt: new Date(),
  });
}

async function toggleTodo(id: string, completed: boolean) {
  await update(id, { completed: !completed });
}

async function deleteTodo(id: string) {
  await remove(id);
}
</script>

<template>
  <button @click="addTodo('New todo')" :disabled="isLoading">
    {{ isLoading ? 'Adding...' : 'Add Todo' }}
  </button>
</template>
```

### useDocument

Fetch and subscribe to a single document:

```vue
<script setup lang="ts">
import { useDocument } from '@pocket/vue';
import type { Todo } from './db';

const props = defineProps<{ id: string }>();

const { data: todo, isLoading } = useDocument<Todo>('todos', () => props.id);
</script>

<template>
  <div v-if="isLoading">Loading...</div>
  <div v-else-if="!todo">Not found</div>
  <div v-else>
    <h2>{{ todo.title }}</h2>
    <p>Status: {{ todo.completed ? 'Done' : 'Pending' }}</p>
  </div>
</template>
```

### useFindOne

Find the first document matching a query:

```vue
<script setup lang="ts">
import { useFindOne } from '@pocket/vue';

const { data: activeUser } = useFindOne<User>(
  'users',
  (c) => c.find().where('status').equals('active')
);
</script>
```

### useSyncStatus

Monitor sync status when using the sync engine:

```vue
<script setup lang="ts">
import { useSyncStatus } from '@pocket/vue';

const { status, stats, isOnline, isSyncing } = useSyncStatus();
</script>

<template>
  <div class="sync-indicator">
    <span v-if="isSyncing">Syncing...</span>
    <span v-else-if="!isOnline">Offline</span>
    <span v-else>Synced</span>
    <small>Last sync: {{ stats.lastSyncAt }}</small>
  </div>
</template>
```

### useOnlineStatus

Track browser online/offline status:

```vue
<script setup lang="ts">
import { useOnlineStatus } from '@pocket/vue';

const isOnline = useOnlineStatus();
</script>

<template>
  <span :class="{ online: isOnline, offline: !isOnline }">
    {{ isOnline ? 'Online' : 'Offline' }}
  </span>
</template>
```

### useDatabase / useCollection

Get direct access to database or collection:

```vue
<script setup lang="ts">
import { useDatabase, useCollection } from '@pocket/vue';

const db = useDatabase();
const todos = useCollection<Todo>('todos');

async function exportData() {
  const allTodos = await todos.value?.getAll();
  console.log(allTodos);
}
</script>
```

## Patterns

### Reactive Query Parameters

Use `computed` or reactive refs as query parameters:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';
import { useLiveQuery } from '@pocket/vue';

const showCompleted = ref(false);
const searchTerm = ref('');

const { data: todos } = useLiveQuery<Todo>(
  'todos',
  (c) => {
    let query = c.find();

    if (!showCompleted.value) {
      query = query.where('completed').equals(false);
    }

    if (searchTerm.value) {
      query = query.where('title').contains(searchTerm.value);
    }

    return query;
  }
);
</script>

<template>
  <input v-model="searchTerm" placeholder="Search..." />
  <label>
    <input type="checkbox" v-model="showCompleted" />
    Show completed
  </label>
  <TodoList :todos="todos" />
</template>
```

### Pagination

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useLiveQuery } from '@pocket/vue';

const page = ref(0);
const pageSize = 10;

const { data: todos } = useLiveQuery<Todo>(
  'todos',
  (c) => c.find()
    .sort('createdAt', 'desc')
    .skip(page.value * pageSize)
    .limit(pageSize)
);
</script>

<template>
  <TodoList :todos="todos" />
  <div class="pagination">
    <button @click="page--" :disabled="page === 0">Previous</button>
    <span>Page {{ page + 1 }}</span>
    <button @click="page++">Next</button>
  </div>
</template>
```

### Optimistic Updates

Mutations are already optimistic - the local database updates immediately:

```vue
<script setup lang="ts">
import { useMutation, useLiveQuery } from '@pocket/vue';

const { data: todos } = useLiveQuery<Todo>('todos');
const { update } = useMutation<Todo>('todos');

function toggleTodo(todo: Todo) {
  // UI updates instantly, no loading state needed
  update(todo._id, { completed: !todo.completed });
}
</script>

<template>
  <div
    v-for="todo in todos"
    :key="todo._id"
    @click="toggleTodo(todo)"
    class="todo-item"
  >
    <span>{{ todo.completed ? '✓' : '○' }}</span>
    <span>{{ todo.title }}</span>
  </div>
</template>
```

## TypeScript

All composables are fully typed:

```typescript
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
}

// data is Ref<Todo[]>
const { data } = useLiveQuery<Todo>('todos');

// TypeScript enforces the document shape
const { insert } = useMutation<Todo>('todos');
insert({ title: 'Test', completed: false }); // OK
insert({ name: 'Test' }); // Error: 'name' doesn't exist
```

## Complete Example

```vue
<!-- TodoApp.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import { useLiveQuery, useMutation } from '@pocket/vue';

interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

const newTodoTitle = ref('');

const { data: todos, isLoading } = useLiveQuery<Todo>(
  'todos',
  (c) => c.find().sort('createdAt', 'desc')
);

const { insert, update, remove } = useMutation<Todo>('todos');

async function addTodo() {
  if (!newTodoTitle.value.trim()) return;

  await insert({
    _id: crypto.randomUUID(),
    title: newTodoTitle.value,
    completed: false,
    createdAt: new Date(),
  });

  newTodoTitle.value = '';
}
</script>

<template>
  <div class="todo-app">
    <h1>Todos</h1>

    <form @submit.prevent="addTodo">
      <input v-model="newTodoTitle" placeholder="What needs to be done?" />
      <button type="submit">Add</button>
    </form>

    <div v-if="isLoading">Loading...</div>

    <ul v-else>
      <li v-for="todo in todos" :key="todo._id">
        <input
          type="checkbox"
          :checked="todo.completed"
          @change="update(todo._id, { completed: !todo.completed })"
        />
        <span :class="{ completed: todo.completed }">{{ todo.title }}</span>
        <button @click="remove(todo._id)">Delete</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.completed {
  text-decoration: line-through;
  opacity: 0.6;
}
</style>
```

## Next Steps

- [Sync Setup](/docs/guides/sync-setup) - Add server synchronization
- [Schema Validation](/docs/guides/schema-validation) - Validate your data
- [Offline-First App](/docs/guides/offline-first-app) - Build a complete offline app
