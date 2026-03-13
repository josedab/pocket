# Pocket

[![CI](https://github.com/pocket-db/pocket/actions/workflows/ci.yml/badge.svg)](https://github.com/pocket-db/pocket/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/pocket-db/pocket/branch/main/graph/badge.svg)](https://codecov.io/gh/pocket-db/pocket)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/pocket-db/pocket/badge)](https://scorecard.dev/viewer/?uri=github.com/pocket-db/pocket)
[![npm version](https://img.shields.io/npm/v/pocket.svg)](https://www.npmjs.com/package/pocket)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/pocket)](https://bundlephobia.com/package/pocket)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Discussions](https://img.shields.io/github/discussions/pocket-db/pocket)](https://github.com/pocket-db/pocket/discussions)

A local-first database for web applications with reactive queries and sync capabilities.

## Features

- **Local-First** - Data lives on the client, works offline by default
- **Reactive Queries** - Subscribe to query results that update automatically
- **Multiple Storage Backends** - IndexedDB, OPFS, or in-memory storage
- **TypeScript Native** - Full type safety with strict TypeScript support
- **Sync Ready** - Built-in sync engine for client-server synchronization
- **React Bindings** - Hooks for seamless React integration
- **Schema Validation** - Runtime type validation with defaults
- **Lightweight** - Small bundle size with tree-shaking support

## Quick Start

```bash
npm install pocket
```

### Basic Usage

```typescript
import { createDatabase, createIndexedDBStorage } from 'pocket';

// Define your document type
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

// Create a database
const db = await createDatabase({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});

// Get a collection
const todos = db.collection<Todo>('todos');

// Insert a document
await todos.insert({
  _id: crypto.randomUUID(),
  title: 'Learn Pocket',
  completed: false,
  createdAt: new Date(),
});

// Query documents
const incompleteTodos = await todos.find({
  filter: { completed: false },
  sort: { createdAt: 'desc' },
});
```

### Reactive Queries

```typescript
// Subscribe to live query results
const subscription = todos
  .find$({ filter: { completed: false } })
  .subscribe((results) => {
    console.log('Incomplete todos:', results);
  });

// Results automatically update when data changes
await todos.update(todoId, { completed: true });

// Clean up
subscription.unsubscribe();
```

### React Integration

```tsx
import { PocketProvider, useLiveQuery, useMutation } from 'pocket/react';

function App() {
  return (
    <PocketProvider database={db}>
      <TodoList />
    </PocketProvider>
  );
}

function TodoList() {
  const { data: todos, loading } = useLiveQuery(
    (db) => db.collection('todos').find$({ filter: { completed: false } })
  );

  const { mutate: addTodo } = useMutation(
    (db, title: string) => db.collection('todos').insert({
      _id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: new Date(),
    })
  );

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <button onClick={() => addTodo('New todo')}>Add Todo</button>
      <ul>
        {todos?.map((todo) => (
          <li key={todo._id}>{todo.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

## Packages

### Core

| Package | Description | Size |
|---------|-------------|------|
| [`pocket`](./packages/pocket) | All-in-one package with core + React + storage adapters | - |
| [`@pocket/core`](./packages/core) | Core database engine | ~25KB |
| [`@pocket/sync`](./packages/sync) | Sync engine for client-server sync | ~12KB |
| [`@pocket/server`](./packages/server) | Server-side sync endpoint | - |

### Frontend Integration

| Package | Description |
|---------|-------------|
| [`@pocket/react`](./packages/react) | React hooks and components |
| [`@pocket/angular`](./packages/angular) | Angular integration |
| [`@pocket/vue`](./packages/vue) | Vue integration |
| [`@pocket/svelte`](./packages/svelte) | Svelte integration |
| [`@pocket/solid`](./packages/solid) | Solid.js integration |

### Storage Adapters

| Package | Description | Size |
|---------|-------------|------|
| [`@pocket/storage-indexeddb`](./packages/storage-indexeddb) | IndexedDB storage adapter | ~5KB |
| [`@pocket/storage-opfs`](./packages/storage-opfs) | OPFS storage adapter | ~8KB |
| [`@pocket/storage-memory`](./packages/storage-memory) | In-memory storage adapter | ~3KB |
| [`@pocket/storage-sqlite`](./packages/storage-sqlite) | SQLite storage adapter | - |

### Extensions

| Package | Description |
|---------|-------------|
| [`@pocket/ai`](./packages/ai) | LLM integration with RAG pipeline |
| [`@pocket/crdt`](./packages/crdt) | Conflict-free replicated data types |
| [`@pocket/encryption`](./packages/encryption) | End-to-end encryption |
| [`@pocket/analytics`](./packages/analytics) | Offline-first analytics |
| [`@pocket/devtools`](./packages/devtools) | Developer tools and debugging |

> See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full package dependency graph.
>
> **Package Maturity Levels:** 🟢 Stable (tested, documented) · 🟡 Beta (functional, limited tests) · 🔵 Experimental (API may change)

<details>
<summary><strong>Full Package Status Matrix</strong> (80+ packages)</summary>

| Package | Status | Tests | Category |
|---------|--------|-------|----------|
| `@pocket/core` | 🟢 Stable | 770 | Core |
| `@pocket/react` | 🟢 Stable | 100 | Framework |
| `@pocket/sync` | 🟢 Stable | 211 | Core |
| `@pocket/server` | 🟢 Stable | 52 | Core |
| `@pocket/storage-indexeddb` | 🟢 Stable | 60 | Storage |
| `@pocket/storage-memory` | 🟢 Stable | 55 | Storage |
| `@pocket/storage-opfs` | 🟡 Beta | 26 | Storage |
| `@pocket/storage-sqlite` | 🟡 Beta | 13 | Storage |
| `@pocket/storage-edge` | 🟢 Stable | 107 | Storage |
| `@pocket/storage-wa-sqlite` | 🟢 Stable | 100 | Storage |
| `@pocket/storage-expo-sqlite` | 🟢 Stable | 113 | Storage |
| `@pocket/cloud` | 🟢 Stable | 373 | Cloud |
| `@pocket/sync-server` | 🟢 Stable | 157 | Core |
| `@pocket/ai` | 🟢 Stable | 149 | Extension |
| `@pocket/codegen` | 🟢 Stable | 190 | Tooling |
| `@pocket/studio` | 🟢 Stable | 340 | Tooling |
| `@pocket/encryption` | 🟡 Beta | 63 | Extension |
| `@pocket/graphql` | 🟡 Beta | 41 | Extension |
| `@pocket/graphql-gateway` | 🟢 Stable | 110 | Extension |
| `@pocket/collaboration` | 🟢 Stable | 242 | Extension |
| `@pocket/crdt` | 🟢 Stable | 116 | Extension |
| `@pocket/analytics` | 🟢 Stable | 94 | Extension |
| `@pocket/plugin-sdk` | 🟢 Stable | 165 | Extension |
| `@pocket/time-travel` | 🟢 Stable | 98 | Extension |
| `@pocket/migration` | 🟡 Beta | 53 | Tooling |
| `@pocket/query-builder` | 🟢 Stable | 90 | Extension |
| `@pocket/schema-inference` | 🟢 Stable | 87 | Tooling |
| `@pocket/vectors` | 🟢 Stable | 85 | Extension |
| `@pocket/mobile` | 🟢 Stable | 163 | Platform |
| `@pocket/sync-blockchain` | 🟡 Beta | 126 | Extension |
| `@pocket/angular` | 🟡 Beta | 43 | Framework |
| `@pocket/vue` | 🟡 Beta | 39 | Framework |
| `@pocket/svelte` | 🟡 Beta | 30 | Framework |
| `@pocket/solid` | 🟡 Beta | 11 | Framework |
| `@pocket/react-native` | 🟡 Beta | 57 | Framework |
| `@pocket/next` | 🟡 Beta | 45 | Framework |
| `@pocket/electron` | 🟡 Beta | 9 | Platform |
| `@pocket/expo` | 🟡 Beta | 6 | Platform |
| `@pocket/tauri` | 🟡 Beta | 13 | Platform |
| `@pocket/cli` | 🟢 Stable | 132 | Tooling |
| `@pocket/devtools` | 🟡 Beta | 42 | Tooling |
| `@pocket/auth` | 🟡 Beta | 53 | Extension |
| `@pocket/permissions` | 🟡 Beta | 80 | Extension |
| `@pocket/forms` | 🟢 Stable | 101 | Extension |
| `@pocket/views` | 🟢 Stable | 94 | Extension |
| `@pocket/subscriptions` | 🟡 Beta | 78 | Extension |
| `@pocket/presence` | 🟢 Stable | 89 | Extension |
| `@pocket/cross-tab` | 🟡 Beta | 36 | Extension |
| `@pocket/opentelemetry` | 🟢 Stable | 97 | Extension |
| `@pocket/conflict-resolution` | 🟡 Beta | 48 | Extension |
| `@pocket/zod` | 🟡 Beta | 46 | Extension |
| `@pocket/query` | 🟡 Beta | 66 | Extension |
| `@pocket/pwa` | 🟡 Beta | 62 | Extension |
| `@pocket/create-pocket-app` | 🟡 Beta | 11 | Tooling |
| `pocket` | 🟡 Beta | 15 | Meta |

</details>

## Examples

- [Todo App](./examples/todo-app) - Simple todo application
- [Notes App](./examples/notes-app) - Notes with sync

## Getting Started

New to the project? See **[QUICKSTART.md](./QUICKSTART.md)** for a 5-minute guide to making your first contribution.

## System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Node.js | 18.0.0 | 20+ (see `.nvmrc`) |
| pnpm | 8.12.0 | Latest 8.x |
| RAM | 8 GB | 16 GB (for full test suite) |
| Disk | 2 GB | 4 GB (with node_modules + build artifacts) |

> **Memory tip:** If you hit out-of-memory errors, set `NODE_OPTIONS="--max-old-space-size=8192"` before running commands. See [DEVELOPMENT.md](./DEVELOPMENT.md) for details and the [Development Troubleshooting](./website/docs/guides/troubleshooting.md) guide for more solutions.

## Development

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests (via Turbo, per-package) |
| `pnpm validate` | Full CI check (build + lint + typecheck + test) |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint all packages |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm format` | Format all files with Prettier |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm docs:dev` | Start documentation site locally |

To work on a single package:

```bash
# Build one package
npx turbo run build --filter=@pocket/core

# Test one package
npx vitest run --project unit packages/core/src/__tests__/
```

See [DEVELOPMENT.md](./DEVELOPMENT.md) for advanced topics and [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

### Alternative: Task Runner

If you have [Task](https://taskfile.dev) installed, you can use shorthand commands:

```bash
task setup   # install + build
task check   # lint + format:check + typecheck + test
task dev     # watch mode for all packages
task bench   # run performance benchmarks
```

See [`Taskfile.yml`](./Taskfile.yml) for the full list of available tasks.

## Community

- [GitHub Discussions](https://github.com/pocket-db/pocket/discussions) - Ask questions, share ideas, and connect with other users
- [GitHub Issues](https://github.com/pocket-db/pocket/issues) - Report bugs or request features
- [Contributing Guide](./CONTRIBUTING.md) - Learn how to contribute
- [Roadmap](./ROADMAP.md) - See what's planned for future releases

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines, or jump straight to **[QUICKSTART.md](./QUICKSTART.md)** for a 5-minute setup walkthrough.

Please note that this project is released with a [Code of Conduct](./CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## License

MIT - see [LICENSE](./LICENSE)
