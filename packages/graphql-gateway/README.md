# @pocket/graphql-gateway

[![npm version](https://img.shields.io/npm/v/@pocket/graphql-gateway.svg)](https://www.npmjs.com/package/@pocket/graphql-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

GraphQL Live Query Gateway for Pocket - auto-generate GraphQL schemas and resolvers from collections

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/graphql-gateway
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createSchemaGenerator, createResolverFactory } from '@pocket/graphql-gateway';

const schemaGen = createSchemaGenerator({ database: db });
const schema = schemaGen.generate(['todos', 'users']);

const resolvers = createResolverFactory({ database: db });

// With subscriptions for live queries
const subs = createSubscriptionManager({ database: db });
```

## API

| Export | Description |
|--------|-------------|
| `createSchemaGenerator(config)` | Generate GraphQL schemas from Pocket collections |
| `createResolverFactory(config)` | Create resolvers with DataLoader batching |
| `createSubscriptionManager(config)` | Manage GraphQL live query subscriptions |
| `createQueryComplexityAnalyzer(config)` | Analyze and limit query complexity |
| `createDataLoaderRegistry(config)` | Batch and cache database reads |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/graphql-gateway

# Test
npx vitest run --project unit packages/graphql-gateway/src/__tests__/

# Watch mode
npx vitest --project unit packages/graphql-gateway/src/__tests__/
```

## License

MIT
