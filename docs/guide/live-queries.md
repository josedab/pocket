# Live Queries

Live queries are reactive queries that automatically update when the underlying data changes. They're built on RxJS Observables and provide real-time updates without manual polling.

## Basic Usage

### Creating a Live Query

```typescript
const subscription = todos
  .find({ completed: false })
  .live()
  .subscribe((results) => {
    console.log('Incomplete todos:', results);
  });
```

### Unsubscribing

Always unsubscribe when done:

```typescript
subscription.unsubscribe();
```

## Query Builder with Live

Use the full query builder API:

```typescript
const subscription = todos
  .find()
  .where('completed').equals(false)
  .where('priority').gt(5)
  .sort('createdAt', 'desc')
  .limit(10)
  .live()
  .subscribe((results) => {
    updateUI(results);
  });
```

## Live Query Options

### Debouncing

Reduce update frequency for performance:

```typescript
const subscription = todos
  .find()
  .live({ debounceMs: 100 })
  .subscribe((results) => {
    // Called at most every 100ms
  });
```

### Event Reduce Optimization

Enable smart diffing to minimize re-queries:

```typescript
const subscription = todos
  .find()
  .live({ useEventReduce: true })
  .subscribe((results) => {
    // Uses incremental updates when possible
  });
```

## Observing Single Documents

Watch a specific document by ID:

```typescript
const subscription = todos.observeById('todo-123').subscribe((todo) => {
  if (todo) {
    console.log('Todo updated:', todo.title);
  } else {
    console.log('Todo was deleted');
  }
});
```

## Observing All Changes

Subscribe to the raw change stream:

```typescript
const subscription = todos.changes().subscribe((event) => {
  switch (event.operation) {
    case 'insert':
      console.log('New todo:', event.document);
      break;
    case 'update':
      console.log('Updated:', event.documentId);
      console.log('Previous:', event.previousDocument);
      console.log('Current:', event.document);
      break;
    case 'delete':
      console.log('Deleted:', event.documentId);
      break;
  }
});
```

### Change Event Structure

```typescript
interface ChangeEvent<T> {
  operation: 'insert' | 'update' | 'delete';
  documentId: string;
  document: T | null;
  previousDocument?: T;
  isFromSync: boolean;
  timestamp: number;
  sequence: number;
}
```

## RxJS Integration

Live queries return standard RxJS Observables, so you can use all RxJS operators:

```typescript
import { map, filter, distinctUntilChanged } from 'rxjs/operators';

const subscription = todos
  .find()
  .live()
  .pipe(
    map((todos) => todos.filter((t) => t.priority > 5)),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
  )
  .subscribe((highPriorityTodos) => {
    updateUI(highPriorityTodos);
  });
```

## Combining Queries

Combine multiple live queries:

```typescript
import { combineLatest } from 'rxjs';

const todos$ = todos.find({ completed: false }).live();
const users$ = users.find().live();

const subscription = combineLatest([todos$, users$]).subscribe(
  ([todos, users]) => {
    // Both queries updated
    renderDashboard(todos, users);
  }
);
```

## Error Handling

```typescript
const subscription = todos
  .find()
  .live()
  .subscribe({
    next: (results) => {
      updateUI(results);
    },
    error: (error) => {
      console.error('Query error:', error);
      showErrorMessage();
    },
  });
```

## Performance Considerations

### 1. Use Debouncing for Frequent Updates

```typescript
// Debounce rapid changes
.live({ debounceMs: 50 })
```

### 2. Limit Query Results

```typescript
// Don't watch thousands of documents
.limit(100)
.live()
```

### 3. Use Projection

```typescript
// Only select needed fields
.include('_id', 'title', 'completed')
.live()
```

### 4. Enable Event Reduce

```typescript
// Smart incremental updates
.live({ useEventReduce: true })
```

### 5. Unsubscribe Properly

```typescript
// In cleanup/unmount
subscription.unsubscribe();
```

## How It Works

1. **Initial Query**: Executes the query and emits results
2. **Change Detection**: Subscribes to collection's change stream
3. **Re-query**: When relevant changes occur, re-executes the query
4. **Event Reduce**: Optionally uses incremental updates instead of full re-query
5. **Emit**: Pushes new results to subscribers

## Next Steps

- [React Integration](./react.md) - React hooks for live queries
- [Queries](./queries.md) - Query builder reference
- [Collections](./collections.md) - Collection change streams
