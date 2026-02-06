# @pocket/studio

[![npm](https://img.shields.io/npm/v/@pocket/studio.svg)](https://www.npmjs.com/package/@pocket/studio)

Visual database management UI for Pocket — browse collections, run queries, design schemas, and profile performance.

## Installation

```bash
npm install @pocket/studio
```

## Quick Start

```typescript
import { createStudioServer } from '@pocket/studio';
import { Database } from '@pocket/core';

const db = await Database.create({ name: 'my-app', storage });

// Start the Studio server
const studio = createStudioServer({ database: db, port: 4000 });
await studio.start();
// Open http://localhost:4000 in your browser
```

## Features

- **Database Inspector** — browse collections, documents, and indexes
- **Query Playground** — write and execute queries with explain plans and history
- **Schema Designer** — visually design and modify collection schemas
- **Data Explorer** — aggregate, filter, and visualize your data
- **Performance Profiler** — profile operations and identify bottlenecks
- **Sync Inspector** — monitor real-time sync state and conflicts
- **Import/Export Manager** — import and export data in multiple formats
- **AI Query Builder** — build queries using natural language
- **Visual Timeline** — visualize document change history

## API

| Export | Description |
|--------|-------------|
| `createStudioServer(config)` | Start the Studio web server |
| `createDatabaseInspector(db)` | Inspect collections and documents |
| `createQueryPlayground(config)` | Interactive query editor |
| `createSchemaDesigner(config)` | Visual schema editing |
| `createDataExplorer(config)` | Data browsing and aggregation |
| `createPerformanceProfiler(db)` | Profile database operations |
| `createImportExportManager(config)` | Manage data import/export |

## Documentation

- [Full Documentation](https://pocket.dev/docs)
- [API Reference](https://pocket.dev/docs/api/studio)

## License

MIT
