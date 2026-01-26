# @pocket/storage-opfs

Origin Private File System (OPFS) storage adapter for Pocket - high-performance file-based storage.

## Installation

```bash
npm install @pocket/storage-opfs
```

## Quick Start

```typescript
import { Database } from '@pocket/core';
import { createOPFSStorage } from '@pocket/storage-opfs';

const db = await Database.create({
  name: 'my-app',
  storage: createOPFSStorage({
    workerUrl: '/workers/opfs-worker.js',
    useWorker: true
  })
});

// High-performance persistent storage
const todos = db.collection<Todo>('todos');
await todos.insert({ title: 'Fast todo' });
```

## Features

- **High Performance**: Synchronous file access in Web Workers
- **Large Datasets**: No practical size limits (file system based)
- **SQLite Ready**: Perfect for running SQLite in the browser
- **Origin Isolated**: Private to your origin, not visible to users
- **WAL Support**: Write-Ahead Logging for durability

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Main Thread                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    OPFSAdapter                            │  │
│  │  - Manages worker communication                          │  │
│  │  - Handles request/response messaging                    │  │
│  └─────────────────────────┬────────────────────────────────┘  │
└────────────────────────────┼────────────────────────────────────┘
                             │ postMessage
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Web Worker                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  OPFS Worker                              │  │
│  │  - Direct OPFS file access                               │  │
│  │  - Synchronous file operations                           │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Origin Private File System                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ collection1 │  │ collection2 │  │ collection3 │  ...       │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

## Worker Setup

Create `public/workers/opfs-worker.js`:

```javascript
import { handleOPFSRequest } from '@pocket/storage-opfs/worker';

self.onmessage = (event) => handleOPFSRequest(event);
```

## Browser Support

| Browser | Version | Support |
|---------|---------|---------|
| Chrome | 86+ | Full |
| Edge | 86+ | Full |
| Firefox | 111+ | Full |
| Safari | 15.2+ | Partial |

## Configuration

```typescript
const storage = createOPFSStorage({
  // URL to worker script
  workerUrl: '/workers/opfs-worker.js',

  // Use worker for operations (recommended)
  useWorker: true
});
```

## Checking Availability

```typescript
const storage = createOPFSStorage();

if (!storage.isAvailable()) {
  // Fall back to IndexedDB
  const fallback = createIndexedDBStorage();
}
```

## When to Use

**Use OPFS when:**
- Need highest browser performance
- Working with large datasets
- Running SQLite in browser
- Need file-system-like access

**Consider alternatives when:**
- Need wider browser support (use IndexedDB)
- Simple prototyping (use Memory)
- Server-side (use SQLite native)

## Performance

OPFS provides significant performance improvements over IndexedDB for large datasets:

| Operation | IndexedDB | OPFS |
|-----------|-----------|------|
| Write 10K docs | ~2000ms | ~500ms |
| Read 10K docs | ~1500ms | ~300ms |
| Clear database | ~500ms | ~50ms |

## Documentation

- [OPFS Guide](https://pocket.dev/docs/storage/opfs)
- [MDN: Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)

## License

MIT
