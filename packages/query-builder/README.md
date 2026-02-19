# @pocket/query-builder

[![npm version](https://img.shields.io/npm/v/@pocket/query-builder.svg)](https://www.npmjs.com/package/@pocket/query-builder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Programmatic query builder with type-safe fluent API for Pocket databases

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/query-builder
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createQueryBuilder } from '@pocket/query-builder';

const query = createQueryBuilder<Todo>()
  .where('completed', '==', false)
  .where('priority', '>=', 3)
  .orderBy('createdAt', 'desc')
  .limit(10)
  .build();

const results = await collection.find(query);
```

## API

| Export | Description |
|--------|-------------|
| `createQueryBuilder<T>()` | Create a type-safe fluent query builder |
| `createQuerySerializer()` | Serialize queries to/from JSON |
| `createVisualBuilder()` | Visual query builder for UI integration |
| `createQueryTemplateRegistry()` | Manage reusable query templates |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/query-builder

# Test
npx vitest run --project unit packages/query-builder/src/__tests__/

# Watch mode
npx vitest --project unit packages/query-builder/src/__tests__/
```

## License

MIT
