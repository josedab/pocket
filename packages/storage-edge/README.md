# @pocket/storage-edge

[![npm version](https://img.shields.io/npm/v/@pocket/storage-edge.svg)](https://www.npmjs.com/package/@pocket/storage-edge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Edge runtime storage adapters for Pocket - Cloudflare Durable Objects, Cloudflare KV, D1, Deno KV, Vercel KV, Bun SQLite

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/storage-edge
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createCloudflareKVStorage, createD1Storage } from '@pocket/storage-edge';

// Cloudflare Workers
const storage = createCloudflareKVStorage({ namespace: KV });

// Cloudflare D1
const d1Storage = createD1Storage({ database: env.DB });

// Deno KV
import { createDenoKVStorage } from '@pocket/storage-edge';
const denoStorage = createDenoKVStorage();
```

## API

| Export | Description |
|--------|-------------|
| `createCloudflareKVStorage(config)` | Cloudflare KV storage adapter |
| `createDurableObjectStorage(config)` | Cloudflare Durable Objects adapter |
| `createD1Storage(config)` | Cloudflare D1 (SQLite) adapter |
| `createDenoKVStorage(config)` | Deno KV storage adapter |
| `createVercelKVStorage(config)` | Vercel KV storage adapter |
| `createBunSQLiteStorage(config)` | Bun native SQLite adapter |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/storage-edge

# Test
npx vitest run --project unit packages/storage-edge/src/__tests__/

# Watch mode
npx vitest --project unit packages/storage-edge/src/__tests__/
```

## License

MIT
