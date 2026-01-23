---
sidebar_position: 101
title: FAQ
description: Frequently asked questions about Pocket
---

# Frequently Asked Questions

## General

### What is Pocket?

Pocket is a local-first database for web applications. It stores data in the browser, works offline, and can sync with a server when needed.

### Who is Pocket for?

- Developers building offline-capable web apps
- React developers wanting reactive data
- Teams building collaborative apps
- Anyone tired of loading spinners

### Is Pocket production-ready?

Pocket is approaching v1.0. The core features are stable, but we recommend:
- Reviewing the [roadmap](https://github.com/pocket-db/pocket/blob/main/ROADMAP.md) for known gaps
- Testing thoroughly with your use case
- Joining [discussions](https://github.com/pocket-db/pocket/discussions) for support

### Is Pocket free?

Yes. Pocket is MIT licensed and free for any use, including commercial.

---

## Technical

### How much data can Pocket store?

Browser limits vary:
- **Chrome**: ~80% of disk space (up to ~2GB per origin)
- **Firefox**: ~50% of disk space
- **Safari**: ~1GB per origin

For larger datasets, consider:
- Pagination and lazy loading
- Data cleanup strategies
- Server-side storage for archives

### Does Pocket support encryption?

Pocket doesn't have built-in encryption yet (see [roadmap](https://github.com/pocket-db/pocket/blob/main/ROADMAP.md)), but you can:
- Encrypt data before storing
- Use the Web Crypto API
- Implement a storage adapter wrapper

### Can I use Pocket with Next.js/Remix/etc?

Yes, with SSR considerations:
- Pocket runs client-side only (uses browser APIs)
- Import dynamically to avoid SSR issues:

```typescript
// In a client component
import dynamic from 'next/dynamic';

const TodoList = dynamic(() => import('./TodoList'), { ssr: false });
```

Or check for browser environment:
```typescript
if (typeof window !== 'undefined') {
  const db = await Database.create({...});
}
```

### Does Pocket support TypeScript?

Yes, Pocket is written in TypeScript and provides full type safety:

```typescript
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
}

const todos = db.collection<Todo>('todos');
// todos.insert(), get(), etc. are all typed
```

### Can I use Pocket without React?

Yes. Pocket core works with any framework or vanilla JavaScript:

```typescript
import { Database, createIndexedDBStorage } from 'pocket';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});

// Use with any framework
db.collection('todos').find().live().subscribe(renderTodos);
```

### How do I migrate from another database?

1. Export data from your current database
2. Transform to Pocket's document format (add `_id` field)
3. Use `insertMany()` to import:

```typescript
const legacyData = await fetchFromOldDB();

const pocketDocs = legacyData.map((item) => ({
  _id: item.id || crypto.randomUUID(),
  ...item,
}));

await todos.insertMany(pocketDocs);
```

---

## Sync

### Do I need a server to use Pocket?

No. Pocket works entirely client-side. You only need a server for multi-device sync.

### What backend do I need for sync?

Pocket provides `@pocket/server` for Node.js. You can also build a custom backend that implements the sync protocol.

### Can I use my existing backend?

Yes, if you implement the sync protocol. Pocket uses a push/pull model with JSON messages over WebSocket or HTTP.

### How does conflict resolution work?

When the same document is modified on multiple clients:
1. Both clients push their changes
2. Server detects the conflict (different revisions)
3. Conflict is resolved using your chosen strategy
4. Resolved version is sent to all clients

See [Conflict Resolution Guide](/docs/guides/conflict-resolution).

### Is sync real-time?

With WebSocket, changes propagate in near real-time. With HTTP polling, there's a delay based on poll interval.

### What happens if sync fails?

Changes are queued locally and retried automatically. Data is never lost - it stays in local storage until successfully synced.

---

## Performance

### Is Pocket fast?

Local operations complete in milliseconds because there's no network round-trip. Benchmarks show:
- Reads: &lt;1ms for single document
- Writes: &lt;5ms for single document
- Queries: &lt;10ms for 1000 documents (with index)

### How do I improve query performance?

1. **Add indexes** for queried fields:
   ```typescript
   await todos.createIndex({ fields: ['completed'] });
   ```

2. **Limit results**:
   ```typescript
   .limit(50)
   ```

3. **Use specific filters**:
   ```typescript
   .where('userId').equals(currentUserId)
   ```

### How big is the bundle?

| Package | Size (gzipped) |
|---------|---------------|
| @pocket/core | ~25KB |
| @pocket/react | ~8KB |
| @pocket/sync | ~12KB |
| @pocket/storage-indexeddb | ~5KB |
| @pocket/storage-opfs | ~8KB |

The `pocket` package includes everything but supports tree-shaking.

---

## Comparison

### Pocket vs LocalStorage?

LocalStorage is synchronous and limited to 5-10MB of strings. Pocket provides:
- Async API (non-blocking)
- Much larger storage (GB)
- Structured data with queries
- Reactive updates
- Sync capability

### Pocket vs IndexedDB directly?

IndexedDB is low-level and verbose. Pocket adds:
- Simple document API
- Query builder
- Live queries
- TypeScript types
- Schema validation
- Sync engine

### Pocket vs Firebase/Supabase?

Firebase and Supabase are server-first. Pocket is local-first:
- Data lives on client, not server
- Works offline by default
- No vendor lock-in
- You control the server

See [Comparison page](/docs/comparison) for detailed comparisons.

---

## Contributing

### How can I contribute?

See our [Contributing Guide](https://github.com/pocket-db/pocket/blob/main/CONTRIBUTING.md):
- Report bugs
- Suggest features
- Submit PRs
- Help with docs
- Answer community questions

### How do I report a bug?

1. Search [existing issues](https://github.com/pocket-db/pocket/issues)
2. If new, [create an issue](https://github.com/pocket-db/pocket/issues/new) with:
   - Pocket version
   - Browser version
   - Steps to reproduce
   - Expected vs actual behavior

### How do I request a feature?

Open a [discussion](https://github.com/pocket-db/pocket/discussions/categories/ideas) or [issue](https://github.com/pocket-db/pocket/issues/new).

---

## See Also

- [Troubleshooting](/docs/troubleshooting) - Common issues
- [Comparison](/docs/comparison) - Pocket vs alternatives
- [GitHub Discussions](https://github.com/pocket-db/pocket/discussions) - Ask questions
