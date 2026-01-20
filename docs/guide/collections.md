# Collections

Collections are containers for documents of a similar type. They provide methods for CRUD operations, querying, and observing changes.

## Getting a Collection

```typescript
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

const todos = db.collection<Todo>('todos');
```

## CRUD Operations

### Insert

Insert a single document:

```typescript
const todo = await todos.insert({
  _id: crypto.randomUUID(),
  title: 'Learn Pocket',
  completed: false,
  createdAt: new Date(),
});
```

Insert multiple documents:

```typescript
const newTodos = await todos.insertMany([
  { _id: '1', title: 'Task 1', completed: false, createdAt: new Date() },
  { _id: '2', title: 'Task 2', completed: false, createdAt: new Date() },
]);
```

### Read

Get by ID:

```typescript
const todo = await todos.get('todo-1');
// Returns null if not found
```

Get multiple by IDs:

```typescript
const results = await todos.getMany(['id-1', 'id-2', 'id-3']);
// Returns array with null for missing documents
```

Get all documents:

```typescript
const allTodos = await todos.getAll();
```

### Update

Update a document by ID:

```typescript
const updated = await todos.update('todo-1', {
  completed: true,
});
```

### Upsert

Insert or update (upsert):

```typescript
const todo = await todos.upsert('todo-1', {
  title: 'Updated title',
  completed: true,
  createdAt: new Date(),
});
```

### Delete

Soft delete (for sync-enabled collections):

```typescript
await todos.delete('todo-1');
```

Hard delete (permanently removes):

```typescript
await todos.hardDelete('todo-1');
```

Delete multiple:

```typescript
await todos.deleteMany(['id-1', 'id-2', 'id-3']);
```

## Querying

### Find with Filter

```typescript
// Using object filter
const incomplete = await todos.find({ completed: false }).exec();

// Using query builder
const urgent = await todos
  .find()
  .where('priority').greaterThan(5)
  .where('completed').equals(false)
  .sort('createdAt', 'desc')
  .limit(10)
  .exec();
```

### Find One

```typescript
const todo = await todos.findOne({ completed: false });
```

### Count

```typescript
const total = await todos.count();
const incomplete = await todos.count({ completed: false });
```

## Observing Changes

### Observe All Changes

```typescript
const subscription = todos.changes().subscribe((event) => {
  console.log(event.operation); // 'insert' | 'update' | 'delete'
  console.log(event.documentId);
  console.log(event.document);
  console.log(event.previousDocument);
});

// Clean up
subscription.unsubscribe();
```

### Observe a Single Document

```typescript
const subscription = todos.observeById('todo-1').subscribe((todo) => {
  console.log('Todo changed:', todo);
});
```

## Indexes

### Create an Index

```typescript
await todos.createIndex({
  name: 'completed_priority',
  fields: ['completed', 'priority'],
});
```

### Drop an Index

```typescript
await todos.dropIndex('completed_priority');
```

### List Indexes

```typescript
const indexes = await todos.getIndexes();
```

## Schema Validation

When a collection has a schema, documents are validated on insert/update:

```typescript
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  collections: [{
    name: 'todos',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1 },
        completed: { type: 'boolean' },
      },
      required: ['title'],
    },
  }],
});

try {
  await todos.insert({ title: '' }); // Throws ValidationError
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.validation.errors);
  }
}
```

## Clear Collection

Remove all documents:

```typescript
await todos.clear();
```

## Next Steps

- [Documents](./documents.md) - Document structure and metadata
- [Queries](./queries.md) - Advanced querying
- [Live Queries](./live-queries.md) - Reactive queries
