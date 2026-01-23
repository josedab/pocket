---
sidebar_position: 6
title: Indexing
description: Create indexes to speed up queries
---

# Indexing

Indexes speed up queries by avoiding full collection scans. This guide explains how to create and use indexes effectively.

## Why Indexes Matter

Without an index, finding a document requires scanning every document:

```
Query: { completed: false }

Without index: Scan all 10,000 documents → slow
With index:    Look up in index → 500 matching docs → fast
```

## Creating Indexes

### At Database Creation

```typescript
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  collections: [
    {
      name: 'todos',
      indexes: [
        { fields: ['completed'] },
        { fields: ['createdAt'] },
        { fields: ['userId', 'completed'] },  // Compound index
      ],
    },
  ],
});
```

### After Creation

```typescript
const todos = db.collection('todos');

// Create single-field index
await todos.createIndex({ fields: ['completed'] });

// Create compound index
await todos.createIndex({ fields: ['userId', 'createdAt'] });
```

## Index Types

### Single-Field Index

Index on one field:

```typescript
await todos.createIndex({ fields: ['completed'] });

// Speeds up:
todos.find().where('completed').equals(true).exec();
todos.find({ completed: false }).exec();
```

### Compound Index

Index on multiple fields:

```typescript
await todos.createIndex({ fields: ['userId', 'completed'] });

// Speeds up:
todos.find()
  .where('userId').equals('user-1')
  .where('completed').equals(false)
  .exec();

// Also speeds up (uses first field):
todos.find().where('userId').equals('user-1').exec();

// Does NOT speed up (skips first field):
todos.find().where('completed').equals(false).exec();  // Full scan
```

**Rule**: Compound indexes work left-to-right. A query must use fields from the left.

### Unique Index

Enforce uniqueness:

```typescript
await users.createIndex({
  fields: ['email'],
  unique: true,
});

// This will fail if email already exists:
await users.insert({ _id: '1', email: 'alice@example.com' });
await users.insert({ _id: '2', email: 'alice@example.com' });  // Error!
```

## Index Selection

Pocket automatically selects the best index for a query. You can check which index is used:

```typescript
const query = todos.find()
  .where('userId').equals('user-1')
  .where('completed').equals(false);

// Get query plan (for debugging)
const plan = query.explain();
console.log('Using index:', plan.index);
```

## Query Patterns

### Equality Queries

Single value matching:

```typescript
// Index on 'completed'
await todos.createIndex({ fields: ['completed'] });

// Fast:
todos.find().where('completed').equals(true).exec();
```

### Range Queries

```typescript
// Index on 'createdAt'
await todos.createIndex({ fields: ['createdAt'] });

// Fast:
todos.find()
  .where('createdAt').gte(startOfDay)
  .where('createdAt').lte(endOfDay)
  .exec();
```

### Sorting

Indexes speed up sorting:

```typescript
// Index on 'createdAt'
await todos.createIndex({ fields: ['createdAt'] });

// Fast (uses index order):
todos.find().sort('createdAt', 'desc').exec();

// Without index: fetch all, then sort in memory
```

### Combined Filter and Sort

```typescript
// Compound index for filter + sort
await todos.createIndex({ fields: ['completed', 'createdAt'] });

// Fast:
todos.find()
  .where('completed').equals(false)
  .sort('createdAt', 'desc')
  .exec();
```

## Managing Indexes

### List Indexes

```typescript
const indexes = await todos.getIndexes();
console.log(indexes);
// [
//   { name: '_id', fields: ['_id'], unique: true },
//   { name: 'completed', fields: ['completed'] },
//   { name: 'userId_createdAt', fields: ['userId', 'createdAt'] },
// ]
```

### Drop Index

```typescript
await todos.dropIndex('completed');
```

### Naming Indexes

Indexes are auto-named by joining field names:

```typescript
{ fields: ['completed'] }          // Name: "completed"
{ fields: ['userId', 'createdAt'] } // Name: "userId_createdAt"
```

Or specify a custom name:

```typescript
await todos.createIndex({
  name: 'user_todos_by_date',
  fields: ['userId', 'createdAt'],
});
```

## Index Design Guidelines

### 1. Index Fields You Query

Only index fields used in `where()` or `sort()`:

```typescript
// If you query by userId often:
await todos.createIndex({ fields: ['userId'] });

// If you never query by 'description', don't index it
```

### 2. Consider Query Patterns

Design indexes around your actual queries:

```typescript
// Query: Get user's incomplete todos, newest first
todos.find()
  .where('userId').equals(userId)
  .where('completed').equals(false)
  .sort('createdAt', 'desc')
  .exec();

// Best index:
await todos.createIndex({ fields: ['userId', 'completed', 'createdAt'] });
```

### 3. Equality Before Range

In compound indexes, put equality fields first:

```typescript
// Query: User's todos in date range
todos.find()
  .where('userId').equals(userId)  // Equality
  .where('createdAt').gte(start)   // Range
  .exec();

// Good: Equality first
{ fields: ['userId', 'createdAt'] }

// Bad: Range first
{ fields: ['createdAt', 'userId'] }
```

### 4. Don't Over-Index

Indexes cost:
- **Storage**: Each index takes space
- **Write speed**: Every insert/update updates all indexes

Only create indexes you need.

## Performance Comparison

```typescript
// Setup: 100,000 todos
const startTime = performance.now();

// Without index: ~500ms
await todos.find().where('completed').equals(false).exec();

// With index: ~5ms
await todos.find().where('completed').equals(false).exec();
```

## Common Patterns

### Filter by Owner

```typescript
// Most apps filter by user
await todos.createIndex({ fields: ['userId'] });
await notes.createIndex({ fields: ['userId'] });
```

### Status + Date

```typescript
// Active items, sorted by date
await todos.createIndex({ fields: ['completed', 'createdAt'] });

// Query
todos.find()
  .where('completed').equals(false)
  .sort('createdAt', 'desc')
  .limit(20)
  .exec();
```

### Full-Text Search (Simple)

For basic text search, index a normalized field:

```typescript
// Store normalized search field
await todos.insert({
  _id: '1',
  title: 'Buy Groceries',
  titleLower: 'buy groceries',  // Lowercase for search
});

await todos.createIndex({ fields: ['titleLower'] });

// Search (prefix match)
todos.find()
  .where('titleLower').startsWith('buy')
  .exec();
```

For full-text search, consider a dedicated search library.

### Pagination

```typescript
// Index for cursor-based pagination
await todos.createIndex({ fields: ['createdAt'] });

// First page
const page1 = await todos.find()
  .sort('createdAt', 'desc')
  .limit(20)
  .exec();

// Next page (use last item's createdAt as cursor)
const lastItem = page1[page1.length - 1];
const page2 = await todos.find()
  .where('createdAt').lt(lastItem.createdAt)
  .sort('createdAt', 'desc')
  .limit(20)
  .exec();
```

## Troubleshooting

### Query is Slow

1. Check if an index exists:
   ```typescript
   const indexes = await todos.getIndexes();
   ```

2. Create appropriate index:
   ```typescript
   await todos.createIndex({ fields: ['yourQueryField'] });
   ```

### Index Not Being Used

Compound indexes must be queried left-to-right:

```typescript
// Index: ['a', 'b', 'c']

// Uses index:
.where('a').equals(1)
.where('a').equals(1).where('b').equals(2)
.where('a').equals(1).where('b').equals(2).where('c').equals(3)

// Does NOT use index (skips 'a'):
.where('b').equals(2)
.where('c').equals(3)
```

### Write Performance Degraded

Too many indexes slow down writes. Audit and remove unused indexes:

```typescript
// List all indexes
const indexes = await todos.getIndexes();

// Remove unused ones
await todos.dropIndex('unused_index_name');
```

## Next Steps

- [Query Builder API](/docs/api/query-builder) - Complete query reference
- [Storage Backends](/docs/concepts/storage-backends) - How storage affects performance
- [Collection API](/docs/api/collection) - Complete collection reference
