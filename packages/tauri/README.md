# @pocket/tauri

Tauri integration for Pocket database.

## Installation

```bash
pnpm add @pocket/tauri
```

## Features

- Tauri SQLite storage adapter for native desktop persistence
- Leverages Tauri's Rust-based SQLite bindings for performance
- Re-exports core Pocket types for convenience

## Usage

```typescript
import { createTauriSQLiteStorage } from '@pocket/tauri';
import { createDatabase } from '@pocket/core';

const storage = createTauriSQLiteStorage({ dbName: 'myapp.db' });
const db = createDatabase({ storage });
```

## API Reference

- `createTauriSQLiteStorage` — SQLite storage adapter for Tauri
- Re-exports: `Collection`, `Database`, `Document`, `QueryBuilder`, `StorageAdapter` from `@pocket/core`

## License

MIT
