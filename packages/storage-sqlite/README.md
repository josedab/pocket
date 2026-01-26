# @pocket/storage-sqlite

SQLite storage adapter for Pocket - SQL-powered persistent storage.

## Installation

```bash
npm install @pocket/storage-sqlite
```

For browser (sql.js):
```bash
npm install sql.js
```

For Node.js (better-sqlite3):
```bash
npm install better-sqlite3
```

## Quick Start

```typescript
import { Database } from '@pocket/core';
import { createSQLiteStorage } from '@pocket/storage-sqlite';

const db = await Database.create({
  name: 'my-app',
  storage: createSQLiteStorage()
});

const todos = db.collection<Todo>('todos');
await todos.insert({ title: 'SQL-powered todo' });
```

## Features

- **Full SQL Power**: Complex queries with JSON functions
- **ACID Transactions**: Atomic, consistent, isolated, durable
- **JSON Indexing**: Create indexes on JSON document fields
- **Cross-Platform**: Browser (WASM) and Node.js (native)
- **Exportable**: Database can be serialized to Uint8Array

## Driver Backends

| Driver | Environment | Performance | Bundle Size |
|--------|-------------|-------------|-------------|
| sql.js | Browser/Node | Good | ~1MB |
| better-sqlite3 | Node.js | Excellent | Native |
| wa-sqlite | Browser | Good | ~400KB |

## Browser Setup (sql.js)

```typescript
import initSqlJs from 'sql.js';
import { createSQLiteStorage } from '@pocket/storage-sqlite';

const SQL = await initSqlJs({
  locateFile: file => `https://sql.js.org/dist/${file}`
});

const storage = createSQLiteStorage({
  driver: 'sqljs',
  sqlJsFactory: () => new SQL.Database()
});
```

## Node.js Setup (better-sqlite3)

```typescript
import { createSQLiteStorage } from '@pocket/storage-sqlite';

const storage = createSQLiteStorage({
  driver: 'better-sqlite3',
  filename: './data.db'
});
```

## Export/Import Database

```typescript
const adapter = db.storage as SQLiteStorageAdapter;

// Export
const data = adapter.export();
if (data) {
  // Save to file or IndexedDB
  const blob = new Blob([data], { type: 'application/x-sqlite3' });
}

// Import (on initialization)
const storage = createSQLiteStorage({
  driver: 'sqljs',
  sqlJsFactory: () => new SQL.Database(existingData)
});
```

## Table Schema

Each collection is stored as a table:

```sql
CREATE TABLE pocket_{collection} (
  _id TEXT PRIMARY KEY,
  _rev TEXT,
  _deleted INTEGER DEFAULT 0,
  _updatedAt INTEGER,
  _vclock TEXT,
  _data TEXT NOT NULL
);
```

## Creating Indexes

```typescript
const todos = db.collection<Todo>('todos');

// Create index on JSON field
await todos.createIndex({
  name: 'idx_todos_completed',
  fields: ['completed']
});

// Queries on 'completed' will use the index
const incomplete = await todos.find({ completed: false }).exec();
```

## When to Use

**Use SQLite when:**
- Need complex SQL queries
- Building desktop apps (Electron, Tauri)
- Need database export/import
- Familiar with SQL

**Consider alternatives when:**
- Simple web app (use IndexedDB)
- Need file system access (use OPFS)
- Testing (use Memory)

## Documentation

- [SQLite Guide](https://pocket.dev/docs/storage/sqlite)
- [sql.js Documentation](https://sql.js.org/)

## License

MIT
