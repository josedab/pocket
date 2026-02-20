# Examples

Explore these example applications to see Pocket in action. Each example demonstrates different features and integration patterns.

## Available Examples

| Example | Description | Stack | Run Command |
| --- | --- | --- | --- |
| [todo-app](./todo-app) | A simple todo application with persistent storage | React, Vite, IndexedDB | `pnpm --filter @pocket/example-todo-app dev` |
| [notes-app](./notes-app) | A notes application with client-server sync | React, Vite, IndexedDB, Sync | `pnpm --filter @pocket/example-notes-app dev` |
| [stackblitz-react](./stackblitz-react) | A lightweight React example for running in StackBlitz | React, Vite, Memory Storage | `pnpm --filter @pocket/example-stackblitz-react dev` |
| [playground](./playground) | Interactive playground with CRUD, live queries, and a query explorer | React, Vite, Memory Storage | `npm run dev` (standalone) |
| [nextjs-app](./nextjs-app) | RSC server loading with local-first client hydration | Next.js 15, React 19, Memory Storage | `pnpm --filter pocket-nextjs-example dev` |

## Prerequisites

- Node.js (v18+)
- [pnpm](https://pnpm.io/) installed globally
- Build the monorepo packages first:

```bash
pnpm install
pnpm build
```

## Running Examples

1. Clone the repository and install dependencies from the root:

   ```bash
   pnpm install
   ```

2. Build all packages:

   ```bash
   pnpm build
   ```

3. Start an example using its filter name:

   ```bash
   pnpm --filter @pocket/example-todo-app dev
   ```

4. Open the URL shown in your terminal (usually `http://localhost:5173`).

> **Note:** The notes-app also has a sync server. Run it in a separate terminal with:
>
> ```bash
> pnpm --filter @pocket/example-notes-app server
> ```
