# @pocket/crdt

[![npm version](https://img.shields.io/npm/v/@pocket/crdt.svg)](https://www.npmjs.com/package/@pocket/crdt)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CRDT (Conflict-free Replicated Data Types) for Pocket local-first database

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/crdt
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { GCounter, LWWRegister, ORSet } from '@pocket/crdt';

// Grow-only counter
const counter = new GCounter('node-1');
counter.increment(5);

// Last-writer-wins register
const register = new LWWRegister('node-1', 'initial value');
register.set('updated value');

// Observed-remove set
const set = new ORSet('node-1');
set.add('item-1');
```

## API

| Export | Description |
|--------|-------------|
| `GCounter` | Grow-only counter CRDT |
| `LWWRegister` | Last-writer-wins register |
| `ORSet` | Observed-remove set |
| `LWWMap` | Last-writer-wins map |
| `DocumentCRDT` | Document-level CRDT for Pocket documents |
| `createCRDTSyncBridge(config)` | Bridge between CRDTs and Pocket sync |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/crdt

# Test
npx vitest run --project unit packages/crdt/src/__tests__/

# Watch mode
npx vitest --project unit packages/crdt/src/__tests__/
```

## License

MIT
