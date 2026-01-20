# Database

The `Database` class is the main entry point for Pocket. It manages collections, storage, and provides the foundation for all data operations.

## Creating a Database

Use the static `create` method to initialize a new database:

```typescript
import { Database } from '@pocket/core';
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | Required | Unique database name |
| `storage` | `StorageAdapter` | Required | Storage backend to use |
| `version` | `number` | `1` | Schema version for migrations |
| `nodeId` | `string` | Auto-generated | Unique client ID for sync |
| `collections` | `CollectionConfig[]` | `[]` | Pre-configure collections |

### Pre-configuring Collections

You can define collections with schemas and indexes at database creation:

```typescript
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  collections: [
    {
      name: 'todos',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          completed: { type: 'boolean', default: false },
          priority: { type: 'number', default: 0 },
        },
        required: ['title'],
      },
      indexes: [
        { fields: ['completed'] },
        { fields: ['priority'] },
      ],
    },
  ],
});
```

## Working with Collections

### Get or Create a Collection

```typescript
// Get a typed collection
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
}

const todos = db.collection<Todo>('todos');
```

### Check if Collection Exists

```typescript
if (db.hasCollection('todos')) {
  console.log('Collection exists');
}
```

### List All Collections

```typescript
const collections = await db.listCollections();
// ['todos', 'users', 'settings']
```

### Delete a Collection

```typescript
await db.deleteCollection('old-collection');
```

## Transactions

Execute multiple operations atomically:

```typescript
await db.transaction(['todos', 'users'], 'readwrite', async () => {
  const todos = db.collection('todos');
  const users = db.collection('users');

  await todos.insert({ _id: '1', title: 'Task', completed: false });
  await users.update('user-1', { taskCount: 1 });
});
```

## Database Statistics

Get information about storage usage:

```typescript
const stats = await db.getStats();

console.log(stats);
// {
//   databaseName: 'my-app',
//   databaseVersion: 1,
//   collectionCount: 3,
//   documentCount: 150,
//   storageSize: 102400,
//   storeCount: 3,
//   indexCount: 5,
// }
```

## Lifecycle

### Check if Open

```typescript
if (db.isOpen) {
  // Database is ready
}
```

### Close the Database

Always close the database when done:

```typescript
await db.close();
```

## Best Practices

1. **Single Instance**: Create one database instance per app and share it
2. **Close on Exit**: Close the database when your app terminates
3. **Pre-configure Collections**: Define schemas upfront for validation and type safety
4. **Use TypeScript**: Leverage generics for type-safe collections

## Next Steps

- [Collections](./collections.md) - Learn about collection operations
- [Documents](./documents.md) - Working with documents
- [Queries](./queries.md) - Querying data
