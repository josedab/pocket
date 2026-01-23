---
sidebar_position: 2
title: Collection API
description: Collection class API reference
---

# Collection API

The `Collection` class provides methods for working with documents. Get a collection from the database:

```typescript
const todos = db.collection<Todo>('todos');
```

## CRUD Operations

### insert()

Inserts a new document.

```typescript
insert(doc: NewDocument<T>): Promise<T>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `doc` | `NewDocument<T>` | Document to insert (must include `_id`) |

#### Returns

`Promise<T>` - The inserted document with any defaults applied.

#### Example

```typescript
const todo = await todos.insert({
  _id: crypto.randomUUID(),
  title: 'Learn Pocket',
  completed: false,
});

console.log(todo._id); // The generated ID
```

---

### insertMany()

Inserts multiple documents.

```typescript
insertMany(docs: NewDocument<T>[]): Promise<T[]>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `docs` | `NewDocument<T>[]` | Array of documents to insert |

#### Returns

`Promise<T[]>` - Array of inserted documents.

#### Example

```typescript
const todos = await collection.insertMany([
  { _id: '1', title: 'Task 1', completed: false },
  { _id: '2', title: 'Task 2', completed: false },
  { _id: '3', title: 'Task 3', completed: false },
]);
```

---

### get()

Gets a document by ID.

```typescript
get(id: string): Promise<T | null>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Document ID |

#### Returns

`Promise<T | null>` - The document, or `null` if not found.

#### Example

```typescript
const todo = await todos.get('todo-123');

if (todo) {
  console.log(todo.title);
} else {
  console.log('Not found');
}
```

---

### getMany()

Gets multiple documents by ID.

```typescript
getMany(ids: string[]): Promise<(T | null)[]>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ids` | `string[]` | Array of document IDs |

#### Returns

`Promise<(T | null)[]>` - Array of documents (null for not found).

#### Example

```typescript
const results = await todos.getMany(['id-1', 'id-2', 'id-3']);
// [Todo, null, Todo] - id-2 wasn't found
```

---

### getAll()

Gets all documents in the collection.

```typescript
getAll(): Promise<T[]>
```

#### Returns

`Promise<T[]>` - All documents.

#### Example

```typescript
const allTodos = await todos.getAll();
console.log(`Total: ${allTodos.length} todos`);
```

---

### update()

Updates a document by ID.

```typescript
update(id: string, changes: DocumentUpdate<T>): Promise<T>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Document ID |
| `changes` | `DocumentUpdate<T>` | Fields to update |

#### Returns

`Promise<T>` - The updated document.

#### Throws

- `Error` if document not found
- `ValidationError` if schema validation fails

#### Example

```typescript
const updated = await todos.update('todo-123', {
  completed: true,
  completedAt: Date.now(),
});
```

---

### upsert()

Inserts or updates a document.

```typescript
upsert(id: string, doc: NewDocument<T> | DocumentUpdate<T>): Promise<T>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Document ID |
| `doc` | `NewDocument<T> \| DocumentUpdate<T>` | Document data |

#### Returns

`Promise<T>` - The inserted or updated document.

#### Example

```typescript
// Creates if doesn't exist, updates if it does
const todo = await todos.upsert('todo-123', {
  title: 'Learn Pocket',
  completed: false,
});
```

---

### delete()

Deletes a document by ID (soft delete if sync is enabled).

```typescript
delete(id: string): Promise<void>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Document ID |

#### Example

```typescript
await todos.delete('todo-123');
```

:::note
With sync enabled, documents are soft-deleted (marked with `_deleted: true`) to propagate deletions to other clients.
:::

---

### deleteMany()

Deletes multiple documents.

```typescript
deleteMany(ids: string[]): Promise<void>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ids` | `string[]` | Array of document IDs |

#### Example

```typescript
await todos.deleteMany(['id-1', 'id-2', 'id-3']);
```

---

### hardDelete()

Permanently removes a document (bypasses soft delete).

```typescript
hardDelete(id: string): Promise<void>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Document ID |

:::warning
Hard-deleted documents won't propagate to synced clients. Use regular `delete()` for synced collections.
:::

---

### clear()

Removes all documents from the collection.

```typescript
clear(): Promise<void>
```

#### Example

```typescript
await todos.clear();
```

---

## Querying

### find()

Creates a query builder.

```typescript
find(filter?: Partial<T>): QueryBuilder<T>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `filter` | `Partial<T>` | Optional simple filter |

#### Returns

`QueryBuilder<T>` - Query builder for chaining.

#### Example

```typescript
// All documents
const all = await todos.find().exec();

// With filter
const incomplete = await todos.find({ completed: false }).exec();

// Using query builder
const recent = await todos
  .find()
  .where('completed').equals(false)
  .sort('createdAt', 'desc')
  .limit(10)
  .exec();
```

---

### findOne()

Finds a single document matching the filter.

```typescript
findOne(filter?: Partial<T>): Promise<T | null>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `filter` | `Partial<T>` | Optional filter |

#### Returns

`Promise<T | null>` - First matching document, or `null`.

#### Example

```typescript
const firstIncomplete = await todos.findOne({ completed: false });
```

---

### count()

Counts documents matching an optional filter.

```typescript
count(filter?: Partial<T>): Promise<number>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `filter` | `Partial<T>` | Optional filter |

#### Returns

`Promise<number>` - Document count.

#### Example

```typescript
const total = await todos.count();
const incomplete = await todos.count({ completed: false });
```

---

## Observables

### observeById()

Observes a single document by ID.

```typescript
observeById(id: string): Observable<T | null>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Document ID |

#### Returns

`Observable<T | null>` - Emits document or null on changes.

#### Example

```typescript
const subscription = todos.observeById('todo-123').subscribe((todo) => {
  if (todo) {
    console.log('Todo updated:', todo.title);
  } else {
    console.log('Todo deleted');
  }
});

// Clean up
subscription.unsubscribe();
```

---

### changes()

Observes all changes to the collection.

```typescript
changes(): Observable<ChangeEvent<T>>
```

#### Returns

`Observable<ChangeEvent<T>>` - Stream of change events.

#### Example

```typescript
todos.changes().subscribe((event) => {
  console.log('Operation:', event.operation);
  console.log('Document ID:', event.documentId);
  console.log('Document:', event.document);
});
```

---

## Indexes

### createIndex()

Creates an index on the collection.

```typescript
createIndex(index: IndexDefinition): Promise<void>
```

#### Parameters

```typescript
interface IndexDefinition {
  name?: string;
  fields: string[];
  unique?: boolean;
}
```

#### Example

```typescript
await todos.createIndex({ fields: ['completed'] });
await todos.createIndex({ fields: ['userId', 'createdAt'] });
await users.createIndex({ fields: ['email'], unique: true });
```

---

### dropIndex()

Removes an index.

```typescript
dropIndex(name: string): Promise<void>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Index name |

#### Example

```typescript
await todos.dropIndex('completed');
```

---

### getIndexes()

Lists all indexes on the collection.

```typescript
getIndexes(): Promise<NormalizedIndex[]>
```

#### Returns

```typescript
interface NormalizedIndex {
  name: string;
  fields: string[];
  unique: boolean;
}
```

#### Example

```typescript
const indexes = await todos.getIndexes();
console.log(indexes);
// [{ name: '_id', fields: ['_id'], unique: true }, ...]
```

---

## Types

### Document

Base document type:

```typescript
interface Document {
  _id: string;
  _rev?: string;
  _deleted?: boolean;
  _updatedAt?: number;
}
```

### NewDocument

Document without system fields:

```typescript
type NewDocument<T> = Omit<T, '_rev' | '_deleted' | '_updatedAt'> & {
  _id: string;
};
```

### DocumentUpdate

Partial document for updates:

```typescript
type DocumentUpdate<T> = Partial<Omit<T, '_id'>>;
```

### ChangeEvent

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

---

## See Also

- [Query Builder API](/docs/api/query-builder) - Query builder reference
- [Database Model](/docs/concepts/database-model) - Understanding documents
- [Indexing Guide](/docs/guides/indexing) - Creating effective indexes
