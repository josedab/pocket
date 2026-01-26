---
sidebar_position: 18
title: Data Seeding
description: Seed development and test data
---

# Data Seeding

Pocket provides a seeding system to populate your database with development or test data. This is useful for local development, demos, and testing.

## Basic Usage

### 1. Define a Seed Configuration

```typescript
import { defineSeed } from '@pocket/core';

export const seedConfig = defineSeed({
  environments: ['development', 'test'],
  collections: {
    users: {
      data: [
        { _id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'admin' },
        { _id: 'user-1', name: 'Alice', email: 'alice@example.com', role: 'user' },
      ],
    },
  },
});
```

### 2. Run the Seeder

```typescript
import { createSeeder } from '@pocket/core';

const seeder = createSeeder(seedConfig);

const result = await seeder.seed(
  {
    users: db.collection('users'),
    posts: db.collection('posts'),
  },
  'development'
);

console.log(`Seeded ${result.totalInserted} documents`);
```

## Seed Configuration

### defineSeed

The `defineSeed` helper provides type-safe configuration:

```typescript
import { defineSeed } from '@pocket/core';

export default defineSeed({
  // Only allow seeding in these environments
  environments: ['development', 'test'],

  // Random seed for reproducible data (optional)
  randomSeed: 12345,

  // Collection configurations
  collections: {
    // Static data
    users: {
      data: [
        { _id: 'admin', name: 'Admin', role: 'admin' },
      ],
    },

    // Factory-generated data
    posts: {
      factory: (index, ctx) => ({
        _id: ctx.randomId(),
        title: `Post ${index + 1}`,
        content: `Content for post ${index + 1}`,
        authorId: ctx.randomPick(['admin', 'user-1', 'user-2']),
        createdAt: ctx.randomDate(
          new Date('2024-01-01'),
          new Date()
        ),
      }),
      count: 50,
    },
  },
});
```

### Collection Options

```typescript
interface CollectionSeedConfig<T> {
  /** Static data to insert */
  data?: T[];

  /** Factory function to generate data */
  factory?: (index: number, context: SeedContext) => T | Promise<T>;

  /** Number of documents to generate (with factory) */
  count?: number;

  /** Clear collection before seeding */
  clear?: boolean;

  /** Only seed if collection is empty */
  onlyIfEmpty?: boolean;
}
```

## Factory Functions

Factory functions generate documents dynamically:

```typescript
{
  posts: {
    factory: (index, ctx) => ({
      _id: ctx.randomId(),
      title: `Post ${index + 1}`,
      content: generateLoremIpsum(ctx),
      published: ctx.random() > 0.3, // 70% published
    }),
    count: 100,
  },
}
```

### Seed Context

The context provides utilities for generating random data:

```typescript
interface SeedContext {
  /** Current environment */
  environment: string;

  /** Collection being seeded */
  collection: string;

  /** Random number between 0 and 1 */
  random: () => number;

  /** Generate a random UUID-like ID */
  randomId: () => string;

  /** Random date within a range */
  randomDate: (start: Date, end: Date) => Date;

  /** Pick a random item from an array */
  randomPick: <T>(items: T[]) => T;

  /** Random integer between min and max (inclusive) */
  randomInt: (min: number, max: number) => number;
}
```

### Example Factory Functions

```typescript
// User factory
users: {
  factory: (i, ctx) => ({
    _id: ctx.randomId(),
    name: ctx.randomPick(['Alice', 'Bob', 'Charlie', 'Diana']),
    email: `user${i}@example.com`,
    age: ctx.randomInt(18, 65),
    createdAt: ctx.randomDate(new Date('2023-01-01'), new Date()),
    verified: ctx.random() > 0.2,
  }),
  count: 100,
},

// Order factory with relations
orders: {
  factory: async (i, ctx) => {
    const userIds = ['user-1', 'user-2', 'user-3'];
    const products = ['Widget', 'Gadget', 'Gizmo', 'Thing'];

    return {
      _id: ctx.randomId(),
      userId: ctx.randomPick(userIds),
      items: Array.from(
        { length: ctx.randomInt(1, 5) },
        () => ({
          product: ctx.randomPick(products),
          quantity: ctx.randomInt(1, 10),
          price: ctx.randomInt(10, 100),
        })
      ),
      status: ctx.randomPick(['pending', 'processing', 'shipped', 'delivered']),
      createdAt: ctx.randomDate(new Date('2024-01-01'), new Date()),
    };
  },
  count: 200,
},
```

## Seeder API

### Creating a Seeder

```typescript
import { createSeeder, Seeder } from '@pocket/core';

// Using factory
const seeder = createSeeder(config);

// Or class directly
const seeder = new Seeder(config);
```

### Running Seeds

```typescript
const result = await seeder.seed(collections, environment);
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `collections` | `Record<string, SeedableCollection>` | Map of collection names to instances |
| `environment` | `string` | Current environment name |

#### Return Value

```typescript
interface SeedResult {
  collections: CollectionSeedResult[];
  totalInserted: number;
  totalExecutionTimeMs: number;
  environment: string;
}

interface CollectionSeedResult {
  collection: string;
  insertedCount: number;
  cleared: boolean;
  skipped: boolean;
  skipReason?: string;
  executionTimeMs: number;
}
```

### Seeding Individual Collections

```typescript
const result = await seeder.seedCollection(
  db.collection('users'),
  {
    data: [{ name: 'Test User' }],
    clear: true,
  },
  'test'
);
```

### Checking Environment

```typescript
if (seeder.isAllowed('production')) {
  // This would be false if production isn't in environments list
}
```

### Clearing Seeded Data

```typescript
await seeder.clear({
  users: db.collection('users'),
  posts: db.collection('posts'),
});
```

## Seed File Pattern

Create a dedicated seed file:

```typescript
// pocket.seed.ts
import { defineSeed } from '@pocket/core';

export default defineSeed({
  environments: ['development', 'test'],

  collections: {
    users: {
      // Admin user always present
      data: [
        {
          _id: 'admin',
          name: 'Administrator',
          email: 'admin@example.com',
          role: 'admin',
          verified: true,
        },
      ],
      // Plus random users
      factory: (i, ctx) => ({
        _id: ctx.randomId(),
        name: `User ${i + 1}`,
        email: `user${i + 1}@example.com`,
        role: 'user',
        verified: ctx.random() > 0.3,
      }),
      count: 20,
    },

    posts: {
      factory: (i, ctx) => ({
        _id: ctx.randomId(),
        title: `Sample Post ${i + 1}`,
        content: `This is the content for post ${i + 1}.`,
        authorId: i < 5 ? 'admin' : ctx.randomPick(['admin', 'user-1']),
        published: true,
        createdAt: ctx.randomDate(new Date('2024-01-01'), new Date()),
      }),
      count: 50,
    },

    comments: {
      factory: (i, ctx) => ({
        _id: ctx.randomId(),
        postId: `post-${ctx.randomInt(1, 50)}`,
        authorId: ctx.randomPick(['admin', 'user-1', 'user-2']),
        content: `Comment ${i + 1}`,
        createdAt: ctx.randomDate(new Date('2024-01-01'), new Date()),
      }),
      count: 200,
    },
  },
});
```

### Using the Seed File

```typescript
import seedConfig from './pocket.seed';
import { createSeeder } from '@pocket/core';

const seeder = createSeeder(seedConfig);

// In development setup
if (process.env.NODE_ENV === 'development') {
  await seeder.seed(
    {
      users: db.collection('users'),
      posts: db.collection('posts'),
      comments: db.collection('comments'),
    },
    'development'
  );
}
```

## CLI Integration

Use the Pocket CLI to run seeds:

```bash
# Run seeds for development
pocket seed

# Run seeds for specific environment
pocket seed --env test

# Clear and reseed
pocket seed --clear

# Dry run (show what would be seeded)
pocket seed --dry-run
```

## Testing Integration

### Jest Example

```typescript
import { createSeeder } from '@pocket/core';
import seedConfig from './pocket.seed';

describe('Posts API', () => {
  let db: Database;
  let seeder: Seeder;

  beforeAll(async () => {
    db = await Database.create({
      name: 'test-db',
      storage: createMemoryStorage(),
    });
    seeder = createSeeder(seedConfig);
  });

  beforeEach(async () => {
    await seeder.seed(
      {
        users: db.collection('users'),
        posts: db.collection('posts'),
      },
      'test'
    );
  });

  afterEach(async () => {
    await seeder.clear({
      users: db.collection('users'),
      posts: db.collection('posts'),
    });
  });

  test('returns posts by author', async () => {
    const posts = await db.collection('posts')
      .find()
      .where('authorId').equals('admin')
      .exec();

    expect(posts.length).toBeGreaterThan(0);
  });
});
```

### Reproducible Tests

Use `randomSeed` for reproducible random data:

```typescript
const seedConfig = defineSeed({
  randomSeed: 42, // Same data every time
  collections: {
    users: {
      factory: (i, ctx) => ({
        _id: ctx.randomId(), // Same IDs with same seed
        name: ctx.randomPick(['A', 'B', 'C']),
      }),
      count: 10,
    },
  },
});
```

## Best Practices

### 1. Environment Protection

Always restrict seeding to non-production environments:

```typescript
defineSeed({
  environments: ['development', 'test', 'staging'],
  // production NOT included
});
```

### 2. Use `onlyIfEmpty` for Safety

Prevent accidental data duplication:

```typescript
{
  users: {
    data: [...],
    onlyIfEmpty: true, // Won't seed if users exist
  },
}
```

### 3. Seed Related Data Together

Ensure foreign keys reference existing documents:

```typescript
{
  users: {
    data: [
      { _id: 'user-1', name: 'Alice' },
      { _id: 'user-2', name: 'Bob' },
    ],
  },
  posts: {
    factory: (i, ctx) => ({
      authorId: ctx.randomPick(['user-1', 'user-2']), // Valid user IDs
    }),
  },
}
```

### 4. Keep Seeds Fast

For large datasets, consider async factories and batching:

```typescript
{
  largeCollection: {
    factory: async (i, ctx) => {
      // Async operations if needed
      return { ... };
    },
    count: 10000,
  },
}
```

### 5. Document Your Seeds

Add comments explaining the seed data:

```typescript
{
  users: {
    data: [
      // System admin - used for admin panel tests
      { _id: 'admin', role: 'admin' },
      // Regular user - used for permission tests
      { _id: 'user-1', role: 'user' },
    ],
  },
}
```

## Next Steps

- [Testing Guide](/docs/guides/testing) - Test with seeded data
- [CLI Reference](/docs/api/cli) - Seed command reference
- [Schema Validation](/docs/guides/schema-validation) - Validate seeded data
