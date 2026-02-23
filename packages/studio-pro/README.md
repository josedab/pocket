# @pocket/studio-pro

Visual Schema Designer & Studio Pro for Pocket — schema inspection, query playground engine, and sync dashboard data.

## Installation

```bash
pnpm add @pocket/studio-pro
```

## Features

- Schema inspector for browsing collections, fields, and indexes
- Interactive query playground for testing queries
- Sync dashboard for monitoring replication status
- Data inspector for exploring documents

## Usage

```typescript
import { createSchemaInspector, createQueryPlayground } from '@pocket/studio-pro';

const inspector = createSchemaInspector(db);
const schemas = await inspector.listCollections();

const playground = createQueryPlayground(db);
const result = await playground.execute({ collection: 'users', filter: { active: true } });
```

## API Reference

- `createSchemaInspector` / `SchemaInspector` — Inspect database schemas
- `createQueryPlayground` / `QueryPlayground` — Interactive query execution
- `createSyncDashboard` / `SyncDashboard` — Sync status monitoring
- `createDataInspector` / `DataInspector` — Document data exploration

## License

MIT
