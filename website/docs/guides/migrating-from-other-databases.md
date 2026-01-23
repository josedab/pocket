---
sidebar_position: 15
title: Migration Guides
description: Migrate from PouchDB, RxDB, LocalForage, and other databases to Pocket
---

# Migration Guides

This guide helps you migrate from popular local-first databases to Pocket. Each section covers concepts, API differences, and step-by-step migration strategies.

## Migrating from PouchDB

[PouchDB](https://pouchdb.com/) is a widely-used JavaScript database inspired by CouchDB. Here's how to migrate.

### Concept Mapping

| PouchDB | Pocket | Notes |
|---------|--------|-------|
| `new PouchDB('db')` | `Database.create({ name: 'db' })` | Database creation |
| `db.put(doc)` | `collection.insert(doc)` / `collection.upsert(doc)` | Insert/update |
| `db.get(id)` | `collection.get(id)` | Get by ID |
| `db.remove(doc)` | `collection.delete(id)` | Delete |
| `db.allDocs()` | `collection.find().exec()` | Get all |
| `db.query(view)` | `collection.find(filter).exec()` | Query |
| `db.changes()` | `collection.changes()` | Change feed |
| `db.sync(remote)` | `createSyncEngine(db, config)` | Sync |
| `_id`, `_rev` | `_id`, `_rev` | Same fields |
| Documents | Documents in collections | Pocket uses collections |

### Code Migration

**PouchDB:**
```javascript
import PouchDB from 'pouchdb';

const db = new PouchDB('todos');

// Insert
await db.put({ _id: 'todo-1', title: 'Buy milk', done: false });

// Get
const doc = await db.get('todo-1');

// Update
await db.put({ ...doc, done: true });

// Delete
await db.remove(doc);

// Query all
const result = await db.allDocs({ include_docs: true });
const todos = result.rows.map(row => row.doc);

// Sync
db.sync('https://server.com/db', { live: true, retry: true });
```

**Pocket:**
```typescript
import { Database, createIndexedDBStorage } from 'pocket';
import { createSyncEngine } from '@pocket/sync';

interface Todo {
  _id: string;
  title: string;
  done: boolean;
}

const db = await Database.create({
  name: 'todos',
  storage: createIndexedDBStorage(),
});

const todos = db.collection<Todo>('todos');

// Insert
await todos.insert({ title: 'Buy milk', done: false });

// Get
const doc = await todos.get('todo-1');

// Update
await todos.update('todo-1', { done: true });

// Delete
await todos.delete('todo-1');

// Query all
const allTodos = await todos.find().exec();

// Sync
const sync = createSyncEngine(db, {
  serverUrl: 'wss://server.com',
});
await sync.start();
```

### Data Migration Script

```typescript
import PouchDB from 'pouchdb';
import { Database, createIndexedDBStorage } from 'pocket';

async function migratePouchDBToPocket(
  pouchDbName: string,
  pocketDbName: string,
  collectionName: string
) {
  // Open PouchDB
  const pouchDb = new PouchDB(pouchDbName);

  // Create Pocket database
  const pocketDb = await Database.create({
    name: pocketDbName,
    storage: createIndexedDBStorage(),
  });

  const collection = pocketDb.collection(collectionName);

  // Get all documents from PouchDB
  const result = await pouchDb.allDocs({ include_docs: true });

  // Migrate each document
  for (const row of result.rows) {
    if (row.doc && !row.id.startsWith('_design/')) {
      const { _rev, ...doc } = row.doc;
      await collection.upsert(doc);
    }
  }

  console.log(`Migrated ${result.rows.length} documents`);

  // Optional: Close PouchDB and destroy
  await pouchDb.close();
  // await pouchDb.destroy(); // Uncomment to delete PouchDB after migration

  return pocketDb;
}
```

### Key Differences

1. **Collections**: Pocket organizes documents into typed collections; PouchDB stores all docs in one database
2. **Type Safety**: Pocket has full TypeScript support with generics
3. **Query Syntax**: Pocket uses a fluent query builder instead of MapReduce views
4. **Sync Protocol**: Different sync protocols - Pocket uses WebSocket-based sync

---

## Migrating from RxDB

[RxDB](https://rxdb.info/) is a reactive database for JavaScript applications. Pocket shares many concepts with RxDB.

### Concept Mapping

| RxDB | Pocket | Notes |
|------|--------|-------|
| `createRxDatabase()` | `Database.create()` | Database creation |
| Collections with schema | Typed collections | Both use collections |
| `collection.insert()` | `collection.insert()` | Same API |
| `collection.findOne()` | `collection.get()` | Find by ID |
| `collection.find().$` | `collection.find().$` | Reactive queries |
| `RxDocument` | Document | Document types |
| Schema (JSON Schema) | Schema (Zod) | Different validators |
| Plugins | Plugins | Similar plugin system |

### Code Migration

**RxDB:**
```typescript
import { createRxDatabase, addRxPlugin } from 'rxdb';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';

addRxPlugin(RxDBDevModePlugin);

const db = await createRxDatabase({
  name: 'todosdb',
  storage: getRxStorageDexie(),
});

await db.addCollections({
  todos: {
    schema: {
      version: 0,
      primaryKey: 'id',
      type: 'object',
      properties: {
        id: { type: 'string', maxLength: 100 },
        title: { type: 'string' },
        done: { type: 'boolean' },
      },
      required: ['id', 'title'],
    },
  },
});

// Insert
await db.todos.insert({ id: 'todo-1', title: 'Buy milk', done: false });

// Reactive query
db.todos.find().$.subscribe(docs => {
  console.log('Todos:', docs);
});

// Update
const doc = await db.todos.findOne('todo-1').exec();
await doc.patch({ done: true });
```

**Pocket:**
```typescript
import { Database, createIndexedDBStorage } from 'pocket';
import { z } from 'zod';

const TodoSchema = z.object({
  _id: z.string(),
  title: z.string(),
  done: z.boolean(),
});

type Todo = z.infer<typeof TodoSchema>;

const db = await Database.create({
  name: 'todosdb',
  storage: createIndexedDBStorage(),
});

const todos = db.collection<Todo>('todos', {
  schema: TodoSchema,
});

// Insert
await todos.insert({ title: 'Buy milk', done: false });

// Reactive query
todos.find().$.subscribe(docs => {
  console.log('Todos:', docs);
});

// Update
await todos.update('todo-1', { done: true });
```

### Key Differences

1. **Schema**: RxDB uses JSON Schema; Pocket uses Zod (better TypeScript integration)
2. **Document Updates**: RxDB uses `.patch()` on documents; Pocket uses `collection.update()`
3. **Plugins**: Similar concept, slightly different APIs
4. **Size**: Pocket aims to be smaller and more focused

---

## Migrating from LocalForage

[LocalForage](https://localforage.github.io/localForage/) is a simple key-value storage library.

### Concept Mapping

| LocalForage | Pocket | Notes |
|-------------|--------|-------|
| `localforage.setItem(key, value)` | `collection.upsert({ _id: key, ...value })` | Store data |
| `localforage.getItem(key)` | `collection.get(key)` | Get data |
| `localforage.removeItem(key)` | `collection.delete(key)` | Remove data |
| `localforage.clear()` | Manual deletion | Clear all |
| `localforage.keys()` | `collection.find().exec()` | List keys |
| Key-value store | Document database | Different model |

### Code Migration

**LocalForage:**
```javascript
import localforage from 'localforage';

// Store
await localforage.setItem('user-1', {
  name: 'John',
  email: 'john@example.com',
  preferences: { theme: 'dark' },
});

// Retrieve
const user = await localforage.getItem('user-1');

// Remove
await localforage.removeItem('user-1');

// Iterate
await localforage.iterate((value, key) => {
  console.log(key, value);
});
```

**Pocket:**
```typescript
import { Database, createIndexedDBStorage } from 'pocket';

interface User {
  _id: string;
  name: string;
  email: string;
  preferences: { theme: string };
}

const db = await Database.create({
  name: 'app-data',
  storage: createIndexedDBStorage(),
});

const users = db.collection<User>('users');

// Store
await users.upsert({
  _id: 'user-1',
  name: 'John',
  email: 'john@example.com',
  preferences: { theme: 'dark' },
});

// Retrieve
const user = await users.get('user-1');

// Remove
await users.delete('user-1');

// Iterate
const allUsers = await users.find().exec();
allUsers.forEach(user => {
  console.log(user._id, user);
});
```

### Data Migration Script

```typescript
import localforage from 'localforage';
import { Database, createIndexedDBStorage } from 'pocket';

async function migrateLocalForageToPocket(collectionName: string) {
  const db = await Database.create({
    name: 'migrated-app',
    storage: createIndexedDBStorage(),
  });

  const collection = db.collection(collectionName);

  // Get all keys
  const keys = await localforage.keys();

  // Migrate each item
  for (const key of keys) {
    const value = await localforage.getItem(key);
    if (value && typeof value === 'object') {
      await collection.upsert({
        _id: key,
        ...value,
      });
    }
  }

  console.log(`Migrated ${keys.length} items`);
  return db;
}
```

### Key Differences

1. **Data Model**: LocalForage is key-value; Pocket is document-based with queries
2. **Queries**: Pocket supports complex queries; LocalForage only has get/set
3. **Reactivity**: Pocket has reactive queries; LocalForage doesn't
4. **Sync**: Pocket has built-in sync; LocalForage doesn't
5. **TypeScript**: Pocket has better TypeScript support

---

## Migrating from WatermelonDB

[WatermelonDB](https://nozbe.github.io/WatermelonDB/) is a reactive database for React Native.

### Concept Mapping

| WatermelonDB | Pocket | Notes |
|--------------|--------|-------|
| `Database` | `Database` | Database instance |
| `Model` class | TypeScript interface | Schema definition |
| `collection.create()` | `collection.insert()` | Create records |
| `collection.find(id)` | `collection.get(id)` | Find by ID |
| `record.update()` | `collection.update(id, ...)` | Update |
| `record.markAsDeleted()` | `collection.delete(id)` | Delete |
| `@lazy` decorators | Reactive queries | Reactivity |
| `sync()` | `createSyncEngine()` | Sync |

### Code Migration

**WatermelonDB:**
```typescript
import { Database, Model, Q } from '@nozbe/watermelondb';
import { field, text, readonly, date } from '@nozbe/watermelondb/decorators';

class Todo extends Model {
  static table = 'todos';

  @text('title') title!: string;
  @field('done') done!: boolean;
  @readonly @date('created_at') createdAt!: Date;
}

// Create
await database.write(async () => {
  await database.get<Todo>('todos').create(todo => {
    todo.title = 'Buy milk';
    todo.done = false;
  });
});

// Query
const todos = await database
  .get<Todo>('todos')
  .query(Q.where('done', false))
  .fetch();

// Update
await database.write(async () => {
  await todo.update(t => {
    t.done = true;
  });
});
```

**Pocket (with React Native):**
```typescript
import { Database } from 'pocket';
import { createMMKVStorage } from '@pocket/react-native';

interface Todo {
  _id: string;
  title: string;
  done: boolean;
  createdAt: number;
}

const db = await Database.create({
  name: 'app',
  storage: createMMKVStorage(),
});

const todos = db.collection<Todo>('todos');

// Create
await todos.insert({
  title: 'Buy milk',
  done: false,
  createdAt: Date.now(),
});

// Query
const incompleteTodos = await todos
  .find({ done: false })
  .exec();

// Update
await todos.update(todoId, { done: true });
```

### Key Differences

1. **Schema Definition**: WatermelonDB uses decorators on classes; Pocket uses TypeScript interfaces
2. **Transactions**: WatermelonDB requires `database.write()`; Pocket operations are simpler
3. **Query Syntax**: Different query builders
4. **React Native**: Both support React Native; Pocket has simpler setup

---

## Migrating from Dexie.js

[Dexie.js](https://dexie.org/) is a wrapper for IndexedDB.

### Concept Mapping

| Dexie.js | Pocket | Notes |
|----------|--------|-------|
| `new Dexie('db')` | `Database.create()` | Database creation |
| `db.version(1).stores({})` | Collection definition | Schema versioning |
| `table.add(obj)` | `collection.insert(obj)` | Insert |
| `table.get(id)` | `collection.get(id)` | Get |
| `table.put(obj)` | `collection.upsert(obj)` | Insert/update |
| `table.delete(id)` | `collection.delete(id)` | Delete |
| `table.where()` | `collection.find()` | Query |
| `liveQuery()` | `collection.find().$` | Reactive |

### Code Migration

**Dexie.js:**
```typescript
import Dexie, { Table } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';

interface Todo {
  id?: number;
  title: string;
  done: boolean;
}

class AppDatabase extends Dexie {
  todos!: Table<Todo, number>;

  constructor() {
    super('app');
    this.version(1).stores({
      todos: '++id, title, done',
    });
  }
}

const db = new AppDatabase();

// Insert
await db.todos.add({ title: 'Buy milk', done: false });

// Query
const todos = await db.todos.where('done').equals(false).toArray();

// React hook
function TodoList() {
  const todos = useLiveQuery(() => db.todos.toArray());
  return <ul>{todos?.map(t => <li key={t.id}>{t.title}</li>)}</ul>;
}
```

**Pocket:**
```typescript
import { Database, createIndexedDBStorage } from 'pocket';
import { useQuery } from '@pocket/react';

interface Todo {
  _id: string;
  title: string;
  done: boolean;
}

const db = await Database.create({
  name: 'app',
  storage: createIndexedDBStorage(),
});

const todos = db.collection<Todo>('todos');

// Insert
await todos.insert({ title: 'Buy milk', done: false });

// Query
const incompleteTodos = await todos.find({ done: false }).exec();

// React hook
function TodoList() {
  const { data: todos } = useQuery(todos.find());
  return <ul>{todos?.map(t => <li key={t._id}>{t.title}</li>)}</ul>;
}
```

### Key Differences

1. **Class-based vs Functional**: Dexie uses classes; Pocket is more functional
2. **Auto-increment**: Dexie supports auto-increment IDs; Pocket generates UUIDs
3. **Sync**: Dexie doesn't include sync; Pocket has built-in sync

---

## General Migration Strategies

### 1. Parallel Operation

Run both databases during migration:

```typescript
async function parallelMigration() {
  // Keep old database running
  const oldDb = initializeOldDatabase();

  // Create new Pocket database
  const newDb = await Database.create({
    name: 'new-app',
    storage: createIndexedDBStorage(),
  });

  // Write to both during transition
  async function createTodo(data: TodoData) {
    await Promise.all([
      oldDb.createTodo(data),
      newDb.collection('todos').insert(data),
    ]);
  }

  // Gradually shift reads to new database
  // After verification, remove old database
}
```

### 2. Big Bang Migration

Migrate all data at once during maintenance:

```typescript
async function bigBangMigration() {
  console.log('Starting migration...');

  // Export all data from old database
  const allData = await exportOldDatabase();

  // Create new Pocket database
  const newDb = await Database.create({
    name: 'app',
    storage: createIndexedDBStorage(),
  });

  // Import all data
  for (const [collectionName, documents] of Object.entries(allData)) {
    const collection = newDb.collection(collectionName);
    for (const doc of documents) {
      await collection.upsert(doc);
    }
  }

  console.log('Migration complete!');

  // Delete old database
  await deleteOldDatabase();
}
```

### 3. Incremental Migration

Migrate data on-demand as it's accessed:

```typescript
class MigrationWrapper {
  private migrated = new Set<string>();

  async get(id: string) {
    if (!this.migrated.has(id)) {
      // Check old database
      const oldDoc = await this.oldDb.get(id);
      if (oldDoc) {
        // Migrate to new database
        await this.newDb.collection('items').upsert(oldDoc);
        this.migrated.add(id);
      }
    }

    return this.newDb.collection('items').get(id);
  }
}
```

### 4. Feature Flag Migration

Use feature flags to gradually roll out:

```typescript
const USE_POCKET = featureFlags.get('use_pocket_database');

async function getTodos() {
  if (USE_POCKET) {
    return pocketDb.collection('todos').find().exec();
  } else {
    return oldDb.getTodos();
  }
}
```

## Testing Your Migration

```typescript
import { describe, it, expect } from 'vitest';

describe('Data Migration', () => {
  it('should migrate all documents', async () => {
    // Count in old database
    const oldCount = await oldDb.todos.count();

    // Run migration
    await runMigration();

    // Count in new database
    const newCount = await newDb.collection('todos').find().exec();

    expect(newCount.length).toBe(oldCount);
  });

  it('should preserve document data', async () => {
    const oldDoc = await oldDb.todos.get('todo-1');
    await runMigration();
    const newDoc = await newDb.collection('todos').get('todo-1');

    expect(newDoc?.title).toBe(oldDoc.title);
    expect(newDoc?.done).toBe(oldDoc.done);
  });

  it('should handle edge cases', async () => {
    // Test documents with special characters
    // Test documents with large data
    // Test empty collections
    // Test missing fields
  });
});
```

## See Also

- [Getting Started](/docs/intro) - Start using Pocket
- [Database API](/docs/api/database) - Database configuration
- [Schema Validation](/docs/guides/schema-validation) - Define document schemas
- [Sync Setup](/docs/guides/sync-setup) - Configure synchronization
