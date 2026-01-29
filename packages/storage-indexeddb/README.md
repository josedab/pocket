# @pocket/storage-indexeddb

IndexedDB storage adapter for Pocket - persistent browser storage.

## Installation

```bash
npm install @pocket/storage-indexeddb
```

## Quick Start

```typescript
import { Database } from '@pocket/core';
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage()
});

// Data persists in browser IndexedDB
const todos = db.collection<Todo>('todos');
await todos.insert({ title: 'Persistent todo' });
```

## Features

- **Persistent Storage**: Data survives browser restarts
- **Large Capacity**: Typically 50%+ of available disk space
- **Index Support**: Create indexes for efficient queries
- **Automatic Versioning**: Schema migrations handled automatically
- **Universal Support**: Works in all modern browsers

## Browser Support

| Browser | Version |
|---------|---------|
| Chrome | 24+ |
| Firefox | 16+ |
| Safari | 10+ |
| Edge | 12+ |

## Configuration

```typescript
const storage = createIndexedDBStorage({
  // Custom IndexedDB factory (for testing)
  indexedDB: fakeIndexedDB
});
```

## Testing

Use fake-indexeddb for testing:

```typescript
import 'fake-indexeddb/auto';
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';

const storage = createIndexedDBStorage({
  indexedDB: indexedDB // Injected by fake-indexeddb
});
```

## When to Use

**Use IndexedDB when:**
- Building web applications
- Need persistent storage
- Universal browser support required

**Consider alternatives when:**
- Need higher performance (use OPFS)
- Server-side (use SQLite)
- Testing (use Memory)

## API Reference

### createIndexedDBStorage(options?)

Creates an IndexedDB storage adapter.

**Options:**
| Option | Type | Description |
|--------|------|-------------|
| `indexedDB` | IDBFactory | Custom IndexedDB instance |

**Returns:** `IndexedDBAdapter`

## Documentation

- [Storage Guide](https://pocket.dev/docs/storage)
- [IndexedDB Reference](https://pocket.dev/docs/storage/indexeddb)

## License

MIT
