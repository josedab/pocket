---
sidebar_position: 15
title: Storage Migration
description: How to migrate between storage backends
---

# Storage Migration

This guide covers how to migrate data between Pocket storage backends — for example, moving from IndexedDB to OPFS for better performance, or from in-memory storage to a persistent backend when transitioning from testing to production.

## Overview

You might need to migrate storage backends when:

- **Performance requirements change** — OPFS offers lower latency than IndexedDB for large datasets
- **Platform targets shift** — Moving from a web app to Electron or Tauri requires SQLite
- **Scaling beyond browser limits** — IndexedDB quotas may not fit your data volume
- **Going from prototype to production** — Replacing in-memory storage with a persistent backend
- **Adding offline support** — Edge runtimes like Cloudflare Workers need specialized adapters

Pocket's storage layer is pluggable, so you can export data from one backend and import it into another using the standard collection API.

## Available Storage Backends

| Backend | Package | Bundle Size | Best For | Persistence |
|---------|---------|-------------|----------|-------------|
| **IndexedDB** | `@pocket/storage-indexeddb` | ~5 KB | General web apps | ✅ Browser-scoped |
| **OPFS** | `@pocket/storage-opfs` | ~8 KB | High-performance web apps | ✅ Origin-scoped |
| **SQLite** | `@pocket/storage-sqlite` | Varies | Node.js, Electron, Tauri | ✅ File-based |
| **Memory** | `@pocket/storage-memory` | ~3 KB | Testing, SSR, ephemeral data | ❌ None |
| **wa-sqlite** | `@pocket/storage-wa-sqlite` | ~200 KB | Browser (WASM-based SQL) | ✅ Via IndexedDB/OPFS |
| **Expo SQLite** | `@pocket/storage-expo-sqlite` | Native | React Native / Expo | ✅ Device storage |

### Choosing a Backend

- **Web apps (general):** Start with IndexedDB — it's well-supported and requires no extra setup.
- **Web apps (performance-critical):** Use OPFS for lower latency on reads and writes, especially with large datasets.
- **Desktop apps (Electron/Tauri):** Use SQLite for full ACID transactions and file-based persistence.
- **Mobile (React Native):** Use Expo SQLite for native performance on device.
- **Testing:** Use Memory storage for fast, isolated test runs with zero cleanup.

## Migration Patterns

Every storage migration follows the same high-level steps:

1. **Open the source database** with the current storage backend
2. **Export all data** from each collection
3. **Create a new database** with the target storage backend
4. **Import data** into the new database
5. **Verify data integrity** by comparing document counts and spot-checking records
6. **Clean up** the old storage once migration is confirmed

### Generic Migration Function

```typescript
import { Database } from '@pocket/core';

interface MigrationResult {
  collection: string;
  exported: number;
  imported: number;
  verified: boolean;
}

async function migrateStorage(
  sourceDb: Database,
  targetDb: Database,
  collectionNames: string[],
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];

  for (const name of collectionNames) {
    const sourceCollection = sourceDb.collection(name);
    const targetCollection = targetDb.collection(name);

    // Step 1: Export all documents from source
    const documents = await sourceCollection.find().exec();

    // Step 2: Import into target in batches
    const BATCH_SIZE = 100;
    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batch = documents.slice(i, i + BATCH_SIZE);
      await targetCollection.insertMany(batch);
    }

    // Step 3: Verify document counts match
    const sourceCount = await sourceCollection.count();
    const targetCount = await targetCollection.count();

    results.push({
      collection: name,
      exported: sourceCount,
      imported: targetCount,
      verified: sourceCount === targetCount,
    });
  }

  return results;
}
```

## IndexedDB to OPFS Migration

This is the most common migration path for web applications looking for better performance. OPFS provides faster reads and writes, especially for datasets with thousands of documents.

### Full Example

```typescript
import { Database, createIndexedDBStorage } from '@pocket/core';
import { createOPFSStorage } from '@pocket/storage-opfs';

interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}

interface User {
  _id: string;
  name: string;
  email: string;
}

async function migrateIndexedDBToOPFS(): Promise<void> {
  // 1. Open the existing IndexedDB-backed database
  const sourceDb = await Database.create({
    name: 'my-app-source',
    storage: createIndexedDBStorage(),
  });

  // 2. Create a new OPFS-backed database
  const targetDb = await Database.create({
    name: 'my-app',
    storage: createOPFSStorage(),
  });

  const collections = ['todos', 'users'];

  for (const name of collections) {
    const source = sourceDb.collection(name);
    const target = targetDb.collection(name);

    // 3. Export all documents
    const docs = await source.find().exec();
    console.log(`Exporting ${docs.length} documents from ${name}`);

    // 4. Import in batches to manage memory
    const BATCH_SIZE = 200;
    let imported = 0;

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = docs.slice(i, i + BATCH_SIZE);
      await target.insertMany(batch);
      imported += batch.length;
      console.log(`  ${name}: ${imported}/${docs.length} imported`);
    }

    // 5. Verify integrity
    const sourceCount = await source.count();
    const targetCount = await target.count();

    if (sourceCount !== targetCount) {
      throw new Error(
        `Count mismatch for ${name}: source=${sourceCount}, target=${targetCount}`
      );
    }

    console.log(`✓ ${name}: ${targetCount} documents migrated successfully`);
  }

  // 6. Close the source database
  await sourceDb.close();

  console.log('Migration complete. You can now remove the old IndexedDB data.');
}
```

### Verifying Individual Documents

For critical data, spot-check specific documents after migration:

```typescript
async function verifyDocuments(
  sourceDb: Database,
  targetDb: Database,
  collectionName: string,
  sampleIds: string[],
): Promise<boolean> {
  const source = sourceDb.collection(collectionName);
  const target = targetDb.collection(collectionName);

  for (const id of sampleIds) {
    const sourceDoc = await source.findOne({ _id: id });
    const targetDoc = await target.findOne({ _id: id });

    if (JSON.stringify(sourceDoc) !== JSON.stringify(targetDoc)) {
      console.error(`Document mismatch for ${id} in ${collectionName}`);
      return false;
    }
  }

  return true;
}
```

## Memory to IndexedDB Migration

When transitioning from a development or testing setup to production, you may need to persist data that was created during prototyping with in-memory storage.

```typescript
import { Database, createMemoryStorage, createIndexedDBStorage } from '@pocket/core';

async function migrateMemoryToIndexedDB(): Promise<void> {
  // Source: in-memory database (e.g., from test seeding or prototyping)
  const memoryDb = await Database.create({
    name: 'dev-prototype',
    storage: createMemoryStorage(),
  });

  // Seed some test data
  const todos = memoryDb.collection('todos');
  await todos.insertMany([
    { _id: 'todo-1', title: 'Design schema', completed: true, createdAt: Date.now() },
    { _id: 'todo-2', title: 'Build UI', completed: false, createdAt: Date.now() },
    { _id: 'todo-3', title: 'Write tests', completed: false, createdAt: Date.now() },
  ]);

  // Target: persistent IndexedDB database
  const prodDb = await Database.create({
    name: 'my-app',
    storage: createIndexedDBStorage(),
  });

  // Migrate
  const allTodos = await todos.find().exec();
  const prodTodos = prodDb.collection('todos');
  await prodTodos.insertMany(allTodos);

  // Verify
  const count = await prodTodos.count();
  console.log(`Migrated ${count} todos to IndexedDB`);

  // Clean up memory database
  await memoryDb.close();
}
```

## Error Handling

Storage migrations can fail for several reasons. Always wrap migrations in proper error handling.

### Common Failure Scenarios

| Scenario | Cause | Mitigation |
|----------|-------|------------|
| **Quota exceeded** | Target storage has insufficient space | Check available storage before migrating |
| **Duplicate IDs** | Documents already exist in target | Use upsert or clear target first |
| **Partial migration** | Network error or tab close mid-migration | Track progress and support resuming |
| **Corrupt data** | Source documents fail validation in target | Validate before inserting |
| **Browser incompatibility** | OPFS not supported in older browsers | Feature-detect before migrating |

### Resilient Migration with Error Recovery

```typescript
import { Database } from '@pocket/core';

interface BatchResult {
  succeeded: number;
  failed: string[];
}

async function resilientMigrate(
  sourceDb: Database,
  targetDb: Database,
  collectionName: string,
): Promise<BatchResult> {
  const source = sourceDb.collection(collectionName);
  const target = targetDb.collection(collectionName);
  const result: BatchResult = { succeeded: 0, failed: [] };

  const docs = await source.find().exec();
  const BATCH_SIZE = 50;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);

    try {
      await target.insertMany(batch);
      result.succeeded += batch.length;
    } catch (error) {
      // Fall back to inserting one at a time to isolate failures
      for (const doc of batch) {
        try {
          await target.insert(doc);
          result.succeeded++;
        } catch (docError) {
          console.error(`Failed to migrate document ${doc._id}:`, docError);
          result.failed.push(doc._id);
        }
      }
    }
  }

  return result;
}
```

### Feature Detection for OPFS

Before attempting an OPFS migration, verify browser support:

```typescript
function isOPFSSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    'getDirectory' in navigator.storage
  );
}

async function migrateWithFallback(): Promise<Database> {
  if (isOPFSSupported()) {
    const { createOPFSStorage } = await import('@pocket/storage-opfs');
    return Database.create({
      name: 'my-app',
      storage: createOPFSStorage(),
    });
  }

  // Fall back to IndexedDB
  console.warn('OPFS not supported, using IndexedDB');
  return Database.create({
    name: 'my-app',
    storage: createIndexedDBStorage(),
  });
}
```

## Performance Considerations

### Batch Sizes

The batch size you choose affects both memory usage and migration speed:

| Batch Size | Memory Usage | Speed | Best For |
|------------|-------------|-------|----------|
| 10–50 | Low | Slower | Low-memory devices, very large documents |
| 100–200 | Moderate | Balanced | Most applications |
| 500–1000 | High | Fastest | Servers or desktop apps with ample RAM |

### Progress Tracking

For large migrations, report progress to keep users informed:

```typescript
import { Database } from '@pocket/core';

interface MigrationProgress {
  collection: string;
  total: number;
  completed: number;
  percentage: number;
}

type ProgressCallback = (progress: MigrationProgress) => void;

async function migrateWithProgress(
  sourceDb: Database,
  targetDb: Database,
  collectionName: string,
  onProgress: ProgressCallback,
): Promise<void> {
  const source = sourceDb.collection(collectionName);
  const target = targetDb.collection(collectionName);

  const docs = await source.find().exec();
  const total = docs.length;
  let completed = 0;

  const BATCH_SIZE = 100;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    await target.insertMany(batch);

    completed += batch.length;
    onProgress({
      collection: collectionName,
      total,
      completed,
      percentage: Math.round((completed / total) * 100),
    });
  }
}

// Usage
await migrateWithProgress(sourceDb, targetDb, 'todos', (progress) => {
  console.log(`${progress.collection}: ${progress.percentage}% complete`);
});
```

### React Progress Component

```tsx
import { useState, useEffect } from 'react';

function StorageMigration({ sourceDb, targetDb, collections, onComplete }) {
  const [current, setCurrent] = useState({ collection: '', percentage: 0 });
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function run() {
      for (const name of collections) {
        await migrateWithProgress(sourceDb, targetDb, name, setCurrent);
      }
      setDone(true);
      onComplete();
    }
    run();
  }, []);

  if (done) return <p>Migration complete!</p>;

  return (
    <div>
      <p>Migrating {current.collection}...</p>
      <progress value={current.percentage} max={100} />
      <span>{current.percentage}%</span>
    </div>
  );
}
```

### Memory Tips

- **Stream large collections** — Process documents in batches rather than loading everything into memory at once.
- **Close the source database** after migration to free resources: `await sourceDb.close()`.
- **Avoid migrating during heavy app usage** — Schedule migrations at startup or in a Web Worker to prevent UI jank.

## See Also

- [Schema Migrations](/docs/guides/migrations) — Migrate data between schema versions
- [Performance](/docs/guides/performance) — Optimize Pocket for your use case
- [Testing](/docs/guides/testing) — Use in-memory storage for fast tests
- [Migrating from Other Databases](/docs/guides/migrating-from-other-databases) — Move data from PouchDB, Dexie, etc.
