# @pocket/graphql

[![npm version](https://img.shields.io/npm/v/@pocket/graphql.svg)](https://www.npmjs.com/package/@pocket/graphql)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Auto-generated GraphQL schema and resolvers for Pocket collections

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/graphql
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { generateSchema, generateResolvers } from '@pocket/graphql';

const schema = generateSchema(db, {
  collections: ['todos', 'users'],
});

const resolvers = generateResolvers(db, {
  collections: ['todos', 'users'],
});
```

## API

| Export | Description |
|--------|-------------|
| `generateSchema(db, options)` | Auto-generate GraphQL schema from collections |
| `generateResolvers(db, options)` | Auto-generate resolvers for CRUD operations |
| `createResolverContext(db)` | Create a resolver context with database access |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/graphql

# Test
npx vitest run --project unit packages/graphql/src/__tests__/

# Watch mode
npx vitest --project unit packages/graphql/src/__tests__/
```

## License

MIT
