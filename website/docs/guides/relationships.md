---
sidebar_position: 16
title: Relationships
description: Defining and populating document relationships
---

# Relationships

Pocket supports document relationships, allowing you to define references between collections and fetch related documents with a single query.

## Defining Relationships

Relationships are defined in your schema using the `ref` property:

```typescript
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  collections: [
    {
      name: 'users',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
        },
      },
    },
    {
      name: 'posts',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          authorId: {
            type: 'string',
            ref: 'users',  // References users collection
          },
        },
      },
    },
  ],
});
```

## Relationship Types

### One-to-One

A single reference to another document:

```typescript
// Schema
{
  properties: {
    authorId: {
      type: 'string',
      ref: 'users',
      relation: {
        type: 'one',
        collection: 'users',
      },
    },
  },
}
```

### One-to-Many

An array of references or a foreign key lookup:

```typescript
// Option 1: Array of IDs
{
  properties: {
    tagIds: {
      type: 'array',
      items: { type: 'string' },
      ref: 'tags',
      relation: {
        type: 'many',
        collection: 'tags',
      },
    },
  },
}

// Option 2: Foreign key (inverse relation)
// Comments collection with postId field
{
  properties: {
    postId: {
      type: 'string',
      ref: 'posts',
    },
  },
}
```

## Populating Relations

Use the `populate()` method to fetch related documents:

### Basic Population

```typescript
// Fetch a post with its author
const post = await posts.get('post-1');
const populatedPost = await posts.populate(post, ['authorId']);

console.log(populatedPost.authorId);
// { _id: 'user-1', name: 'Alice', email: 'alice@example.com' }
```

### Query with Population

```typescript
// Find all posts and populate authors
const results = await posts
  .find()
  .where('published').equals(true)
  .populate('authorId')
  .exec();

// Each post now has the full author object
results.forEach(post => {
  console.log(`${post.title} by ${post.authorId.name}`);
});
```

### Multiple Relations

```typescript
// Populate multiple relations
const order = await orders
  .findOne({ _id: 'order-1' })
  .populate(['customerId', 'items'])
  .exec();

console.log(order.customerId.name);  // Customer name
console.log(order.items);            // Array of item documents
```

### Nested Population

Populate relations on related documents:

```typescript
// Populate post author and the author's department
const post = await posts
  .findOne({ _id: 'post-1' })
  .populate({
    path: 'authorId',
    populate: ['departmentId'],  // Nested populate
  })
  .exec();

console.log(post.authorId.departmentId.name);
```

## Population Options

### Filtering Related Documents

```typescript
// Only populate active comments
const post = await posts
  .findOne({ _id: 'post-1' })
  .populate({
    path: 'comments',
    filter: { status: 'approved' },
  })
  .exec();
```

### Sorting Related Documents

```typescript
// Sort comments by date
const post = await posts
  .findOne({ _id: 'post-1' })
  .populate({
    path: 'comments',
    sort: { field: 'createdAt', direction: 'desc' },
  })
  .exec();
```

### Limiting Related Documents

```typescript
// Get only the 5 most recent comments
const post = await posts
  .findOne({ _id: 'post-1' })
  .populate({
    path: 'comments',
    limit: 5,
    sort: { field: 'createdAt', direction: 'desc' },
  })
  .exec();
```

## Manual Relations

For more control, you can resolve relations manually:

```typescript
import { resolveRelations } from '@pocket/core';

const post = await posts.get('post-1');

const context = {
  getCollection: (name) => db.collection(name),
  getRelation: (collectionName, path) => ({
    collection: 'users',
    type: 'one',
  }),
};

const { document, documentsFetched } = await resolveRelations(
  post,
  ['authorId'],
  'posts',
  context
);

console.log(`Fetched ${documentsFetched} related documents`);
```

## Batch Population

For better performance with multiple documents:

```typescript
import { resolveRelationsBatch } from '@pocket/core';

const posts = await postsCollection.find().exec();

const populatedPosts = await resolveRelationsBatch(
  posts,
  ['authorId'],
  'posts',
  context
);
```

## TypeScript

Define types for populated documents:

```typescript
interface User {
  _id: string;
  name: string;
  email: string;
}

interface Post {
  _id: string;
  title: string;
  authorId: string;  // Before population
}

interface PopulatedPost extends Omit<Post, 'authorId'> {
  authorId: User;  // After population
}

// Type-safe population
const post = await posts
  .findOne({ _id: 'post-1' })
  .populate('authorId')
  .exec() as PopulatedPost;

post.authorId.name;  // Type-safe access
```

## Performance Considerations

### N+1 Query Problem

Without batching, populating N documents can result in N+1 queries:

```typescript
// Avoid: N+1 queries
const posts = await postsCollection.find().exec();
for (const post of posts) {
  await postsCollection.populate(post, ['authorId']);
}

// Better: Batch population
const posts = await postsCollection
  .find()
  .populate('authorId')
  .exec();
```

### Index Related Fields

Ensure foreign key fields are indexed:

```typescript
await posts.createIndex({
  fields: ['authorId'],
  name: 'authorId_idx',
});
```

### Limit Population Depth

Avoid deeply nested populations which can be expensive:

```typescript
// Expensive: Multiple levels of nesting
.populate({
  path: 'author',
  populate: {
    path: 'department',
    populate: {
      path: 'company',
      populate: ['headquarters'],
    },
  },
})

// Better: Fetch in separate queries if needed
const post = await posts.findOne({ _id }).populate('author').exec();
const dept = await departments.get(post.author.departmentId);
```

## React Integration

Use populations with React hooks:

```tsx
import { useLiveQuery } from '@pocket/react';

function PostList() {
  const { data: posts, isLoading } = useLiveQuery(
    'posts',
    (c) => c.find()
      .where('published').equals(true)
      .populate('authorId')
      .sort('createdAt', 'desc')
  );

  if (isLoading) return <div>Loading...</div>;

  return (
    <ul>
      {posts.map(post => (
        <li key={post._id}>
          <h2>{post.title}</h2>
          <p>By {post.authorId.name}</p>
        </li>
      ))}
    </ul>
  );
}
```

## Comparison with SQL Joins

| SQL | Pocket |
|-----|--------|
| `INNER JOIN` | `populate()` with required relation |
| `LEFT JOIN` | `populate()` (returns `null` if not found) |
| `SELECT specific columns` | Not supported (fetches full document) |
| `JOIN with condition` | `populate({ filter: {...} })` |

Unlike SQL joins which combine tables in a single query, Pocket's `populate()` executes additional queries to fetch related documents. This is typical of document databases.

## Next Steps

- [Schema Validation](/docs/guides/schema-validation) - Define schemas with refs
- [Indexing](/docs/guides/indexing) - Index foreign key fields
- [Query Builder](/docs/api/query-builder) - Query API reference
