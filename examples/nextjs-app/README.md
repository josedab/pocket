# Pocket + Next.js (App Router) Example

This example demonstrates how to use **Pocket** with **Next.js 15** and the App Router to combine server-side data loading with local-first client-side operation.

## What This Demonstrates

- **RSC Server Loading** — A React Server Component uses `PocketServerLoader` from `@pocket/next` to fetch initial data during SSR.
- **Client Hydration** — The server-loaded data is passed as props to a Client Component, which seeds a local Pocket database.
- **Local-First Operation** — After hydration, the client operates entirely against a local in-memory Pocket database using `@pocket/react` hooks (`useLiveQuery`, `useMutation`).

## Architecture

```
┌───────────────────────────────────────────────────────┐
│  Server (RSC)                                         │
│                                                       │
│  page.tsx                                             │
│    └─ createServerLoader(config)                      │
│         └─ loader.loadCollection('todos')             │
│              └─ fetches from sync server via HTTP     │
│                                                       │
│  Passes initialTodos + serverTimestamp as props ───────┤
└───────────────────────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────┐
│  Client ('use client')                                │
│                                                       │
│  todo-list.tsx                                        │
│    └─ Creates local Pocket DB (memory storage)        │
│    └─ Seeds DB with server-provided initialTodos      │
│    └─ useLiveQuery('todos') for reactive updates      │
│    └─ useMutation('todos') for add/toggle/delete      │
│                                                       │
│  From this point on: fully local-first 🟢             │
└───────────────────────────────────────────────────────┘
```

## Running

From the monorepo root:

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start the example
pnpm --filter pocket-nextjs-example dev
```

> **Note:** If no sync server is running, the app starts with an empty todo list and operates fully offline. Set `POCKET_SERVER_URL` to point to a running Pocket sync server.

## Files

| File | Description |
| --- | --- |
| `src/app/page.tsx` | Server Component — loads data with `PocketServerLoader` |
| `src/app/todo-list.tsx` | Client Component — hydrates and runs local-first |
| `src/app/layout.tsx` | Root layout with minimal styling |
| `src/lib/pocket.ts` | Shared config and database factory |
| `next.config.ts` | Next.js config with workspace package transpilation |
