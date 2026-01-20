# FAQ & Troubleshooting

This guide covers frequently asked questions and common issues when using Pocket.

## Frequently Asked Questions

### General

#### What browsers does Pocket support?

Pocket supports all modern browsers:
- Chrome/Edge 80+
- Firefox 78+
- Safari 14+

For IndexedDB storage, the browser must support IndexedDB v2. For OPFS storage, the browser must support the Origin Private File System API.

#### Can I use Pocket with React Native?

Currently, Pocket is designed for web browsers. React Native support is on the roadmap. For now, you would need to use a web view or create a custom storage adapter.

#### How large can my database be?

The maximum size depends on the storage adapter:
- **IndexedDB**: Typically 50% of available disk space, varies by browser
- **OPFS**: Usually 10% of available disk space
- **Memory**: Limited by available RAM

Monitor storage usage with the `getStats()` method:

```typescript
const stats = await db.getStats();
console.log(`Storage used: ${stats.storageSize} bytes`);
```

#### Is my data encrypted?

By default, data is not encrypted. Pocket stores data in browser storage (IndexedDB/OPFS) which is:
- Isolated to your origin (domain)
- Not accessible to other websites
- Subject to browser security policies

For sensitive data, consider:
- Using HTTPS (required for OPFS)
- Implementing application-level encryption
- Not storing sensitive data client-side

### Performance

#### My queries are slow, how can I improve them?

1. **Add indexes** for fields you query frequently:

```typescript
await collection.createIndex({
  name: 'status_idx',
  fields: ['status'],
});
```

2. **Use projections** to limit returned fields (when supported by your storage adapter)

3. **Paginate results** instead of loading all documents:

```typescript
const page1 = await todos.find().limit(20).exec();
const page2 = await todos.find().skip(20).limit(20).exec();
```

4. **Avoid complex regex patterns** - they can cause performance issues

#### Why are my live queries updating slowly?

Live queries update when the underlying data changes. If updates seem slow:

1. Check if you have many overlapping subscriptions
2. Use `debounceTime` option for high-frequency updates:

```typescript
const query = collection.createLiveQuery(spec, { debounceTime: 100 });
```

3. Consider if you need reactive updates, or if polling would suffice

### Sync

#### Why is sync not working?

Common causes:

1. **Network issues**: Check browser console for network errors
2. **Authentication expired**: Refresh your auth token
3. **Server unavailable**: Verify the sync server is running

Enable logging to debug:

```typescript
const syncEngine = createSyncEngine(db, {
  serverUrl: 'https://api.example.com/sync',
  logger: { level: 'debug', enabled: true },
});
```

#### How do I handle sync conflicts?

Pocket provides several conflict resolution strategies:

```typescript
const syncEngine = createSyncEngine(db, {
  serverUrl: '...',
  conflictStrategy: 'last-write-wins', // or 'server-wins', 'client-wins', 'merge'
});
```

For custom logic, use the `merge` strategy with a custom function:

```typescript
const syncEngine = createSyncEngine(db, {
  serverUrl: '...',
  conflictStrategy: 'merge',
  // Custom merge is handled via the ConflictResolver class
});
```

#### Why do I see duplicate documents after sync?

This usually happens when:
1. Documents are created offline without proper IDs
2. The same document is created on multiple clients

**Solution**: Always use deterministic IDs when possible, or use UUIDs:

```typescript
await collection.insert({
  _id: crypto.randomUUID(),
  title: 'New Document',
});
```

## Common Issues

### "QuotaExceededError" when inserting documents

Your browser's storage quota has been exceeded.

**Solutions**:
1. Delete old or unnecessary documents
2. Clear the database and re-sync from server
3. Request persistent storage (increases quota):

```typescript
if (navigator.storage?.persist) {
  const isPersisted = await navigator.storage.persist();
  console.log(`Persistent storage: ${isPersisted}`);
}
```

### "InvalidStateError" with IndexedDB

This error occurs when the database connection is closed unexpectedly.

**Solutions**:
1. Don't close the database manually unless necessary
2. Handle page unload events properly
3. Check for browser extensions that might clear data

### React hooks causing infinite re-renders

If using `useLiveQuery` with inline query functions, the query will re-run on every render.

**Wrong**:
```tsx
// This creates a new function on every render!
const { data } = useLiveQuery(() => collection.find().exec());
```

**Correct**:
```tsx
// Memoize the query function
const query = useCallback(
  () => collection.find({ status: 'active' }).exec(),
  []
);
const { data } = useLiveQuery(query);
```

### "Failed to execute 'transaction' on 'IDBDatabase'"

This error can occur when:
1. The database is being upgraded
2. The tab was backgrounded and the connection was closed

**Solution**: Implement connection recovery:

```typescript
// The database automatically handles reconnection
// but you may need to retry failed operations
try {
  await collection.insert(doc);
} catch (error) {
  if (error.name === 'InvalidStateError') {
    // Wait and retry
    await new Promise(resolve => setTimeout(resolve, 100));
    await collection.insert(doc);
  }
}
```

### Sync engine shows "offline" but I have internet

The sync engine may show offline if:
1. The WebSocket connection was dropped
2. The server is unreachable
3. A proxy/firewall is blocking WebSocket connections

**Solutions**:
1. Check if the server endpoint is correct
2. Try HTTP transport instead of WebSocket:

```typescript
const syncEngine = createSyncEngine(db, {
  serverUrl: '...',
  useWebSocket: false, // Use HTTP polling instead
});
```

3. Check browser console for WebSocket errors

### Schema validation errors

If you see "Validation failed" errors:

1. Check that your document matches the schema:

```typescript
const schema = {
  title: { type: 'string', required: true },
  count: { type: 'number', default: 0 },
};
```

2. Ensure required fields are provided:

```typescript
// This will fail if title is required
await collection.insert({ count: 5 }); // Missing 'title'
```

3. Check field types match:

```typescript
// This will fail if count should be a number
await collection.insert({ title: 'Test', count: 'five' });
```

## Debugging Tips

### Enable verbose logging

For sync issues:

```typescript
const syncEngine = createSyncEngine(db, {
  serverUrl: '...',
  logger: {
    level: 'debug',
    enabled: true,
  },
});
```

### Inspect database contents

```typescript
// Get all documents in a collection
const allDocs = await collection.getAll();
console.log('Documents:', allDocs);

// Get database statistics
const stats = await db.getStats();
console.log('Stats:', stats);

// List all collections
const collections = await db.listCollections();
console.log('Collections:', collections);
```

### Monitor sync status

```typescript
syncEngine.getStatus().subscribe(status => {
  console.log('Sync status:', status); // 'idle', 'syncing', 'error', 'offline'
});

syncEngine.getStats().subscribe(stats => {
  console.log('Sync stats:', stats);
  // { pushCount, pullCount, conflictCount, lastSyncAt, lastError }
});
```

### Check for storage issues

```typescript
// Check available storage
if (navigator.storage?.estimate) {
  const { usage, quota } = await navigator.storage.estimate();
  console.log(`Using ${usage} of ${quota} bytes`);
}
```

## Getting Help

If you can't find an answer here:

1. Search [GitHub Discussions](https://github.com/pocket-db/pocket/discussions)
2. Open a new discussion with:
   - Pocket version
   - Browser and version
   - Minimal reproduction code
   - Error messages from console
3. For bugs, open an [issue](https://github.com/pocket-db/pocket/issues/new?template=bug_report.yml)
