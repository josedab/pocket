---
sidebar_position: 4
title: Conflict Resolution
description: Handling conflicts when multiple clients edit the same data
---

# Conflict Resolution

When multiple clients edit the same document before syncing, conflicts occur. This guide explains how Pocket detects and resolves conflicts.

## What Causes Conflicts

```
Timeline:
─────────────────────────────────────────────────────────────
         │
Client A │  read doc    update title="A"
         │     ▼             ▼
         │  ┌─────┐      ┌─────┐
         │  │ doc │      │ doc │────────▶ push
         │  └─────┘      └─────┘
         │
Client B │     read doc         update title="B"
         │        ▼                  ▼
         │     ┌─────┐           ┌─────┐
         │     │ doc │           │ doc │────────▶ push (CONFLICT!)
         │     └─────┘           └─────┘
         │
─────────────────────────────────────────────────────────────
```

Both clients read the same version, then both modified it. The server sees two different versions claiming to be the successor of the same original.

## Conflict Detection

Pocket uses revision tracking to detect conflicts:

```typescript
// Every document has a revision
const doc = await todos.get('123');
console.log(doc._rev); // "1-abc123"

// After update
await todos.update('123', { title: 'Updated' });
const updated = await todos.get('123');
console.log(updated._rev); // "2-def456"
```

When pushing, if the server has a different revision than expected, a conflict is detected.

## Built-in Strategies

### Last-Write-Wins (Default)

The most recent change wins based on timestamp:

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  conflictStrategy: 'last-write-wins',
});
```

```
Client A: title="A" at 10:00:01
Client B: title="B" at 10:00:02
Result:   title="B" (later timestamp wins)
```

**Pros**: Simple, predictable
**Cons**: Data from earlier write is lost

### Server-Wins

Server's version always wins:

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  conflictStrategy: 'server-wins',
});
```

**Use case**: When server is authoritative (e.g., admin overrides)

### Client-Wins

Client's version always wins:

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  conflictStrategy: 'client-wins',
});
```

**Use case**: When local changes should always be preserved

### Field-Level Merge

Merge non-conflicting field changes:

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  conflictStrategy: 'merge',
});
```

```
Client A: { title: "A", completed: false }
Client B: { title: "Original", completed: true }
Server:   { title: "Original", completed: false }

Result:   { title: "A", completed: true }
          (title from A, completed from B - different fields)
```

**Pros**: Preserves more user intent
**Cons**: Can produce unexpected combinations

## Custom Resolution

For complex scenarios, implement custom resolution:

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  conflictStrategy: 'custom',
  conflictResolver: (conflict) => {
    const { localDocument, remoteDocument, documentId } = conflict;

    // Example: Merge arrays, keep latest scalar values
    return {
      ...remoteDocument,
      ...localDocument,
      tags: [...new Set([
        ...(localDocument.tags || []),
        ...(remoteDocument.tags || []),
      ])],
      _rev: remoteDocument._rev,  // Use server revision
    };
  },
});
```

### Conflict Object

```typescript
interface Conflict<T> {
  documentId: string;
  localDocument: T;     // What we have locally
  remoteDocument: T;    // What the server has
  timestamp: number;    // When conflict was detected
}
```

### Resolution Guidelines

Your resolver should return a valid document with:
- All required fields
- The server's `_rev` (to avoid infinite conflict loops)
- Meaningful merged content

## Domain-Specific Examples

### Todo App: Preserve Completed Status

```typescript
conflictResolver: (conflict) => {
  const { localDocument: local, remoteDocument: remote } = conflict;

  // If either version is completed, keep it completed
  // (don't accidentally un-complete a todo)
  return {
    ...remote,
    ...local,
    completed: local.completed || remote.completed,
    _rev: remote._rev,
  };
};
```

### Notes App: Merge Content

```typescript
conflictResolver: (conflict) => {
  const { localDocument: local, remoteDocument: remote } = conflict;

  // If both modified content, show conflict markers
  if (local.content !== remote.content &&
      local.updatedAt !== remote.updatedAt) {
    return {
      ...remote,
      content: `<<<< LOCAL >>>>\n${local.content}\n<<<< REMOTE >>>>\n${remote.content}`,
      hasConflict: true,  // Flag for UI to show
      _rev: remote._rev,
    };
  }

  // Otherwise, latest wins
  return local.updatedAt > remote.updatedAt
    ? { ...local, _rev: remote._rev }
    : remote;
};
```

### Shopping Cart: Sum Quantities

```typescript
conflictResolver: (conflict) => {
  const { localDocument: local, remoteDocument: remote } = conflict;

  // Merge cart items by summing quantities
  const mergedItems = new Map();

  for (const item of [...local.items, ...remote.items]) {
    const existing = mergedItems.get(item.productId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      mergedItems.set(item.productId, { ...item });
    }
  }

  return {
    ...remote,
    items: Array.from(mergedItems.values()),
    _rev: remote._rev,
  };
};
```

## Handling Unresolvable Conflicts

Sometimes you need user intervention:

```typescript
// Store conflicting versions
let pendingConflicts: Conflict[] = [];

const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  conflictStrategy: 'custom',
  conflictResolver: (conflict) => {
    // Store for user resolution
    pendingConflicts.push(conflict);

    // Temporarily use server version
    return conflict.remoteDocument;
  },
});

// In your UI
function ConflictResolver() {
  if (pendingConflicts.length === 0) return null;

  const conflict = pendingConflicts[0];

  return (
    <div className="conflict-dialog">
      <h3>Conflict Detected</h3>
      <div className="versions">
        <div>
          <h4>Your Version</h4>
          <pre>{JSON.stringify(conflict.localDocument, null, 2)}</pre>
          <button onClick={() => resolveWith('local')}>Keep Mine</button>
        </div>
        <div>
          <h4>Server Version</h4>
          <pre>{JSON.stringify(conflict.remoteDocument, null, 2)}</pre>
          <button onClick={() => resolveWith('remote')}>Keep Theirs</button>
        </div>
      </div>
    </div>
  );

  async function resolveWith(choice: 'local' | 'remote') {
    const resolved = choice === 'local'
      ? { ...conflict.localDocument, _rev: conflict.remoteDocument._rev }
      : conflict.remoteDocument;

    await db.collection('todos').update(conflict.documentId, resolved);
    pendingConflicts.shift();
  }
}
```

## Monitoring Conflicts

Track conflict frequency:

```typescript
sync.getStats().subscribe((stats) => {
  if (stats.conflictCount > 0) {
    console.log(`Resolved ${stats.conflictCount} conflicts`);

    // Send to analytics
    analytics.track('sync_conflicts', {
      count: stats.conflictCount,
    });
  }
});
```

## Prevention Strategies

### 1. Smaller Documents

Instead of one large document:

```typescript
// Bad: One document with all user data
{ _id: 'user:123', settings: {...}, preferences: {...}, profile: {...} }

// Good: Separate documents
{ _id: 'user:123:settings', ... }
{ _id: 'user:123:preferences', ... }
{ _id: 'user:123:profile', ... }
```

Smaller scope = fewer conflicts.

### 2. Append-Only Patterns

Instead of updating in place:

```typescript
// Bad: Update a counter
await todos.update(id, { viewCount: viewCount + 1 });

// Good: Append events
await events.insert({
  _id: crypto.randomUUID(),
  type: 'view',
  todoId: id,
  timestamp: Date.now(),
});

// Compute count from events
const views = await events.count({ type: 'view', todoId: id });
```

### 3. Operational Transforms

For text editing, consider operational transforms:

```typescript
// Instead of replacing text
await doc.update(id, { content: newContent });

// Send operations
await operations.insert({
  _id: crypto.randomUUID(),
  docId: id,
  op: { type: 'insert', position: 5, text: 'hello' },
  timestamp: Date.now(),
});
```

### 4. Lock for Critical Operations

For critical sections, implement locking:

```typescript
async function performCriticalUpdate(docId: string, update: Function) {
  const lock = await acquireLock(docId);
  try {
    await sync.forceSync();  // Get latest
    await update();
    await sync.forceSync();  // Push immediately
  } finally {
    await releaseLock(lock);
  }
}
```

## Testing Conflicts

```typescript
import { describe, it, expect } from 'vitest';

describe('Conflict Resolution', () => {
  it('should merge non-conflicting fields', async () => {
    const local = { _id: '1', title: 'Local', done: false };
    const remote = { _id: '1', title: 'Original', done: true };

    const resolved = mergeResolver({ localDocument: local, remoteDocument: remote });

    expect(resolved.title).toBe('Local');  // From local
    expect(resolved.done).toBe(true);      // From remote
  });

  it('should handle array merging', async () => {
    const local = { _id: '1', tags: ['a', 'b'] };
    const remote = { _id: '1', tags: ['b', 'c'] };

    const resolved = mergeResolver({ localDocument: local, remoteDocument: remote });

    expect(resolved.tags).toEqual(['a', 'b', 'c']);  // Merged
  });
});
```

## Next Steps

- [Sync Architecture](/docs/concepts/sync-architecture) - Understand sync internals
- [Sync Setup](/docs/guides/sync-setup) - Configure sync
- [SyncEngine API](/docs/api/sync-engine) - Complete API reference
