# Development Guide

This guide covers advanced development topics for contributors working on Pocket's internals.

## Table of Contents

- [Development Environment](#development-environment)
- [Package Development](#package-development)
- [Testing Strategies](#testing-strategies)
- [Debugging](#debugging)
- [Performance Profiling](#performance-profiling)
- [Release Process](#release-process)
- [Common Tasks](#common-tasks)

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

### Monorepo Structure

```
pocket/
├── packages/           # All publishable packages
│   ├── core/          # @pocket/core
│   ├── react/         # @pocket/react
│   ├── sync/          # @pocket/sync
│   └── ...
├── examples/          # Example applications
├── test/              # Integration tests
├── docs/              # VitePress API docs (auto-generated)
├── website/           # Docusaurus documentation site (canonical)
└── benchmarks/        # Performance benchmarks
```

### Working on a Single Package

```bash
# Watch mode for a specific package
pnpm --filter @pocket/core dev

# Run tests for a specific package
pnpm --filter @pocket/core test

# Type check a specific package
pnpm --filter @pocket/core typecheck

# Build a specific package
pnpm --filter @pocket/core build
```

### Package Dependencies

```bash
# View dependency graph
pnpm why <package-name>

# Add a dependency to a package
pnpm --filter @pocket/sync add lodash

# Add a dev dependency
pnpm --filter @pocket/core add -D @types/node

# Add a workspace dependency
pnpm --filter @pocket/react add @pocket/core@workspace:*
```

### Creating a New Package

```bash
# 1. Create the package directory
mkdir packages/my-feature

# 2. Initialize with standard structure
cd packages/my-feature
pnpm init

# 3. Add required configuration files
```

Standard package structure:

```
packages/my-feature/
├── src/
│   ├── index.ts         # Public exports
│   └── *.ts             # Implementation
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

Minimal `package.json`:

```json
{
  "name": "@pocket/my-feature",
  "version": "0.1.0",
  "description": "Description of my feature",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@pocket/core": "workspace:*"
  }
}
```

## Testing Strategies

### Test Structure

```
packages/core/src/
├── database/
│   ├── collection.ts
│   └── collection.test.ts    # Unit tests co-located
├── query/
│   └── operators.test.ts
└── ...

test/                          # Integration tests
├── sync.integration.test.ts
├── storage.integration.test.ts
└── fixtures/
```

### Running Tests

```bash
# All tests (via turbo — runs per-package)
pnpm test

# Watch mode
pnpm test:watch

# With coverage
pnpm test:coverage

# Specific file
pnpm --filter @pocket/core test -- collection.test.ts

# Integration tests only
pnpm test:integration

# With verbose output
pnpm test -- --reporter=verbose

# Check which packages have no tests
pnpm test:audit
```

> **Note:** Running `vitest run` directly at the repository root (instead of `pnpm test`) 
> may run out of memory with 44 packages. If you encounter OOM errors, increase the
> Node.js heap size:
>
> ```bash
> NODE_OPTIONS="--max-old-space-size=8192" pnpm test:coverage
> ```

### Writing Unit Tests

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../database';
import { createMemoryStorage } from '@pocket/storage-memory';

describe('Collection', () => {
  let db: Database;

  beforeEach(async () => {
    db = await Database.create({
      name: 'test-db',
      storage: createMemoryStorage(),
    });
  });

  afterEach(async () => {
    await db.close();
  });

  describe('insert', () => {
    it('should insert a document and return it with _id', async () => {
      const collection = db.collection('users');
      const doc = await collection.insert({ name: 'Alice' });

      expect(doc._id).toBeDefined();
      expect(doc.name).toBe('Alice');
    });

    it('should throw on duplicate _id', async () => {
      const collection = db.collection('users');
      await collection.insert({ _id: 'user-1', name: 'Alice' });

      await expect(
        collection.insert({ _id: 'user-1', name: 'Bob' })
      ).rejects.toThrow(/already exists/);
    });
  });
});
```

### Testing Async/Observable Code

```typescript
import { firstValueFrom, take, toArray } from 'rxjs';

describe('Live Queries', () => {
  it('should emit updates when documents change', async () => {
    const collection = db.collection('todos');

    // Collect first 3 emissions
    const emissions = collection
      .find()
      .$
      .pipe(take(3), toArray());

    const emissionsPromise = firstValueFrom(emissions);

    // Trigger changes
    await collection.insert({ title: 'Todo 1' });
    await collection.insert({ title: 'Todo 2' });

    const results = await emissionsPromise;

    expect(results).toHaveLength(3);
    expect(results[0]).toHaveLength(0);  // Initial empty
    expect(results[1]).toHaveLength(1);  // After first insert
    expect(results[2]).toHaveLength(2);  // After second insert
  });
});
```

### Mocking

```typescript
import { vi } from 'vitest';

// Mock a module
vi.mock('@pocket/core', () => ({
  Database: {
    create: vi.fn().mockResolvedValue({
      collection: vi.fn(),
    }),
  },
}));

// Mock timers
vi.useFakeTimers();
await vi.advanceTimersByTimeAsync(1000);
vi.useRealTimers();

// Spy on a method
const spy = vi.spyOn(collection, 'insert');
await collection.insert({ name: 'Test' });
expect(spy).toHaveBeenCalledWith({ name: 'Test' });
```

### Testing IndexedDB (Browser APIs)

We use `fake-indexeddb` for testing IndexedDB code:

```typescript
import 'fake-indexeddb/auto';
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';

describe('IndexedDB Storage', () => {
  it('should persist documents', async () => {
    const storage = createIndexedDBStorage();
    await storage.set('users', 'user-1', { name: 'Alice' });

    const doc = await storage.get('users', 'user-1');
    expect(doc).toEqual({ name: 'Alice' });
  });
});
```

## Debugging

### Debug Logging

```typescript
// Enable debug output
DEBUG=pocket:* pnpm test

// Specific namespaces
DEBUG=pocket:sync,pocket:storage pnpm dev

// In code
import { debug } from './logger';
const log = debug('pocket:sync');
log('Syncing %d documents', docs.length);
```

### VS Code Debugging

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run", "--reporter=verbose", "${relativeFile}"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Current Package Tests",
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run", "--reporter=verbose"],
      "cwd": "${fileDirname}/../..",
      "console": "integratedTerminal"
    }
  ]
}
```

### Browser Debugging

```typescript
// DevTools integration
import { initDevTools } from '@pocket/devtools';

const db = await createDatabase({ ... });
initDevTools(db);

// Now available via the DevTools bridge inspector
```

### Common Issues

**Out of memory when running tests at root:**
```bash
# The monorepo has 44 packages — running vitest directly at root may OOM.
# Use turbo (pnpm test) or increase heap size:
NODE_OPTIONS="--max-old-space-size=8192" pnpm test:coverage
```

**Tests hang or timeout:**
```bash
# Check for unresolved promises
pnpm test -- --no-threads

# Increase timeout
pnpm test -- --test-timeout=30000
```

**IndexedDB errors in tests:**
```typescript
// Ensure fake-indexeddb is imported before any IndexedDB usage
import 'fake-indexeddb/auto';
```

**RxJS subscription leaks:**
```typescript
// Always unsubscribe in afterEach
let subscription: Subscription;

beforeEach(() => {
  subscription = observable.subscribe(...);
});

afterEach(() => {
  subscription?.unsubscribe();
});
```

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

### Versioning with Changesets

```bash
# 1. Create a changeset for your changes
pnpm changeset

# 2. Select affected packages and version bump type
# - patch: Bug fixes
# - minor: New features (backwards compatible)
# - major: Breaking changes

# 3. Write a summary for the changelog
```

### Release Workflow

```bash
# 1. Ensure main is up to date
git checkout main
git pull

# 2. Version packages (maintainers only)
pnpm changeset version

# 3. Review generated CHANGELOG.md entries

# 4. Commit version bumps
git add .
git commit -m "chore: version packages"

# 5. Publish to npm (maintainers only)
pnpm release

# 6. Push tags
git push --follow-tags
```

### Pre-release Versions

```bash
# Enter pre-release mode
pnpm changeset pre enter alpha

# Create changesets and version as normal
pnpm changeset
pnpm changeset version

# Exit pre-release mode
pnpm changeset pre exit
```

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
> The `docs/` directory contains VitePress-based API reference pages that are auto-generated.
> When writing or updating user-facing documentation, edit files under `website/docs/`.

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
