---
sidebar_position: 9
title: Schema Migrations
description: Migrate data between schema versions safely
---

# Schema Migrations

As your application evolves, document schemas change. Pocket's migration system helps you transform existing data to match new schema versions safely.

## Overview

Migrations in Pocket:
- Transform documents from one schema version to another
- Support both upgrade (`up`) and downgrade (`down`) operations
- Can run eagerly (all at once) or lazily (on document access)
- Track migration state to prevent duplicate runs
- Handle errors with configurable strategies

## Basic Migration

### Define Migrations

Each migration transforms documents from one version to the next:

```typescript
import type { Migration } from '@pocket/core';

interface UserV1 {
  _id: string;
  name: string;
  email: string;
}

interface UserV2 {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
}

const userMigrations: Migration[] = [
  {
    version: 2,
    name: 'split-name-field',
    up: (doc: UserV1): UserV2 => {
      const [firstName = '', lastName = ''] = doc.name.split(' ');
      return {
        _id: doc._id,
        firstName,
        lastName,
        email: doc.email,
      };
    },
    down: (doc: UserV2): UserV1 => ({
      _id: doc._id,
      name: `${doc.firstName} ${doc.lastName}`.trim(),
      email: doc.email,
    }),
  },
];
```

### Register and Run Migrations

```typescript
import { Database, createIndexedDBStorage, createMigrationManager } from 'pocket';

const storage = createIndexedDBStorage();

const db = await Database.create({
  name: 'my-app',
  storage,
});

// Create migration manager
const migrationManager = createMigrationManager('my-app', storage);
await migrationManager.initialize();

// Register migrations for a collection
migrationManager.registerMigrations('users', userMigrations);

// Run migrations
const result = await migrationManager.migrate('users');

console.log(`Migrated ${result.successCount} documents`);
console.log(`Duration: ${result.durationMs}ms`);
```

## Migration Structure

### Migration Definition

```typescript
interface Migration<TFrom = unknown, TTo = unknown> {
  // Target version (required)
  version: number;

  // Optional name for identification
  name?: string;

  // Upgrade function: previous version -> this version
  up: (doc: TFrom, context: MigrationContext) => TTo | Promise<TTo>;

  // Downgrade function: this version -> previous version (optional)
  down?: (doc: TTo, context: MigrationContext) => TFrom | Promise<TFrom>;
}
```

### Migration Context

The context provides information about the migration:

```typescript
interface MigrationContext {
  databaseName: string;
  collectionName: string;
  fromVersion: number;
  toVersion: number;
  direction: 'up' | 'down';
}
```

### Using Context in Migrations

```typescript
const migration: Migration = {
  version: 3,
  up: (doc, context) => {
    console.log(`Migrating ${context.collectionName} from v${context.fromVersion}`);
    return {
      ...doc,
      migratedAt: Date.now(),
      migratedBy: context.databaseName,
    };
  },
};
```

## Migration Strategies

Configure how to handle failures:

### Stop on Error (Default)

Stop migration immediately when a document fails:

```typescript
const result = await migrationManager.migrate('users', {
  strategy: 'stop-on-error',
});

if (result.failureCount > 0) {
  console.error('Migration stopped at first error:', result.failures[0].error);
}
```

### Continue on Error

Continue migrating other documents even if some fail:

```typescript
const result = await migrationManager.migrate('users', {
  strategy: 'continue-on-error',
});

console.log(`Migrated: ${result.successCount}/${result.totalDocuments}`);
console.log(`Failed: ${result.failureCount}`);

for (const failure of result.failures) {
  console.error(`Document ${failure.documentId}: ${failure.error.message}`);
}
```

### Rollback on Error

Rollback all changes if any document fails:

```typescript
const result = await migrationManager.migrate('users', {
  strategy: 'rollback-on-error',
});

if (result.failureCount > 0) {
  console.log('Migration rolled back due to errors');
}
```

## Lazy Migrations

Migrate documents on-demand when they're accessed, instead of all at once:

```typescript
// Enable lazy migrations
const migrationManager = createMigrationManager('my-app', storage, {
  lazy: true,
});

// Documents are migrated when accessed
const user = await users.get('user-1');
// Document is automatically migrated if needed
```

### Manual Lazy Migration

```typescript
// Migrate a specific document
const doc = await users.get('user-1');
const migratedDoc = await migrationManager.migrateDocumentLazy('users', doc);
```

### Tracking Pending Lazy Migrations

```typescript
const status = migrationManager.getMigrationStatus();

for (const collection of status) {
  if (collection.pendingLazyMigrations > 0) {
    console.log(
      `${collection.collectionName}: ${collection.pendingLazyMigrations} pending`
    );
  }
}
```

## Progress Tracking

Monitor migration progress for large collections:

```typescript
const result = await migrationManager.migrate('users', {
  onProgress: (progress) => {
    console.log(
      `[${progress.collectionName}] ${progress.phase}: ` +
      `${progress.current}/${progress.total} (${progress.percentage}%)`
    );
  },
});
```

### Progress Phases

| Phase | Description |
|-------|-------------|
| `reading` | Loading documents from storage |
| `migrating` | Transforming documents |
| `writing` | Saving migrated documents |
| `complete` | Migration finished |

### Progress UI Component

```tsx
function MigrationProgress({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState({ phase: 'reading', percentage: 0 });

  useEffect(() => {
    migrationManager.migrate('users', {
      onProgress: setProgress,
    }).then(onComplete);
  }, []);

  return (
    <div>
      <p>Migrating data... {progress.percentage}%</p>
      <progress value={progress.percentage} max={100} />
      <p>Phase: {progress.phase}</p>
    </div>
  );
}
```

## Batch Processing

Control memory usage with batch size:

```typescript
const result = await migrationManager.migrate('users', {
  batchSize: 50, // Process 50 documents at a time (default: 100)
});
```

## Multiple Migrations

Define incremental migrations between versions:

```typescript
const userMigrations: Migration[] = [
  // v1 -> v2: Split name into first/last
  {
    version: 2,
    name: 'split-name',
    up: (doc) => ({
      ...doc,
      firstName: doc.name.split(' ')[0] || '',
      lastName: doc.name.split(' ').slice(1).join(' '),
      name: undefined, // Remove old field
    }),
    down: (doc) => ({
      ...doc,
      name: `${doc.firstName} ${doc.lastName}`.trim(),
      firstName: undefined,
      lastName: undefined,
    }),
  },

  // v2 -> v3: Add createdAt timestamp
  {
    version: 3,
    name: 'add-created-at',
    up: (doc) => ({
      ...doc,
      createdAt: Date.now(),
    }),
    down: (doc) => ({
      ...doc,
      createdAt: undefined,
    }),
  },

  // v3 -> v4: Normalize email to lowercase
  {
    version: 4,
    name: 'normalize-email',
    up: (doc) => ({
      ...doc,
      email: doc.email.toLowerCase(),
    }),
    // No down migration - lowercase is acceptable in v3
  },
];
```

### Migrating Through Multiple Versions

```typescript
// Migrate from v1 to v4
// Runs: v1->v2, v2->v3, v3->v4 in sequence
const result = await migrationManager.migrate('users');
```

## Rollback

Downgrade to a previous version:

```typescript
// Rollback from v4 to v2
await migrationManager.rollback('users', 2);
```

:::warning
Rollback requires `down` functions to be defined for each migration. If a migration lacks a `down` function, rollback will fail.
:::

## Migration Status

Check which collections need migration:

```typescript
// Check single collection
if (migrationManager.needsMigration('users')) {
  console.log('Users collection needs migration');
}

// Get detailed status for all collections
const status = migrationManager.getMigrationStatus();

for (const collection of status) {
  console.log(`${collection.collectionName}:`);
  console.log(`  Current: v${collection.storedVersion}`);
  console.log(`  Target: v${collection.targetVersion}`);
  console.log(`  Needs migration: ${collection.needsMigration}`);
  console.log(`  Last migrated: ${collection.lastMigrationAt}`);
}
```

## Validating Migrations

Check migrations before running:

```typescript
const validationResults = migrationManager.validateMigrations();

for (const [collection, result] of validationResults) {
  if (!result.valid) {
    console.error(`${collection} migrations invalid:`);
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
  }
}
```

## Migrating All Collections

Run migrations for all registered collections:

```typescript
const results = await migrationManager.migrateAll();

for (const [collection, result] of results) {
  console.log(`${collection}: ${result.successCount}/${result.totalDocuments}`);
}
```

## Async Migrations

Migrations can be asynchronous for complex transformations:

```typescript
const migration: Migration = {
  version: 2,
  up: async (doc) => {
    // Fetch additional data
    const enrichedData = await fetchExternalData(doc._id);

    return {
      ...doc,
      enriched: enrichedData,
    };
  },
};
```

## Schema Versioning

Documents track their schema version with `_schemaVersion`:

```typescript
interface VersionedDocument {
  _id: string;
  _schemaVersion?: number; // Added automatically
  // ... other fields
}
```

### Checking Document Version

```typescript
const user = await users.get('user-1');
console.log('Document version:', user._schemaVersion ?? 1);
```

## Best Practices

### 1. Always Define Down Migrations

Enable rollback capability:

```typescript
// Good: Both directions defined
{
  version: 2,
  up: (doc) => ({ ...doc, newField: computeValue() }),
  down: (doc) => ({ ...doc, newField: undefined }),
}

// Risky: No rollback possible
{
  version: 2,
  up: (doc) => ({ ...doc, newField: computeValue() }),
  // No down!
}
```

### 2. Keep Migrations Idempotent

Handle partially migrated documents:

```typescript
{
  version: 2,
  up: (doc) => {
    // Check if already migrated
    if (doc.newField !== undefined) {
      return doc;
    }
    return { ...doc, newField: computeValue() };
  },
}
```

### 3. Test Migrations Before Production

```typescript
// Create test data
const testDocs = [
  { _id: '1', name: 'John Doe' },
  { _id: '2', name: 'Jane' }, // Edge case: no last name
  { _id: '3', name: '' }, // Edge case: empty name
];

// Test migration
for (const doc of testDocs) {
  const migrated = migration.up(doc, mockContext);
  console.log('Input:', doc);
  console.log('Output:', migrated);
}
```

### 4. Handle Missing Fields

Account for documents created before fields existed:

```typescript
{
  version: 3,
  up: (doc) => ({
    ...doc,
    // Use nullish coalescing for missing fields
    updatedAt: doc.updatedAt ?? doc.createdAt ?? Date.now(),
  }),
}
```

### 5. Use Lazy Migrations for Large Collections

Avoid blocking app startup:

```typescript
// Configure lazy migrations
const migrationManager = createMigrationManager('my-app', storage, {
  lazy: true,
});

// App starts immediately
// Documents migrate as they're accessed
```

### 6. Log Migration Results

Track what happened:

```typescript
const result = await migrationManager.migrate('users');

console.log(JSON.stringify({
  collection: result.collectionName,
  from: result.fromVersion,
  to: result.toVersion,
  total: result.totalDocuments,
  success: result.successCount,
  failed: result.failureCount,
  duration: result.durationMs,
}, null, 2));
```

## Example: Complete Migration Setup

```typescript
import { Database, createIndexedDBStorage, createMigrationManager } from 'pocket';

// Define migrations
const userMigrations = [
  {
    version: 2,
    name: 'add-profile',
    up: (doc) => ({
      ...doc,
      profile: {
        bio: '',
        avatar: null,
      },
    }),
    down: (doc) => ({
      ...doc,
      profile: undefined,
    }),
  },
];

const postMigrations = [
  {
    version: 2,
    name: 'add-slug',
    up: (doc) => ({
      ...doc,
      slug: doc.title.toLowerCase().replace(/\s+/g, '-'),
    }),
    down: (doc) => ({
      ...doc,
      slug: undefined,
    }),
  },
];

// Setup
async function initializeDatabase() {
  const storage = createIndexedDBStorage();

  const migrationManager = createMigrationManager('my-app', storage, {
    strategy: 'continue-on-error',
    batchSize: 100,
    onProgress: (p) => console.log(`${p.collectionName}: ${p.percentage}%`),
  });

  await migrationManager.initialize();

  // Register all migrations
  migrationManager.registerMigrations('users', userMigrations);
  migrationManager.registerMigrations('posts', postMigrations);

  // Run migrations
  const results = await migrationManager.migrateAll();

  for (const [collection, result] of results) {
    if (result.failureCount > 0) {
      console.error(`${collection} had ${result.failureCount} failures`);
    }
  }

  // Create database
  return Database.create({
    name: 'my-app',
    storage,
  });
}

const db = await initializeDatabase();
```

## See Also

- [Schema Validation](/docs/guides/schema-validation) - Validate document structure
- [Plugin System](/docs/guides/plugins) - Add custom migration hooks
- [Database API](/docs/api/database) - Database configuration
