# Getting Started

This guide will help you set up Pocket in your project and create your first database.

<div style="margin: 1.5rem 0;">
  <a href="https://stackblitz.com/github/pocket-db/pocket/tree/main/examples/stackblitz-react" target="_blank" rel="noopener noreferrer">
    <img src="https://developer.stackblitz.com/img/open_in_stackblitz.svg" alt="Open in StackBlitz" />
  </a>
</div>

::: tip Try it Live
Open the StackBlitz example above to see Pocket in action with a working React todo app!
:::

## Installation

::: code-group

```bash [npm]
npm install pocket
```

```bash [pnpm]
pnpm add pocket
```

```bash [yarn]
yarn add pocket
```

:::

The `pocket` package includes everything you need: the core database, IndexedDB storage, and sync client.

### Modular Installation

For smaller bundle sizes, install only what you need:

```bash
# Core + specific storage
pnpm add @pocket/core @pocket/storage-indexeddb

# React integration
pnpm add @pocket/react

# Sync support
pnpm add @pocket/sync
```

## Quick Start

### 1. Create a Database

```typescript
import { createDatabase, createIndexedDBStorage } from 'pocket';

// Create a database with IndexedDB storage
const db = await createDatabase({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});
```

### 2. Define a Collection

```typescript
// Get or create a collection
const users = db.collection('users');
```

### 3. Insert Documents

```typescript
// Insert a single document
const user = await users.insert({
  name: 'Alice',
  email: 'alice@example.com',
  age: 28,
});

console.log(user._id); // Auto-generated ID
console.log(user._rev); // Revision for sync
```

### 4. Query Documents

```typescript
// Find all users
const allUsers = await users.getAll();

// Find users with a filter
const adults = await users
  .find()
  .where('age').greaterThanOrEqual(18)
  .exec();

// Find a single user
const alice = await users.findOne({ name: 'Alice' });
```

### 5. Update Documents

```typescript
// Update by ID
await users.update(user._id, {
  age: 29,
});

// Upsert (insert or update)
await users.upsert('user-123', {
  name: 'Bob',
  email: 'bob@example.com',
});
```

### 6. Delete Documents

```typescript
// Delete by ID
await users.delete(user._id);
```

## Reactive Queries

Subscribe to query results to get real-time updates:

```typescript
// Create an observable query
const activeUsers$ = users
  .find()
  .where('status').equals('active')
  .observe();

// Subscribe to changes
const subscription = activeUsers$.subscribe(users => {
  console.log('Active users:', users.length);
});

// Later: clean up
subscription.unsubscribe();
```

## React Integration

For React applications, use the `@pocket/react` package:

```tsx
import { PocketProvider, useQuery, useDocument } from '@pocket/react';

// Wrap your app
function App() {
  return (
    <PocketProvider database={db}>
      <UserList />
    </PocketProvider>
  );
}

// Use hooks in components
function UserList() {
  const users = useQuery(db =>
    db.collection('users').find().where('active').equals(true)
  );

  if (users.loading) return <p>Loading...</p>;
  if (users.error) return <p>Error: {users.error.message}</p>;

  return (
    <ul>
      {users.data.map(user => (
        <li key={user._id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

## TypeScript Support

Pocket is built with TypeScript and provides full type safety:

```typescript
// Define your document type
interface User {
  _id: string;
  _rev: string;
  name: string;
  email: string;
  age: number;
  status: 'active' | 'inactive';
}

// Use typed collections
const users = db.collection<User>('users');

// Type-safe operations
const user = await users.insert({
  name: 'Alice',
  email: 'alice@example.com',
  age: 28,
  status: 'active',
});

// TypeScript knows the shape
console.log(user.name); // ✓ OK
console.log(user.foo);  // ✗ Error: Property 'foo' does not exist
```

## Next Steps

- Learn about [Collections](/guide/collections) in depth
- Explore [Queries](/guide/queries) and filtering
- Set up [Reactive Queries](/guide/live-queries)
- Configure [Storage Adapters](/guide/storage)
- Enable [Sync](/guide/sync) for multi-device support
