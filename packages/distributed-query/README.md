# @pocket/distributed-query

[![npm version](https://img.shields.io/npm/v/@pocket/distributed-query.svg)](https://www.npmjs.com/package/@pocket/distributed-query)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Distributed query execution for Pocket - decompose, route and aggregate queries across nodes

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/distributed-query
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createDistributedQueryEngine, createNodeRegistry } from '@pocket/distributed-query';

const registry = createNodeRegistry();
registry.register({ id: 'node-1', endpoint: 'ws://localhost:3001' });

const engine = createDistributedQueryEngine({ registry });
const results = await engine.query({
  collection: 'orders',
  filter: { status: 'pending' },
});
```

## API

| Export | Description |
|--------|-------------|
| `createDistributedQueryEngine(config)` | Execute queries across distributed nodes |
| `createNodeRegistry()` | Register and discover query nodes |
| `createQueryDecomposer(config)` | Decompose queries into sub-queries |
| `createResultAggregator(config)` | Aggregate results from multiple nodes |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/distributed-query

# Test
npx vitest run --project unit packages/distributed-query/src/__tests__/

# Watch mode
npx vitest --project unit packages/distributed-query/src/__tests__/
```

## License

MIT
