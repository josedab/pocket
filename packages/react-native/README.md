# @pocket/react-native

React Native integration for Pocket - hooks and storage adapters optimized for mobile.

## Installation

```bash
npm install @pocket/react-native @pocket/core
```

For MMKV storage (recommended):
```bash
npm install react-native-mmkv
cd ios && pod install
```

## Quick Start

```tsx
import { PocketProvider, useQuery, useMutation } from '@pocket/react-native';
import { createMMKVDocumentStore } from '@pocket/react-native';
import { MMKV } from 'react-native-mmkv';

// Setup storage
const mmkv = new MMKV();

function App() {
  return (
    <PocketProvider dbName="my-app" storage={mmkv}>
      <TodoApp />
    </PocketProvider>
  );
}

function TodoApp() {
  const { data: todos, isLoading } = useQuery<Todo>('todos');
  const { insert, remove } = useMutation<Todo>('todos');

  if (isLoading) return <ActivityIndicator />;

  return (
    <FlatList
      data={todos}
      renderItem={({ item }) => (
        <TodoItem todo={item} onDelete={() => remove(item._id)} />
      )}
    />
  );
}
```

## Storage Adapters

### MMKV (Recommended)

10x faster than AsyncStorage:

```typescript
import { MMKV } from 'react-native-mmkv';
import { createMMKVDocumentStore } from '@pocket/react-native';

const mmkv = new MMKV();
const store = createMMKVDocumentStore<Todo>('todos', mmkv);
```

### AsyncStorage

Standard React Native storage:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStorageDocumentStore } from '@pocket/react-native';

const store = createAsyncStorageDocumentStore<Todo>('todos', AsyncStorage);
```

### Performance Comparison

| Operation | AsyncStorage | MMKV |
|-----------|--------------|------|
| Write 100 | ~200ms | ~10ms |
| Read 100 | ~150ms | ~5ms |
| Clear | ~50ms | ~1ms |

## Hooks

### useQuery

Query with filtering and sorting:

```tsx
const { data, isLoading, isEmpty, refetch } = useQuery<Todo>(
  'todos',
  { completed: false },
  {
    sortBy: 'createdAt',
    sortDirection: 'desc',
    limit: 20
  }
);
```

### useDocument

Single document with updates:

```tsx
const { data: todo, update, remove } = useDocument<Todo>('todos', todoId);

// Update
await update({ completed: true });

// Delete
await remove();
```

### useMutation

Insert, update, delete operations:

```tsx
const { insert, update, remove, isMutating, error } = useMutation<Todo>('todos');

// Insert
const newTodo = await insert({ title: 'New todo' });

// Update
await update(newTodo._id, { completed: true });

// Delete
await remove(newTodo._id);
```

### useCount

Count documents:

```tsx
const { count, isLoading } = useCount<Todo>('todos', { completed: false });
```

### useAll

All documents in collection:

```tsx
const { data: todos, isLoading } = useAll<Todo>('todos');
```

## Example: Todo App

```tsx
function TodoScreen() {
  const { data: todos, isLoading } = useQuery<Todo>(
    'todos',
    { completed: false },
    { sortBy: 'createdAt', sortDirection: 'desc' }
  );
  const { insert, remove } = useMutation<Todo>('todos');
  const [title, setTitle] = useState('');

  const addTodo = async () => {
    if (!title.trim()) return;
    await insert({ title, completed: false, createdAt: Date.now() });
    setTitle('');
  };

  if (isLoading) {
    return <ActivityIndicator size="large" />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inputContainer}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Add todo..."
          style={styles.input}
        />
        <Button title="Add" onPress={addTodo} />
      </View>

      <FlatList
        data={todos}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <TouchableOpacity onLongPress={() => remove(item._id)}>
            <Text style={styles.todoText}>{item.title}</Text>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}
```

## Documentation

- [React Native Guide](https://pocket.dev/docs/react-native)
- [Storage Adapters](https://pocket.dev/docs/react-native/storage)
- [Expo Integration](https://pocket.dev/docs/react-native/expo)

## License

MIT
