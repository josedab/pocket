---
sidebar_position: 100
title: Troubleshooting
description: Common issues and how to resolve them
---

# Troubleshooting

Solutions to common issues when using Pocket.

## Installation Issues

### "Cannot find module 'pocket'"

**Cause**: Package not installed or import path incorrect.

**Solution**:
```bash
npm install pocket
```

For subpackages:
```typescript
// Main package
import { Database } from 'pocket';

// Or specific packages
import { Database } from '@pocket/core';
import { useLiveQuery } from '@pocket/react';
```

### TypeScript Errors

**Cause**: Missing type definitions or version mismatch.

**Solution**:
```bash
# Ensure TypeScript 5.0+
npm install typescript@latest

# Types are included with pocket
npm install pocket
```

Check `tsconfig.json`:
```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "esModuleInterop": true
  }
}
```

---

## Database Issues

### "Storage adapter is not available"

**Cause**: Using OPFS in unsupported browser or IndexedDB is disabled.

**Solution**:
```typescript
// Check availability first
import { createOPFSStorage, createIndexedDBStorage } from 'pocket';

function createStorage() {
  const opfs = createOPFSStorage();
  if (opfs.isAvailable()) {
    return opfs;
  }
  return createIndexedDBStorage();
}
```

For incognito/private mode, use in-memory storage:
```typescript
import { createMemoryStorage } from 'pocket';
const storage = createMemoryStorage();
```

### "Database not initialized"

**Cause**: Using database before `create()` completes.

**Solution**:
```typescript
// Wrong
const db = new Database(...);
db.collection('todos'); // Error!

// Correct
const db = await Database.create(...);
db.collection('todos'); // Works
```

### Data Not Persisting

**Cause**: Browser storage limits or private browsing.

**Check storage quota**:
```typescript
const stats = await db.getStats();
console.log('Storage used:', stats.storageSize);

// Check browser quota
if (navigator.storage?.estimate) {
  const { usage, quota } = await navigator.storage.estimate();
  console.log(`Using ${usage} of ${quota} bytes`);
}
```

**Request persistent storage**:
```typescript
if (navigator.storage?.persist) {
  const persisted = await navigator.storage.persist();
  console.log('Persistent storage:', persisted);
}
```

---

## Query Issues

### Query Returns Empty Array

**Cause**: Filter doesn't match any documents, or collection name mismatch.

**Debug**:
```typescript
// Check collection exists
const collections = await db.listCollections();
console.log('Collections:', collections);

// Check all documents
const all = await todos.getAll();
console.log('All docs:', all);

// Check your filter
const results = await todos.find().where('status').equals('active').exec();
console.log('Query results:', results);
```

### Live Query Not Updating

**Cause**: Subscription not set up correctly or unsubscribed.

**Solution**:
```typescript
// Ensure subscription is stored
const subscription = todos
  .find()
  .live()
  .subscribe((results) => {
    console.log('Updated:', results);
  });

// Don't unsubscribe too early
// subscription.unsubscribe(); // Only when done
```

In React:
```tsx
useEffect(() => {
  const sub = todos.find().live().subscribe(setData);
  return () => sub.unsubscribe(); // Clean up on unmount
}, []); // Check dependency array
```

### Query Performance Slow

**Cause**: Missing index or large result set.

**Solution**:
```typescript
// Add index for filtered fields
await todos.createIndex({ fields: ['completed'] });

// Limit results
const results = await todos
  .find()
  .where('completed').equals(false)
  .limit(50)
  .exec();
```

---

## React Issues

### "useDatabase must be used within PocketProvider"

**Cause**: Hook used outside provider.

**Solution**:
```tsx
// Ensure provider wraps your components
function App() {
  return (
    <PocketProvider database={db}>
      <YourComponents />
    </PocketProvider>
  );
}
```

### Component Re-renders Excessively

**Cause**: Query recreated on every render.

**Solution**:
```tsx
// Wrong: Query recreated every render
useLiveQuery('todos', (c) => c.find().where('id').equals(id));

// Correct: Use dependencies
useLiveQuery('todos', (c) => c.find().where('id').equals(id), [id]);
```

### State Updates After Unmount

**Warning**: "Can't perform a React state update on an unmounted component"

**Solution**:
```tsx
// Use enabled option to prevent updates
const [mounted, setMounted] = useState(true);

useEffect(() => {
  return () => setMounted(false);
}, []);

const { data } = useLiveQuery('todos', undefined, [], { enabled: mounted });
```

Or use the built-in hooks which handle this:
```tsx
// useLiveQuery handles cleanup automatically
const { data } = useLiveQuery('todos');
```

---

## Sync Issues

### Sync Not Connecting

**Cause**: Wrong URL, network issues, or auth failure.

**Debug**:
```typescript
sync.getStatus().subscribe((status) => {
  console.log('Sync status:', status);
});

sync.getStats().subscribe((stats) => {
  if (stats.lastError) {
    console.error('Sync error:', stats.lastError);
  }
});
```

**Check**:
- Server URL is correct (`wss://` for WebSocket, `https://` for HTTP)
- Auth token is valid
- Server is running
- No CORS issues

### Changes Not Syncing

**Cause**: Collection not configured for sync.

**Solution**:
```typescript
// Enable sync on collection
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  collections: [
    { name: 'todos', sync: true },  // Must be true
  ],
});

// Include in sync config
const sync = createSyncEngine(db, {
  serverUrl: 'wss://...',
  collections: ['todos'],  // Must include the collection
});
```

### Sync Conflicts

**Symptoms**: Data reverting or showing wrong values.

**Solution**:
```typescript
// Monitor conflicts
sync.getStats().subscribe((stats) => {
  console.log('Conflicts resolved:', stats.conflictCount);
});

// Use appropriate strategy
const sync = createSyncEngine(db, {
  serverUrl: 'wss://...',
  conflictStrategy: 'merge',  // Or custom resolver
});
```

See [Conflict Resolution Guide](/docs/guides/conflict-resolution).

### Offline Changes Lost

**Cause**: Sync engine destroyed before pushing.

**Solution**:
```typescript
// Force sync before closing
async function cleanup() {
  await sync.forceSync();
  sync.destroy();
  await db.close();
}
```

---

## Schema Validation Issues

### ValidationError on Insert

**Cause**: Document doesn't match schema.

**Debug**:
```typescript
import { ValidationError } from 'pocket';

try {
  await todos.insert(data);
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('Validation errors:');
    for (const err of error.validation.errors) {
      console.log(`- ${err.path}: ${err.message}`);
    }
  }
}
```

### Defaults Not Applied

**Cause**: Field present but empty/null vs absent.

```typescript
// Defaults only apply to missing fields
schema: {
  properties: {
    status: { type: 'string', default: 'pending' }
  }
}

// This gets default
await insert({ _id: '1', title: 'Test' });
// status = 'pending'

// This doesn't (field is present)
await insert({ _id: '1', title: 'Test', status: null });
// status = null (not 'pending')
```

---

## Browser Compatibility

### Safari Issues

**IndexedDB quirks in Safari**:
- Smaller storage quota
- May clear data in low storage
- Private mode has limited storage

**Solution**: Request persistent storage and handle storage errors:
```typescript
try {
  await db.collection('todos').insert(doc);
} catch (error) {
  if (error.name === 'QuotaExceededError') {
    // Handle storage full
    alert('Storage full. Please free up space.');
  }
}
```

### OPFS Not Available

**Supported browsers**: Chrome 86+, Firefox 111+, Safari 15.2+

**Solution**: Use fallback:
```typescript
const storage = createOPFSStorage().isAvailable()
  ? createOPFSStorage()
  : createIndexedDBStorage();
```

---

## Getting Help

If you can't resolve an issue:

1. **Search existing issues**: [GitHub Issues](https://github.com/pocket-db/pocket/issues)
2. **Ask the community**: [GitHub Discussions](https://github.com/pocket-db/pocket/discussions)
3. **File a bug report**: Include:
   - Pocket version
   - Browser/Node version
   - Minimal reproduction code
   - Error messages and stack traces

---

## See Also

- [FAQ](/docs/faq) - Frequently asked questions
- [GitHub Issues](https://github.com/pocket-db/pocket/issues) - Report bugs
- [GitHub Discussions](https://github.com/pocket-db/pocket/discussions) - Ask questions
