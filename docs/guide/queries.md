# Queries

Pocket provides a powerful query API with a fluent builder pattern for type-safe, composable queries.

## Basic Queries

### Simple Filter

```typescript
// Object-based filter
const incomplete = await todos.find({ completed: false }).exec();

// Equivalent using query builder
const incomplete = await todos
  .find()
  .where('completed').equals(false)
  .exec();
```

### Find One

```typescript
const todo = await todos.findOne({ completed: false });
```

### Count

```typescript
const count = await todos.count({ completed: false });
```

## Query Builder

The query builder provides a fluent API for complex queries:

```typescript
const results = await todos
  .find()
  .where('completed').equals(false)
  .where('priority').greaterThan(5)
  .sort('createdAt', 'desc')
  .skip(10)
  .limit(20)
  .exec();
```

## Comparison Operators

### Equality

```typescript
.where('status').equals('active')
.where('status').eq('active')        // Alias

.where('status').notEquals('deleted')
.where('status').ne('deleted')       // Alias
```

### Numeric Comparisons

```typescript
.where('priority').greaterThan(5)
.where('priority').gt(5)             // Alias

.where('priority').greaterThanOrEqual(5)
.where('priority').gte(5)            // Alias

.where('priority').lessThan(10)
.where('priority').lt(10)            // Alias

.where('priority').lessThanOrEqual(10)
.where('priority').lte(10)           // Alias

.where('priority').between(5, 10)    // Inclusive
```

### Array Operators

```typescript
.where('status').in(['active', 'pending'])
.where('status').notIn(['deleted', 'archived'])
```

### Existence

```typescript
.where('description').exists()       // Not null/undefined
.where('description').notExists()    // Is null/undefined
```

## String Operators

```typescript
.where('title').startsWith('Task')
.where('title').endsWith('!')
.where('title').contains('important')
.where('title').matches(/^Task \d+/)
```

## Array Field Operators

```typescript
// Array contains all values
.where('tags').all(['urgent', 'work'])

// Array has specific size
.where('tags').size(3)

// Element matches condition
.where('items').elemMatch({ quantity: { $gt: 5 } })
```

## Logical Operators

### AND (Implicit)

Multiple `where` calls are ANDed:

```typescript
const results = await todos
  .find()
  .where('completed').equals(false)
  .where('priority').gt(5)
  .exec();
// completed = false AND priority > 5
```

### AND (Explicit)

```typescript
const results = await todos
  .find()
  .and(
    { completed: false },
    { priority: { $gt: 5 } }
  )
  .exec();
```

### OR

```typescript
const results = await todos
  .find()
  .or(
    { priority: { $gte: 8 } },
    { tags: { $in: ['urgent'] } }
  )
  .exec();
```

## Sorting

### Single Field

```typescript
.sort('createdAt', 'desc')
.sort('priority', 'asc')
```

### Multiple Fields

```typescript
.sortBy([
  { field: 'priority', direction: 'desc' },
  { field: 'createdAt', direction: 'asc' },
])
```

## Pagination

### Skip and Limit

```typescript
const page2 = await todos
  .find()
  .skip(20)
  .limit(10)
  .exec();
```

### Pagination Helper

```typescript
async function getPage(page: number, pageSize: number) {
  return todos
    .find()
    .sort('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .exec();
}
```

## Projection

### Include Fields

```typescript
const results = await todos
  .find()
  .include('_id', 'title', 'completed')
  .exec();
```

### Exclude Fields

```typescript
const results = await todos
  .find()
  .exclude('description', 'internalNotes')
  .exec();
```

### Raw Projection

```typescript
const results = await todos
  .find()
  .select({ title: 1, completed: 1, description: 0 })
  .exec();
```

## Raw Filters

For complex queries, use raw filter syntax:

```typescript
const results = await todos
  .find()
  .filter({
    $and: [
      { completed: false },
      {
        $or: [
          { priority: { $gte: 8 } },
          { tags: { $in: ['urgent'] } },
        ],
      },
    ],
  })
  .exec();
```

## Query Specification

Get the raw query spec for debugging:

```typescript
const query = todos
  .find()
  .where('completed').equals(false)
  .sort('createdAt', 'desc')
  .limit(10);

console.log(query.getSpec());
// {
//   filter: { completed: false },
//   sort: [{ field: 'createdAt', direction: 'desc' }],
//   limit: 10
// }
```

## First Result

Get only the first matching document:

```typescript
const todo = await todos
  .find()
  .where('completed').equals(false)
  .sort('priority', 'desc')
  .first();
```

## Performance Tips

1. **Use Indexes**: Create indexes for frequently queried fields
2. **Limit Results**: Always use `.limit()` when possible
3. **Project Fields**: Only select fields you need
4. **Avoid $or**: OR queries can't use indexes efficiently

```typescript
// Create index for common query
await todos.createIndex({
  fields: ['completed', 'priority'],
});

// Query uses the index
const results = await todos
  .find()
  .where('completed').equals(false)
  .where('priority').gt(5)
  .exec();
```

## Next Steps

- [Live Queries](./live-queries.md) - Reactive, auto-updating queries
- [Collections](./collections.md) - Collection operations
- [Indexes](./database.md#indexes) - Index optimization
