# @pocket/rls

[![npm version](https://img.shields.io/npm/v/@pocket/rls.svg)](https://www.npmjs.com/package/@pocket/rls)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Multi-tenancy and row-level security for Pocket - enforce data access policies and tenant isolation

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/rls
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createPolicyEngine, createTenantManager } from '@pocket/rls';

const policies = createPolicyEngine({
  database: db,
  policies: [
    {
      collection: 'documents',
      action: 'read',
      condition: (doc, user) => doc.tenantId === user.tenantId,
    },
  ],
});

const tenants = createTenantManager({ database: db });
await tenants.createTenant({ id: 'org-1', name: 'Acme Corp' });
```

## API

| Export | Description |
|--------|-------------|
| `createPolicyEngine(config)` | Enforce row-level security policies |
| `createTenantManager(config)` | Multi-tenant data isolation |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/rls

# Test
npx vitest run --project unit packages/rls/src/__tests__/

# Watch mode
npx vitest --project unit packages/rls/src/__tests__/
```

## License

MIT
