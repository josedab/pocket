---
sidebar_position: 2
title: Building an Offline-First App
description: Step-by-step guide to building an app that works offline
---

# Building an Offline-First App

This guide walks through building a complete offline-first todo application with Pocket and React.

## What We're Building

A todo app that:
- Works completely offline
- Persists data in the browser
- Syncs when online (optional)
- Has a responsive, instant UI

## Project Setup

### 1. Create the Project

```bash
npm create vite@latest pocket-todos -- --template react-ts
cd pocket-todos
npm install pocket
```

### 2. Project Structure

```
src/
├── components/
│   ├── TodoList.tsx
│   ├── TodoItem.tsx
│   ├── AddTodo.tsx
│   └── FilterBar.tsx
├── db/
│   ├── index.ts
│   └── types.ts
├── App.tsx
└── main.tsx
```

## Database Setup

### Define Types

```typescript
// src/db/types.ts
export interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
}

export type TodoFilter = 'all' | 'active' | 'completed';
```

### Initialize Database

```typescript
// src/db/index.ts
import { Database, createIndexedDBStorage } from 'pocket';
import type { Todo } from './types';

let dbInstance: Database | null = null;

export async function getDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;

  dbInstance = await Database.create({
    name: 'pocket-todos',
    storage: createIndexedDBStorage(),
    collections: [
      {
        name: 'todos',
        indexes: [
          { fields: ['completed'] },
          { fields: ['createdAt'] },
        ],
      },
    ],
  });

  return dbInstance;
}

export function getTodosCollection(db: Database) {
  return db.collection<Todo>('todos');
}
```

## App Entry Point

```tsx
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { PocketProvider } from 'pocket/react';
import { getDatabase } from './db';
import App from './App';
import './index.css';

async function main() {
  const db = await getDatabase();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PocketProvider database={db}>
        <App />
      </PocketProvider>
    </React.StrictMode>
  );
}

main();
```

## Components

### App Component

```tsx
// src/App.tsx
import { useState } from 'react';
import { AddTodo } from './components/AddTodo';
import { FilterBar } from './components/FilterBar';
import { TodoList } from './components/TodoList';
import type { TodoFilter } from './db/types';

export default function App() {
  const [filter, setFilter] = useState<TodoFilter>('all');

  return (
    <div className="app">
      <header>
        <h1>Pocket Todos</h1>
        <p className="offline-indicator">Works offline!</p>
      </header>

      <main>
        <AddTodo />
        <FilterBar filter={filter} onFilterChange={setFilter} />
        <TodoList filter={filter} />
      </main>
    </div>
  );
}
```

### AddTodo Component

```tsx
// src/components/AddTodo.tsx
import { useState, FormEvent } from 'react';
import { useMutation } from 'pocket/react';
import type { Todo } from '../db/types';

export function AddTodo() {
  const [title, setTitle] = useState('');

  const { mutate: addTodo, isLoading } = useMutation(
    async (db, newTitle: string) => {
      const todos = db.collection<Todo>('todos');
      return todos.insert({
        _id: crypto.randomUUID(),
        title: newTitle.trim(),
        completed: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    await addTodo(title);
    setTitle('');
  };

  return (
    <form onSubmit={handleSubmit} className="add-todo">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What needs to be done?"
        disabled={isLoading}
      />
      <button type="submit" disabled={isLoading || !title.trim()}>
        Add
      </button>
    </form>
  );
}
```

### FilterBar Component

```tsx
// src/components/FilterBar.tsx
import { useLiveQuery } from 'pocket/react';
import type { Todo, TodoFilter } from '../db/types';

interface FilterBarProps {
  filter: TodoFilter;
  onFilterChange: (filter: TodoFilter) => void;
}

export function FilterBar({ filter, onFilterChange }: FilterBarProps) {
  const { data: todos } = useLiveQuery<Todo>('todos');

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <div className="filter-bar">
      <span className="count">{activeCount} items left</span>

      <div className="filters">
        <button
          className={filter === 'all' ? 'active' : ''}
          onClick={() => onFilterChange('all')}
        >
          All ({todos.length})
        </button>
        <button
          className={filter === 'active' ? 'active' : ''}
          onClick={() => onFilterChange('active')}
        >
          Active ({activeCount})
        </button>
        <button
          className={filter === 'completed' ? 'active' : ''}
          onClick={() => onFilterChange('completed')}
        >
          Completed ({completedCount})
        </button>
      </div>
    </div>
  );
}
```

### TodoList Component

```tsx
// src/components/TodoList.tsx
import { useLiveQuery } from 'pocket/react';
import { TodoItem } from './TodoItem';
import type { Todo, TodoFilter } from '../db/types';

interface TodoListProps {
  filter: TodoFilter;
}

export function TodoList({ filter }: TodoListProps) {
  const { data: todos, isLoading } = useLiveQuery<Todo>(
    'todos',
    (collection) => {
      let query = collection.find();

      if (filter === 'active') {
        query = query.where('completed').equals(false);
      } else if (filter === 'completed') {
        query = query.where('completed').equals(true);
      }

      return query.sort('createdAt', 'desc');
    },
    [filter]
  );

  if (isLoading) {
    return <div className="loading">Loading todos...</div>;
  }

  if (todos.length === 0) {
    return (
      <div className="empty">
        {filter === 'all'
          ? 'No todos yet. Add one above!'
          : `No ${filter} todos.`}
      </div>
    );
  }

  return (
    <ul className="todo-list">
      {todos.map((todo) => (
        <TodoItem key={todo._id} todo={todo} />
      ))}
    </ul>
  );
}
```

### TodoItem Component

```tsx
// src/components/TodoItem.tsx
import { useState } from 'react';
import { useMutation } from 'pocket/react';
import type { Todo } from '../db/types';

interface TodoItemProps {
  todo: Todo;
}

export function TodoItem({ todo }: TodoItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(todo.title);

  const { mutate: toggleTodo } = useMutation(
    async (db, id: string) => {
      const todos = db.collection<Todo>('todos');
      const current = await todos.get(id);
      if (current) {
        await todos.update(id, {
          completed: !current.completed,
          updatedAt: Date.now(),
        });
      }
    }
  );

  const { mutate: updateTitle } = useMutation(
    async (db, params: { id: string; title: string }) => {
      const todos = db.collection<Todo>('todos');
      await todos.update(params.id, {
        title: params.title,
        updatedAt: Date.now(),
      });
    }
  );

  const { mutate: deleteTodo } = useMutation(
    async (db, id: string) => {
      const todos = db.collection<Todo>('todos');
      await todos.delete(id);
    }
  );

  const handleSave = () => {
    if (editTitle.trim() && editTitle !== todo.title) {
      updateTitle({ id: todo._id, title: editTitle.trim() });
    }
    setIsEditing(false);
  };

  return (
    <li className={`todo-item ${todo.completed ? 'completed' : ''}`}>
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={() => toggleTodo(todo._id)}
      />

      {isEditing ? (
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          autoFocus
        />
      ) : (
        <span onDoubleClick={() => setIsEditing(true)}>{todo.title}</span>
      )}

      <button onClick={() => deleteTodo(todo._id)} className="delete">
        Delete
      </button>
    </li>
  );
}
```

## Styling

```css
/* src/index.css */
* {
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  margin: 0;
  padding: 20px;
  background: #f5f5f5;
}

.app {
  max-width: 500px;
  margin: 0 auto;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

header {
  background: #4f46e5;
  color: white;
  padding: 20px;
  text-align: center;
}

header h1 {
  margin: 0;
}

.offline-indicator {
  margin: 5px 0 0;
  font-size: 0.875rem;
  opacity: 0.8;
}

main {
  padding: 20px;
}

.add-todo {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.add-todo input {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

.add-todo button {
  padding: 10px 20px;
  background: #4f46e5;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.add-todo button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  font-size: 0.875rem;
}

.filters {
  display: flex;
  gap: 5px;
}

.filters button {
  padding: 5px 10px;
  background: none;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
}

.filters button.active {
  background: #4f46e5;
  color: white;
  border-color: #4f46e5;
}

.todo-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.todo-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-bottom: 1px solid #eee;
}

.todo-item.completed span {
  text-decoration: line-through;
  opacity: 0.5;
}

.todo-item span {
  flex: 1;
}

.todo-item input[type="text"] {
  flex: 1;
  padding: 5px;
  border: 1px solid #4f46e5;
  border-radius: 4px;
}

.todo-item .delete {
  padding: 5px 10px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
}

.todo-item:hover .delete {
  opacity: 1;
}

.loading,
.empty {
  text-align: center;
  padding: 40px;
  color: #666;
}
```

## Testing Offline

1. **Build the app**: `npm run build`
2. **Serve it**: `npm run preview`
3. **Open DevTools** → Network tab
4. **Set to Offline**
5. **Test**: Add, complete, and delete todos
6. **Refresh**: Data persists!

## Adding PWA Support (Optional)

Make it installable and fully offline:

```bash
npm install vite-plugin-pwa
```

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Pocket Todos',
        short_name: 'Todos',
        theme_color: '#4f46e5',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
});
```

## Adding Sync (Optional)

To sync todos across devices, add the sync engine:

```typescript
// src/db/index.ts
import { createSyncEngine } from 'pocket/sync';

export async function setupSync(db: Database, authToken: string) {
  const sync = createSyncEngine(db, {
    serverUrl: 'wss://your-server.com/sync',
    authToken,
    collections: ['todos'],
  });

  await sync.start();
  return sync;
}
```

See [Sync Setup Guide](/docs/guides/sync-setup) for full details.

## Next Steps

- [Sync Setup](/docs/guides/sync-setup) - Add multi-device sync
- [Schema Validation](/docs/guides/schema-validation) - Validate todo data
- [Indexing](/docs/guides/indexing) - Optimize for large todo lists
