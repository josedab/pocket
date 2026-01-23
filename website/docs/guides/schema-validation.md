---
sidebar_position: 5
title: Schema Validation
description: Define schemas to validate and transform documents
---

# Schema Validation

Pocket supports runtime schema validation to ensure data integrity. Schemas define the structure of your documents and catch invalid data before it's stored.

## Why Use Schemas

- **Catch bugs early** - Invalid data fails fast with clear errors
- **Self-documenting** - Schemas describe your data model
- **Default values** - Auto-fill missing fields
- **Type safety** - Complements TypeScript types

## Defining Schemas

### Basic Schema

```typescript
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  collections: [
    {
      name: 'todos',
      schema: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1 },
          completed: { type: 'boolean', default: false },
          priority: { type: 'number', minimum: 1, maximum: 5 },
        },
      },
    },
  ],
});
```

### Schema Properties

| Property | Description |
|----------|-------------|
| `type` | Data type: `'string'`, `'number'`, `'boolean'`, `'object'`, `'array'` |
| `required` | Array of required field names |
| `properties` | Schema for each field (objects) |
| `items` | Schema for array elements |
| `default` | Default value if missing |
| `minimum` / `maximum` | Number range |
| `minLength` / `maxLength` | String length |
| `pattern` | Regex pattern for strings |
| `enum` | Allowed values |

## Type Validation

### Strings

```typescript
{
  name: 'users',
  schema: {
    type: 'object',
    properties: {
      // Basic string
      name: { type: 'string' },

      // With length constraints
      username: {
        type: 'string',
        minLength: 3,
        maxLength: 20,
      },

      // Pattern matching
      email: {
        type: 'string',
        pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
      },

      // Enum values
      status: {
        type: 'string',
        enum: ['active', 'inactive', 'pending'],
      },
    },
  },
}
```

### Numbers

```typescript
{
  name: 'products',
  schema: {
    type: 'object',
    properties: {
      // Basic number
      price: { type: 'number' },

      // With range
      rating: {
        type: 'number',
        minimum: 0,
        maximum: 5,
      },

      // Integer only
      quantity: {
        type: 'integer',
        minimum: 0,
      },
    },
  },
}
```

### Booleans

```typescript
{
  name: 'settings',
  schema: {
    type: 'object',
    properties: {
      darkMode: { type: 'boolean', default: false },
      notifications: { type: 'boolean', default: true },
    },
  },
}
```

### Arrays

```typescript
{
  name: 'posts',
  schema: {
    type: 'object',
    properties: {
      // Array of strings
      tags: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
      },

      // Array of objects
      comments: {
        type: 'array',
        items: {
          type: 'object',
          required: ['author', 'text'],
          properties: {
            author: { type: 'string' },
            text: { type: 'string' },
            createdAt: { type: 'number' },
          },
        },
      },
    },
  },
}
```

### Nested Objects

```typescript
{
  name: 'users',
  schema: {
    type: 'object',
    required: ['name', 'email'],
    properties: {
      name: { type: 'string' },
      email: { type: 'string' },
      address: {
        type: 'object',
        properties: {
          street: { type: 'string' },
          city: { type: 'string' },
          zip: { type: 'string', pattern: '^\\d{5}$' },
          country: {
            type: 'string',
            enum: ['US', 'CA', 'UK'],
            default: 'US',
          },
        },
      },
    },
  },
}
```

## Default Values

Defaults are applied when a field is missing:

```typescript
{
  name: 'todos',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      completed: { type: 'boolean', default: false },
      priority: { type: 'number', default: 3 },
      tags: { type: 'array', default: [] },
      createdAt: { type: 'number' },  // No default
    },
  },
}

// Insert without all fields
await todos.insert({
  _id: '1',
  title: 'Learn Pocket',
});

// Stored with defaults applied
{
  _id: '1',
  title: 'Learn Pocket',
  completed: false,    // default
  priority: 3,         // default
  tags: [],            // default
  // createdAt is NOT set (no default)
}
```

### Dynamic Defaults

For dynamic values like timestamps, set them in your code:

```typescript
await todos.insert({
  _id: crypto.randomUUID(),
  title: 'Learn Pocket',
  createdAt: Date.now(),  // Set dynamically
});
```

## Validation Errors

When validation fails, a `ValidationError` is thrown:

```typescript
import { ValidationError } from 'pocket';

try {
  await todos.insert({
    _id: '1',
    title: '',  // Invalid: minLength is 1
    priority: 10,  // Invalid: maximum is 5
  });
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('Validation failed:');
    for (const err of error.validation.errors) {
      console.log(`- ${err.path}: ${err.message}`);
    }
    // Output:
    // - title: String is too short (minimum 1)
    // - priority: Number is too large (maximum 5)
  }
}
```

### Error Structure

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

interface ValidationError {
  path: string;     // Field path, e.g., "address.zip"
  message: string;  // Human-readable message
  keyword: string;  // Validation rule that failed
  params: object;   // Parameters of the rule
}
```

## TypeScript Integration

Combine schemas with TypeScript for maximum safety:

```typescript
// Define your type
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  priority: 1 | 2 | 3 | 4 | 5;
  tags: string[];
}

// Define matching schema
const todoSchema = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string', minLength: 1 },
    completed: { type: 'boolean', default: false },
    priority: { type: 'number', minimum: 1, maximum: 5, default: 3 },
    tags: { type: 'array', items: { type: 'string' }, default: [] },
  },
} as const;

// Use both
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  collections: [
    { name: 'todos', schema: todoSchema },
  ],
});

const todos = db.collection<Todo>('todos');

// TypeScript catches type errors at compile time
// Schema catches data errors at runtime
```

## Validation on Update

Updates are also validated:

```typescript
// This validates the updated document
await todos.update('1', {
  priority: 10,  // Throws ValidationError
});
```

The entire document (after merge) is validated, not just the changed fields.

## Conditional Validation

For complex validation, use code:

```typescript
async function insertTodo(data: Partial<Todo>) {
  // Custom validation
  if (data.dueDate && data.dueDate < Date.now()) {
    throw new Error('Due date cannot be in the past');
  }

  if (data.priority === 1 && !data.assignee) {
    throw new Error('High priority todos must have an assignee');
  }

  return todos.insert({
    _id: crypto.randomUUID(),
    ...data,
  });
}
```

## Schema Evolution

When your schema changes:

### Adding Fields

Add new fields with defaults for backward compatibility:

```typescript
// v1
{ title: { type: 'string' } }

// v2 - Add new field with default
{
  title: { type: 'string' },
  category: { type: 'string', default: 'general' },  // New field
}
```

### Removing Fields

Remove fields gradually:

1. Make the field optional (remove from `required`)
2. Stop writing to the field
3. Migrate existing data
4. Remove from schema

### Changing Types

Migrate data before changing types:

```typescript
// Migrate string priority to number
const todos = await db.collection('todos').getAll();
for (const todo of todos) {
  if (typeof todo.priority === 'string') {
    await db.collection('todos').update(todo._id, {
      priority: parseInt(todo.priority, 10),
    });
  }
}
```

## Performance Notes

- Validation runs on every insert/update
- Complex schemas (deep nesting, many regex) add overhead
- For bulk operations, consider batch validation

```typescript
// Validate in bulk before inserting
function validateBatch(items: Todo[]) {
  const errors: { index: number; errors: ValidationError[] }[] = [];

  for (let i = 0; i < items.length; i++) {
    const result = schema.validate(items[i]);
    if (!result.valid) {
      errors.push({ index: i, errors: result.errors });
    }
  }

  if (errors.length > 0) {
    throw new BatchValidationError(errors);
  }
}
```

## Next Steps

- [Database Model](/docs/concepts/database-model) - Understanding documents and collections
- [Collection API](/docs/api/collection) - Complete collection reference
- [Indexing](/docs/guides/indexing) - Optimize query performance
