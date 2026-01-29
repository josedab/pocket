---
sidebar_position: 10
title: Zod Schema Integration
description: Runtime validation with Zod schemas in Pocket
---

# Zod Schema Integration

The `@pocket/zod` package provides seamless integration between Zod schemas and Pocket, enabling runtime validation for all database operations.

## Installation

```bash
npm install @pocket/core @pocket/zod zod
```

## Quick Start

```typescript
import { Database, createIndexedDBStorage } from '@pocket/core';
import { zodSchema } from '@pocket/zod';
import { z } from 'zod';

// Define your schema with Zod
const todoSchema = z.object({
  _id: z.string().uuid(),
  title: z.string().min(1).max(200),
  completed: z.boolean().default(false),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  tags: z.array(z.string()).optional(),
  createdAt: z.date(),
  updatedAt: z.date().optional(),
});

// Infer TypeScript type from schema
type Todo = z.infer<typeof todoSchema>;

// Create database with schema validation
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});

// Create collection with Zod schema
const todos = db.collection<Todo>('todos', {
  schema: zodSchema(todoSchema),
});
```

## Schema Definition

### Basic Types

```typescript
import { z } from 'zod';

const userSchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().positive(),
  isActive: z.boolean(),
  role: z.enum(['admin', 'user', 'guest']),
  metadata: z.record(z.unknown()).optional(),
});
```

### Nested Objects

```typescript
const addressSchema = z.object({
  street: z.string(),
  city: z.string(),
  country: z.string(),
  zipCode: z.string().regex(/^\d{5}$/),
});

const customerSchema = z.object({
  _id: z.string(),
  name: z.string(),
  address: addressSchema,
  shippingAddresses: z.array(addressSchema),
});
```

### Optional and Nullable Fields

```typescript
const profileSchema = z.object({
  _id: z.string(),
  username: z.string(),
  bio: z.string().optional(),           // Field may be missing
  avatar: z.string().nullable(),        // Field can be null
  website: z.string().url().nullish(),  // Can be null, undefined, or string
});
```

### Dates and Timestamps

```typescript
const eventSchema = z.object({
  _id: z.string(),
  name: z.string(),
  // Date objects
  startDate: z.date(),
  // ISO string dates
  createdAt: z.string().datetime(),
  // Unix timestamps
  timestamp: z.number().int(),
});

// With preprocessing for date strings
const documentSchema = z.object({
  _id: z.string(),
  createdAt: z.preprocess(
    (val) => (typeof val === 'string' ? new Date(val) : val),
    z.date()
  ),
});
```

## Validation Modes

### Strict Mode (Default)

Rejects documents with extra fields:

```typescript
const todos = db.collection('todos', {
  schema: zodSchema(todoSchema, { mode: 'strict' }),
});

// This will throw - 'extra' field not in schema
await todos.insert({
  _id: '1',
  title: 'Test',
  completed: false,
  createdAt: new Date(),
  extra: 'field', // Error!
});
```

### Passthrough Mode

Allows extra fields:

```typescript
const todos = db.collection('todos', {
  schema: zodSchema(todoSchema, { mode: 'passthrough' }),
});

// This works - extra fields are preserved
await todos.insert({
  _id: '1',
  title: 'Test',
  completed: false,
  createdAt: new Date(),
  customField: 'allowed',
});
```

### Strip Mode

Removes extra fields silently:

```typescript
const todos = db.collection('todos', {
  schema: zodSchema(todoSchema, { mode: 'strip' }),
});

// Extra fields are removed, no error
const doc = await todos.insert({
  _id: '1',
  title: 'Test',
  completed: false,
  createdAt: new Date(),
  extra: 'will be removed',
});
// doc.extra is undefined
```

## Validation on Operations

### Insert Validation

```typescript
// Valid insert
await todos.insert({
  _id: crypto.randomUUID(),
  title: 'Learn Pocket',
  completed: false,
  priority: 'high',
  createdAt: new Date(),
});

// Invalid insert - throws ZodError
try {
  await todos.insert({
    _id: crypto.randomUUID(),
    title: '', // Error: min length 1
    completed: 'yes', // Error: expected boolean
    priority: 'urgent', // Error: not in enum
    createdAt: new Date(),
  });
} catch (error) {
  if (error instanceof z.ZodError) {
    console.log(error.issues);
    // [
    //   { path: ['title'], message: 'String must contain at least 1 character(s)' },
    //   { path: ['completed'], message: 'Expected boolean, received string' },
    //   { path: ['priority'], message: 'Invalid enum value...' },
    // ]
  }
}
```

### Update Validation

Updates are validated as partial schemas:

```typescript
// Valid update
await todos.update('todo-1', {
  title: 'Updated title',
  completed: true,
});

// Invalid update - throws ZodError
await todos.update('todo-1', {
  priority: 'invalid', // Error: not in enum
});
```

### Partial Schema for Updates

```typescript
const todos = db.collection('todos', {
  schema: zodSchema(todoSchema),
  // Optional: custom update schema
  updateSchema: zodSchema(todoSchema.partial()),
});
```

## Default Values

```typescript
const todoSchema = z.object({
  _id: z.string().uuid(),
  title: z.string(),
  completed: z.boolean().default(false),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  tags: z.array(z.string()).default([]),
  createdAt: z.date().default(() => new Date()),
});

// Defaults are applied automatically
const todo = await todos.insert({
  _id: crypto.randomUUID(),
  title: 'Test',
});
// todo.completed === false
// todo.priority === 'medium'
// todo.tags === []
// todo.createdAt === <current date>
```

## Transformations

### Coercion

```typescript
const schema = z.object({
  _id: z.string(),
  // Coerce string to number
  count: z.coerce.number(),
  // Coerce string to date
  date: z.coerce.date(),
  // Coerce to boolean
  active: z.coerce.boolean(),
});
```

### Custom Transforms

```typescript
const userSchema = z.object({
  _id: z.string(),
  email: z.string().email().transform((e) => e.toLowerCase()),
  name: z.string().transform((n) => n.trim()),
});

const user = await users.insert({
  _id: '1',
  email: 'USER@Example.COM',
  name: '  John Doe  ',
});
// user.email === 'user@example.com'
// user.name === 'John Doe'
```

## Refinements

### Custom Validation Rules

```typescript
const orderSchema = z.object({
  _id: z.string(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive(),
    price: z.number().positive(),
  })),
  total: z.number(),
}).refine(
  (order) => {
    const calculatedTotal = order.items.reduce(
      (sum, item) => sum + item.quantity * item.price,
      0
    );
    return Math.abs(order.total - calculatedTotal) < 0.01;
  },
  { message: 'Total does not match sum of items' }
);
```

### Async Refinements

```typescript
const usernameSchema = z.string().refine(
  async (username) => {
    const existing = await users.find()
      .where('username').equals(username)
      .exec();
    return existing.length === 0;
  },
  { message: 'Username already taken' }
);
```

## Error Handling

### Formatted Errors

```typescript
import { zodSchema, formatZodError } from '@pocket/zod';

try {
  await todos.insert(invalidData);
} catch (error) {
  if (error instanceof z.ZodError) {
    const formatted = formatZodError(error);
    console.log(formatted);
    // {
    //   title: 'String must contain at least 1 character(s)',
    //   'items.0.price': 'Number must be positive',
    // }
  }
}
```

### Custom Error Messages

```typescript
const todoSchema = z.object({
  _id: z.string({ required_error: 'ID is required' }),
  title: z.string({
    required_error: 'Title is required',
    invalid_type_error: 'Title must be a string',
  }).min(1, 'Title cannot be empty'),
  priority: z.enum(['low', 'medium', 'high'], {
    errorMap: () => ({ message: 'Priority must be low, medium, or high' }),
  }),
});
```

## React Integration

### Form Validation

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@pocket/react';
import { z } from 'zod';

const todoSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  priority: z.enum(['low', 'medium', 'high']),
});

type TodoForm = z.infer<typeof todoSchema>;

function AddTodoForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<TodoForm>({
    resolver: zodResolver(todoSchema),
  });

  const { mutate: addTodo } = useMutation(async (db, data: TodoForm) => {
    return db.collection('todos').insert({
      _id: crypto.randomUUID(),
      ...data,
      completed: false,
      createdAt: new Date(),
    });
  });

  return (
    <form onSubmit={handleSubmit((data) => addTodo(data))}>
      <input {...register('title')} />
      {errors.title && <span>{errors.title.message}</span>}

      <select {...register('priority')}>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>

      <button type="submit">Add</button>
    </form>
  );
}
```

## Schema Evolution

### Adding New Fields

```typescript
// Version 1
const todoSchemaV1 = z.object({
  _id: z.string(),
  title: z.string(),
  completed: z.boolean(),
});

// Version 2 - adding optional field (backwards compatible)
const todoSchemaV2 = z.object({
  _id: z.string(),
  title: z.string(),
  completed: z.boolean(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});
```

### With Migrations

```typescript
const migrations = [
  {
    version: 2,
    up: async (db: Database) => {
      const todos = await db.collection('todos').find().exec();
      for (const todo of todos) {
        await db.collection('todos').update(todo._id, {
          priority: 'medium', // Set default for existing docs
        });
      }
    },
  },
];
```

## TypeScript Integration

### Extracting Types

```typescript
// Define schema
const todoSchema = z.object({
  _id: z.string(),
  title: z.string(),
  completed: z.boolean(),
});

// Extract type
type Todo = z.infer<typeof todoSchema>;

// Use in collection
const todos = db.collection<Todo>('todos', {
  schema: zodSchema(todoSchema),
});
```

### Input vs Output Types

```typescript
const userSchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.string().email().transform((e) => e.toLowerCase()),
});

// Input type (before transforms)
type UserInput = z.input<typeof userSchema>;

// Output type (after transforms)
type User = z.output<typeof userSchema>;
// or: type User = z.infer<typeof userSchema>;
```

## Performance Considerations

### Parse vs SafeParse

```typescript
// For production, consider caching parsed schemas
const parsedSchema = todoSchema.safeParse;

// Use safeParse for non-throwing validation
const result = todoSchema.safeParse(data);
if (result.success) {
  await todos.insert(result.data);
} else {
  handleErrors(result.error);
}
```

### Lazy Validation

```typescript
// For recursive schemas
const categorySchema: z.ZodType<Category> = z.lazy(() =>
  z.object({
    _id: z.string(),
    name: z.string(),
    parent: categorySchema.optional(),
  })
);
```

## Next Steps

- [Schema Validation Guide](/docs/guides/schema-validation) - Built-in validation
- [Migrations Guide](/docs/guides/migrations) - Database migrations
- [React Integration](/docs/guides/react-integration) - Using with React hooks
