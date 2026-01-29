---
sidebar_position: 7
title: Electron Integration
description: Using Pocket in Electron desktop applications
---

# Electron Integration

Pocket works seamlessly with Electron for building desktop applications with local-first data persistence. The `@pocket/electron` package provides optimized storage and IPC helpers.

## Installation

```bash
npm install @pocket/core @pocket/electron
```

If using React in your renderer:

```bash
npm install @pocket/react
```

## Architecture Options

Electron apps can run Pocket in different processes:

| Approach | Pros | Cons |
|----------|------|------|
| **Main Process** | Full Node.js access, single source of truth | IPC overhead for renderer queries |
| **Renderer Process** | Direct access, simpler code | Limited to browser APIs |
| **Hybrid** | Best of both worlds | More complex setup |

We recommend the **Main Process** approach for most applications.

## Main Process Setup

### 1. Create the Database in Main

```typescript
// src/main/database.ts
import { Database } from '@pocket/core';
import { createElectronStorage } from '@pocket/electron';
import { app } from 'electron';
import path from 'path';

export interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

let db: Database | null = null;

export async function initDatabase(): Promise<Database> {
  if (db) return db;

  const userDataPath = app.getPath('userData');

  db = await Database.create({
    name: 'my-app',
    storage: createElectronStorage({
      path: path.join(userDataPath, 'pocket.db'),
      // Use better-sqlite3 for optimal performance
      driver: 'better-sqlite3',
    }),
  });

  return db;
}

export function getDatabase(): Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}
```

### 2. Set Up IPC Handlers

```typescript
// src/main/ipc.ts
import { ipcMain } from 'electron';
import { getDatabase } from './database';

export function setupDatabaseIPC() {
  const db = getDatabase();

  // Query handler
  ipcMain.handle('pocket:query', async (_, collection: string, query?: object) => {
    const col = db.collection(collection);
    let builder = col.find();

    if (query?.filter) {
      for (const [key, value] of Object.entries(query.filter)) {
        builder = builder.where(key).equals(value);
      }
    }
    if (query?.sort) {
      builder = builder.sort(query.sort.field, query.sort.direction);
    }
    if (query?.limit) {
      builder = builder.limit(query.limit);
    }
    if (query?.skip) {
      builder = builder.skip(query.skip);
    }

    return builder.exec();
  });

  // Get single document
  ipcMain.handle('pocket:get', async (_, collection: string, id: string) => {
    return db.collection(collection).get(id);
  });

  // Insert handler
  ipcMain.handle('pocket:insert', async (_, collection: string, doc: object) => {
    return db.collection(collection).insert(doc);
  });

  // Update handler
  ipcMain.handle('pocket:update', async (_, collection: string, id: string, changes: object) => {
    return db.collection(collection).update(id, changes);
  });

  // Delete handler
  ipcMain.handle('pocket:delete', async (_, collection: string, id: string) => {
    return db.collection(collection).delete(id);
  });

  // Live query subscription
  ipcMain.on('pocket:subscribe', (event, channel: string, collection: string, query?: object) => {
    const col = db.collection(collection);
    let builder = col.find();

    if (query?.filter) {
      for (const [key, value] of Object.entries(query.filter)) {
        builder = builder.where(key).equals(value);
      }
    }

    const subscription = builder.live().subscribe((results) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(channel, results);
      }
    });

    // Clean up on window close
    event.sender.once('destroyed', () => {
      subscription.unsubscribe();
    });
  });
}
```

### 3. Initialize in Main Entry

```typescript
// src/main/index.ts
import { app, BrowserWindow } from 'electron';
import { initDatabase } from './database';
import { setupDatabaseIPC } from './ipc';

async function createWindow() {
  // Initialize database before creating window
  await initDatabase();
  setupDatabaseIPC();

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
```

### 4. Create Preload Script

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pocket', {
  query: (collection: string, query?: object) =>
    ipcRenderer.invoke('pocket:query', collection, query),

  get: (collection: string, id: string) =>
    ipcRenderer.invoke('pocket:get', collection, id),

  insert: (collection: string, doc: object) =>
    ipcRenderer.invoke('pocket:insert', collection, doc),

  update: (collection: string, id: string, changes: object) =>
    ipcRenderer.invoke('pocket:update', collection, id, changes),

  delete: (collection: string, id: string) =>
    ipcRenderer.invoke('pocket:delete', collection, id),

  subscribe: (collection: string, query: object | undefined, callback: (data: unknown[]) => void) => {
    const channel = `pocket:data:${Date.now()}:${Math.random()}`;
    ipcRenderer.on(channel, (_, data) => callback(data));
    ipcRenderer.send('pocket:subscribe', channel, collection, query);

    return () => {
      ipcRenderer.removeAllListeners(channel);
    };
  },
});
```

### 5. Use in Renderer

```typescript
// src/renderer/types.ts
export interface PocketAPI {
  query: <T>(collection: string, query?: object) => Promise<T[]>;
  get: <T>(collection: string, id: string) => Promise<T | null>;
  insert: <T>(collection: string, doc: T) => Promise<T>;
  update: <T>(collection: string, id: string, changes: Partial<T>) => Promise<T>;
  delete: (collection: string, id: string) => Promise<void>;
  subscribe: <T>(collection: string, query: object | undefined, callback: (data: T[]) => void) => () => void;
}

declare global {
  interface Window {
    pocket: PocketAPI;
  }
}
```

```typescript
// src/renderer/App.tsx
import { useEffect, useState } from 'react';
import type { Todo } from '../main/database';

function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);

  useEffect(() => {
    // Subscribe to live updates
    const unsubscribe = window.pocket.subscribe<Todo>(
      'todos',
      { filter: { completed: false } },
      setTodos
    );

    return unsubscribe;
  }, []);

  const addTodo = async (title: string) => {
    await window.pocket.insert('todos', {
      _id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: new Date(),
    });
  };

  return (
    <div>
      <button onClick={() => addTodo('New todo')}>Add</button>
      <ul>
        {todos.map((todo) => (
          <li key={todo._id}>{todo.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

## Using the Electron Client

For a simpler API, use the provided client:

```typescript
// src/renderer/db.ts
import { createElectronClient } from '@pocket/electron/renderer';

export const db = createElectronClient();

// Use like a regular Pocket database
const todos = await db.collection('todos').find().exec();
await db.collection('todos').insert({ ... });
```

## React Integration

```tsx
// src/renderer/App.tsx
import { ElectronPocketProvider, useLiveQuery, useMutation } from '@pocket/electron/react';
import type { Todo } from '../main/database';

function App() {
  return (
    <ElectronPocketProvider>
      <TodoList />
    </ElectronPocketProvider>
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
      <button onClick={() => addTodo('New todo')}>Add</button>
      <ul>
        {todos.map((todo) => (
          <li key={todo._id}>{todo.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

## Storage Options

### SQLite (Recommended)

```typescript
import { createElectronStorage } from '@pocket/electron';

const storage = createElectronStorage({
  path: path.join(app.getPath('userData'), 'data.db'),
  driver: 'better-sqlite3',
  // Optional: WAL mode for better concurrent access
  walMode: true,
});
```

### IndexedDB (Renderer Only)

```typescript
import { createIndexedDBStorage } from '@pocket/core';

// Only works in renderer process
const storage = createIndexedDBStorage();
```

## File Locations

Electron provides standard paths for storing data:

```typescript
import { app } from 'electron';

// User data directory (recommended)
const userDataPath = app.getPath('userData');
// Windows: C:\Users\<user>\AppData\Roaming\<app>
// macOS: ~/Library/Application Support/<app>
// Linux: ~/.config/<app>

// Documents folder
const documentsPath = app.getPath('documents');

// Temporary files
const tempPath = app.getPath('temp');
```

## Sync with Remote Server

Enable sync in your Electron app:

```typescript
// src/main/database.ts
import { Database } from '@pocket/core';
import { createElectronStorage } from '@pocket/electron';
import { SyncEngine } from '@pocket/sync';

export async function initDatabase(): Promise<Database> {
  const db = await Database.create({
    name: 'my-app',
    storage: createElectronStorage({
      path: path.join(app.getPath('userData'), 'pocket.db'),
    }),
  });

  // Set up sync
  const sync = new SyncEngine({
    database: db,
    serverUrl: 'wss://your-server.com/sync',
    authToken: await getAuthToken(),
  });

  sync.start();

  return db;
}
```

## Auto-Updates with Data Migration

Handle database migrations during app updates:

```typescript
// src/main/database.ts
import { Database, Migration } from '@pocket/core';

const migrations: Migration[] = [
  {
    version: 1,
    up: async (db) => {
      // Initial schema
    },
  },
  {
    version: 2,
    up: async (db) => {
      // Add new field to existing documents
      const todos = await db.collection('todos').find().exec();
      for (const todo of todos) {
        await db.collection('todos').update(todo._id, {
          priority: 'medium',
        });
      }
    },
  },
];

export async function initDatabase(): Promise<Database> {
  const db = await Database.create({
    name: 'my-app',
    storage: createElectronStorage({ ... }),
    migrations,
  });

  return db;
}
```

## Performance Tips

### 1. Use WAL Mode

```typescript
createElectronStorage({
  path: dbPath,
  walMode: true, // Better concurrent read/write
});
```

### 2. Batch Operations

```typescript
// Instead of multiple individual inserts
for (const item of items) {
  await db.collection('items').insert(item);
}

// Use bulk operations
await db.collection('items').bulkInsert(items);
```

### 3. Index Frequently Queried Fields

```typescript
await db.collection('todos').createIndex({
  fields: ['completed', 'createdAt'],
});
```

### 4. Limit Live Query Scope

```typescript
// Limit results to reduce IPC overhead
builder.limit(100);
```

## Security Considerations

1. **Always use context isolation** (`contextIsolation: true`)
2. **Disable node integration in renderer** (`nodeIntegration: false`)
3. **Validate input in IPC handlers**
4. **Don't expose raw database operations** - create specific handlers
5. **Encrypt sensitive data** using `@pocket/encryption`

## Next Steps

- [Sync Setup](/docs/guides/sync-setup) - Add cloud synchronization
- [Encryption](/docs/guides/encryption) - Encrypt local data
- [DevTools](/docs/guides/devtools) - Debug your database
