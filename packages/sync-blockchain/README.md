# @pocket/sync-blockchain

[![npm version](https://img.shields.io/npm/v/@pocket/sync-blockchain.svg)](https://www.npmjs.com/package/@pocket/sync-blockchain)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Decentralized P2P sync via content-addressed storage with blockchain audit trails for Pocket

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/sync-blockchain
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createBlockchainSync } from '@pocket/sync-blockchain';

const sync = createBlockchainSync({
  database: db,
  peers: ['ws://peer1:3001', 'ws://peer2:3001'],
});

await sync.start();
```

## API

| Export | Description |
|--------|-------------|
| `createBlockchainSync(config)` | P2P sync with content-addressed storage |
| `ContentAddressedStore` | Content-addressed document storage |
| `BlockchainAuditLog` | Blockchain-based audit trail |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/sync-blockchain

# Test
npx vitest run --project unit packages/sync-blockchain/src/__tests__/

# Watch mode
npx vitest --project unit packages/sync-blockchain/src/__tests__/
```

## License

MIT
