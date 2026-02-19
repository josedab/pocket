# @pocket/migration

[![npm version](https://img.shields.io/npm/v/@pocket/migration.svg)](https://www.npmjs.com/package/@pocket/migration)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

One-click migration toolkit for migrating from PouchDB, RxDB, Dexie, and Firestore to Pocket

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/migration
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createPouchDBMigrator } from '@pocket/migration';

const migrator = createPouchDBMigrator({
  source: pouchDB,
  target: pocketDB,
});

const result = await migrator.migrate({
  collections: ['todos', 'users'],
  batchSize: 100,
});

console.log(`Migrated ${result.documentsProcessed} documents`);
```

## API

| Export | Description |
|--------|-------------|
| `createPouchDBMigrator(config)` | Migrate from PouchDB to Pocket |
| `createRxDBMigrator(config)` | Migrate from RxDB to Pocket |
| `createDexieMigrator(config)` | Migrate from Dexie.js to Pocket |
| `createFirestoreMigrator(config)` | Migrate from Firestore to Pocket |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/migration

# Test
npx vitest run --project unit packages/migration/src/__tests__/

# Watch mode
npx vitest --project unit packages/migration/src/__tests__/
```

## License

MIT
