# @pocket/polyglot

[![npm version](https://img.shields.io/npm/v/@pocket/polyglot.svg)](https://www.npmjs.com/package/@pocket/polyglot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Cross-database polyglot queries for Pocket - federate queries across multiple database adapters

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/polyglot
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createQueryFederation, createMemoryAdapter } from '@pocket/polyglot';

const federation = createQueryFederation({
  adapters: {
    pocket: pocketAdapter,
    postgres: postgresAdapter,
  },
});

// Query across multiple databases
const results = await federation.query({
  from: 'pocket:todos',
  join: 'postgres:users',
  on: { 'todos.userId': 'users.id' },
});
```

## API

| Export | Description |
|--------|-------------|
| `createQueryFederation(config)` | Federate queries across database adapters |
| `createMemoryAdapter()` | In-memory adapter for testing |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/polyglot

# Test
npx vitest run --project unit packages/polyglot/src/__tests__/

# Watch mode
npx vitest --project unit packages/polyglot/src/__tests__/
```

## License

MIT
