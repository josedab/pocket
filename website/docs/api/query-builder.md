---
sidebar_position: 3
title: Query Builder API
description: QueryBuilder class API reference
---

# Query Builder API

The `QueryBuilder` provides a fluent API for building queries. Get a query builder from a collection:

```typescript
const query = todos.find();
```

## Building Queries

### where()

Starts a condition on a field.

```typescript
where(field: keyof T & string): FieldCondition<T>
```

#### Example

```typescript
todos.find()
  .where('completed').equals(false)
  .where('priority').gte(3);
```

---

## Field Conditions

After calling `where(field)`, use these methods:

### equals()

Exact match.

```typescript
.where('status').equals('active')
```

### notEquals()

Not equal to value.

```typescript
.where('status').notEquals('deleted')
```

### gt() / gte()

Greater than / greater than or equal.

```typescript
.where('priority').gt(2)
.where('createdAt').gte(startOfDay)
```

### lt() / lte()

Less than / less than or equal.

```typescript
.where('priority').lt(5)
.where('dueDate').lte(endOfWeek)
```

### in()

Value in array.

```typescript
.where('status').in(['active', 'pending'])
```

### notIn()

Value not in array.

```typescript
.where('status').notIn(['deleted', 'archived'])
```

### contains()

Array field contains value.

```typescript
.where('tags').contains('urgent')
```

### startsWith()

String starts with prefix.

```typescript
.where('title').startsWith('TODO:')
```

### exists()

Field exists (is not undefined).

```typescript
.where('assignee').exists()
```

### regex()

Matches regular expression.

```typescript
.where('email').regex(/^admin@/)
```

---

## Query Modifiers

### sort()

Orders results.

```typescript
sort(field: keyof T & string, direction?: 'asc' | 'desc'): QueryBuilder<T>
```

#### Example

```typescript
// Ascending (default)
.sort('createdAt')

// Descending
.sort('createdAt', 'desc')

// Multiple sorts
.sort('priority', 'desc')
.sort('createdAt', 'asc')
```

---

### limit()

Limits the number of results.

```typescript
limit(count: number): QueryBuilder<T>
```

#### Example

```typescript
// Get top 10
.limit(10)
```

---

### skip()

Skips a number of results.

```typescript
skip(count: number): QueryBuilder<T>
```

#### Example

```typescript
// Pagination: page 2, 10 items per page
.skip(10)
.limit(10)
```

---

## Executing Queries

### exec()

Executes the query and returns results.

```typescript
exec(): Promise<T[]>
```

#### Example

```typescript
const results = await todos
  .find()
  .where('completed').equals(false)
  .sort('createdAt', 'desc')
  .limit(10)
  .exec();
```

---

### live()

Creates a live query that updates when data changes.

```typescript
live(options?: LiveQueryOptions): Observable<T[]>
```

#### Options

```typescript
interface LiveQueryOptions {
  debounceMs?: number;      // Batch updates (default: 0)
  useEventReduce?: boolean; // Optimize updates (default: true)
}
```

#### Example

```typescript
const subscription = todos
  .find()
  .where('completed').equals(false)
  .live({ debounceMs: 100 })
  .subscribe((results) => {
    console.log('Updated results:', results);
  });

// Clean up
subscription.unsubscribe();
```

---

## Complete Examples

### Basic Filtering

```typescript
// Incomplete todos
const incomplete = await todos
  .find()
  .where('completed').equals(false)
  .exec();
```

### Multiple Conditions

```typescript
// High priority incomplete todos for a user
const urgent = await todos
  .find()
  .where('userId').equals(currentUser.id)
  .where('completed').equals(false)
  .where('priority').gte(4)
  .exec();
```

### Sorting and Limiting

```typescript
// Latest 5 todos
const latest = await todos
  .find()
  .sort('createdAt', 'desc')
  .limit(5)
  .exec();
```

### Pagination

```typescript
async function getTodos(page: number, pageSize: number) {
  return todos
    .find()
    .sort('createdAt', 'desc')
    .skip(page * pageSize)
    .limit(pageSize)
    .exec();
}
```

### Date Range

```typescript
// Todos due this week
const thisWeek = await todos
  .find()
  .where('dueDate').gte(startOfWeek)
  .where('dueDate').lte(endOfWeek)
  .sort('dueDate', 'asc')
  .exec();
```

### Array Contains

```typescript
// Todos with 'urgent' tag
const urgent = await todos
  .find()
  .where('tags').contains('urgent')
  .exec();
```

### Text Search

```typescript
// Todos starting with "TODO:"
const prefixed = await todos
  .find()
  .where('title').startsWith('TODO:')
  .exec();

// Using regex
const emails = await users
  .find()
  .where('email').regex(/@company\.com$/)
  .exec();
```

### Live Query with React

```typescript
function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);

  useEffect(() => {
    const subscription = db
      .collection<Todo>('todos')
      .find()
      .where('completed').equals(false)
      .sort('createdAt', 'desc')
      .live()
      .subscribe(setTodos);

    return () => subscription.unsubscribe();
  }, []);

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo._id}>{todo.title}</li>
      ))}
    </ul>
  );
}
```

---

## Query Operators Reference

| Operator | Description | Example |
|----------|-------------|---------|
| `equals` | Exact match | `.where('status').equals('active')` |
| `notEquals` | Not equal | `.where('status').notEquals('deleted')` |
| `gt` | Greater than | `.where('count').gt(5)` |
| `gte` | Greater than or equal | `.where('count').gte(5)` |
| `lt` | Less than | `.where('count').lt(10)` |
| `lte` | Less than or equal | `.where('count').lte(10)` |
| `in` | Value in array | `.where('type').in(['a', 'b'])` |
| `notIn` | Value not in array | `.where('type').notIn(['x', 'y'])` |
| `contains` | Array contains | `.where('tags').contains('urgent')` |
| `startsWith` | String prefix | `.where('name').startsWith('Dr.')` |
| `exists` | Field exists | `.where('email').exists()` |
| `regex` | Regex match | `.where('email').regex(/@test\.com$/)` |

---

## Types

### QueryBuilder

```typescript
class QueryBuilder<T> {
  where(field: keyof T & string): FieldCondition<T>;
  sort(field: keyof T & string, direction?: 'asc' | 'desc'): this;
  limit(count: number): this;
  skip(count: number): this;
  exec(): Promise<T[]>;
  live(options?: LiveQueryOptions): Observable<T[]>;
}
```

### LiveQueryOptions

```typescript
interface LiveQueryOptions {
  debounceMs?: number;
  useEventReduce?: boolean;
}
```

---

## See Also

- [Collection API](/docs/api/collection) - Collection methods
- [Reactive Queries](/docs/concepts/reactive-queries) - How live queries work
- [Indexing Guide](/docs/guides/indexing) - Optimize query performance
