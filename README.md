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
<summary><strong>Full Package Status Matrix</strong> (49+ packages)</summary>

| Package | Status | Tests | Category |
|---------|--------|-------|----------|
| `@pocket/core` | 🟢 Stable | 6 | Core |
| `@pocket/react` | 🟢 Stable | 5 | Framework |
| `@pocket/sync` | 🟡 Beta | 3 | Core |
| `@pocket/server` | 🟡 Beta | 2 | Core |
| `@pocket/storage-indexeddb` | 🟡 Beta | 2 | Storage |
| `@pocket/storage-memory` | 🟡 Beta | 1 | Storage |
| `@pocket/storage-opfs` | 🟡 Beta | 1 | Storage |
| `@pocket/storage-sqlite` | 🔵 Experimental | 0 | Storage |
| `@pocket/storage-edge` | 🟡 Beta | 2 | Storage |
| `@pocket/storage-wa-sqlite` | 🟡 Beta | 1 | Storage |
| `@pocket/storage-expo-sqlite` | 🟡 Beta | 1 | Storage |
| `@pocket/cloud` | 🟡 Beta | 8 | Cloud |
| `@pocket/sync-server` | 🟡 Beta | 3 | Core |
| `@pocket/ai` | 🟡 Beta | 3 | Extension |
| `@pocket/codegen` | 🟡 Beta | 3 | Tooling |
| `@pocket/studio` | 🟡 Beta | 6 | Tooling |
| `@pocket/encryption` | 🟡 Beta | 2 | Extension |
| `@pocket/graphql` | 🟡 Beta | 2 | Extension |
| `@pocket/graphql-gateway` | 🟡 Beta | 6 | Extension |
| `@pocket/collaboration` | 🟡 Beta | 5 | Extension |
| `@pocket/crdt` | 🟡 Beta | 2 | Extension |
| `@pocket/analytics` | 🟡 Beta | 2 | Extension |
| `@pocket/plugin-sdk` | 🟡 Beta | 2 | Extension |
| `@pocket/time-travel` | 🟡 Beta | 4 | Extension |
| `@pocket/migration` | 🟡 Beta | 1 | Tooling |
| `@pocket/query-builder` | 🟡 Beta | 4 | Extension |
| `@pocket/schema-inference` | 🟡 Beta | 4 | Tooling |
| `@pocket/vectors` | 🟡 Beta | 3 | Extension |
| `@pocket/mobile` | 🟡 Beta | 5 | Platform |
| `@pocket/sync-blockchain` | 🔵 Experimental | 4 | Extension |
| `@pocket/angular` | 🔵 Experimental | 0 | Framework |
| `@pocket/vue` | 🔵 Experimental | 0 | Framework |
| `@pocket/svelte` | 🔵 Experimental | 0 | Framework |
| `@pocket/solid` | 🔵 Experimental | 0 | Framework |
| `@pocket/react-native` | 🟡 Beta | 1 | Framework |
| `@pocket/electron` | 🔵 Experimental | 0 | Platform |
| `@pocket/expo` | 🔵 Experimental | 0 | Platform |
| `@pocket/tauri` | 🔵 Experimental | 0 | Platform |
| `@pocket/cli` | 🟡 Beta | 4 | Tooling |
| `@pocket/devtools` | 🔵 Experimental | 0 | Tooling |
| `@pocket/auth` | 🟡 Beta | 1 | Extension |
| `@pocket/permissions` | 🔵 Experimental | 0 | Extension |
| `@pocket/forms` | 🔵 Experimental | 0 | Extension |
| `@pocket/views` | 🟡 Beta | 1 | Extension |
| `@pocket/subscriptions` | 🟡 Beta | 1 | Extension |
| `@pocket/presence` | 🟡 Beta | 4 | Extension |
| `@pocket/cross-tab` | 🟡 Beta | 1 | Extension |
| `@pocket/opentelemetry` | 🟡 Beta | 1 | Extension |
| `@pocket/conflict-resolution` | 🔵 Experimental | 0 | Extension |
| `@pocket/zod` | 🔵 Experimental | 0 | Extension |
| `@pocket/query` | 🔵 Experimental | 0 | Extension |
| `@pocket/create-pocket-app` | 🔵 Experimental | 0 | Tooling |
| `pocket` | 🔵 Experimental | 0 | Meta |

</details>

## Examples

- [Todo App](./examples/todo-app) - Simple todo application
- [Notes App](./examples/notes-app) - Notes with sync

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

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

Please note that this project is released with a [Code of Conduct](./CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## License

MIT - see [LICENSE](./LICENSE)
