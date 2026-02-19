# @pocket/storage-expo-sqlite

[![npm version](https://img.shields.io/npm/v/@pocket/storage-expo-sqlite.svg)](https://www.npmjs.com/package/@pocket/storage-expo-sqlite)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Expo SQLite storage adapter for Pocket - native SQLite performance on mobile

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/storage-expo-sqlite
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createExpoSQLiteStorage } from '@pocket/storage-expo-sqlite';
import * as SQLite from 'expo-sqlite';

const storage = createExpoSQLiteStorage({
  database: SQLite.openDatabaseAsync('pocket.db'),
});

const db = await createDatabase({
  name: 'my-app',
  storage,
});
```

## API

| Export | Description |
|--------|-------------|
| `createExpoSQLiteStorage(config)` | Create an Expo SQLite storage adapter |
| `ExpoSQLiteAdapter` | Low-level SQLite adapter class |
| `BackgroundSyncManager` | Manage background sync on mobile |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/storage-expo-sqlite

# Test
npx vitest run --project unit packages/storage-expo-sqlite/src/__tests__/

# Watch mode
npx vitest --project unit packages/storage-expo-sqlite/src/__tests__/
```

## License

MIT
