# Storage Adapters

Pocket supports multiple storage backends through a pluggable adapter system. Choose the right adapter based on your application's needs.

## Available Adapters

| Adapter | Package | Best For |
|---------|---------|----------|
| [IndexedDB](./storage-indexeddb.md) | `@pocket/storage-indexeddb` | Production web apps |
| [OPFS](./storage-opfs.md) | `@pocket/storage-opfs` | Large datasets, file-based storage |
| [Memory](./storage-memory.md) | `@pocket/storage-memory` | Testing, temporary data |

## Choosing an Adapter

### IndexedDB (Recommended)

Best for most web applications:
- Wide browser support
- Persistent storage
- Good performance for typical workloads
- Built-in transactions

```typescript
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});
```

### OPFS (Origin Private File System)

Best for large datasets or file-heavy apps:
- Higher storage limits
- Better performance for large data
- File-based access patterns
- Requires modern browsers

```typescript
import { createOPFSStorage } from '@pocket/storage-opfs';

const db = await Database.create({
  name: 'my-app',
  storage: createOPFSStorage(),
});
```

### Memory

Best for testing or temporary data:
- Fastest performance
- No persistence (data lost on refresh)
- Great for unit tests
- No browser APIs required

```typescript
import { createMemoryStorage } from '@pocket/storage-memory';

const db = await Database.create({
  name: 'my-app',
  storage: createMemoryStorage(),
});
```

## Feature Comparison

| Feature | IndexedDB | OPFS | Memory |
|---------|-----------|------|--------|
| Persistence | Yes | Yes | No |
| Browser Support | Excellent | Modern only | All |
| Performance | Good | Better | Best |
| Storage Limit | ~50MB-2GB | Higher | RAM |
| Transactions | Native | Simulated | Simulated |
| Worker Support | Yes | Required | Yes |

## Storage Interface

All adapters implement the `StorageAdapter` interface:

```typescript
interface StorageAdapter {
  /** Adapter name */
  readonly name: string;

  /** Check if storage is available */
  isAvailable(): boolean;

  /** Initialize storage */
  initialize(config: StorageConfig): Promise<void>;

  /** Close storage connection */
  close(): Promise<void>;

  /** Get a document store */
  getStore<T extends Document>(name: string): DocumentStore<T>;

  /** Check if store exists */
  hasStore(name: string): boolean;

  /** List all stores */
  listStores(): Promise<string[]>;

  /** Delete a store */
  deleteStore(name: string): Promise<void>;

  /** Execute transaction */
  transaction<R>(
    storeNames: string[],
    mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R>;

  /** Get storage statistics */
  getStats(): Promise<StorageStats>;
}
```

## Checking Availability

Before using an adapter, check if it's available:

```typescript
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';
import { createMemoryStorage } from '@pocket/storage-memory';

const idbStorage = createIndexedDBStorage();

const storage = idbStorage.isAvailable()
  ? idbStorage
  : createMemoryStorage();

const db = await Database.create({
  name: 'my-app',
  storage,
});
```

## Custom Adapters

Implement `StorageAdapter` for custom backends:

```typescript
class MyCustomAdapter implements StorageAdapter {
  readonly name = 'custom';

  isAvailable(): boolean {
    return true;
  }

  async initialize(config: StorageConfig): Promise<void> {
    // Initialize your storage
  }

  // ... implement remaining methods
}
```

## Storage Statistics

Get information about storage usage:

```typescript
const stats = await db.getStats();

console.log({
  documentCount: stats.documentCount,
  storageSize: stats.storageSize,
  storeCount: stats.storeCount,
  indexCount: stats.indexCount,
});
```

## Next Steps

- [IndexedDB Adapter](./storage-indexeddb.md) - Detailed IndexedDB guide
- [OPFS Adapter](./storage-opfs.md) - OPFS guide
- [Memory Adapter](./storage-memory.md) - Memory adapter guide
