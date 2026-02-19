# @pocket/audit-trail

[![npm version](https://img.shields.io/npm/v/@pocket/audit-trail.svg)](https://www.npmjs.com/package/@pocket/audit-trail)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Blockchain audit trail for Pocket - tamper-evident logging with Merkle tree verification

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/audit-trail
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createAuditStore, createMerkleTree } from '@pocket/audit-trail';

const audit = createAuditStore({ database: db });

// Log an auditable action
await audit.append({
  action: 'document.update',
  actor: 'user-123',
  resource: 'invoice-456',
});

// Verify integrity with Merkle tree
const tree = createMerkleTree();
const proof = tree.getProof(entryHash);
```

## API

| Export | Description |
|--------|-------------|
| `createAuditStore(config)` | Create a tamper-evident audit log |
| `createMerkleTree()` | Build a Merkle tree for integrity verification |
| `computeHash(data)` | Compute a cryptographic hash of audit data |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/audit-trail

# Test
npx vitest run --project unit packages/audit-trail/src/__tests__/

# Watch mode
npx vitest --project unit packages/audit-trail/src/__tests__/
```

## License

MIT
