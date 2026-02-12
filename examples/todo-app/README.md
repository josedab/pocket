# Todo App Example

A simple todo application demonstrating Pocket's core features with React.

## What This Demonstrates

- **Database setup** with IndexedDB storage (memory fallback)
- **Schema validation** with required fields and defaults
- **Reactive queries** with automatic UI updates
- **CRUD operations** via Pocket collections
- **Indexes** for efficient querying

## Tech Stack

React · Vite · TypeScript · IndexedDB

## Quick Start

From the **repository root**:

```bash
pnpm install
pnpm build
pnpm --filter @pocket/example-todo-app dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Key Files

| File | Description |
|------|-------------|
| [`src/db.ts`](./src/db.ts) | Database configuration, schema, and `Todo` type definition |
| [`src/App.tsx`](./src/App.tsx) | Main app component |
| [`src/TodoList.tsx`](./src/TodoList.tsx) | Todo list with live query subscription |
| [`src/AddTodo.tsx`](./src/AddTodo.tsx) | Form for adding new todos |

## Learn More

- [Pocket Documentation](https://pocket-db.github.io/pocket/)
- [React Integration Guide](../../website/docs/guides/react-integration.md)
- [Contributing Guide](../../CONTRIBUTING.md)
