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

### select()

Specifies which fields to include in results.

```typescript
select(fields: (keyof T)[]): QueryBuilder<T>
```

#### Example

```typescript
// Only return title and completed fields
.select(['_id', 'title', 'completed'])
```

---

### exclude()

Specifies which fields to exclude from results.

```typescript
exclude(fields: (keyof T)[]): QueryBuilder<T>
```

#### Example

```typescript
// Exclude internal fields
.exclude(['_internal', '_metadata'])
```

---

## Cursor Pagination

Cursor-based pagination is more efficient than offset-based pagination for large datasets. It uses a document's ID or field value as a cursor to fetch the next/previous page.

### after()

Returns documents after the specified document ID.

```typescript
after(documentId: string): QueryBuilder<T>
```

#### Example

```typescript
// First page
const page1 = await todos
  .find()
  .sort('createdAt', 'desc')
  .limit(20)
  .exec();

// Next page using cursor
const lastItem = page1[page1.length - 1];
const page2 = await todos
  .find()
  .sort('createdAt', 'desc')
  .after(lastItem._id)
  .limit(20)
  .exec();
```

---

### before()

Returns documents before the specified document ID.

```typescript
before(documentId: string): QueryBuilder<T>
```

#### Example

```typescript
// Get previous page
const previousPage = await todos
  .find()
  .sort('createdAt', 'desc')
  .before(firstItem._id)
  .limit(20)
  .exec();
```

---

### cursor()

Advanced cursor positioning with direction control.

```typescript
cursor(value: string | number | Date, options?: CursorOptions): QueryBuilder<T>
```

#### Options

```typescript
interface CursorOptions {
  direction: 'after' | 'before';
  field?: string;  // Field to use for cursor (default: '_id')
}
```

#### Example

```typescript
// Cursor on a custom field
const results = await todos
  .find()
  .sort('priority', 'desc')
  .cursor(5, { direction: 'after', field: 'priority' })
  .limit(10)
  .exec();
```

---

### Cursor Pagination Hook Pattern

```tsx
function useCursorPagination<T extends { _id: string }>(
  collection: string,
  pageSize = 20
) {
  const [cursors, setCursors] = useState<string[]>([]);

  const { data, isLoading } = useLiveQuery<T>(
    collection,
    (c) => {
      let query = c.find().sort('createdAt', 'desc').limit(pageSize);
      if (cursors.length > 0) {
        query = query.after(cursors[cursors.length - 1]);
      }
      return query;
    },
    [cursors]
  );

  const loadMore = () => {
    if (data && data.length > 0) {
      setCursors([...cursors, data[data.length - 1]._id]);
    }
  };

  const goBack = () => {
    setCursors(cursors.slice(0, -1));
  };

  return { data, isLoading, loadMore, goBack, hasMore: data?.length === pageSize };
}
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

### explain()

Returns the query execution plan without executing the query. Useful for debugging and performance optimization.

```typescript
explain(): Promise<QueryExplanation>
```

#### Return Value

```typescript
interface QueryExplanation {
  /** Whether an index will be used */
  usesIndex: boolean;

  /** Name of the index that will be used */
  indexName?: string;

  /** Fields used for filtering */
  filterFields: string[];

  /** Fields used for sorting */
  sortFields: string[];

  /** Estimated number of documents to scan */
  estimatedDocuments?: number;

  /** Execution statistics (after exec) */
  execution?: {
    /** Total execution time in milliseconds */
    totalTimeMs: number;
    /** Number of documents scanned */
    documentsScanned: number;
    /** Number of index lookups */
    indexHits: number;
    /** Number of documents returned */
    documentsReturned: number;
  };
}
```

#### Example

```typescript
// Check query plan before executing
const plan = await todos
  .find()
  .where('status').equals('active')
  .where('priority').gte(3)
  .explain();

console.log('Uses index:', plan.usesIndex);
console.log('Index name:', plan.indexName);
console.log('Filter fields:', plan.filterFields);
// Output:
// Uses index: true
// Index name: status_priority_idx
// Filter fields: ['status', 'priority']
```

#### Performance Debugging

```typescript
// Find slow queries
async function debugQuery<T>(query: QueryBuilder<T>) {
  const explanation = await query.explain();

  if (!explanation.usesIndex) {
    console.warn('Query does not use an index!');
    console.log('Consider creating an index on:', explanation.filterFields);
  }

  // Execute and get timing
  const start = performance.now();
  const results = await query.exec();
  const duration = performance.now() - start;

  console.log({
    duration: `${duration.toFixed(2)}ms`,
    documentsReturned: results.length,
    ...explanation,
  });

  return results;
}

// Usage
const results = await debugQuery(
  todos.find().where('status').equals('active')
);
```

#### Explain with Index Suggestions

```typescript
const plan = await todos
  .find()
  .where('userId').equals(userId)
  .where('completed').equals(false)
  .sort('createdAt', 'desc')
  .explain();

if (!plan.usesIndex) {
  // Suggest optimal index
  const suggestedIndex = [...plan.filterFields, ...plan.sortFields];
  console.log(`Create index: { fields: ${JSON.stringify(suggestedIndex)} }`);
}
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

### Offset Pagination

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

### Cursor Pagination

```typescript
async function* paginateTodos(pageSize: number) {
  let cursor: string | undefined;

  while (true) {
    let query = todos.find().sort('createdAt', 'desc').limit(pageSize);

    if (cursor) {
      query = query.after(cursor);
    }

    const page = await query.exec();

    if (page.length === 0) break;

    yield page;

    cursor = page[page.length - 1]._id;

    if (page.length < pageSize) break;
  }
}

// Usage
for await (const page of paginateTodos(20)) {
  console.log('Page:', page);
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
  // Conditions
  where(field: keyof T & string): FieldCondition<T>;

  // Modifiers
  sort(field: keyof T & string, direction?: 'asc' | 'desc'): this;
  limit(count: number): this;
  skip(count: number): this;
  select(fields: (keyof T)[]): this;
  exclude(fields: (keyof T)[]): this;

  // Cursor pagination
  after(documentId: string): this;
  before(documentId: string): this;
  cursor(value: string | number | Date, options?: CursorOptions): this;

  // Execution
  exec(): Promise<T[]>;
  live(options?: LiveQueryOptions): Observable<T[]>;
  explain(): Promise<QueryExplanation>;
}
```

### LiveQueryOptions

```typescript
interface LiveQueryOptions {
  debounceMs?: number;
  useEventReduce?: boolean;
}
```

### CursorOptions

```typescript
interface CursorOptions {
  direction: 'after' | 'before';
  field?: string;
}
```

### QueryExplanation

```typescript
interface QueryExplanation {
  usesIndex: boolean;
  indexName?: string;
  filterFields: string[];
  sortFields: string[];
  estimatedDocuments?: number;
  execution?: {
    totalTimeMs: number;
    documentsScanned: number;
    indexHits: number;
    documentsReturned: number;
  };
}
```

---

## See Also

- [Collection API](/docs/api/collection) - Collection methods
- [Reactive Queries](/docs/concepts/reactive-queries) - How live queries work
- [Indexing Guide](/docs/guides/indexing) - Optimize query performance
- [Performance Guide](/docs/guides/performance) - Query optimization techniques
- [Quick Reference](/docs/quick-reference) - Query cheatsheet
