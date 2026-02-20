# @pocket/expo

Expo integration for Pocket database.

## Installation

```bash
pnpm add @pocket/expo
```

## Features

- Expo SQLite storage adapter for on-device persistence
- Expo FileSystem storage adapter as an alternative backend
- Re-exports core Pocket types for convenience
- Works with Expo managed and bare workflows

## Usage

```typescript
import { createExpoSQLiteStorage } from '@pocket/expo';
import { createDatabase } from '@pocket/core';

const storage = createExpoSQLiteStorage({ dbName: 'myapp.db' });
const db = createDatabase({ storage });
```

## API Reference

- `createExpoSQLiteStorage` — SQLite-based storage adapter for Expo
- `createExpoFileSystemStorage` — File system-based storage adapter for Expo
- Re-exports: `Collection`, `Database`, `Document`, `QueryBuilder`, `StorageAdapter` from `@pocket/core`

## License

MIT
