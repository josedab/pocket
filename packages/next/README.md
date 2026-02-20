# @pocket/next

Next.js integration for [Pocket](https://pocket-db.dev) with React Server Components (RSC) support.

## Features

- **Server-side data loading** – fetch collections during SSR / RSC rendering
- **Batch loading** – load multiple collections in parallel
- **Client hydration** – seamlessly transition from server data to live local queries
- **DI-friendly hooks** – uses the `ReactHooks` interface for framework-agnostic hook injection

## Installation

```bash
npm install @pocket/next @pocket/core
# or
pnpm add @pocket/next @pocket/core
```

### Peer dependencies

| Package | Version  |
| ------- | -------- |
| `next`  | >=14.0.0 |
| `react` | >=18.0.0 |

## Quick Start

### Server-side loading (RSC / `getServerSideProps`)

```typescript
import { createServerLoader } from '@pocket/next';

const loader = createServerLoader({
  serverUrl: 'http://localhost:4000',
  authToken: process.env.POCKET_AUTH_TOKEN,
});

// Load a single collection
const users = await loader.loadCollection('users', { role: 'admin' });

// Batch-load multiple collections
const results = await loader.loadMultiple([
  { collection: 'users' },
  { collection: 'posts' },
]);

// Get hydration props to pass to the client
const hydrationProps = loader.getHydrationProps();
```

### Client-side hydration

```typescript
import { createHydrationProvider, createUseHydratedQueryHook } from '@pocket/next';
import * as React from 'react';

// Create the hook with React DI
const useHydratedQuery = createUseHydratedQueryHook(React);

// In your component
function UserList({ hydrationProps }) {
  const provider = createHydrationProvider(hydrationProps);
  const { data, isLive } = useHydratedQuery(provider, 'users');

  return (
    <ul>
      {data.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
      {!isLive && <p>Loading live data…</p>}
    </ul>
  );
}
```

## API Reference

### `createServerLoader(config)`

Creates a `PocketServerLoader` instance for server-side data fetching.

### `PocketServerLoader`

| Method | Description |
| --- | --- |
| `loadCollection<T>(collection, filter?)` | Fetch a single collection |
| `loadMultiple(specs)` | Batch-fetch multiple collections |
| `getHydrationProps()` | Get serialisable props for client hydration |

### `createHydrationProvider(props)`

Wraps server data into a provider the client hooks can consume.

### `createUseHydratedQueryHook(React)`

Returns a `useHydratedQuery(provider, collection, filter?)` hook that starts with server data and transitions to live local queries.

## License

MIT
