# @pocket/views

[![npm version](https://img.shields.io/npm/v/@pocket/views.svg)](https://www.npmjs.com/package/@pocket/views)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Incremental materialized views for Pocket - persistent query results with O(delta) updates

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/views
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createViewManager, createViewPlugin } from '@pocket/views';

const views = createViewManager({ database: db });

// Define a materialized view
await views.create('active-todos', {
  collection: 'todos',
  filter: { completed: false },
  sort: { createdAt: 'desc' },
});

// Query the view (O(1) reads, O(delta) updates)
const activeTodos = await views.query('active-todos');

// Install as a plugin for automatic updates
db.use(createViewPlugin({ viewManager: views }));
```

## API

| Export | Description |
|--------|-------------|
| `createViewManager(config)` | Manage materialized views |
| `MaterializedView` | Individual materialized view instance |
| `createViewPlugin(config)` | Pocket plugin for automatic view updates |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/views

# Test
npx vitest run --project unit packages/views/src/__tests__/

# Watch mode
npx vitest --project unit packages/views/src/__tests__/
```

## License

MIT
