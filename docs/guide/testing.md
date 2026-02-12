# Testing Strategies

This guide covers testing patterns, strategies, and best practices for contributing to the Pocket monorepo. It is extracted from the main [Development Guide](/DEVELOPMENT.md) for focused reference.

> ⚠️ **Memory Warning**: With 59+ packages, running `vitest run` at the root may cause out-of-memory errors. Use the Turbo-based test runner (`pnpm test`) which isolates per-package, or set `NODE_OPTIONS="--max-old-space-size=8192"`.

## Test Structure

```
packages/core/src/
├── database/
│   ├── collection.ts
│   └── collection.test.ts    # Unit tests co-located
├── query/
│   └── operators.test.ts
└── ...

test/                          # Integration tests
├── sync.integration.test.ts
├── storage.integration.test.ts
└── fixtures/
```

## Running Tests

```bash
# All tests (via turbo — runs per-package)
pnpm test

# Watch mode
pnpm test:watch

# With coverage
pnpm test:coverage

# Specific file
pnpm --filter @pocket/core test -- collection.test.ts

# Integration tests only
pnpm test:integration

# With verbose output
pnpm test -- --reporter=verbose

# Check which packages have no tests
pnpm test:audit
```

> **Note:** Running `vitest run` directly at the repository root (instead of `pnpm test`) 
> may run out of memory with 44 packages. If you encounter OOM errors, increase the
> Node.js heap size:
>
> ```bash
> NODE_OPTIONS="--max-old-space-size=8192" pnpm test:coverage
> ```

## Writing Unit Tests

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../database';
import { createMemoryStorage } from '@pocket/storage-memory';

describe('Collection', () => {
  let db: Database;

  beforeEach(async () => {
    db = await Database.create({
      name: 'test-db',
      storage: createMemoryStorage(),
    });
  });

  afterEach(async () => {
    await db.close();
  });

  describe('insert', () => {
    it('should insert a document and return it with _id', async () => {
      const collection = db.collection('users');
      const doc = await collection.insert({ name: 'Alice' });

      expect(doc._id).toBeDefined();
      expect(doc.name).toBe('Alice');
    });

    it('should throw on duplicate _id', async () => {
      const collection = db.collection('users');
      await collection.insert({ _id: 'user-1', name: 'Alice' });

      await expect(
        collection.insert({ _id: 'user-1', name: 'Bob' })
      ).rejects.toThrow(/already exists/);
    });
  });
});
```

## Testing Async/Observable Code

```typescript
import { firstValueFrom, take, toArray } from 'rxjs';

describe('Live Queries', () => {
  it('should emit updates when documents change', async () => {
    const collection = db.collection('todos');

    // Collect first 3 emissions
    const emissions = collection
      .find()
      .$
      .pipe(take(3), toArray());

    const emissionsPromise = firstValueFrom(emissions);

    // Trigger changes
    await collection.insert({ title: 'Todo 1' });
    await collection.insert({ title: 'Todo 2' });

    const results = await emissionsPromise;

    expect(results).toHaveLength(3);
    expect(results[0]).toHaveLength(0);  // Initial empty
    expect(results[1]).toHaveLength(1);  // After first insert
    expect(results[2]).toHaveLength(2);  // After second insert
  });
});
```

## Mocking

```typescript
import { vi } from 'vitest';

// Mock a module
vi.mock('@pocket/core', () => ({
  Database: {
    create: vi.fn().mockResolvedValue({
      collection: vi.fn(),
    }),
  },
}));

// Mock timers
vi.useFakeTimers();
await vi.advanceTimersByTimeAsync(1000);
vi.useRealTimers();

// Spy on a method
const spy = vi.spyOn(collection, 'insert');
await collection.insert({ name: 'Test' });
expect(spy).toHaveBeenCalledWith({ name: 'Test' });
```

## Testing IndexedDB (Browser APIs)

We use `fake-indexeddb` for testing IndexedDB code:

```typescript
import 'fake-indexeddb/auto';
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';

describe('IndexedDB Storage', () => {
  it('should persist documents', async () => {
    const storage = createIndexedDBStorage();
    await storage.set('users', 'user-1', { name: 'Alice' });

    const doc = await storage.get('users', 'user-1');
    expect(doc).toEqual({ name: 'Alice' });
  });
});
```

## See Also

- [Development Guide](/DEVELOPMENT.md) — Main development overview
- [Debugging Guide](/docs/guide/debugging.md)
- [Contributing Guidelines](/CONTRIBUTING.md)
