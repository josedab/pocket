---
sidebar_position: 9
title: Tauri Integration
description: Using Pocket in Tauri desktop applications
---

# Tauri Integration

Pocket integrates seamlessly with Tauri for building lightweight, secure desktop applications. The `@pocket/tauri` package provides SQLite storage via the Tauri SQL plugin.

## Installation

### 1. Add Tauri Plugin

```bash
cargo add tauri-plugin-sql
```

Or in `src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
```

### 2. Install JavaScript Packages

```bash
npm install @pocket/core @pocket/tauri
```

For React apps:

```bash
npm install @pocket/react
```

## Setup

### 1. Initialize Plugin in Rust

```rust
// src-tauri/src/main.rs
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 2. Configure Permissions

```json
// src-tauri/capabilities/default.json
{
  "identifier": "default",
  "permissions": [
    "sql:default",
    "sql:allow-execute",
    "sql:allow-select"
  ]
}
```

### 3. Create Database

```typescript
// src/db.ts
import { Database } from '@pocket/core';
import { createTauriStorage } from '@pocket/tauri';

export interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

export const db = await Database.create({
  name: 'my-app',
  storage: createTauriStorage({
    // Database file path (relative to app data directory)
    path: 'pocket.db',
  }),
});
```

## React Integration

```tsx
// src/App.tsx
import { PocketProvider, useLiveQuery, useMutation } from '@pocket/react';
import { db, Todo } from './db';

function App() {
  return (
    <PocketProvider database={db}>
      <TodoList />
    </PocketProvider>
  );
}

function TodoList() {
  const { data: todos, isLoading } = useLiveQuery<Todo>('todos', (c) =>
    c.find().where('completed').equals(false)
  );

  const { mutate: addTodo } = useMutation(async (db, title: string) => {
    return db.collection('todos').insert({
      _id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: new Date(),
    });
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <button onClick={() => addTodo('New todo')}>Add Todo</button>
      <ul>
        {todos.map((todo) => (
          <li key={todo._id}>{todo.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

## Storage Configuration

### SQLite Options

```typescript
import { createTauriStorage } from '@pocket/tauri';

const storage = createTauriStorage({
  // Database file name
  path: 'data.db',

  // Enable WAL mode for better concurrent performance
  walMode: true,

  // Custom journal mode
  journalMode: 'WAL', // 'DELETE' | 'TRUNCATE' | 'PERSIST' | 'MEMORY' | 'WAL' | 'OFF'

  // Synchronous mode
  synchronous: 'NORMAL', // 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA'
});
```

### Database Location

By default, the database is stored in the app's data directory:

- **Windows**: `C:\Users\<user>\AppData\Roaming\<app>\`
- **macOS**: `~/Library/Application Support/<app>/`
- **Linux**: `~/.local/share/<app>/`

To use a custom path:

```typescript
import { createTauriStorage } from '@pocket/tauri';
import { appDataDir, join } from '@tauri-apps/api/path';

const dataDir = await appDataDir();
const dbPath = await join(dataDir, 'databases', 'myapp.db');

const storage = createTauriStorage({
  path: dbPath,
  absolutePath: true,
});
```

## Vue Integration

```vue
<!-- src/App.vue -->
<script setup lang="ts">
import { providePocket, useLiveQuery, useMutation } from '@pocket/vue';
import { db } from './db';
import type { Todo } from './db';

providePocket(db);

const { data: todos, isLoading } = useLiveQuery<Todo>('todos', (c) =>
  c.find().where('completed').equals(false)
);

const { mutate: addTodo, isLoading: isAdding } = useMutation(
  async (db, title: string) => {
    return db.collection('todos').insert({
      _id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: new Date(),
    });
  }
);
</script>

<template>
  <div>
    <button @click="addTodo('New todo')" :disabled="isAdding">
      Add Todo
    </button>
    <div v-if="isLoading">Loading...</div>
    <ul v-else>
      <li v-for="todo in todos" :key="todo._id">
        {{ todo.title }}
      </li>
    </ul>
  </div>
</template>
```

## Svelte Integration

```svelte
<!-- src/App.svelte -->
<script lang="ts">
import { setPocket, liveQuery, mutation } from '@pocket/svelte';
import { db } from './db';
import type { Todo } from './db';

setPocket(db);

const todos = liveQuery<Todo>('todos', (c) =>
  c.find().where('completed').equals(false)
);

const addTodo = mutation(async (db, title: string) => {
  return db.collection('todos').insert({
    _id: crypto.randomUUID(),
    title,
    completed: false,
    createdAt: new Date(),
  });
});
</script>

<button on:click={() => $addTodo.mutate('New todo')}>
  Add Todo
</button>

{#if $todos.isLoading}
  <p>Loading...</p>
{:else}
  <ul>
    {#each $todos.data as todo (todo._id)}
      <li>{todo.title}</li>
    {/each}
  </ul>
{/if}
```

## Tauri Commands for Advanced Operations

### Custom Rust Commands

```rust
// src-tauri/src/main.rs
use tauri::State;
use std::sync::Mutex;

struct AppState {
    // Your app state
}

#[tauri::command]
async fn export_database(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    // Export logic
    Ok(())
}

#[tauri::command]
async fn import_database(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    // Import logic
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            export_database,
            import_database,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Calling from JavaScript

```typescript
import { invoke } from '@tauri-apps/api/core';

async function exportData(path: string) {
  await invoke('export_database', { path });
}

async function importData(path: string) {
  await invoke('import_database', { path });
}
```

## Sync with Remote Server

```typescript
// src/db.ts
import { Database } from '@pocket/core';
import { createTauriStorage } from '@pocket/tauri';
import { SyncEngine } from '@pocket/sync';

export async function initDatabase() {
  const db = await Database.create({
    name: 'my-app',
    storage: createTauriStorage({ path: 'pocket.db' }),
  });

  const sync = new SyncEngine({
    database: db,
    serverUrl: 'wss://your-server.com/sync',
    authToken: await getAuthToken(),
  });

  // Start sync when online
  sync.start();

  return { db, sync };
}
```

## File Dialogs for Import/Export

```typescript
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';

async function exportToFile(db: Database) {
  const path = await save({
    filters: [{ name: 'JSON', extensions: ['json'] }],
    defaultPath: 'pocket-backup.json',
  });

  if (path) {
    const data = await db.export();
    await writeTextFile(path, JSON.stringify(data, null, 2));
  }
}

async function importFromFile(db: Database) {
  const path = await open({
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });

  if (path) {
    const content = await readTextFile(path);
    const data = JSON.parse(content);
    await db.import(data);
  }
}
```

## Window Management with Database

```typescript
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getDatabase } from './db';

// Save window state before close
const appWindow = getCurrentWindow();

appWindow.onCloseRequested(async () => {
  const db = getDatabase();

  // Save window position/size
  const position = await appWindow.innerPosition();
  const size = await appWindow.innerSize();

  await db.collection('settings').upsert({
    _id: 'window',
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  });
});
```

## Security Best Practices

### 1. Enable Strict CSP

```json
// src-tauri/tauri.conf.json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self'"
    }
  }
}
```

### 2. Minimize Permissions

Only request permissions you need:

```json
// src-tauri/capabilities/default.json
{
  "identifier": "default",
  "permissions": [
    "sql:allow-execute",
    "sql:allow-select"
    // Don't add "sql:allow-*" unless necessary
  ]
}
```

### 3. Encrypt Sensitive Data

```typescript
import { createTauriStorage } from '@pocket/tauri';
import { withEncryption } from '@pocket/encryption';

const storage = withEncryption(
  createTauriStorage({ path: 'encrypted.db' }),
  {
    key: await getEncryptionKey(),
    algorithm: 'aes-256-gcm',
  }
);
```

## Performance Tips

### 1. Use WAL Mode

```typescript
createTauriStorage({
  path: 'data.db',
  walMode: true,
});
```

### 2. Create Indexes

```typescript
await db.collection('todos').createIndex({
  fields: ['completed', 'createdAt'],
});
```

### 3. Batch Operations

```typescript
// Bulk insert for better performance
await db.collection('todos').bulkInsert(todos);
```

### 4. Limit Query Results

```typescript
const { data } = useLiveQuery<Todo>(
  'todos',
  (c) => c.find().sort('createdAt', 'desc').limit(100),
  []
);
```

## Comparison: Tauri vs Electron

| Feature | Tauri + Pocket | Electron + Pocket |
|---------|----------------|-------------------|
| Bundle size | ~5MB | ~150MB+ |
| Memory usage | Low | Higher |
| SQLite | Via Rust plugin | Via better-sqlite3 |
| Security | Rust backend | Node.js backend |
| Cross-platform | Yes | Yes |
| Auto-updates | Built-in | electron-updater |

## Next Steps

- [Sync Setup](/docs/guides/sync-setup) - Add cloud synchronization
- [Encryption](/docs/guides/encryption) - Encrypt local data
- [DevTools](/docs/guides/devtools) - Debug your database
