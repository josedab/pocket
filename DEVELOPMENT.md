# Development Guide

This guide covers advanced development topics for contributors working on Pocket's internals.

## System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Node.js | 18.0.0 | 20+ (see `.nvmrc`) |
| pnpm | 8.12.0 | Latest 8.x |
| RAM | 8 GB | 16 GB (for full test suite) |
| Disk | 2 GB | 4 GB (with node_modules + build artifacts) |

> ⚠️ **Memory Warning**: With 70+ packages, running `vitest run` at the root may cause out-of-memory errors. Use the Turbo-based test runner (`pnpm test`) which isolates per-package, or set:
> ```bash
> export NODE_OPTIONS="--max-old-space-size=8192"
> ```
> Add this to your shell profile (`.bashrc`, `.zshrc`) for persistent configuration.
> For targeted testing, run tests per-package: `npx vitest run --project unit packages/<name>/src/__tests__/`

## Table of Contents

- [Development Environment](#development-environment)
- [Package Development](#package-development)
- [Testing Strategies](#testing-strategies) → [Full Guide](website/docs/guides/testing.md)
- [Debugging](#debugging)
- [Performance Profiling](#performance-profiling)
- [Release Process](#release-process)
- [Common Tasks](#common-tasks)
- [Code Style Reference](#code-style-reference)

## Development Environment

### Prerequisites

```bash
# Required (recommended: Node 20 — see .nvmrc)
node --version  # >= 18.0.0
pnpm --version  # >= 8.12.0

# If using nvm, switch to the recommended version:
nvm use

# Recommended tools
code --version  # VS Code with extensions
```

### Recommended VS Code Extensions

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "vitest.explorer",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-typescript-next"
  ]
}
```

### Initial Setup

```bash
# Clone and install
git clone https://github.com/pocket-db/pocket.git
cd pocket
pnpm install

# Build all packages (required before running tests)
pnpm build

# Verify setup
pnpm test
pnpm typecheck
```

### Environment Variables

Create `.env.local` for local development:

```bash
# Optional: Enable debug logging
DEBUG=pocket:*

# Optional: Test server configuration
SYNC_SERVER_PORT=3001
SYNC_SERVER_HOST=localhost
```

## Package Development

The monorepo uses pnpm workspaces with per-package builds via tsup. Use `pnpm --filter @pocket/<name>` to work on individual packages, and `node scripts/create-package.mjs` to scaffold new ones.

## Testing Strategies

Tests are co-located with source files (`*.test.ts`). Integration tests live in the top-level `test/` directory. Use `pnpm test` (turbo-based) to run all tests safely without OOM issues.

📖 **[Full Testing Guide →](website/docs/guides/testing.md)**

## Debugging

Enable debug logging with `DEBUG=pocket:*`, use VS Code launch configurations for breakpoint debugging, and integrate `@pocket/devtools` for browser inspection.

## Performance Profiling

### Running Benchmarks

```bash
# Run all benchmarks
pnpm bench

# Specific benchmark
pnpm --filter @pocket/benchmarks bench -- insert
```

### Creating Benchmarks

```typescript
// benchmarks/insert.bench.ts
import { bench, describe } from 'vitest';

describe('Insert Performance', () => {
  bench('single insert', async () => {
    await collection.insert({ name: 'Test' });
  });

  bench('bulk insert 1000 docs', async () => {
    const docs = Array.from({ length: 1000 }, (_, i) => ({
      name: `User ${i}`,
    }));
    await collection.bulkInsert(docs);
  });
});
```

### Memory Profiling

```bash
# Generate heap snapshot
node --inspect packages/core/dist/index.js

# Memory usage during tests
node --expose-gc node_modules/vitest/vitest.mjs run --reporter=verbose
```

### Bundle Size Analysis

```bash
# Check bundle sizes
pnpm size-limit

# Analyze bundle contents
pnpm --filter @pocket/core build
npx source-map-explorer packages/core/dist/index.js
```

## Release Process

Pocket uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing. Contributors create changesets with `pnpm changeset`; maintainers handle version bumps and npm publishing.

## Common Tasks

### Adding a New Hook to @pocket/react

```typescript
// 1. Create the hook
// packages/react/src/hooks/useMyFeature.ts
export function useMyFeature(options: MyFeatureOptions) {
  const db = useDatabase();
  // Implementation
  return { data, loading, error };
}

// 2. Export from index
// packages/react/src/index.ts
export { useMyFeature } from './hooks/useMyFeature';

// 3. Add tests
// packages/react/src/hooks/useMyFeature.test.tsx

// 4. Update documentation
// website/docs/api/react-hooks.md
```

### Adding a New Storage Adapter

```typescript
// 1. Implement StorageAdapter interface
// packages/storage-my-adapter/src/adapter.ts
import { StorageAdapter } from '@pocket/core';

export function createMyStorage(): StorageAdapter {
  return {
    async get(collection, id) { /* ... */ },
    async set(collection, id, doc) { /* ... */ },
    async delete(collection, id) { /* ... */ },
    async query(collection, options) { /* ... */ },
    // ... other methods
  };
}

// 2. Export factory function
// packages/storage-my-adapter/src/index.ts
export { createMyStorage } from './adapter';
export type { MyStorageOptions } from './types';
```

### Adding a New Plugin

```typescript
// 1. Define plugin interface
// packages/my-plugin/src/types.ts
export interface MyPluginOptions {
  // Options
}

// 2. Implement plugin
// packages/my-plugin/src/plugin.ts
import { Plugin } from '@pocket/core';

export function createMyPlugin(options: MyPluginOptions): Plugin {
  return {
    name: 'my-plugin',
    version: '1.0.0',

    install(context) {
      context.hooks.beforeInsert(async (doc) => {
        // Transform document
        return doc;
      });
    },
  };
}
```

### Updating Dependencies

```bash
# Check for outdated packages
pnpm outdated

# Update all packages interactively
pnpm update -i

# Update a specific package
pnpm update typescript --recursive

# Check for security issues
pnpm audit
```

### Generating API Documentation

```bash
# Generate TypeDoc output
pnpm docs:api

# Preview the documentation site locally (Docusaurus — canonical docs)
pnpm docs:dev
```

> **Note:** The `website/` directory contains the canonical Docusaurus documentation site.
> The `docs/` directory is **deprecated** for user-facing content and retained only for auto-generated TypeDoc API reference output.
> When writing or updating documentation, **always edit files under `website/docs/`**.
> Architecture Decision Records (ADRs) are in `website/docs/adr/`.

## Code Style Reference

### File Organization

```typescript
// 1. Imports (external, then internal, then relative)
import { Observable } from 'rxjs';
import { Document } from '@pocket/core';
import { helper } from './utils';

// 2. Types and interfaces
interface MyOptions {
  name: string;
}

// 3. Constants
const DEFAULT_OPTIONS: MyOptions = { name: 'default' };

// 4. Main implementation
export class MyClass {
  // ...
}

// 5. Helper functions (private)
function helperFunction() {
  // ...
}
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files | kebab-case | `query-builder.ts` |
| Classes | PascalCase | `QueryBuilder` |
| Functions | camelCase | `createDatabase` |
| Constants | UPPER_SNAKE | `DEFAULT_TIMEOUT` |
| Types/Interfaces | PascalCase | `DatabaseConfig` |
| Test files | `*.test.ts` | `collection.test.ts` |

### JSDoc Style

```typescript
/**
 * Creates a new database instance.
 *
 * @param config - Configuration options for the database
 * @returns A promise that resolves to the database instance
 *
 * @example
 * ```typescript
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createIndexedDBStorage(),
 * });
 * ```
 *
 * @throws {DatabaseError} If the database already exists
 *
 * @see {@link DatabaseConfig} for configuration options
 */
export async function create(config: DatabaseConfig): Promise<Database> {
  // Implementation
}
```

## See Also

- [Architecture Overview](/ARCHITECTURE.md)
- [Contributing Guidelines](/CONTRIBUTING.md)
- [API Reference](/docs/api/)
- [Changelog](/CHANGELOG.md)
