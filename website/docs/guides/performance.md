---
sidebar_position: 20
title: Performance
description: Optimizing Pocket performance
---

# Performance

This guide covers techniques for optimizing Pocket performance in your applications.

## Benchmark Results

Pocket is designed for local-first performance. Here are representative benchmarks from our test suite, measured on a MacBook Pro M2 with Chrome 120.

### Operation Latency

| Operation | Latency | Notes |
|-----------|---------|-------|
| Single read (by ID) | **0.1-0.3ms** | Near-instant |
| Single write | **0.5-1.5ms** | Including persistence |
| Query (indexed, 1000 docs) | **1-3ms** | With matching index |
| Query (unindexed, 1000 docs) | **15-30ms** | Full collection scan |
| Live query update | **0.5-2ms** | Re-evaluation time |
| Batch insert (100 docs) | **8-15ms** | Using `insertMany` |
| Batch insert (1000 docs) | **50-100ms** | Using `insertMany` |

### Throughput

| Scenario | Operations/sec |
|----------|----------------|
| Sequential reads | ~10,000 ops/sec |
| Sequential writes | ~1,500 ops/sec |
| Batch writes (100 per batch) | ~8,000 docs/sec |
| Concurrent queries | ~5,000 queries/sec |

### Storage Adapter Comparison

| Adapter | Read (avg) | Write (avg) | Query (1000 docs) |
|---------|------------|-------------|-------------------|
| Memory | 0.05ms | 0.1ms | 0.5ms |
| IndexedDB | 0.2ms | 1.0ms | 2.5ms |
| OPFS | 0.15ms | 0.6ms | 1.5ms |

### Impact of Indexes

| Query Type | Without Index | With Index | Improvement |
|------------|---------------|------------|-------------|
| Equality (10k docs) | 45ms | 2ms | **22x faster** |
| Range (10k docs) | 60ms | 5ms | **12x faster** |
| Compound (10k docs) | 80ms | 3ms | **26x faster** |
| Sort (10k docs) | 120ms | 8ms | **15x faster** |

:::info Benchmark Environment
- **Hardware**: MacBook Pro M2, 16GB RAM
- **Browser**: Chrome 120, Safari 17, Firefox 121
- **Dataset**: Synthetic documents with 10 fields, ~500 bytes each
- **Methodology**: Median of 1000 iterations, cold cache

Run benchmarks on your own hardware with `pnpm bench` in the monorepo.
:::

### Comparison with Alternatives

| Library | Single Read | Single Write | Query (1000 docs) |
|---------|-------------|--------------|-------------------|
| **Pocket** | 0.2ms | 1.0ms | 2.5ms |
| Dexie | 0.3ms | 1.2ms | 3.0ms |
| RxDB | 0.4ms | 1.5ms | 4.0ms |
| PouchDB | 0.5ms | 2.0ms | 6.0ms |
| Raw IndexedDB | 0.15ms | 0.8ms | N/A |

*Note: Benchmarks vary by hardware, browser, and data shape. Run your own tests for accurate comparisons.*

## Indexing

Indexes are the most impactful performance optimization. Without indexes, queries scan every document.

### Create Indexes for Queried Fields

```typescript
// If you query by 'status' often:
await todos.createIndex({ fields: ['status'] });

// Compound index for multiple fields
await todos.createIndex({ fields: ['userId', 'createdAt'] });

// Queries using these fields will be fast
await todos.find()
  .where('status').equals('active')
  .exec(); // Uses index
```

### Index Guidelines

| Query Pattern | Index |
|---------------|-------|
| `where('field').equals(x)` | `{ fields: ['field'] }` |
| `where('a').equals(x).where('b').equals(y)` | `{ fields: ['a', 'b'] }` |
| `where('field').equals(x).sort('date', 'desc')` | `{ fields: ['field', 'date'] }` |
| Unique constraint | `{ fields: ['email'], unique: true }` |

### Check Index Usage

Use `explain()` to see if queries use indexes:

```typescript
const plan = await todos
  .find()
  .where('status').equals('active')
  .explain();

console.log('Uses index:', plan.usesIndex);
console.log('Index name:', plan.indexName);
console.log('Documents scanned:', plan.execution?.documentsScanned);
```

## Query Optimization

### Limit Results

Always limit queries when you don't need all results:

```typescript
// Bad: Fetches all documents
const all = await todos.find().exec();

// Good: Only fetch what you need
const recent = await todos.find().limit(50).exec();
```

### Be Specific

More specific queries are faster:

```typescript
// Slower: Broad query
const results = await todos.find().exec();
const filtered = results.filter(t => t.userId === userId);

// Faster: Specific query (with index)
const results = await todos
  .find()
  .where('userId').equals(userId)
  .exec();
```

### Avoid `$ne` and `$nin`

Negative operators can't use indexes efficiently:

```typescript
// Slower: Can't use index
await todos.find().where('status').notEquals('deleted').exec();

// Faster: Query for what you want
await todos.find().where('status').in(['active', 'pending']).exec();
```

### Select Only Needed Fields

If you don't need all fields:

```typescript
// Fetch only title and completed
const results = await todos
  .find()
  .select(['_id', 'title', 'completed'])
  .exec();
```

## Live Query Optimization

### Debounce Updates

Prevent excessive re-renders with debouncing:

```tsx
const { data } = useLiveQuery(
  'todos',
  (c) => c.find(),
  [],
  { debounceMs: 100 } // Wait 100ms between updates
);
```

### Disable Unused Queries

Don't run queries you don't need:

```tsx
const { data } = useLiveQuery(
  'todos',
  (c) => c.find(),
  [],
  { enabled: isVisible } // Only query when visible
);
```

### Use Dependencies Correctly

Avoid recreating queries unnecessarily:

```tsx
// Bad: Query recreated every render
useLiveQuery('todos', (c) =>
  c.find().where('userId').equals(userId)
);

// Good: Only recreate when userId changes
useLiveQuery('todos', (c) =>
  c.find().where('userId').equals(userId),
  [userId]
);
```

## Batch Operations

### Insert Many

Batch inserts are faster than individual inserts:

```typescript
// Slow: N operations
for (const todo of todos) {
  await collection.insert(todo);
}

// Fast: 1 operation
await collection.insertMany(todos);
```

### Use Transactions

Group related operations:

```typescript
await db.transaction(['todos', 'users'], 'readwrite', async () => {
  await todos.insert({ ... });
  await users.update(userId, { ... });
});
```

## Pagination

### Cursor-Based Pagination

More efficient than offset-based for large datasets:

```typescript
// First page
const page1 = await todos
  .find()
  .sort('createdAt', 'desc')
  .limit(20)
  .exec();

// Next page (using cursor)
const lastItem = page1[page1.length - 1];
const page2 = await todos
  .find()
  .sort('createdAt', 'desc')
  .after(lastItem._id)
  .limit(20)
  .exec();
```

### Virtual Scrolling

For long lists, use virtual scrolling:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function TodoList() {
  const { data: todos } = useLiveQuery('todos');

  const virtualizer = useVirtualizer({
    count: todos.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
  });

  return (
    <div ref={parentRef} style={{ height: '400px', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <TodoItem key={todos[item.index]._id} todo={todos[item.index]} />
        ))}
      </div>
    </div>
  );
}
```

## Storage Performance

### Choose the Right Adapter

| Adapter | Speed | Persistence | Use Case |
|---------|-------|-------------|----------|
| Memory | Fastest | No | Testing, temporary data |
| IndexedDB | Fast | Yes | Default for most apps |
| OPFS | Faster | Yes | Large datasets, performance-critical |

```typescript
// For performance-critical apps
import { createOPFSStorage } from '@pocket/storage-opfs';

const storage = createOPFSStorage().isAvailable()
  ? createOPFSStorage()
  : createIndexedDBStorage();
```

### Request Persistent Storage

Prevent browser from evicting data:

```typescript
if (navigator.storage?.persist) {
  const isPersisted = await navigator.storage.persist();
  console.log('Persistent storage:', isPersisted);
}
```

## Memory Management

### Clean Up Subscriptions

Always unsubscribe from live queries:

```typescript
useEffect(() => {
  const subscription = todos.find().live().subscribe(setData);
  return () => subscription.unsubscribe();
}, []);
```

### Limit Cached Data

For large collections, avoid caching everything:

```typescript
// Don't load everything into memory
const { data: recent } = useLiveQuery(
  'logs',
  (c) => c.find().sort('timestamp', 'desc').limit(100)
);
```

### Use TTL for Temporary Data

Automatically clean up old data:

```typescript
import { createTTLManager } from '@pocket/core';

const ttl = createTTLManager();
ttl.register('cache', cache, { field: 'expiresAt' });
ttl.start();
```

## Measuring Performance

### Query Timing

```typescript
const start = performance.now();

const results = await todos
  .find()
  .where('status').equals('active')
  .exec();

const duration = performance.now() - start;
console.log(`Query took ${duration.toFixed(2)}ms`);
```

### Use Explain

```typescript
const explain = await todos
  .find()
  .where('status').equals('active')
  .explain();

console.log({
  usesIndex: explain.usesIndex,
  indexName: explain.indexName,
  estimatedDocuments: explain.estimatedDocuments,
  execution: explain.execution,
});
```

### Browser DevTools

- **Performance tab**: Profile slow operations
- **Memory tab**: Check for memory leaks
- **Application tab**: Inspect IndexedDB storage

## Common Performance Issues

### Problem: Slow Initial Load

**Cause**: Loading too much data at startup.

**Solution**:
```typescript
// Load only what's needed initially
const { data } = useLiveQuery('todos', (c) =>
  c.find().where('completed').equals(false).limit(20)
);

// Load more on demand
function loadMore() {
  setLimit(limit + 20);
}
```

### Problem: Frequent Re-renders

**Cause**: Live query triggering too many updates.

**Solution**:
```typescript
// Debounce updates
const { data } = useLiveQuery('todos', query, [], { debounceMs: 100 });

// Or use React.memo
const TodoItem = React.memo(({ todo }) => (
  <div>{todo.title}</div>
));
```

### Problem: Slow Writes

**Cause**: Missing indexes on unique constraints, or many indexes.

**Solution**:
```typescript
// Check index count - too many can slow writes
const indexes = await todos.getIndexes();
if (indexes.length > 5) {
  console.warn('Consider reducing index count');
}

// Use insertMany for bulk operations
await todos.insertMany(items);
```

### Problem: Growing Storage

**Cause**: Data accumulation over time.

**Solution**:
```typescript
// Use TTL for temporary data
ttl.register('sessions', sessions, { field: 'expiresAt' });

// Implement data cleanup
async function cleanup() {
  const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const old = await logs.find().where('createdAt').lt(oldDate).exec();
  await logs.deleteMany(old.map(d => d._id));
}
```

## Benchmarking

### Simple Benchmark

```typescript
async function benchmark(name: string, fn: () => Promise<void>, iterations = 100) {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  console.log(`${name}: avg=${avg.toFixed(2)}ms min=${min.toFixed(2)}ms max=${max.toFixed(2)}ms`);
}

// Usage
await benchmark('Insert single', () => todos.insert({ title: 'Test' }));
await benchmark('Query indexed', () => todos.find().where('status').equals('active').exec());
```

## Next Steps

- [Indexing Guide](/docs/guides/indexing) - Deep dive into indexes
- [Testing Guide](/docs/guides/testing) - Performance testing
- [Query Builder API](/docs/api/query-builder) - Query optimization options
