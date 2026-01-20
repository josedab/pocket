# What is Pocket?

Pocket is a **local-first database** designed for modern web applications. It provides a reactive, offline-capable data layer that syncs seamlessly across devices.

## Why Pocket?

Building local-first applications comes with challenges:

- **Offline support**: Users expect apps to work without an internet connection
- **Real-time updates**: UI should reflect data changes immediately
- **Sync conflicts**: Multiple devices editing the same data need conflict resolution
- **Performance**: Data operations should be fast and not block the UI

Pocket solves these challenges with:

### 🔌 Offline-First Architecture

Data is stored locally first, making your app work seamlessly offline. Changes sync automatically when connectivity is restored.

### ⚡ Reactive Queries

Subscribe to queries and receive real-time updates when data changes. No manual polling or refresh needed.

```typescript
const users = await db.collection('users')
  .find()
  .where('status').equals('active')
  .observe();

users.subscribe(activeUsers => {
  console.log('Active users:', activeUsers);
});
```

### 🔄 Automatic Sync

Built-in sync engine handles multi-device scenarios with configurable conflict resolution strategies.

### 📦 Modular Storage

Choose the storage backend that fits your needs:

- **IndexedDB**: Best for most web applications
- **OPFS**: File system-based storage for large datasets
- **Memory**: Fast, ephemeral storage for testing

### ⚛️ Framework Integration

First-class React hooks make integration effortless:

```tsx
function UserList() {
  const users = useQuery(db =>
    db.collection('users').find().where('active').equals(true)
  );

  return <ul>{users.map(u => <li key={u._id}>{u.name}</li>)}</ul>;
}
```

## Packages

Pocket is organized as a monorepo with focused packages:

| Package | Description |
|---------|-------------|
| `@pocket/core` | Core database, collections, and query engine |
| `@pocket/react` | React hooks and context providers |
| `@pocket/sync` | Sync protocol and client |
| `@pocket/server` | WebSocket sync server |
| `@pocket/storage-indexeddb` | IndexedDB storage adapter |
| `@pocket/storage-opfs` | OPFS storage adapter |
| `@pocket/storage-memory` | In-memory storage adapter |
| `pocket` | All-in-one bundle with IndexedDB storage |

## When to Use Pocket

Pocket is ideal for:

- ✅ Note-taking and productivity apps
- ✅ Collaborative tools (documents, whiteboards)
- ✅ Offline-capable mobile web apps
- ✅ Real-time dashboards with local caching
- ✅ Any app that needs to work offline

Consider alternatives if:

- ❌ You need server-side querying with complex joins
- ❌ Your dataset exceeds browser storage limits (~2GB)
- ❌ You don't need offline support

## Next Steps

Ready to get started? Head to the [Getting Started](/guide/getting-started) guide to set up Pocket in your project.
