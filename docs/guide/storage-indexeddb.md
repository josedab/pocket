# IndexedDB Storage

The IndexedDB adapter is the recommended storage backend for production web applications. It provides persistent, transactional storage with good performance.

## Installation

```bash
npm install @pocket/storage-indexeddb
```

## Basic Usage

```typescript
import { Database } from '@pocket/core';
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});
```

## Configuration Options

```typescript
interface IndexedDBAdapterOptions {
  /** Custom IndexedDB factory (for testing) */
  indexedDB?: IDBFactory;
}
```

### Custom Factory

For testing with fake-indexeddb:

```typescript
import { IDBFactory } from 'fake-indexeddb';

const storage = createIndexedDBStorage({
  indexedDB: new IDBFactory(),
});
```

## How It Works

### Database Structure

Each Pocket database creates an IndexedDB database with:
- One object store per collection
- A `__pocket_meta__` store for internal metadata
- Indexes for query optimization

### Document Storage

Documents are stored with:
- `_id` as the primary key
- Dates serialized as ISO strings
- Automatic deserialization on read

### Transactions

IndexedDB provides native ACID transactions:

```typescript
await db.transaction(['todos', 'users'], 'readwrite', async () => {
  // All operations are atomic
  await todos.insert({ _id: '1', title: 'Task' });
  await users.update('user-1', { taskCount: 1 });
});
```

## Indexes

### Creating Indexes

Indexes improve query performance:

```typescript
// At database creation
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  collections: [{
    name: 'todos',
    indexes: [
      { fields: ['completed'] },
      { fields: ['priority'] },
      { fields: ['completed', 'priority'] },
    ],
  }],
});

// Or dynamically
await todos.createIndex({
  name: 'by_created',
  fields: ['createdAt'],
});
```

### Compound Indexes

For queries on multiple fields:

```typescript
await todos.createIndex({
  name: 'status_priority',
  fields: ['completed', 'priority'],
});
```

### Unique Indexes

Enforce uniqueness:

```typescript
await users.createIndex({
  name: 'email_unique',
  fields: ['email'],
  unique: true,
});
```

## Version Upgrades

IndexedDB requires version upgrades to modify schema. Pocket handles this automatically when you:

1. Add new collections
2. Create new indexes

The database version increments and performs a schema migration.

## Storage Limits

IndexedDB storage limits vary by browser:

| Browser | Limit |
|---------|-------|
| Chrome | 60% of disk space |
| Firefox | 50% of disk space |
| Safari | 1GB (prompts for more) |
| Edge | 60% of disk space |

### Checking Available Space

```typescript
if (navigator.storage?.estimate) {
  const estimate = await navigator.storage.estimate();
  console.log('Used:', estimate.usage);
  console.log('Available:', estimate.quota);
}
```

### Requesting Persistent Storage

```typescript
if (navigator.storage?.persist) {
  const isPersisted = await navigator.storage.persist();
  console.log('Persistent storage:', isPersisted);
}
```

## Performance Tips

### 1. Use Bulk Operations

```typescript
// Faster than individual inserts
await todos.insertMany([
  { _id: '1', title: 'Task 1' },
  { _id: '2', title: 'Task 2' },
  { _id: '3', title: 'Task 3' },
]);
```

### 2. Create Appropriate Indexes

```typescript
// Index fields used in filters
await todos.createIndex({ fields: ['completed'] });
await todos.createIndex({ fields: ['priority'] });
```

### 3. Limit Query Results

```typescript
// Don't load entire collection
const recent = await todos
  .find()
  .sort('createdAt', 'desc')
  .limit(50)
  .exec();
```

### 4. Use Projections

```typescript
// Only load needed fields
const titles = await todos
  .find()
  .include('_id', 'title')
  .exec();
```

## Browser Compatibility

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome | 24+ | Full support |
| Firefox | 16+ | Full support |
| Safari | 10+ | Full support |
| Edge | 12+ | Full support |
| IE | 10+ | Limited support |

## Debugging

### View Data in DevTools

1. Open DevTools (F12)
2. Go to Application tab
3. Expand IndexedDB in sidebar
4. Select your database

### Clear Data

```typescript
// Clear all data
await todos.clear();

// Or delete database
await db.close();
indexedDB.deleteDatabase('my-app');
```

## Error Handling

Common errors and solutions:

### QuotaExceededError

Storage quota exceeded:

```typescript
try {
  await todos.insert(largeDocument);
} catch (error) {
  if (error.name === 'QuotaExceededError') {
    // Clear old data or prompt user
    await cleanupOldData();
  }
}
```

### VersionError

Database version conflict (multiple tabs):

```typescript
// Handle by reloading
window.location.reload();
```

## Next Steps

- [Storage Overview](./storage.md) - Compare all adapters
- [OPFS Adapter](./storage-opfs.md) - Higher performance option
- [Queries](./queries.md) - Optimize queries with indexes
