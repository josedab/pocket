# @pocket/cloud

[![npm version](https://img.shields.io/npm/v/@pocket/cloud.svg)](https://www.npmjs.com/package/@pocket/cloud)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Managed cloud sync service for Pocket - one-line sync setup

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/cloud
```

**Peer dependencies:** `@pocket/core`, `@pocket/sync`

## Usage

```typescript
import { createCloudSync } from '@pocket/cloud';

// One-line cloud sync setup
const sync = createCloudSync({
  database: db,
  projectId: 'my-project',
  apiKey: 'pk_live_xxx',
});

await sync.start();
```

## API

| Export | Description |
|--------|-------------|
| `createCloudSync(config)` | One-line managed sync with Pocket Cloud |
| `createCloudClient(config)` | Low-level cloud API client |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/cloud

# Test
npx vitest run --project unit packages/cloud/src/__tests__/

# Watch mode
npx vitest --project unit packages/cloud/src/__tests__/
```

## License

MIT
