---
sidebar_position: 17
title: TTL & Expiration
description: Automatic document expiration with Time-To-Live
---

# TTL & Expiration

Pocket supports automatic document expiration through Time-To-Live (TTL) settings. This is useful for temporary data like sessions, cache entries, or time-limited records.

## Basic Usage

### 1. Add an Expiration Field

Add a date field to track when documents should expire:

```typescript
interface Session {
  _id: string;
  userId: string;
  token: string;
  expiresAt: Date;  // TTL field
}

await sessions.insert({
  _id: crypto.randomUUID(),
  userId: 'user-123',
  token: 'abc123',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
});
```

### 2. Create a TTL Manager

```typescript
import { createTTLManager } from '@pocket/core';

const ttl = createTTLManager();

// Register the collection
ttl.register('sessions', db.collection('sessions'), {
  field: 'expiresAt',
  cleanupIntervalMs: 60000, // Check every minute
});

// Start automatic cleanup
ttl.start();
```

### 3. Stop When Done

```typescript
// When shutting down
ttl.stop();
```

## TTL Manager API

### Creating a Manager

```typescript
import { createTTLManager, TTLManager } from '@pocket/core';

// Using factory function
const ttl = createTTLManager();

// Or class directly
const ttl = new TTLManager();
```

### Registering Collections

```typescript
ttl.register(name, collection, config);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Collection name |
| `collection` | `TTLCollection` | Collection instance |
| `config` | `TTLConfig` | TTL configuration |

#### TTLConfig Options

```typescript
interface TTLConfig {
  /** Field containing the expiration timestamp */
  field: string;

  /** Cleanup interval in milliseconds (default: 60000) */
  cleanupIntervalMs?: number;

  /** Use soft delete instead of hard delete (default: false) */
  softDelete?: boolean;
}
```

### Starting and Stopping

```typescript
// Start automatic cleanup
ttl.start();

// Start with custom interval (overrides per-collection settings)
ttl.start(30000); // Every 30 seconds

// Stop cleanup
ttl.stop();

// Check if running
if (ttl.isActive()) {
  console.log('TTL cleanup is running');
}
```

### Manual Cleanup

Trigger cleanup manually without waiting for the interval:

```typescript
// Clean up a specific collection
const result = await ttl.cleanup('sessions');
console.log(`Deleted ${result.deletedCount} expired sessions`);

// Clean up all registered collections
const results = await ttl.cleanupAll();
results.forEach(r => {
  console.log(`${r.collection}: deleted ${r.deletedCount}`);
});
```

### Cleanup Result

```typescript
interface TTLCleanupResult {
  /** Number of documents deleted */
  deletedCount: number;
  /** Collection name */
  collection: string;
  /** Execution time in milliseconds */
  executionTimeMs: number;
  /** Any errors encountered (document-level) */
  errors: Array<{ id: string; error: Error }>;
}
```

### Getting Statistics

```typescript
const stats = await ttl.getStats('sessions');

console.log('Total documents:', stats.totalCount);
console.log('Expired (pending cleanup):', stats.expiredCount);
console.log('Next expiration:', stats.nextExpirationAt);
```

### Unregistering Collections

```typescript
ttl.unregister('sessions');
```

### Listing Registered Collections

```typescript
const collections = ttl.getCollections();
// ['sessions', 'cache', 'tokens']
```

## Use Cases

### Session Management

```typescript
interface Session {
  _id: string;
  userId: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
}

const sessions = db.collection<Session>('sessions');

// Create session with 24-hour expiry
async function createSession(userId: string): Promise<Session> {
  return sessions.insert({
    _id: crypto.randomUUID(),
    userId,
    token: generateSecureToken(),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
}

// Extend session
async function extendSession(sessionId: string): Promise<void> {
  await sessions.update(sessionId, {
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
}

// TTL cleanup
const ttl = createTTLManager();
ttl.register('sessions', sessions, { field: 'expiresAt' });
ttl.start();
```

### Cache Entries

```typescript
interface CacheEntry {
  _id: string;
  key: string;
  value: unknown;
  expiresAt: Date;
}

const cache = db.collection<CacheEntry>('cache');

async function setCache(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  await cache.upsert({
    _id: key,
    key,
    value,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  });
}

async function getCache(key: string): Promise<unknown | null> {
  const entry = await cache.get(key);

  // Double-check expiration (in case cleanup hasn't run)
  if (entry && entry.expiresAt > new Date()) {
    return entry.value;
  }

  return null;
}

// More aggressive cleanup for cache
ttl.register('cache', cache, {
  field: 'expiresAt',
  cleanupIntervalMs: 10000, // Every 10 seconds
});
```

### Temporary Uploads

```typescript
interface TempUpload {
  _id: string;
  filename: string;
  path: string;
  uploadedAt: Date;
  expiresAt: Date;
}

const tempUploads = db.collection<TempUpload>('temp_uploads');

// Uploads expire after 1 hour
async function createTempUpload(filename: string, path: string) {
  return tempUploads.insert({
    _id: crypto.randomUUID(),
    filename,
    path,
    uploadedAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
}

ttl.register('temp_uploads', tempUploads, {
  field: 'expiresAt',
  cleanupIntervalMs: 5 * 60 * 1000, // Every 5 minutes
});
```

### Scheduled Content

```typescript
interface ScheduledPost {
  _id: string;
  title: string;
  content: string;
  publishAt: Date;
  expiresAt: Date | null;  // Optional expiration
}

// For scheduled content, you might want cleanup for expired content
// but also a separate system for publishing scheduled content

const posts = db.collection<ScheduledPost>('scheduled_posts');

// Only register posts that have an expiration
ttl.register('scheduled_posts', posts, {
  field: 'expiresAt',
});
```

## Schema Integration

Define TTL in your schema:

```typescript
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  collections: [
    {
      name: 'sessions',
      schema: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          token: { type: 'string' },
          expiresAt: {
            type: 'date',
            // Mark as TTL field for documentation/tooling
            ttl: true,
          },
        },
      },
      // Index for efficient cleanup queries
      indexes: [
        { fields: ['expiresAt'] },
      ],
    },
  ],
});
```

## Performance

### Index the TTL Field

Always index your expiration field for efficient cleanup:

```typescript
await sessions.createIndex({
  fields: ['expiresAt'],
  name: 'expiresAt_idx',
});
```

### Tune Cleanup Interval

- **More frequent** (10-30 seconds): Cache, rate limiting
- **Medium** (1-5 minutes): Sessions, temporary data
- **Less frequent** (15-60 minutes): Audit logs, archive data

```typescript
// Frequent cleanup for cache
ttl.register('cache', cache, {
  field: 'expiresAt',
  cleanupIntervalMs: 10000,
});

// Less frequent for logs
ttl.register('audit_logs', auditLogs, {
  field: 'expiresAt',
  cleanupIntervalMs: 60 * 60 * 1000, // Every hour
});
```

### Batch Size Considerations

For collections with many expired documents, cleanup happens in batches. Monitor cleanup duration:

```typescript
const result = await ttl.cleanup('sessions');
console.log(`Cleanup took ${result.executionTimeMs}ms`);

if (result.executionTimeMs > 5000) {
  console.warn('Cleanup is slow, consider more frequent intervals');
}
```

## Error Handling

Handle cleanup errors gracefully:

```typescript
const result = await ttl.cleanup('sessions');

if (result.errors.length > 0) {
  console.warn('Some documents failed to delete:');
  result.errors.forEach(({ id, error }) => {
    console.warn(`  ${id}: ${error.message}`);
  });
}
```

## React Integration

Monitor TTL status in your UI:

```tsx
import { useEffect, useState } from 'react';
import { createTTLManager } from '@pocket/core';

function TTLStatus({ ttl, collectionName }: {
  ttl: TTLManager;
  collectionName: string;
}) {
  const [stats, setStats] = useState<{
    expiredCount: number;
    nextExpirationAt: Date | null;
  } | null>(null);

  useEffect(() => {
    const updateStats = async () => {
      const s = await ttl.getStats(collectionName);
      setStats(s);
    };

    updateStats();
    const interval = setInterval(updateStats, 10000);

    return () => clearInterval(interval);
  }, [ttl, collectionName]);

  if (!stats) return null;

  return (
    <div className="ttl-status">
      <span>Expired: {stats.expiredCount}</span>
      {stats.nextExpirationAt && (
        <span>
          Next expiry: {stats.nextExpirationAt.toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
```

## Best Practices

1. **Always index TTL fields** for efficient cleanup queries
2. **Use appropriate intervals** based on data sensitivity
3. **Monitor cleanup performance** and adjust intervals if needed
4. **Handle null expiration** for documents that shouldn't expire
5. **Consider soft delete** if you need to recover expired data
6. **Double-check expiration** when reading data (cleanup may not have run yet)

## Next Steps

- [Schema Validation](/docs/guides/schema-validation) - Define TTL in schemas
- [Indexing](/docs/guides/indexing) - Index expiration fields
- [Data Seeding](/docs/guides/data-seeding) - Seed test data with TTL
