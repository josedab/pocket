# ADR-010: Optimistic Updates with Rollback

## Status

Accepted

## Context

Local-first applications face a fundamental UX challenge: should changes wait for server confirmation, or be applied immediately?

**Pessimistic updates** (wait for server):
- User clicks "Save"
- UI shows loading spinner
- Wait for server response (100ms - 10s depending on network)
- Then show success or error

**Optimistic updates** (apply immediately):
- User clicks "Save"
- UI updates instantly
- Sync happens in background
- If sync fails, rollback and notify user

For a local-first database, users expect changes to work offline and feel instant. However, optimistic updates introduce complexity around conflicts and rollback.

## Decision

Implement optimistic updates as the default behavior, with automatic rollback on sync failure.

### Core Principle

All local mutations return immediately after writing to local storage. Sync with the server happens asynchronously.

```typescript
// This returns in ~1ms (local write only)
const todo = await todos.insert({ title: 'Buy groceries' });
console.log(todo._id); // Available immediately

// Sync happens in background
// If it fails, the change is rolled back
```

### Implementation Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│                                                              │
│  await todos.insert({ title: 'New' })  ──────────────────►  │
│                                         Returns immediately   │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Pocket Core                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  1. Write to local storage (sync)                     │   │
│  │  2. Emit change event                                 │   │
│  │  3. Queue for sync (async)                           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼ async
┌─────────────────────────────────────────────────────────────┐
│                    Sync Engine                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  1. Batch pending changes                             │   │
│  │  2. Push to server                                    │   │
│  │  3. Handle response:                                  │   │
│  │     - Success: Mark synced, update checkpoint         │   │
│  │     - Conflict: Apply resolution strategy             │   │
│  │     - Error: Rollback local change                    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Change Tracking

Each document tracks its sync state:

```typescript
interface DocumentMetadata {
  _id: string;
  _rev: string;           // Local revision
  _syncState: 'pending' | 'synced' | 'conflict';
  _serverRev?: string;    // Last known server revision
  _pendingChanges?: DocumentChanges;  // For rollback
}
```

### Rollback Mechanism

```typescript
// Internal rollback implementation
async function rollbackChange(change: PendingChange): Promise<void> {
  const { collection, documentId, previousState, operation } = change;

  switch (operation) {
    case 'insert':
      // Remove the optimistically inserted document
      await collection.storage.delete(documentId);
      break;

    case 'update':
      // Restore previous document state
      await collection.storage.put(documentId, previousState);
      break;

    case 'delete':
      // Restore the deleted document
      await collection.storage.put(documentId, previousState);
      break;
  }

  // Emit rollback event for UI notification
  collection.events$.next({
    type: 'rollback',
    documentId,
    reason: change.error
  });
}
```

### Handling Rollback in UI

```typescript
// React example
function TodoItem({ todo }) {
  const { data, syncState, error } = useDocument('todos', todo._id);

  if (syncState === 'pending') {
    return <div className="pending">{data.title} (saving...)</div>;
  }

  if (error?.type === 'rollback') {
    return (
      <div className="error">
        Failed to save: {error.message}
        <button onClick={() => retry()}>Retry</button>
      </div>
    );
  }

  return <div>{data.title}</div>;
}
```

### Conflict Resolution

When server rejects a change due to conflict:

```typescript
const sync = createSyncEngine(db, {
  conflictStrategy: 'last-write-wins',  // Default

  // Or custom resolver
  conflictResolver: async (local, remote, base) => {
    // Three-way merge
    return mergeDocuments(base, local, remote);
  },

  // Handle unresolvable conflicts
  onConflict: (conflict) => {
    // Notify user, let them choose
    showConflictDialog(conflict);
  }
});
```

### Sync States

| State | Meaning | UI Indication |
|-------|---------|---------------|
| `synced` | Document matches server | None (normal) |
| `pending` | Local changes not yet synced | Subtle indicator |
| `syncing` | Currently pushing to server | Loading indicator |
| `conflict` | Server rejected, needs resolution | Warning/action needed |
| `error` | Sync failed, will retry | Error indicator |

### Batch Rollback

For related changes that must succeed or fail together:

```typescript
await db.transaction(async (tx) => {
  const order = await tx.collection('orders').insert({ total: 100 });
  await tx.collection('orderItems').insert({ orderId: order._id, product: 'A' });
  await tx.collection('orderItems').insert({ orderId: order._id, product: 'B' });
});
// All three documents rolled back together if sync fails
```

## Consequences

### Positive

- **Instant feedback**: UI responds immediately to user actions
- **Offline support**: Works without network connection
- **Reduced perceived latency**: App feels fast regardless of network
- **Consistency**: Rollback ensures data integrity

### Negative

- **Complexity**: Rollback logic adds implementation complexity
- **UI states**: Must handle pending/syncing/error states in UI
- **User confusion**: Rollbacks can surprise users ("where did my data go?")
- **Retry logic**: Need strategy for retrying failed syncs

### Mitigations

1. **Clear UI feedback**: Always show sync state to users
2. **Retry with backoff**: Automatic retry for transient failures
3. **Conflict preview**: Show users what changed before rollback
4. **Offline queue**: Persist pending changes across app restarts

## Alternatives Considered

### 1. Pessimistic Updates

Wait for server confirmation before updating UI.

```typescript
// Show loading, wait for server, then update
setLoading(true);
await serverApi.createTodo(todo);
await refetchTodos();
setLoading(false);
```

Rejected because:
- Poor UX (perceived as slow)
- Doesn't work offline
- Contradicts local-first philosophy

### 2. No Rollback (Accept Divergence)

Apply changes optimistically, don't rollback on failure, let sync resolve later.

Rejected because:
- Data can diverge significantly
- Users see stale/wrong data
- Conflicts become harder to resolve

### 3. Manual Sync

Let users explicitly trigger sync, don't auto-sync.

Rejected because:
- Poor UX (users forget to sync)
- Data loss risk (unsaved changes)
- Doesn't feel "automatic"

### 4. Version Vectors Instead of Rollback

Track all versions, let users resolve conflicts manually.

Rejected because:
- Complex UI requirements
- Users don't want to be merge conflict resolvers
- Overkill for most applications

## References

- [Offline-First Design Patterns](https://www.nngroup.com/articles/offline-design-patterns/)
- [Optimistic UI Patterns](https://www.apollographql.com/docs/react/performance/optimistic-ui/)
- [CouchDB Replication Protocol](https://docs.couchdb.org/en/stable/replication/protocol.html)
