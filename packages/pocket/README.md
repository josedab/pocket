# pocket

The all-in-one package for Pocket - a local-first database for web applications.

This package bundles the most common Pocket packages for easy installation.

## Installation

```bash
npm install pocket
```

## What's Included

| Package | Description |
|---------|-------------|
| `@pocket/core` | Core database engine |
| `@pocket/react` | React hooks and components |
| `@pocket/storage-indexeddb` | IndexedDB storage adapter |
| `@pocket/sync` | Synchronization engine |

## Quick Start

```tsx
import { Database, useLiveQuery, useMutation, PocketProvider } from 'pocket';

// Create database
const db = await Database.create({
  name: 'my-app'
  // IndexedDB storage is used by default
});

// Use in React
function App() {
  return (
    <PocketProvider database={db}>
      <TodoApp />
    </PocketProvider>
  );
}

function TodoApp() {
  const { data: todos } = useLiveQuery<Todo>('todos');
  const { insert } = useMutation<Todo>('todos');

  return (
    <div>
      <button onClick={() => insert({ title: 'New todo' })}>Add</button>
      {todos.map(todo => <div key={todo._id}>{todo.title}</div>)}
    </div>
  );
}
```

## When to Use This Package

**Use `pocket` when:**
- Building a React web application
- Want a simple, all-in-one solution
- Don't need fine-grained control over dependencies

**Use individual packages when:**
- Need only specific features
- Optimizing bundle size
- Building for React Native, Vue, etc.
- Need custom storage adapter

## Individual Packages

For more control, install packages separately:

```bash
# Core only
npm install @pocket/core

# React integration
npm install @pocket/react @pocket/core

# Custom storage
npm install @pocket/core @pocket/storage-sqlite

# Sync only
npm install @pocket/sync @pocket/core
```

## Documentation

- [Getting Started](https://pocket.dev/docs)
- [API Reference](https://pocket.dev/docs/api)
- [Examples](https://pocket.dev/examples)

## License

MIT
