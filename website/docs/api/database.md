---
sidebar_position: 1
title: Database API
description: Database class API reference
---

# Database API

The `Database` class is the main entry point for Pocket. It manages collections and storage.

## Creating a Database

### Database.create()

Creates and initializes a new database instance.

```typescript
import { Database, createIndexedDBStorage } from 'pocket';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  version: 1,
  nodeId: 'client-123',
  collections: [
    { name: 'todos', sync: true },
  ],
});
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Unique database identifier |
| `storage` | `StorageAdapter` | Yes | Storage backend to use |
| `version` | `number` | No | Schema version (default: 1) |
| `nodeId` | `string` | No | Unique client ID for sync (auto-generated if not provided) |
| `collections` | `CollectionConfig[]` | No | Pre-configured collections |

#### Returns

`Promise<Database>` - The initialized database instance.

#### Example

```typescript
const db = await Database.create({
  name: 'todo-app',
  storage: createIndexedDBStorage(),
  collections: [
    {
      name: 'todos',
      sync: true,
      indexes: [{ fields: ['completed'] }],
      schema: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          completed: { type: 'boolean', default: false },
        },
      },
    },
  ],
});
```

---

## Properties

### name

```typescript
readonly name: string
```

The database name.

### version

```typescript
readonly version: number
```

The database schema version.

### nodeId

```typescript
readonly nodeId: string
```

Unique identifier for this client, used in sync operations.

### isOpen

```typescript
get isOpen(): boolean
```

Whether the database is open and ready for operations.

---

## Methods

### collection()

Gets or creates a collection.

```typescript
collection<T extends Document>(name: string): Collection<T>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Collection name |

#### Returns

`Collection<T>` - The collection instance.

#### Example

```typescript
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
}

const todos = db.collection<Todo>('todos');
```

---

### hasCollection()

Checks if a collection exists.

```typescript
hasCollection(name: string): boolean
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Collection name to check |

#### Returns

`boolean` - True if the collection exists.

#### Example

```typescript
if (db.hasCollection('todos')) {
  console.log('Todos collection exists');
}
```

---

### listCollections()

Lists all collection names in the database.

```typescript
listCollections(): Promise<string[]>
```

#### Returns

`Promise<string[]>` - Array of collection names.

#### Example

```typescript
const collections = await db.listCollections();
console.log('Collections:', collections);
// ['todos', 'users', 'settings']
```

---

### deleteCollection()

Deletes a collection and all its data.

```typescript
deleteCollection(name: string): Promise<void>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Collection name to delete |

#### Example

```typescript
await db.deleteCollection('old-data');
```

:::warning
This permanently deletes all documents in the collection.
:::

---

### transaction()

Executes a function within a transaction.

```typescript
transaction<R>(
  collectionNames: string[],
  mode: 'readonly' | 'readwrite',
  fn: () => Promise<R>
): Promise<R>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `collectionNames` | `string[]` | Collections to include in transaction |
| `mode` | `'readonly' \| 'readwrite'` | Transaction mode |
| `fn` | `() => Promise<R>` | Function to execute |

#### Returns

`Promise<R>` - Result of the function.

#### Example

```typescript
await db.transaction(['todos', 'users'], 'readwrite', async () => {
  await todos.insert({ _id: '1', title: 'Task', completed: false });
  await users.update('user-1', { todoCount: 1 });
});
```

---

### getStats()

Gets database statistics.

```typescript
getStats(): Promise<DatabaseStats>
```

#### Returns

```typescript
interface DatabaseStats {
  databaseName: string;
  databaseVersion: number;
  collectionCount: number;
  documentCount: number;
  storageSize: number;
  storeCount: number;
  indexCount: number;
}
```

#### Example

```typescript
const stats = await db.getStats();
console.log('Total documents:', stats.documentCount);
console.log('Storage used:', stats.storageSize, 'bytes');
```

---

### close()

Closes the database connection.

```typescript
close(): Promise<void>
```

#### Example

```typescript
// When shutting down
await db.close();
```

:::note
After closing, the database cannot be used. Create a new instance if needed.
:::

---

## Helper Function

### createDatabase()

Convenience function that wraps `Database.create()`.

```typescript
import { createDatabase, createIndexedDBStorage } from 'pocket';

const db = await createDatabase({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});
```

---

## Types

### DatabaseOptions

```typescript
interface DatabaseOptions {
  name: string;
  storage: StorageAdapter;
  version?: number;
  nodeId?: string;
  collections?: CollectionConfig[];
}
```

### CollectionConfig

```typescript
interface CollectionConfig<T = Document> {
  name: string;
  sync?: boolean;
  indexes?: IndexDefinition[];
  schema?: SchemaDefinition;
}
```

### DatabaseStats

```typescript
interface DatabaseStats {
  databaseName: string;
  databaseVersion: number;
  collectionCount: number;
  documentCount: number;
  storageSize: number;
  storeCount: number;
  indexCount: number;
}
```

---

## See Also

- [Collection API](/docs/api/collection) - Working with collections
- [Storage Backends](/docs/concepts/storage-backends) - Available storage options
- [Database Model](/docs/concepts/database-model) - Understanding the data model
