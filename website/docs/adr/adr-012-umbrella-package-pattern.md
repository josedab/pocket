# ADR-012: Umbrella Package with Selective Re-exports

## Status

Accepted

## Context

Pocket is organized as a monorepo with multiple packages:
- `@pocket/core` - Core database engine
- `@pocket/react` - React integration
- `@pocket/sync` - Synchronization engine
- `@pocket/storage-*` - Storage adapters

This provides flexibility but creates a friction point: new users must figure out which packages to install.

```bash
# Confusing for beginners
npm install @pocket/core @pocket/react @pocket/storage-indexeddb @pocket/sync
```

Common complaints about package-per-feature monorepos:
- "Which packages do I need?"
- "Import paths are long and confusing"
- "I just want it to work"

## Decision

Provide an umbrella package `pocket` that re-exports the most common packages with a convenient API.

### Package Structure

```
pocket/
├── src/
│   ├── index.ts         # Re-exports everything
│   ├── core.ts          # Re-exports @pocket/core
│   ├── react.ts         # Re-exports @pocket/react
│   └── sync.ts          # Re-exports @pocket/sync
└── package.json
```

### Re-export Strategy

```typescript
// pocket/src/index.ts

// Core exports
export {
  Database,
  Collection,
  Document,
  type DatabaseConfig,
  type CollectionConfig,
  type QueryOptions
} from '@pocket/core';

// React exports
export {
  PocketProvider,
  useLiveQuery,
  useDocument,
  useMutation,
  useSuspenseQuery,
  useSyncStatus
} from '@pocket/react';

// Storage (default)
export { createIndexedDBStorage } from '@pocket/storage-indexeddb';

// Sync exports
export {
  createSyncEngine,
  type SyncConfig,
  type SyncStatus
} from '@pocket/sync';
```

### Usage Comparison

**Before (individual packages):**
```typescript
import { Database } from '@pocket/core';
import { PocketProvider, useLiveQuery } from '@pocket/react';
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';
import { createSyncEngine } from '@pocket/sync';
```

**After (umbrella package):**
```typescript
import {
  Database,
  PocketProvider,
  useLiveQuery,
  createSyncEngine
} from 'pocket';
```

### Selective Imports (Advanced Users)

Power users can still import from specific paths for optimal tree-shaking:

```typescript
// Only core, no React
import { Database } from 'pocket/core';

// Only React hooks
import { useLiveQuery } from 'pocket/react';
```

### Package.json Exports

```json
{
  "name": "pocket",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./core": {
      "import": "./dist/core.js",
      "types": "./dist/core.d.ts"
    },
    "./react": {
      "import": "./dist/react.js",
      "types": "./dist/react.d.ts"
    },
    "./sync": {
      "import": "./dist/sync.js",
      "types": "./dist/sync.d.ts"
    }
  },
  "dependencies": {
    "@pocket/core": "workspace:*",
    "@pocket/react": "workspace:*",
    "@pocket/storage-indexeddb": "workspace:*",
    "@pocket/sync": "workspace:*"
  }
}
```

### What's Included vs. Excluded

**Included in umbrella:**
| Package | Reason |
|---------|--------|
| `@pocket/core` | Always needed |
| `@pocket/react` | Most users are React developers |
| `@pocket/storage-indexeddb` | Best default for web |
| `@pocket/sync` | Core feature for most apps |

**Excluded from umbrella:**
| Package | Reason |
|---------|--------|
| `@pocket/storage-opfs` | Specialized, not always needed |
| `@pocket/storage-sqlite` | Node.js/React Native only |
| `@pocket/storage-memory` | Testing only |
| `@pocket/react-native` | Different platform |
| `@pocket/devtools` | Development only |

### Documentation Priority

```markdown
# Quick Start

Install the all-in-one package:
npm install pocket

# Advanced Setup

For more control, install individual packages:
npm install @pocket/core @pocket/react
```

## Consequences

### Positive

- **Simple onboarding**: One package to install
- **Discoverable API**: All exports in one place
- **Less documentation**: Fewer "which package" questions
- **IDE support**: Better autocomplete from single import
- **Still flexible**: Individual packages remain available

### Negative

- **Larger default install**: Includes packages user may not need
- **Version coupling**: All sub-packages move together
- **Potential confusion**: Two ways to import same thing
- **Bundle size risk**: Easy to import unused code

### Mitigations

1. **Tree-shaking**: Modern bundlers eliminate unused exports
2. **Documentation**: Clearly explain when to use umbrella vs. individual
3. **Size budgets**: Umbrella package has its own size limit
4. **Subpath exports**: `pocket/core` for selective imports

## Alternatives Considered

### 1. No Umbrella Package

Only provide individual packages.

Rejected because:
- Poor onboarding experience
- More documentation overhead
- Users create their own "pocket-all" wrappers

### 2. Single Monolithic Package

One package with all code, no individual packages.

Rejected because:
- Can't tree-shake unused storage adapters
- Forces React on non-React users
- Larger bundle for everyone

### 3. CLI-Based Installation

`npx create-pocket-app` that installs correct packages.

Rejected because:
- Extra step for users
- Doesn't help with imports
- More tooling to maintain

### 4. Peer Dependencies

Umbrella lists sub-packages as peer dependencies.

```json
{
  "peerDependencies": {
    "@pocket/core": "^1.0.0",
    "@pocket/react": "^1.0.0"
  }
}
```

Rejected because:
- Users still must install each package
- npm/pnpm peer dep handling is inconsistent
- Defeats the simplicity purpose

## Examples

### Minimal React App

```typescript
import { Database, PocketProvider, useLiveQuery } from 'pocket';

const db = await Database.create({ name: 'my-app' });

function App() {
  return (
    <PocketProvider database={db}>
      <TodoList />
    </PocketProvider>
  );
}

function TodoList() {
  const { data: todos } = useLiveQuery('todos');
  return <ul>{todos.map(t => <li key={t._id}>{t.title}</li>)}</ul>;
}
```

### With Sync

```typescript
import {
  Database,
  PocketProvider,
  useLiveQuery,
  createSyncEngine
} from 'pocket';

const db = await Database.create({ name: 'my-app' });
const sync = createSyncEngine(db, {
  serverUrl: 'wss://sync.example.com'
});

await sync.start();
```

### Advanced: Custom Storage

```typescript
// Need to import storage adapter separately
import { Database } from 'pocket/core';
import { createOPFSStorage } from '@pocket/storage-opfs';

const db = await Database.create({
  name: 'my-app',
  storage: createOPFSStorage()
});
```

## References

- [Lodash vs. Lodash-es](https://www.blazemeter.com/blog/import-lodash-libraries)
- [Material-UI Package Structure](https://mui.com/material-ui/guides/minimizing-bundle-size/)
- [date-fns Modular Approach](https://date-fns.org/docs/Getting-Started)
