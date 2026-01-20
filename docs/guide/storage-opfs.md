# OPFS Storage

The OPFS (Origin Private File System) adapter provides high-performance, file-based storage. It's ideal for applications with large datasets or file-heavy workloads.

## Installation

```bash
npm install @pocket/storage-opfs
```

## Basic Usage

```typescript
import { Database } from '@pocket/core';
import { createOPFSStorage } from '@pocket/storage-opfs';

const db = await Database.create({
  name: 'my-app',
  storage: createOPFSStorage(),
});
```

## What is OPFS?

The Origin Private File System is a modern web storage API that provides:

- **File-based storage** - Data stored as files, not database entries
- **High performance** - Faster than IndexedDB for large data
- **Higher limits** - More storage available than traditional APIs
- **Worker access** - Synchronous file access in Web Workers

## When to Use OPFS

Choose OPFS when:
- Storing large documents (>1MB each)
- Managing many documents (>100,000)
- Performance is critical
- You need file-like access patterns

Stick with IndexedDB when:
- Broad browser support is needed
- Documents are small
- Simple queries suffice

## Configuration Options

```typescript
interface OPFSAdapterOptions {
  /** Root directory name */
  rootDirectory?: string;
  /** Use synchronous access (Worker only) */
  syncAccessHandle?: boolean;
}
```

### Custom Root Directory

```typescript
const storage = createOPFSStorage({
  rootDirectory: 'my-app-data',
});
```

### Synchronous Access in Workers

For best performance in Web Workers:

```typescript
// worker.ts
const storage = createOPFSStorage({
  syncAccessHandle: true,
});
```

## How It Works

### File Structure

```
/pocket/
  ├── my-app/
  │   ├── _meta.json
  │   ├── todos/
  │   │   ├── _index.json
  │   │   ├── doc-1.json
  │   │   ├── doc-2.json
  │   │   └── ...
  │   └── users/
  │       └── ...
  └── other-app/
      └── ...
```

### Document Storage

Each document is stored as a separate JSON file:

```
todos/
  ├── abc123.json    # Document with _id: 'abc123'
  ├── def456.json    # Document with _id: 'def456'
  └── ...
```

## Browser Compatibility

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome | 102+ | Full support |
| Edge | 102+ | Full support |
| Firefox | 111+ | Full support |
| Safari | 15.2+ | Partial support |

### Checking Availability

```typescript
import { createOPFSStorage } from '@pocket/storage-opfs';
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';

const opfsStorage = createOPFSStorage();
const storage = opfsStorage.isAvailable()
  ? opfsStorage
  : createIndexedDBStorage();
```

## Performance Comparison

Benchmarks for 10,000 documents:

| Operation | IndexedDB | OPFS |
|-----------|-----------|------|
| Bulk Insert | 850ms | 420ms |
| Get by ID | 2ms | 1ms |
| Full Scan | 180ms | 95ms |
| Update | 5ms | 3ms |

*Results vary by browser and hardware*

## Web Worker Usage

For best performance, use OPFS in a Web Worker:

### Main Thread

```typescript
// main.ts
const worker = new Worker('./database-worker.ts', { type: 'module' });

// Send commands to worker
worker.postMessage({ type: 'insert', collection: 'todos', doc: { ... } });

// Receive responses
worker.onmessage = (event) => {
  console.log('Result:', event.data);
};
```

### Worker Thread

```typescript
// database-worker.ts
import { Database } from '@pocket/core';
import { createOPFSStorage } from '@pocket/storage-opfs';

const db = await Database.create({
  name: 'my-app',
  storage: createOPFSStorage({ syncAccessHandle: true }),
});

self.onmessage = async (event) => {
  const { type, collection, doc } = event.data;

  if (type === 'insert') {
    const result = await db.collection(collection).insert(doc);
    self.postMessage({ type: 'result', data: result });
  }
};
```

## Storage Limits

OPFS typically allows more storage than IndexedDB:

- Chrome: Up to 60% of disk space
- Firefox: Dynamically managed
- Safari: User-prompted for large amounts

### Requesting Persistent Storage

```typescript
if (navigator.storage?.persist) {
  const persisted = await navigator.storage.persist();
  if (persisted) {
    console.log('Storage will not be cleared automatically');
  }
}
```

## Limitations

1. **Newer API** - Not available in older browsers
2. **No IndexedDB features** - No native transactions or indexes
3. **File overhead** - One file per document adds overhead for tiny documents
4. **Safari quirks** - Some limitations on iOS

## Migration from IndexedDB

```typescript
async function migrateToOPFS() {
  const oldDb = await Database.create({
    name: 'my-app',
    storage: createIndexedDBStorage(),
  });

  const newDb = await Database.create({
    name: 'my-app-opfs',
    storage: createOPFSStorage(),
  });

  // Migrate each collection
  const collections = await oldDb.listCollections();
  for (const name of collections) {
    const docs = await oldDb.collection(name).getAll();
    await newDb.collection(name).insertMany(docs);
  }

  await oldDb.close();
}
```

## Debugging

### View Files in DevTools

1. Open DevTools (F12)
2. Go to Application tab
3. Expand "File System" or "Storage" > "OPFS"
4. Browse your app's directory

### Clear Data

```typescript
// Clear Pocket data
const root = await navigator.storage.getDirectory();
await root.removeEntry('pocket', { recursive: true });
```

## Next Steps

- [Storage Overview](./storage.md) - Compare all adapters
- [IndexedDB Adapter](./storage-indexeddb.md) - Traditional storage option
- [Performance](./queries.md#performance-tips) - Query optimization
