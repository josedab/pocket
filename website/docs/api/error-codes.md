---
sidebar_position: 7
title: Error Codes
description: Complete reference of Pocket error codes
---

# Error Codes

Pocket uses structured error codes to help you quickly identify and resolve issues. Each error code follows the pattern `POCKET_[CATEGORY][NUMBER]`.

## Error Categories

| Prefix | Category | Code Range | Description |
|--------|----------|------------|-------------|
| `V` | Validation | V100-V199 | Schema and data validation errors |
| `Q` | Query | Q200-Q299 | Query execution errors |
| `S` | Storage | S300-S399 | Storage adapter and persistence errors |
| `D` | Document | D400-D499 | Document operation errors |
| `C` | Connection | C500-C599 | Sync and network errors |
| `I` | Index | I600-I699 | Index operation errors |
| `M` | Migration | M700-M799 | Migration errors |
| `P` | Plugin | P800-P899 | Plugin errors |
| `X` | Internal | X900-X999 | Internal/unexpected errors |

## Using PocketError

```typescript
import { PocketError } from '@pocket/core';

try {
  await collection.insert(data);
} catch (error) {
  if (PocketError.isPocketError(error)) {
    console.log('Code:', error.code);           // POCKET_V100
    console.log('Message:', error.message);     // Validation failed
    console.log('Suggestion:', error.suggestion);
    console.log('Category:', error.category);   // validation
    console.log('Context:', error.context);     // { field: 'email', ... }
  }
}
```

### Check Specific Codes

```typescript
if (PocketError.isCode(error, 'POCKET_D401')) {
  console.log('Document not found');
}
```

### Check Categories

```typescript
if (PocketError.isCategory(error, 'validation')) {
  console.log('Validation error:', error.format());
}
```

---

## Validation Errors (V100-V199)

### POCKET_V100

**Validation failed**

General validation error when a document doesn't match the schema.

```typescript
// Example
try {
  await users.insert({ email: 'invalid' });
} catch (error) {
  // POCKET_V100: Validation failed
  // Context: { errors: [...] }
}
```

**Resolution:** Check the validation errors in the error context for specific field issues.

---

### POCKET_V101

**Required field is missing**

A required field was not provided in the document.

```typescript
// Schema requires 'email'
await users.insert({ name: 'Alice' });
// POCKET_V101: Required field is missing
// Context: { field: 'email' }
```

**Resolution:** Ensure all required fields are provided.

---

### POCKET_V102

**Invalid field type**

A field value doesn't match the expected type.

```typescript
// Schema: age: { type: 'number' }
await users.insert({ age: 'twenty-five' });
// POCKET_V102: Invalid field type
// Context: { field: 'age', expected: 'number', actual: 'string' }
```

**Resolution:** Ensure field values match their schema types.

---

### POCKET_V103

**Value out of range**

A numeric value is outside the allowed range.

```typescript
// Schema: age: { type: 'number', minimum: 0, maximum: 150 }
await users.insert({ age: 200 });
// POCKET_V103: Value out of range
// Context: { field: 'age', value: 200, max: 150 }
```

**Resolution:** Ensure values are within min/max constraints.

---

### POCKET_V104

**Pattern validation failed**

A string doesn't match the required regex pattern.

```typescript
// Schema: code: { type: 'string', pattern: '^[A-Z]{3}$' }
await items.insert({ code: 'ab1' });
// POCKET_V104: Pattern validation failed
// Context: { field: 'code', pattern: '^[A-Z]{3}$' }
```

**Resolution:** Ensure the string matches the pattern.

---

### POCKET_V105

**Invalid enum value**

A value is not one of the allowed enum options.

```typescript
// Schema: status: { type: 'string', enum: ['draft', 'published'] }
await posts.insert({ status: 'archived' });
// POCKET_V105: Invalid enum value
// Context: { field: 'status', value: 'archived', allowed: ['draft', 'published'] }
```

**Resolution:** Use one of the allowed enum values.

---

### POCKET_V106

**Unknown field not allowed**

An extra field was provided when `additionalProperties: false`.

```typescript
// Schema has additionalProperties: false
await users.insert({ email: 'a@b.com', unknownField: 'value' });
// POCKET_V106: Unknown field not allowed
// Context: { field: 'unknownField' }
```

**Resolution:** Remove unknown fields or update the schema.

---

## Query Errors (Q200-Q299)

### POCKET_Q200

**Query execution failed**

General query error.

**Resolution:** Check query syntax and ensure the collection exists.

---

### POCKET_Q201

**Invalid query operator**

An unsupported operator was used.

```typescript
await users.find({ age: { $invalid: 5 } });
// POCKET_Q201: Invalid query operator
// Context: { operator: '$invalid' }
```

**Resolution:** Use valid operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$contains`, `$regex`.

---

### POCKET_Q202

**Invalid query field**

Query references a non-existent field (when strict mode is enabled).

**Resolution:** Check field names match your schema.

---

### POCKET_Q203

**Query timeout exceeded**

The query took too long to execute.

**Resolution:** Add indexes to optimize the query or increase the timeout.

---

### POCKET_Q204

**Invalid cursor value**

A pagination cursor is malformed or expired.

**Resolution:** Request a fresh cursor from the query.

---

### POCKET_Q205

**Invalid pagination parameters**

Invalid `offset` or `limit` values.

**Resolution:** Ensure offset and limit are non-negative numbers.

---

## Storage Errors (S300-S399)

### POCKET_S300

**Storage operation failed**

General storage error.

**Resolution:** Check storage adapter configuration and available space.

---

### POCKET_S301

**Storage adapter not available**

The storage adapter isn't supported in the current environment.

```typescript
// Using OPFS in unsupported browser
// POCKET_S301: Storage adapter not available
// Suggestion: The storage adapter is not supported in this environment.
```

**Resolution:** Use a different storage adapter or check browser compatibility.

---

### POCKET_S302

**Storage quota exceeded**

Browser storage quota has been exceeded.

**Resolution:** Clear old data or request persistent storage permission.

```typescript
// Request persistent storage
if (navigator.storage?.persist) {
  await navigator.storage.persist();
}
```

---

### POCKET_S303

**Database initialization failed**

Failed to initialize the database.

**Resolution:** Check database configuration and ensure no other tabs have an incompatible version open.

---

### POCKET_S304

**Transaction aborted**

A transaction was aborted due to a conflict.

**Resolution:** Retry the operation.

---

## Document Errors (D400-D499)

### POCKET_D400

**Document operation failed**

General document error.

**Resolution:** Check the document data and try again.

---

### POCKET_D401

**Document not found**

No document exists with the specified ID.

```typescript
await users.get('non-existent-id');
// POCKET_D401: Document not found
// Context: { collection: 'users', documentId: 'non-existent-id' }
```

**Resolution:** Verify the document ID is correct.

---

### POCKET_D402

**Document has been deleted**

Attempted to access a soft-deleted document.

**Resolution:** The document was deleted. Create a new one or restore it if using soft delete.

---

### POCKET_D403

**Document ID already exists**

Attempted to insert a document with an existing ID.

```typescript
await users.insert({ _id: 'existing-id', ... });
// POCKET_D403: Document ID already exists
```

**Resolution:** Use `upsert()` or generate a unique ID.

---

### POCKET_D404

**Invalid document ID**

The document ID is empty or invalid.

**Resolution:** Document IDs must be non-empty strings.

---

## Connection Errors (C500-C599)

### POCKET_C500

**Sync operation failed**

General sync error.

**Resolution:** Check network connectivity and server status.

---

### POCKET_C501

**Connection failed**

Unable to connect to the sync server.

**Resolution:** Verify the server URL and network connectivity.

---

### POCKET_C502

**Authentication failed**

Sync authentication was rejected.

**Resolution:** Check authentication credentials.

---

### POCKET_C503

**Sync conflict detected**

A document was modified on multiple clients.

**Resolution:** Review the conflict using your conflict resolution strategy.

---

### POCKET_C504

**Connection timeout**

The connection timed out.

**Resolution:** Check network conditions and retry.

---

## Index Errors (I600-I699)

### POCKET_I600

**Index operation failed**

General index error.

**Resolution:** Check index configuration and field types.

---

### POCKET_I601

**Index not found**

The specified index doesn't exist.

**Resolution:** Create the index or check the index name.

---

### POCKET_I602

**Duplicate index name**

An index with the same name already exists.

**Resolution:** Use a different index name.

---

### POCKET_I603

**Unique constraint violation**

A document with the same indexed value already exists.

```typescript
// Index on 'email' with unique: true
await users.insert({ email: 'existing@example.com' });
// POCKET_I603: Unique constraint violation
// Context: { index: 'email_unique', value: 'existing@example.com' }
```

**Resolution:** Use a unique value or update the existing document.

---

## Migration Errors (M700-M799)

### POCKET_M700

**Migration failed**

A migration failed to execute.

**Resolution:** Check the migration file for errors.

---

### POCKET_M701

**Migration version mismatch**

The database version doesn't match the expected migration state.

**Resolution:** Run pending migrations or check migration history.

---

### POCKET_M702

**Migration not found**

No migration exists for the specified version.

**Resolution:** Create the missing migration file.

---

### POCKET_M703

**Downgrade not supported**

The migration doesn't support rollback.

**Resolution:** Implement the `down` function in the migration.

---

## Plugin Errors (P800-P899)

### POCKET_P800

**Plugin error**

General plugin error.

**Resolution:** Check plugin configuration and dependencies.

---

### POCKET_P801

**Plugin initialization failed**

A plugin failed to initialize.

**Resolution:** Check plugin options and logs.

---

### POCKET_P802

**Plugin hook error**

An error occurred in a plugin hook.

**Resolution:** Check the plugin implementation.

---

## Internal Errors (X900-X999)

### POCKET_X900

**Internal error**

An unexpected internal error occurred.

**Resolution:** This is likely a bug. Please report it.

---

### POCKET_X901

**Assertion failed**

An internal assertion failed.

**Resolution:** This is likely a bug. Please report it.

---

## Error Handling Patterns

### Centralized Error Handler

```typescript
import { PocketError } from '@pocket/core';

function handlePocketError(error: unknown): void {
  if (!PocketError.isPocketError(error)) {
    throw error; // Re-throw non-Pocket errors
  }

  switch (error.category) {
    case 'validation':
      showValidationErrors(error.context.errors);
      break;
    case 'document':
      if (error.code === 'POCKET_D401') {
        showNotFound();
      }
      break;
    case 'connection':
      showOfflineWarning();
      break;
    default:
      console.error(error.format());
  }
}
```

### React Error Boundary

```tsx
import { PocketError } from '@pocket/core';

function ErrorFallback({ error }: { error: Error }) {
  if (PocketError.isPocketError(error)) {
    return (
      <div>
        <h2>Error: {error.code}</h2>
        <p>{error.message}</p>
        {error.suggestion && <p>Tip: {error.suggestion}</p>}
      </div>
    );
  }

  return <div>An unexpected error occurred</div>;
}
```

---

## See Also

- [Troubleshooting](/docs/troubleshooting) - Common issues
- [FAQ](/docs/faq) - Frequently asked questions
