# ADR-003: Pluggable Storage Adapters

## Status

Accepted

## Context

Pocket needs to persist data in the browser. Several storage options exist:

| Storage | Capacity | Performance | Persistence | Browser Support |
|---------|----------|-------------|-------------|-----------------|
| LocalStorage | 5-10MB | Slow (sync) | Yes | Excellent |
| IndexedDB | 50MB-2GB+ | Good | Yes | Excellent |
| OPFS | Higher | Better | Yes | Modern only |
| Memory | RAM | Best | No | All |
| WebSQL | 50MB | Good | Yes | Deprecated |

Different applications have different requirements:
- Small apps may prefer simplicity
- Large datasets need OPFS performance
- Tests need fast, ephemeral storage
- Some environments lack certain APIs

## Decision

Implement a pluggable storage adapter system where:

1. **Core is storage-agnostic**
   - Database and Collection classes don't depend on specific storage
   - All storage access goes through the adapter interface

2. **Adapters are separate packages**
   - `@pocket/storage-indexeddb`
   - `@pocket/storage-opfs`
   - `@pocket/storage-memory`

3. **Common interface**
   ```typescript
   interface StorageAdapter {
     name: string;
     isAvailable(): boolean;
     initialize(config: StorageConfig): Promise<void>;
     close(): Promise<void>;
     getStore<T>(name: string): DocumentStore<T>;
     hasStore(name: string): boolean;
     listStores(): Promise<string[]>;
     deleteStore(name: string): Promise<void>;
     transaction<R>(stores: string[], mode: string, fn: () => Promise<R>): Promise<R>;
     getStats(): Promise<StorageStats>;
   }
   ```

4. **Users choose at database creation**
   ```typescript
   const db = await Database.create({
     name: 'my-app',
     storage: createIndexedDBStorage(),
   });
   ```

## Consequences

### Positive

- **Flexibility**: Use the right storage for each use case
- **Testability**: Memory adapter makes tests fast and isolated
- **Future-proof**: New storage APIs can be added without changing core
- **Fallback support**: Apps can fallback when preferred storage unavailable
- **Smaller bundles**: Only include adapters you use

### Negative

- **More packages**: Users must install adapter packages separately
- **API surface**: Interface must be stable across adapters
- **Feature parity**: Not all adapters support all features equally
- **Documentation**: Need to document each adapter

### Neutral

- **No default**: Users must explicitly choose a storage adapter
- **Trade-offs visible**: Forces users to understand storage options

## Implementation

### Adapter Selection Pattern

```typescript
// Graceful degradation
const storage = createOPFSStorage().isAvailable()
  ? createOPFSStorage()
  : createIndexedDBStorage().isAvailable()
    ? createIndexedDBStorage()
    : createMemoryStorage();

const db = await Database.create({
  name: 'my-app',
  storage,
});
```

### Feature Detection

Each adapter implements `isAvailable()`:

```typescript
// IndexedDB adapter
isAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

// OPFS adapter
isAvailable(): boolean {
  return typeof navigator !== 'undefined'
    && 'storage' in navigator
    && 'getDirectory' in navigator.storage;
}
```

## Alternatives Considered

### 1. Single Built-in Storage

Use IndexedDB directly without abstraction.

Rejected because:
- No fallback for environments without IndexedDB
- Testing requires IndexedDB mocks
- Can't optimize for specific use cases

### 2. Auto-Detection

Automatically choose the best available storage.

Rejected because:
- "Best" is subjective and use-case dependent
- Surprising behavior when storage changes
- Harder to test deterministically

### 3. Configuration-Based

Single package with configuration options.

```typescript
const db = await Database.create({
  name: 'my-app',
  storageType: 'indexeddb', // or 'opfs', 'memory'
});
```

Rejected because:
- Bundles all adapter code even if unused
- Less flexible for custom adapters
- Harder to tree-shake

## References

- [Dexie.js - Uses IndexedDB with abstraction](https://dexie.org/)
- [PouchDB - Pluggable adapters](https://pouchdb.com/adapters.html)
- [localForage - Storage abstraction library](https://localforage.github.io/localForage/)
