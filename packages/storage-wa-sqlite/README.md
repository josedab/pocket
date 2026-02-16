# @pocket/storage-wa-sqlite

[![npm version](https://img.shields.io/npm/v/@pocket/storage-wa-sqlite.svg)](https://www.npmjs.com/package/@pocket/storage-wa-sqlite)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

WebAssembly SQLite storage adapter for Pocket - SQL-grade performance in the browser

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/storage-wa-sqlite
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createWaSQLiteStorage } from '@pocket/storage-wa-sqlite';

const storage = createWaSQLiteStorage({
  filename: 'pocket.db',
});

const db = await createDatabase({
  name: 'my-app',
  storage,
});
```

## API

| Export | Description |
|--------|-------------|
| `createWaSQLiteStorage(config)` | Create a wa-sqlite storage adapter |
| `WaSQLiteAdapter` | Low-level WebAssembly SQLite adapter |
| `SQLiteDocumentStore` | Document store backed by SQLite |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/storage-wa-sqlite

# Test
npx vitest run --project unit packages/storage-wa-sqlite/src/__tests__/

# Watch mode
npx vitest --project unit packages/storage-wa-sqlite/src/__tests__/
```

## License

MIT
