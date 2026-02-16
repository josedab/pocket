# @pocket/plugin-sdk

[![npm version](https://img.shields.io/npm/v/@pocket/plugin-sdk.svg)](https://www.npmjs.com/package/@pocket/plugin-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Plugin SDK for building, testing, and publishing Pocket plugins

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/plugin-sdk
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createPluginBuilder, validateManifest } from '@pocket/plugin-sdk';

const plugin = createPluginBuilder('my-plugin')
  .version('1.0.0')
  .hook('beforeInsert', async (doc) => {
    doc.updatedAt = new Date();
    return doc;
  })
  .build();

// Validate before publishing
const result = validateManifest(plugin.manifest);
```

## API

| Export | Description |
|--------|-------------|
| `createPluginBuilder(name)` | Fluent API for building Pocket plugins |
| `validateManifest(manifest)` | Validate a plugin manifest |
| `createRegistryClient(config)` | Publish and fetch plugins from a registry |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/plugin-sdk

# Test
npx vitest run --project unit packages/plugin-sdk/src/__tests__/

# Watch mode
npx vitest --project unit packages/plugin-sdk/src/__tests__/
```

## License

MIT
