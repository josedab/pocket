# Conflict Resolution

When multiple clients modify the same document, conflicts can occur. Pocket provides several strategies for resolving these conflicts automatically.

## How Conflicts Occur

```
Client A                    Server                    Client B
   │                          │                          │
   ├── update todo.title ────►│                          │
   │   "Buy milk"             │                          │
   │                          │◄── update todo.title ────┤
   │                          │    "Buy groceries"       │
   │                          │                          │
   │                       CONFLICT!                     │
   │                    Both changed the                 │
   │                    same document                    │
```

## Conflict Detection

Pocket detects conflicts using vector clocks:

```typescript
interface Document {
  _id: string;
  _rev: number;           // Revision counter
  _clock: VectorClock;    // Vector clock for causality
  _updatedAt: number;     // Timestamp
}
```

A conflict is detected when:
- Two documents have the same `_id`
- Neither revision descends from the other
- Both have been modified since last sync

## Resolution Strategies

### Last-Write-Wins (Default)

The most recently modified document wins:

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  conflictStrategy: 'last-write-wins',
});
```

**Pros:** Simple, predictable
**Cons:** May lose data from "losing" client

### Server-Wins

Server version always takes precedence:

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  conflictStrategy: 'server-wins',
});
```

**Pros:** Consistent server state
**Cons:** Client changes may be lost

### Client-Wins

Local version always takes precedence:

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  conflictStrategy: 'client-wins',
});
```

**Pros:** Never lose local work
**Cons:** May overwrite others' changes

### Custom Resolution

Implement your own logic:

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  conflictStrategy: 'custom',
  resolveConflict: (conflict) => {
    const { localDocument, remoteDocument, documentId } = conflict;

    // Merge strategy: combine data from both
    return {
      document: {
        ...remoteDocument,
        ...localDocument,
        _id: documentId,
        // Use latest updatedAt
        _updatedAt: Math.max(
          localDocument._updatedAt,
          remoteDocument._updatedAt
        ),
      },
      resolution: 'merged',
    };
  },
});
```

## Custom Resolution Patterns

### Field-Level Merge

Merge non-conflicting fields:

```typescript
resolveConflict: (conflict) => {
  const { localDocument: local, remoteDocument: remote } = conflict;

  // Get fields changed in each version
  const localChanges = getChangedFields(conflict.baseDocument, local);
  const remoteChanges = getChangedFields(conflict.baseDocument, remote);

  // Check for field-level conflicts
  const conflictingFields = localChanges.filter(f => remoteChanges.includes(f));

  if (conflictingFields.length === 0) {
    // No field conflicts - merge both
    return {
      document: { ...remote, ...local },
      resolution: 'merged',
    };
  }

  // Fall back to last-write-wins for conflicting fields
  return {
    document: local._updatedAt > remote._updatedAt ? local : remote,
    resolution: 'last-write-wins',
  };
}
```

### Array Concatenation

For list fields:

```typescript
resolveConflict: (conflict) => {
  const { localDocument: local, remoteDocument: remote } = conflict;

  // Merge tags arrays
  const mergedTags = [...new Set([
    ...(local.tags || []),
    ...(remote.tags || []),
  ])];

  return {
    document: {
      ...remote,
      ...local,
      tags: mergedTags,
    },
    resolution: 'merged',
  };
}
```

### User-Prompted Resolution

Store conflicts for manual resolution:

```typescript
const pendingConflicts = new Map();

resolveConflict: (conflict) => {
  // Store conflict for user to resolve
  pendingConflicts.set(conflict.documentId, conflict);

  // Temporarily use server version
  return {
    document: conflict.remoteDocument,
    resolution: 'pending-user-review',
  };
}

// Later: show UI for user to resolve
function showConflictUI(documentId: string) {
  const conflict = pendingConflicts.get(documentId);
  // Display both versions, let user choose or merge
}
```

### Operational Transform

For text fields:

```typescript
import { diff, patch } from 'your-diff-library';

resolveConflict: (conflict) => {
  const { baseDocument, localDocument, remoteDocument } = conflict;

  // Compute diffs from base
  const localDiff = diff(baseDocument.content, localDocument.content);
  const remoteDiff = diff(baseDocument.content, remoteDocument.content);

  // Apply both diffs (transform if overlapping)
  const mergedContent = patch(
    baseDocument.content,
    transform(localDiff, remoteDiff)
  );

  return {
    document: {
      ...localDocument,
      content: mergedContent,
    },
    resolution: 'operational-transform',
  };
}
```

## Conflict Interface

```typescript
interface Conflict<T> {
  /** Document ID */
  documentId: string;

  /** Local (client) version */
  localDocument: T;

  /** Remote (server) version */
  remoteDocument: T;

  /** Common ancestor (if available) */
  baseDocument?: T;

  /** When conflict was detected */
  timestamp: number;
}

interface Resolution<T> {
  /** Resolved document */
  document: T;

  /** Resolution type for logging */
  resolution: string;
}
```

## Monitoring Conflicts

### Track Conflict Count

```typescript
sync.getStats().subscribe((stats) => {
  if (stats.conflictCount > 0) {
    console.log(`${stats.conflictCount} conflicts resolved`);
  }
});
```

### Log Conflicts

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  onConflict: (conflict, resolution) => {
    console.log('Conflict resolved:', {
      documentId: conflict.documentId,
      resolution: resolution.resolution,
    });

    // Send to analytics
    analytics.track('sync_conflict', {
      collection: conflict.collection,
      resolution: resolution.resolution,
    });
  },
});
```

## Best Practices

### 1. Design for Conflict Avoidance

```typescript
// Instead of: one large document
{ _id: 'settings', theme: 'dark', language: 'en', ... }

// Use: separate documents per setting
{ _id: 'setting:theme', value: 'dark' }
{ _id: 'setting:language', value: 'en' }
```

### 2. Use Immutable Operations

```typescript
// Instead of: overwriting array
await todos.update(id, { tags: ['new'] });

// Use: append operations
await todos.update(id, {
  tags: [...existingTags, 'new'],
  _appendedTag: 'new',  // Track operation
});
```

### 3. Include Timestamps

```typescript
// Track when each field was modified
interface Todo {
  _id: string;
  title: string;
  titleUpdatedAt: number;
  completed: boolean;
  completedUpdatedAt: number;
}
```

### 4. Test Conflict Scenarios

```typescript
it('handles concurrent updates', async () => {
  // Simulate two clients
  const client1 = await createTestClient();
  const client2 = await createTestClient();

  // Both update same document
  await client1.todos.update('1', { title: 'Version A' });
  await client2.todos.update('1', { title: 'Version B' });

  // Sync both
  await Promise.all([client1.sync(), client2.sync()]);

  // Verify resolution
  const result = await client1.todos.get('1');
  expect(result.title).toBeDefined();
});
```

## Next Steps

- [Sync Overview](./sync.md) - Basic sync setup
- [Server Setup](./sync-server.md) - Server-side configuration
- [Live Queries](./live-queries.md) - React to sync changes
