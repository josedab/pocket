---
sidebar_position: 8
title: Expo Integration
description: Using Pocket in Expo and React Native apps
---

# Expo Integration

Pocket provides native support for Expo apps with optimized storage adapters for mobile. The `@pocket/expo` package includes SQLite storage via expo-sqlite and file system support.

## Installation

```bash
npx expo install @pocket/core @pocket/expo expo-sqlite
```

If you want React hooks:

```bash
npx expo install @pocket/react
```

## Quick Start

```typescript
// src/db.ts
import { Database } from '@pocket/core';
import { createExpoStorage } from '@pocket/expo';

export interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

export const db = await Database.create({
  name: 'my-app',
  storage: createExpoStorage(),
});
```

```tsx
// App.tsx
import { PocketProvider, useLiveQuery, useMutation } from '@pocket/react';
import { db, Todo } from './src/db';

export default function App() {
  return (
    <PocketProvider database={db}>
      <TodoList />
    </PocketProvider>
  );
}

function TodoList() {
  const { data: todos, isLoading } = useLiveQuery<Todo>('todos');

  const { mutate: addTodo } = useMutation(async (db, title: string) => {
    return db.collection('todos').insert({
      _id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: new Date(),
    });
  });

  if (isLoading) {
    return <ActivityIndicator />;
  }

  return (
    <View>
      <Button title="Add Todo" onPress={() => addTodo('New todo')} />
      <FlatList
        data={todos}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => <Text>{item.title}</Text>}
      />
    </View>
  );
}
```

## Storage Options

### SQLite (Recommended)

Uses expo-sqlite for persistent storage:

```typescript
import { createExpoStorage } from '@pocket/expo';

const storage = createExpoStorage({
  // Database file name (stored in app's documents directory)
  filename: 'myapp.db',
  // Enable WAL mode for better performance (default: true)
  useWAL: true,
});
```

### Async Storage

For simpler use cases or when SQLite isn't available:

```typescript
import { createExpoAsyncStorage } from '@pocket/expo';

const storage = createExpoAsyncStorage({
  // Key prefix for AsyncStorage
  prefix: 'pocket:',
});
```

### File System Storage

Store documents as JSON files:

```typescript
import { createExpoFileStorage } from '@pocket/expo';

const storage = createExpoFileStorage({
  // Directory within app's documents
  directory: 'pocket-data',
});
```

## Setup with Expo Router

```typescript
// app/_layout.tsx
import { Stack } from 'expo-router';
import { PocketProvider } from '@pocket/react';
import { useEffect, useState } from 'react';
import { initDatabase } from '../src/db';
import type { Database } from '@pocket/core';

export default function RootLayout() {
  const [db, setDb] = useState<Database | null>(null);

  useEffect(() => {
    initDatabase().then(setDb);
  }, []);

  if (!db) {
    return null; // Or a loading screen
  }

  return (
    <PocketProvider database={db}>
      <Stack />
    </PocketProvider>
  );
}
```

```typescript
// src/db.ts
import { Database } from '@pocket/core';
import { createExpoStorage } from '@pocket/expo';

let db: Database | null = null;

export async function initDatabase(): Promise<Database> {
  if (db) return db;

  db = await Database.create({
    name: 'my-app',
    storage: createExpoStorage(),
  });

  return db;
}

export function getDatabase(): Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}
```

## Hooks Usage

### useLiveQuery

Subscribe to reactive queries:

```tsx
import { useLiveQuery } from '@pocket/react';
import { FlatList, Text, View } from 'react-native';

function TodoList() {
  const { data: todos, isLoading, error } = useLiveQuery<Todo>(
    'todos',
    (collection) => collection
      .find()
      .where('completed').equals(false)
      .sort('createdAt', 'desc'),
    []
  );

  if (isLoading) return <ActivityIndicator />;
  if (error) return <Text>Error: {error.message}</Text>;

  return (
    <FlatList
      data={todos}
      keyExtractor={(item) => item._id}
      renderItem={({ item }) => (
        <View>
          <Text>{item.title}</Text>
        </View>
      )}
    />
  );
}
```

### useMutation

Execute write operations with loading states:

```tsx
import { useMutation } from '@pocket/react';
import { Button, TextInput, View } from 'react-native';
import { useState } from 'react';

function AddTodo() {
  const [title, setTitle] = useState('');

  const { mutate, isLoading } = useMutation(async (db, title: string) => {
    return db.collection('todos').insert({
      _id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: new Date(),
    });
  });

  const handleAdd = async () => {
    if (title.trim()) {
      await mutate(title);
      setTitle('');
    }
  };

  return (
    <View>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Enter todo title"
      />
      <Button
        title={isLoading ? 'Adding...' : 'Add Todo'}
        onPress={handleAdd}
        disabled={isLoading}
      />
    </View>
  );
}
```

### useDocument

Fetch a single document:

```tsx
import { useDocument } from '@pocket/react';

function TodoDetail({ id }: { id: string }) {
  const { data: todo, isLoading } = useDocument<Todo>('todos', id);

  if (isLoading) return <ActivityIndicator />;
  if (!todo) return <Text>Not found</Text>;

  return (
    <View>
      <Text style={styles.title}>{todo.title}</Text>
      <Text>Status: {todo.completed ? 'Done' : 'Pending'}</Text>
    </View>
  );
}
```

## Offline-First Patterns

### Network-Aware Sync

```tsx
import { useEffect } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { SyncEngine } from '@pocket/sync';
import { getDatabase } from './db';

function useSyncWithNetwork() {
  useEffect(() => {
    const db = getDatabase();
    const sync = new SyncEngine({
      database: db,
      serverUrl: 'wss://your-server.com/sync',
    });

    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        sync.start();
      } else {
        sync.pause();
      }
    });

    return () => {
      unsubscribe();
      sync.stop();
    };
  }, []);
}
```

### Sync Status UI

```tsx
import { useSyncStatus } from '@pocket/react';
import { View, Text, StyleSheet } from 'react-native';

function SyncIndicator() {
  const { status, stats } = useSyncStatus();

  return (
    <View style={styles.container}>
      {status === 'syncing' && <Text style={styles.syncing}>Syncing...</Text>}
      {status === 'error' && <Text style={styles.error}>Sync Error</Text>}
      {status === 'offline' && <Text style={styles.offline}>Offline</Text>}
      {status === 'synced' && <Text style={styles.synced}>Synced</Text>}
      {stats.pendingChanges > 0 && (
        <Text>{stats.pendingChanges} pending changes</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 8 },
  syncing: { color: 'blue' },
  error: { color: 'red' },
  offline: { color: 'gray' },
  synced: { color: 'green' },
});
```

## Performance Optimization

### 1. Use FlatList with Proper Keys

```tsx
<FlatList
  data={todos}
  keyExtractor={(item) => item._id}
  renderItem={renderTodo}
  // Optimize rendering
  removeClippedSubviews={true}
  maxToRenderPerBatch={10}
  windowSize={5}
/>
```

### 2. Memoize List Items

```tsx
import { memo } from 'react';

const TodoItem = memo(function TodoItem({ todo, onToggle }) {
  return (
    <TouchableOpacity onPress={() => onToggle(todo._id)}>
      <Text>{todo.title}</Text>
    </TouchableOpacity>
  );
});
```

### 3. Limit Query Results

```tsx
const { data: recentTodos } = useLiveQuery<Todo>(
  'todos',
  (c) => c.find().sort('createdAt', 'desc').limit(50),
  []
);
```

### 4. Create Indexes

```typescript
// During database setup
await db.collection('todos').createIndex({
  fields: ['completed', 'createdAt'],
});
```

### 5. Debounce Live Queries

```tsx
const { data: todos } = useLiveQuery<Todo>(
  'todos',
  (c) => c.find(),
  [],
  { debounceMs: 100 }
);
```

## Testing

### Mock Database for Tests

```typescript
// __tests__/setup.ts
import { Database } from '@pocket/core';
import { createMemoryStorage } from '@pocket/core';

export async function createTestDatabase(): Promise<Database> {
  return Database.create({
    name: 'test-db',
    storage: createMemoryStorage(),
  });
}
```

### Testing Components

```tsx
// __tests__/TodoList.test.tsx
import { render, waitFor } from '@testing-library/react-native';
import { PocketProvider } from '@pocket/react';
import { createTestDatabase } from './setup';
import { TodoList } from '../src/components/TodoList';

test('renders todos', async () => {
  const db = await createTestDatabase();
  await db.collection('todos').insert({
    _id: '1',
    title: 'Test todo',
    completed: false,
    createdAt: new Date(),
  });

  const { getByText } = render(
    <PocketProvider database={db}>
      <TodoList />
    </PocketProvider>
  );

  await waitFor(() => {
    expect(getByText('Test todo')).toBeTruthy();
  });
});
```

## Expo EAS Build

Pocket works with both Expo Go (with limitations) and custom dev clients.

### expo-sqlite Requirements

For full SQLite support, you need a custom dev client:

```bash
# Create development build
npx expo prebuild
npx expo run:ios
# or
npx expo run:android
```

### EAS Build Configuration

```json
// eas.json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "production": {
      "autoIncrement": true
    }
  }
}
```

## Migration from AsyncStorage

If migrating from raw AsyncStorage:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDatabase } from './db';

async function migrateFromAsyncStorage() {
  const db = getDatabase();

  // Check if migration is needed
  const migrated = await AsyncStorage.getItem('pocket:migrated');
  if (migrated) return;

  // Get old data
  const oldTodos = await AsyncStorage.getItem('todos');
  if (oldTodos) {
    const todos = JSON.parse(oldTodos);

    // Import to Pocket
    for (const todo of todos) {
      await db.collection('todos').insert({
        _id: todo.id || crypto.randomUUID(),
        ...todo,
      });
    }
  }

  // Mark migration complete
  await AsyncStorage.setItem('pocket:migrated', 'true');
}
```

## Next Steps

- [React Native Guide](/docs/guides/react-native) - Additional React Native patterns
- [Sync Setup](/docs/guides/sync-setup) - Add cloud synchronization
- [Offline-First App](/docs/guides/offline-first-app) - Build offline-capable apps
