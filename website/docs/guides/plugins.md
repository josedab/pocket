---
sidebar_position: 7
title: Plugin System
description: Extend Pocket with plugins and middleware
---

# Plugin System

Pocket's plugin system lets you extend database functionality with custom logic that runs during document operations.

## Overview

Plugins intercept database operations (insert, update, delete, query, get) and can:

- Transform documents before they're saved
- Validate data with custom rules
- Add computed fields automatically
- Log changes for auditing
- Implement access control

## Creating a Plugin

A plugin is an object that defines hooks for different operations:

```typescript
import type { PluginDefinition } from '@pocket/core';

const myPlugin: PluginDefinition = {
  name: 'my-plugin',
  version: '1.0.0',
  priority: 10, // Higher = runs first

  // Called when plugin is registered
  onInit: async () => {
    console.log('Plugin initialized');
  },

  // Called when plugin is destroyed
  onDestroy: async () => {
    console.log('Plugin destroyed');
  },

  // Intercept insert operations
  beforeInsert: async (context) => {
    console.log('Inserting into', context.collection);
    // Modify the document
    return {
      document: {
        ...context.document,
        createdAt: Date.now(),
      },
    };
  },

  afterInsert: async (document, context) => {
    console.log('Inserted', document._id, 'into', context.collection);
  },
};
```

## Registering Plugins

### Global Plugins

Plugins registered globally run on all collections:

```typescript
import { Database, createIndexedDBStorage } from 'pocket';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  plugins: [myPlugin],
});
```

Or register after creation:

```typescript
db.plugins.register(myPlugin);
```

### Collection-Specific Plugins

Restrict a plugin to specific collections:

```typescript
db.plugins.registerForCollections(auditPlugin, ['users', 'orders']);
```

## Available Hooks

### Before Hooks

Before hooks run before the operation and can modify or cancel it.

| Hook | Context | Can Return |
|------|---------|------------|
| `beforeInsert` | `collection`, `document`, `timestamp` | Modified document, `skip`, or `error` |
| `beforeUpdate` | `collection`, `documentId`, `changes`, `existingDocument`, `timestamp` | Modified changes, `skip`, or `error` |
| `beforeDelete` | `collection`, `documentId`, `existingDocument`, `timestamp` | `skip` or `error` |
| `beforeQuery` | `collection`, `spec`, `timestamp` | Modified spec, cached `results`, `skip`, or `error` |
| `beforeGet` | `collection`, `documentId`, `timestamp` | Cached `document`, `skip`, or `error` |

### After Hooks

After hooks run after the operation completes successfully.

| Hook | Parameters |
|------|------------|
| `afterInsert` | `document`, `context` |
| `afterUpdate` | `document`, `context` |
| `afterDelete` | `context` |
| `afterQuery` | `results`, `context` - can transform results |
| `afterGet` | `document`, `context` - can transform document |

### Error Hook

Handle errors from any operation:

```typescript
onError: async (context) => {
  console.error(
    `Error in ${context.operation} on ${context.collection}:`,
    context.error
  );
  // Send to error tracking service
  errorTracker.capture(context.error);
};
```

## Hook Results

### Modifying Data

Return modified data to transform what gets saved:

```typescript
beforeInsert: async (context) => {
  return {
    document: {
      ...context.document,
      normalizedEmail: context.document.email?.toLowerCase(),
    },
  };
};
```

### Skipping Operations

Return `skip: true` to cancel the operation:

```typescript
beforeDelete: async (context) => {
  if (context.existingDocument?.protected) {
    return { skip: true };
  }
};
```

### Throwing Errors

Return an error to fail the operation:

```typescript
beforeInsert: async (context) => {
  if (!context.document.email) {
    return { error: new Error('Email is required') };
  }
};
```

## Plugin Priority

Plugins run in priority order (higher numbers first):

```typescript
const highPriorityPlugin = {
  name: 'validation',
  priority: 100, // Runs first
  beforeInsert: async (context) => {
    // Validate before other plugins modify data
  },
};

const lowPriorityPlugin = {
  name: 'audit',
  priority: -100, // Runs last
  afterInsert: async (document) => {
    // Log after all other plugins are done
  },
};
```

## Built-in Plugins

### Audit Log Plugin

Track all changes to documents:

```typescript
import { createAuditLogPlugin, InMemoryAuditLogStorage } from '@pocket/core/plugins';

const auditStorage = new InMemoryAuditLogStorage();

const auditPlugin = createAuditLogPlugin({
  storage: auditStorage,
  getUserId: () => currentUser?.id,
  collections: ['orders', 'payments'], // Optional: limit to specific collections
  includeValues: true, // Include before/after values
  getMetadata: () => ({
    userAgent: navigator.userAgent,
    sessionId: sessionStorage.getItem('sessionId'),
  }),
});

db.plugins.register(auditPlugin);

// Query audit logs
const logs = await auditStorage.query({
  collection: 'orders',
  operation: 'update',
  startTime: Date.now() - 86400000, // Last 24 hours
  limit: 100,
});
```

### Computed Fields Plugin

Automatically compute fields based on other fields:

```typescript
import {
  createComputedFieldsPlugin,
  ComputedFieldHelpers,
} from '@pocket/core/plugins';

interface Article {
  _id: string;
  title: string;
  content: string;
  slug?: string;
  wordCount?: number;
  updatedAt?: number;
}

const articlePlugin = createComputedFieldsPlugin<Article>({
  collection: 'articles',
  fields: [
    ComputedFieldHelpers.slug('title'),
    ComputedFieldHelpers.wordCount('content'),
    ComputedFieldHelpers.updatedAt(),
  ],
});

db.plugins.register(articlePlugin);

// Now when you insert an article:
await articles.insert({
  _id: crypto.randomUUID(),
  title: 'Hello World',
  content: 'This is my first article with some content.',
});

// The document will have:
// {
//   _id: '...',
//   title: 'Hello World',
//   content: 'This is my first article with some content.',
//   slug: 'hello-world',
//   wordCount: 8,
//   updatedAt: 1699999999999
// }
```

#### Custom Computed Fields

Create your own computed field logic:

```typescript
const customPlugin = createComputedFieldsPlugin({
  collection: 'products',
  fields: [
    {
      field: 'priceWithTax',
      dependencies: ['price', 'taxRate'],
      compute: (doc) => {
        const price = doc.price ?? 0;
        const taxRate = doc.taxRate ?? 0;
        return price * (1 + taxRate);
      },
    },
    {
      field: 'searchText',
      dependencies: ['name', 'description', 'tags'],
      compute: (doc) => {
        return [doc.name, doc.description, ...(doc.tags || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
      },
    },
  ],
});
```

## Middleware

Middleware provides a simpler way to wrap operations with cross-cutting concerns.

### Using Middleware

```typescript
import { createMiddlewareChain, createLoggingMiddleware } from '@pocket/core/plugins';

const middleware = createMiddlewareChain();

// Add logging middleware
middleware.use(createLoggingMiddleware((message, context) => {
  console.log(`[Pocket] ${message}`);
}));

// Add timing middleware
middleware.use(createTimingMiddleware((operation, collection, durationMs) => {
  console.log(`${operation} on ${collection} took ${durationMs}ms`);
}));
```

### Built-in Middleware

#### Logging Middleware

Log all operations:

```typescript
import { createLoggingMiddleware } from '@pocket/core/plugins';

const logging = createLoggingMiddleware((message, context) => {
  console.log(message);
});
```

#### Timing Middleware

Measure operation duration:

```typescript
import { createTimingMiddleware } from '@pocket/core/plugins';

const timing = createTimingMiddleware((operation, collection, durationMs) => {
  if (durationMs > 100) {
    console.warn(`Slow ${operation} on ${collection}: ${durationMs}ms`);
  }
});
```

#### Rate Limit Middleware

Limit operations per second:

```typescript
import { createRateLimitMiddleware } from '@pocket/core/plugins';

const rateLimit = createRateLimitMiddleware(100); // 100 ops/sec
```

#### Retry Middleware

Automatically retry failed operations:

```typescript
import { createRetryMiddleware } from '@pocket/core/plugins';

const retry = createRetryMiddleware(
  3,    // max retries
  100,  // initial delay ms
  (error) => error.message.includes('temporary') // retry condition
);
```

#### Validation Middleware

Validate operations before they run:

```typescript
import { createValidationMiddleware } from '@pocket/core/plugins';

const validation = createValidationMiddleware((context) => {
  if (context.operation === 'insert' && context.collection === 'users') {
    const doc = context.document as User;
    if (!doc.email?.includes('@')) {
      return 'Invalid email address';
    }
  }
  return true;
});
```

### Custom Middleware

Create middleware for specific needs:

```typescript
import type { MiddlewareDefinition } from '@pocket/core/plugins';

const authMiddleware: MiddlewareDefinition = {
  name: 'auth',
  operations: ['insert', 'update', 'delete'], // Only write operations
  collections: ['private-data'], // Only specific collections
  handler: async (context, next) => {
    if (!currentUser) {
      throw new Error('Authentication required');
    }
    return next();
  },
};

middleware.use(authMiddleware);
```

### Filtering Middleware

Limit middleware to specific operations or collections:

```typescript
const writeOnlyMiddleware: MiddlewareDefinition = {
  name: 'write-validator',
  operations: ['insert', 'update', 'delete'], // Skip reads
  handler: async (context, next) => {
    // Only runs for write operations
    return next();
  },
};

const ordersMiddleware: MiddlewareDefinition = {
  name: 'order-rules',
  collections: ['orders'], // Only orders collection
  handler: async (context, next) => {
    // Only runs for orders
    return next();
  },
};
```

## Examples

### Timestamps Plugin

Automatically add created and updated timestamps:

```typescript
const timestampsPlugin: PluginDefinition = {
  name: 'timestamps',
  priority: 50,

  beforeInsert: async (context) => {
    const now = Date.now();
    return {
      document: {
        ...context.document,
        createdAt: now,
        updatedAt: now,
      },
    };
  },

  beforeUpdate: async (context) => {
    return {
      changes: {
        ...context.changes,
        updatedAt: Date.now(),
      },
    };
  },
};
```

### Soft Delete Plugin

Implement soft deletes instead of hard deletes:

```typescript
const softDeletePlugin: PluginDefinition = {
  name: 'soft-delete',
  priority: 100,

  beforeDelete: async (context) => {
    // Skip the actual delete
    return { skip: true };
  },

  afterDelete: async (context) => {
    // Mark as deleted instead
    const collection = db.collection(context.collection);
    await collection.update(context.documentId, {
      deletedAt: Date.now(),
      deleted: true,
    });
  },

  beforeQuery: async (context) => {
    // Filter out deleted documents
    return {
      spec: {
        ...context.spec,
        filter: {
          ...context.spec.filter,
          deleted: { $ne: true },
        },
      },
    };
  },
};
```

### Cache Plugin

Cache query results:

```typescript
const cachePlugin: PluginDefinition = {
  name: 'cache',
  priority: 1000, // Run first

  beforeQuery: async (context) => {
    const cacheKey = JSON.stringify({ c: context.collection, s: context.spec });
    const cached = queryCache.get(cacheKey);

    if (cached && cached.expiry > Date.now()) {
      return { results: cached.results, skip: true };
    }
  },

  afterQuery: async (results, context) => {
    const cacheKey = JSON.stringify({ c: context.collection, s: context.spec });
    queryCache.set(cacheKey, {
      results,
      expiry: Date.now() + 60000, // 1 minute
    });
    return results;
  },

  // Invalidate cache on writes
  afterInsert: async (_, context) => {
    invalidateCacheForCollection(context.collection);
  },

  afterUpdate: async (_, context) => {
    invalidateCacheForCollection(context.collection);
  },

  afterDelete: async (context) => {
    invalidateCacheForCollection(context.collection);
  },
};
```

## Managing Plugins

### Check Plugin Status

```typescript
// List all plugins
const pluginNames = db.plugins.getPluginNames();
console.log('Registered plugins:', pluginNames);

// Check if plugin exists
if (db.plugins.hasPlugin('audit-log')) {
  console.log('Audit logging is enabled');
}

// Get plugin state
const state = db.plugins.getPluginState('my-plugin');
// 'pending' | 'initialized' | 'error' | 'destroyed'
```

### Unregister Plugins

```typescript
// Remove a plugin
await db.plugins.unregister('my-plugin');
```

## Best Practices

1. **Set appropriate priorities**: Use high priority (100+) for validation/transformation, low priority (-100) for logging/auditing.

2. **Keep hooks fast**: Slow hooks impact all operations. Move heavy work to after hooks or background jobs.

3. **Handle errors gracefully**: Wrap async code in try/catch to prevent unhandled rejections.

4. **Use typed plugins**: Define your document types for better TypeScript support:

   ```typescript
   const myPlugin: PluginDefinition<MyDocument> = {
     name: 'typed-plugin',
     beforeInsert: async (context) => {
       // context.document is typed as MyDocument
     },
   };
   ```

5. **Test plugins in isolation**: Create unit tests for plugin logic before integrating.

## See Also

- [Schema Validation](/docs/guides/schema-validation) - Built-in validation
- [API Reference](/docs/api/database) - Database API
- [Sync Setup](/docs/guides/sync-setup) - Syncing with plugins
