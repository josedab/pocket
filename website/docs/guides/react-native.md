---
sidebar_position: 10
title: React Native
description: Use Pocket in React Native apps with native storage adapters
---

# React Native

Pocket provides first-class React Native support with native storage adapters optimized for mobile performance.

## Overview

The `@pocket/react-native` package provides:
- **Native storage adapters** for AsyncStorage and MMKV
- **React hooks** designed for React Native
- **App state awareness** for background/foreground handling
- **Network state integration** for online/offline detection
- **Automatic sync triggers** when coming online

## Installation

```bash
npm install @pocket/core @pocket/react-native
```

### Storage Backend (Choose One)

**AsyncStorage** (recommended for most apps):
```bash
npm install @react-native-async-storage/async-storage
```

**MMKV** (for high-performance needs):
```bash
npm install react-native-mmkv
```

### iOS Setup

```bash
cd ios && pod install
```

## Quick Start

### 1. Create Storage Adapter

Choose the storage adapter that fits your needs:

#### AsyncStorage Adapter

```typescript
import { Database } from '@pocket/core';
import { createAsyncStorageDocumentStore } from '@pocket/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Create storage factory
function createStorage(collectionName: string) {
  return createAsyncStorageDocumentStore(collectionName, AsyncStorage, 'my-app');
}

// Create database
const db = await Database.create({
  name: 'my-app',
  storage: { createStore: createStorage },
});
```

#### MMKV Adapter

MMKV is significantly faster than AsyncStorage (synchronous operations):

```typescript
import { Database } from '@pocket/core';
import { createMMKVDocumentStore } from '@pocket/react-native';
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV();

function createStorage(collectionName: string) {
  return createMMKVDocumentStore(collectionName, mmkv, 'my-app');
}

const db = await Database.create({
  name: 'my-app',
  storage: { createStore: createStorage },
});
```

### 2. Setup Provider

```tsx
import { PocketProvider } from '@pocket/react-native';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

function App() {
  const [database, setDatabase] = useState<Database | null>(null);

  useEffect(() => {
    initializeDatabase().then(setDatabase);
  }, []);

  if (!database) {
    return <LoadingScreen />;
  }

  return (
    <PocketProvider
      config={{
        name: 'my-app',
        storage: { type: 'async-storage', name: 'my-app' },
        sync: {
          serverUrl: 'wss://sync.example.com',
          syncOnActive: true,
        },
        persistOnBackground: true,
        debug: __DEV__,
      }}
      database={database}
      onAppStateChange={(callback) => {
        const subscription = AppState.addEventListener('change', callback);
        return () => subscription.remove();
      }}
      onNetworkChange={(callback) => {
        return NetInfo.addEventListener((state) => {
          callback({
            isConnected: state.isConnected,
            isInternetReachable: state.isInternetReachable,
            type: state.type,
          });
        });
      }}
    >
      <Navigation />
    </PocketProvider>
  );
}
```

### 3. Use Hooks

```tsx
import { useQuery, useMutation, useDocument } from '@pocket/react-native';

interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}

function TodoList() {
  const { data: todos, isLoading, error } = useQuery<Todo>('todos', {
    completed: false,
  }, {
    sortBy: 'createdAt',
    sortDirection: 'desc',
  });

  const { insert } = useMutation<Todo>('todos');

  const addTodo = async (title: string) => {
    await insert({
      title,
      completed: false,
      createdAt: Date.now(),
    });
  };

  if (isLoading) return <ActivityIndicator />;
  if (error) return <Text>Error: {error.message}</Text>;

  return (
    <FlatList
      data={todos}
      renderItem={({ item }) => <TodoItem todo={item} />}
      keyExtractor={(item) => item._id}
    />
  );
}
```

## Storage Adapters

### AsyncStorage Adapter

Best for most React Native apps. Uses `@react-native-async-storage/async-storage`.

**Features:**
- Async key-value storage
- Persistent across app restarts
- In-memory caching for fast reads
- Supports query operators ($eq, $gt, $lt, $in, etc.)

```typescript
import { createAsyncStorageDocumentStore } from '@pocket/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const store = createAsyncStorageDocumentStore<Todo>(
  'todos',
  AsyncStorage,
  'my-app' // database name prefix
);
```

**How it works:**
- Documents are stored as JSON strings with key format: `{dbName}:{collection}:{id}`
- An in-memory cache is maintained for fast reads
- Cache is lazily populated on first access
- Changes emit events for reactive updates

### MMKV Adapter

Best for high-performance apps with frequent reads/writes.

**Features:**
- Synchronous operations (much faster than AsyncStorage)
- Native C++ implementation
- Optional encryption
- Maintains document ID index for efficient queries

```typescript
import { createMMKVDocumentStore } from '@pocket/react-native';
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV({
  id: 'my-app-storage',
  encryptionKey: 'optional-encryption-key',
});

const store = createMMKVDocumentStore<Todo>('todos', mmkv, 'my-app');
```

**Performance comparison:**

| Operation | AsyncStorage | MMKV |
|-----------|-------------|------|
| Read | ~5ms | ~0.1ms |
| Write | ~10ms | ~0.2ms |
| Bulk read (100) | ~50ms | ~2ms |
| Bulk write (100) | ~100ms | ~5ms |

## React Hooks

### usePocket

Access the Pocket context:

```tsx
import { usePocket } from '@pocket/react-native';

function MyComponent() {
  const {
    database,      // Database instance
    isReady,       // Database initialization complete
    isSyncing,     // Currently syncing
    isOnline,      // Network available
    appState,      // 'active' | 'background' | 'inactive'
    lastSyncAt,    // Last sync timestamp
    syncError,     // Last sync error
    sync,          // Manual sync function
    collection,    // Get collection by name
  } = usePocket();

  return <Text>Status: {isOnline ? 'Online' : 'Offline'}</Text>;
}
```

### useDocument

Fetch and observe a single document:

```tsx
import { useDocument } from '@pocket/react-native';

function TodoDetail({ id }: { id: string }) {
  const {
    data,       // Document or null
    isLoading,  // Loading state
    error,      // Error if any
    refetch,    // Manual refetch
    update,     // Update document
    remove,     // Delete document
  } = useDocument<Todo>('todos', id);

  if (isLoading) return <ActivityIndicator />;
  if (!data) return <Text>Not found</Text>;

  const toggleComplete = () => {
    update({ completed: !data.completed });
  };

  return (
    <View>
      <Text>{data.title}</Text>
      <Switch value={data.completed} onValueChange={toggleComplete} />
      <Button title="Delete" onPress={remove} />
    </View>
  );
}
```

### useQuery

Query documents with filters and options:

```tsx
import { useQuery } from '@pocket/react-native';

function CompletedTodos() {
  const {
    data,       // Array of documents
    isLoading,  // Loading state
    error,      // Error if any
    count,      // Total count
    refetch,    // Manual refetch
    isEmpty,    // No results
  } = useQuery<Todo>('todos', { completed: true }, {
    sortBy: 'createdAt',
    sortDirection: 'desc',
    limit: 20,
    skip: 0,
  });

  return (
    <FlatList
      data={data}
      renderItem={({ item }) => <Text>{item.title}</Text>}
      ListEmptyComponent={<Text>No completed todos</Text>}
    />
  );
}
```

### useMutation

Insert, update, and delete documents:

```tsx
import { useMutation } from '@pocket/react-native';

function AddTodo() {
  const [title, setTitle] = useState('');
  const { insert, isMutating, error } = useMutation<Todo>('todos');

  const handleSubmit = async () => {
    try {
      await insert({
        title,
        completed: false,
        createdAt: Date.now(),
      });
      setTitle('');
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  return (
    <View>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="New todo..."
      />
      <Button
        title={isMutating ? 'Adding...' : 'Add'}
        onPress={handleSubmit}
        disabled={isMutating || !title}
      />
    </View>
  );
}
```

### useAll

Get all documents in a collection:

```tsx
import { useAll } from '@pocket/react-native';

function AllTodos() {
  const { data, isLoading, error } = useAll<Todo>('todos');

  return (
    <FlatList
      data={data}
      renderItem={({ item }) => <Text>{item.title}</Text>}
    />
  );
}
```

### useCount

Count documents:

```tsx
import { useCount } from '@pocket/react-native';

function TodoStats() {
  const { count: total } = useCount<Todo>('todos');
  const { count: completed } = useCount<Todo>('todos', { completed: true });
  const { count: pending } = useCount<Todo>('todos', { completed: false });

  return (
    <View>
      <Text>Total: {total}</Text>
      <Text>Completed: {completed}</Text>
      <Text>Pending: {pending}</Text>
    </View>
  );
}
```

### useCollection

Get a collection reference:

```tsx
import { useCollection } from '@pocket/react-native';

function CustomQuery() {
  const collection = useCollection<Todo>('todos');
  const [results, setResults] = useState<Todo[]>([]);

  useEffect(() => {
    if (!collection) return;

    collection
      .find({ completed: false })
      .sort('createdAt', 'desc')
      .limit(5)
      .exec()
      .then(setResults);
  }, [collection]);

  return <Text>{results.length} recent todos</Text>;
}
```

### Sync Status Hooks

```tsx
import {
  usePocketReady,
  usePocketSync,
  usePocketOnline,
  usePocketAppState,
} from '@pocket/react-native';

function SyncStatus() {
  const isReady = usePocketReady();
  const { isSyncing, lastSyncAt, syncError, sync } = usePocketSync();
  const isOnline = usePocketOnline();
  const appState = usePocketAppState();

  return (
    <View>
      <Text>Ready: {isReady ? 'Yes' : 'No'}</Text>
      <Text>Online: {isOnline ? 'Yes' : 'No'}</Text>
      <Text>Syncing: {isSyncing ? 'Yes' : 'No'}</Text>
      <Text>App State: {appState}</Text>
      {lastSyncAt && (
        <Text>Last sync: {new Date(lastSyncAt).toLocaleTimeString()}</Text>
      )}
      {syncError && <Text style={{ color: 'red' }}>{syncError.message}</Text>}
      <Button title="Sync Now" onPress={sync} disabled={isSyncing || !isOnline} />
    </View>
  );
}
```

## App State Handling

Pocket automatically handles app state changes:

```tsx
<PocketProvider
  config={{
    name: 'my-app',
    storage: { type: 'async-storage', name: 'my-app' },
    sync: {
      serverUrl: 'wss://sync.example.com',
      syncOnActive: true,  // Sync when app becomes active
    },
    persistOnBackground: true,  // Persist on background
    debug: true,
  }}
  database={database}
  onAppStateChange={(callback) => {
    const subscription = AppState.addEventListener('change', callback);
    return () => subscription.remove();
  }}
>
  {children}
</PocketProvider>
```

### App State Values

| State | Description |
|-------|-------------|
| `active` | App is in foreground |
| `background` | App is in background |
| `inactive` | Transitioning (iOS only) |
| `unknown` | Unknown state |
| `extension` | Running in extension |

## Network Handling

Integrate network state for automatic online/offline handling:

```tsx
import NetInfo from '@react-native-community/netinfo';

<PocketProvider
  config={config}
  database={database}
  onNetworkChange={(callback) => {
    return NetInfo.addEventListener((state) => {
      callback({
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        type: state.type,
      });
    });
  }}
>
  {children}
</PocketProvider>
```

### Offline-First Pattern

```tsx
function TodoApp() {
  const { isOnline, isSyncing } = usePocket();
  const { data: todos, isLoading } = useQuery<Todo>('todos');
  const { insert } = useMutation<Todo>('todos');

  // Works offline - data stored locally
  const addTodo = async (title: string) => {
    await insert({
      title,
      completed: false,
      createdAt: Date.now(),
    });
    // Will sync automatically when online
  };

  return (
    <View>
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text>You're offline. Changes will sync when connected.</Text>
        </View>
      )}
      {isSyncing && <ActivityIndicator />}
      <TodoList todos={todos} />
      <AddTodoForm onAdd={addTodo} />
    </View>
  );
}
```

## Complete Example

```tsx
// App.tsx
import React, { useEffect, useState } from 'react';
import { AppState, View, Text, FlatList, ActivityIndicator } from 'react-native';
import { Database } from '@pocket/core';
import {
  PocketProvider,
  createAsyncStorageDocumentStore,
  useQuery,
  useMutation,
  usePocket,
} from '@pocket/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}

// Initialize database
async function initDatabase(): Promise<Database> {
  return Database.create({
    name: 'todos-app',
    storage: {
      createStore: (name) =>
        createAsyncStorageDocumentStore(name, AsyncStorage, 'todos-app'),
    },
  });
}

// Main App
export default function App() {
  const [database, setDatabase] = useState<Database | null>(null);

  useEffect(() => {
    initDatabase().then(setDatabase);
  }, []);

  if (!database) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <PocketProvider
      config={{
        name: 'todos-app',
        storage: { type: 'async-storage', name: 'todos-app' },
        debug: __DEV__,
      }}
      database={database}
      onAppStateChange={(callback) => {
        const sub = AppState.addEventListener('change', callback);
        return () => sub.remove();
      }}
      onNetworkChange={(callback) => {
        return NetInfo.addEventListener((state) => {
          callback({
            isConnected: state.isConnected,
            isInternetReachable: state.isInternetReachable,
            type: state.type,
          });
        });
      }}
    >
      <TodoScreen />
    </PocketProvider>
  );
}

// Todo Screen
function TodoScreen() {
  const { isOnline, isReady } = usePocket();
  const { data: todos, isLoading } = useQuery<Todo>('todos', undefined, {
    sortBy: 'createdAt',
    sortDirection: 'desc',
  });
  const { insert, update, remove } = useMutation<Todo>('todos');

  if (!isReady || isLoading) {
    return <ActivityIndicator />;
  }

  return (
    <View style={{ flex: 1 }}>
      {!isOnline && (
        <View style={{ padding: 10, backgroundColor: '#ffcc00' }}>
          <Text>Offline mode</Text>
        </View>
      )}
      <FlatList
        data={todos}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <TodoItem
            todo={item}
            onToggle={() => update(item._id, { completed: !item.completed })}
            onDelete={() => remove(item._id)}
          />
        )}
      />
    </View>
  );
}

function TodoItem({
  todo,
  onToggle,
  onDelete,
}: {
  todo: Todo;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', padding: 15, borderBottomWidth: 1 }}>
      <Text
        style={{
          flex: 1,
          textDecorationLine: todo.completed ? 'line-through' : 'none',
        }}
        onPress={onToggle}
      >
        {todo.title}
      </Text>
      <Text onPress={onDelete}>Delete</Text>
    </View>
  );
}
```

## Best Practices

### 1. Choose the Right Storage

- **AsyncStorage**: Good for most apps, simple setup
- **MMKV**: Better for frequent reads/writes, large datasets

### 2. Handle Loading States

Always show loading indicators while data is being fetched:

```tsx
function TodoList() {
  const { data, isLoading, error } = useQuery<Todo>('todos');

  if (isLoading) return <ActivityIndicator />;
  if (error) return <ErrorView error={error} />;
  if (data.length === 0) return <EmptyState />;

  return <FlatList data={data} /* ... */ />;
}
```

### 3. Optimize List Rendering

Use `keyExtractor` and `getItemLayout` for better performance:

```tsx
<FlatList
  data={todos}
  keyExtractor={(item) => item._id}
  getItemLayout={(_, index) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  })}
  renderItem={renderItem}
/>
```

### 4. Debounce Frequent Updates

For search or frequent input:

```tsx
import { useDebouncedCallback } from 'use-debounce';

function SearchTodos() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState({});

  const debouncedSetFilter = useDebouncedCallback((q: string) => {
    setFilter(q ? { title: { $regex: q } } : {});
  }, 300);

  const { data } = useQuery<Todo>('todos', filter);

  return (
    <View>
      <TextInput
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          debouncedSetFilter(text);
        }}
      />
      <FlatList data={data} /* ... */ />
    </View>
  );
}
```

### 5. Handle Errors Gracefully

```tsx
function TodoApp() {
  const { syncError, sync } = usePocketSync();

  useEffect(() => {
    if (syncError) {
      Alert.alert(
        'Sync Error',
        syncError.message,
        [{ text: 'Retry', onPress: sync }, { text: 'OK' }]
      );
    }
  }, [syncError]);

  return <TodoList />;
}
```

## See Also

- [React Integration](/docs/guides/react-integration) - Web React hooks
- [Offline-First App](/docs/guides/offline-first-app) - Offline patterns
- [Sync Setup](/docs/guides/sync-setup) - Multi-device sync
