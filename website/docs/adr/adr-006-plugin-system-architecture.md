# ADR-006: Plugin System Architecture

## Status

Accepted

## Context

Pocket needs to support various cross-cutting concerns without bloating the core:
- Automatic timestamps on create/update
- Soft delete functionality
- Audit logging
- Computed/derived fields
- Custom validation beyond schemas
- Analytics and telemetry

These features:
- Are needed by many but not all applications
- Should not increase bundle size for users who don't need them
- Need to integrate deeply with document lifecycle
- Should be composable (multiple plugins together)

The challenge is providing extensibility without sacrificing performance or creating tight coupling between features.

## Decision

Implement a hook-based plugin system with middleware chain execution pattern.

### Plugin Interface

```typescript
interface Plugin {
  name: string;
  version?: string;
  priority?: number;  // Lower executes first, default 100

  install(context: PluginContext): void | Promise<void>;
  uninstall?(context: PluginContext): void | Promise<void>;
}

interface PluginContext {
  database: Database;
  hooks: PluginHooks;
  options: Record<string, unknown>;
}
```

### Available Hooks

| Hook | Timing | Can Modify | Can Abort |
|------|--------|------------|-----------|
| `beforeInsert` | Before document insert | Document | Yes |
| `afterInsert` | After document insert | No | No |
| `beforeUpdate` | Before document update | Changes | Yes |
| `afterUpdate` | After document update | No | No |
| `beforeDelete` | Before document delete | No | Yes |
| `afterDelete` | After document delete | No | No |
| `beforeQuery` | Before query execution | Query | Yes |
| `afterQuery` | After query execution | Results | No |
| `beforeGet` | Before get by ID | No | Yes |
| `afterGet` | After get by ID | Document | No |
| `onError` | On any error | Error | No |
| `onInit` | Database initialization | No | No |
| `onDestroy` | Database shutdown | No | No |

### Execution Order

```
beforeInsert (priority order) → Core Operation → afterInsert (priority order)
         ↓
    [Hook can abort with error]
```

### Registration

```typescript
const db = await Database.create({
  name: 'my-app',
  storage,
  plugins: [
    timestampsPlugin(),        // priority: 10
    validationPlugin(schema),   // priority: 50
    auditLogPlugin(options),    // priority: 100
  ]
});
```

### Built-in Plugins

1. **timestampsPlugin**: Adds `_createdAt` and `_updatedAt` fields
2. **softDeletePlugin**: Implements soft delete with `_deleted` flag
3. **auditLogPlugin**: Logs all changes to separate collection
4. **computedFieldsPlugin**: Derives fields from other fields

## Consequences

### Positive

- **Extensibility**: Users can add custom behavior without forking
- **Separation of concerns**: Each plugin handles one responsibility
- **Composability**: Multiple plugins work together via priority ordering
- **Tree-shakable**: Unused plugins not included in bundle
- **Testable**: Plugins can be unit tested in isolation
- **Type-safe**: Full TypeScript support for hook signatures

### Negative

- **Execution overhead**: Each operation traverses hook chain
- **Debugging complexity**: Errors may originate from plugin code
- **Hook ordering**: Priority conflicts can cause subtle bugs
- **Breaking changes**: Hook signature changes affect all plugins

### Mitigations

1. **Performance**: Hooks are only called if registered; empty chains have no overhead
2. **Debugging**: Plugin errors include plugin name in stack trace
3. **Ordering**: Documentation clearly explains priority semantics
4. **Versioning**: Hook signatures versioned, deprecation warnings provided

## Alternatives Considered

### 1. Inheritance/Subclassing

Extend Database or Collection classes.

```typescript
class AuditedCollection extends Collection {
  async insert(doc) {
    await this.logAudit('insert', doc);
    return super.insert(doc);
  }
}
```

Rejected because:
- Only one level of extension (no composition)
- Requires modifying database creation
- Breaks encapsulation

### 2. Event Emitters

Emit events for operations, let listeners respond.

```typescript
db.on('beforeInsert', (doc) => { /* ... */ });
```

Rejected because:
- Events can't modify documents (or awkward async patterns)
- Events can't abort operations cleanly
- No guaranteed ordering

### 3. Decorators

TypeScript/JavaScript decorators on methods.

Rejected because:
- Requires specific class structure
- Doesn't work at runtime configuration level
- Limited browser support for decorator syntax

### 4. Aspect-Oriented Programming (AOP)

Full AOP framework with pointcuts.

Rejected because:
- Over-engineered for the use case
- Steep learning curve
- Large runtime overhead

## Example: Custom Plugin

```typescript
import { Plugin, PluginContext } from '@pocket/core';

const myPlugin: Plugin = {
  name: 'my-validation-plugin',
  version: '1.0.0',
  priority: 50,

  install(context: PluginContext) {
    const { hooks } = context;

    hooks.beforeInsert(async (doc, collection) => {
      if (collection.name === 'users') {
        if (!doc.email?.includes('@')) {
          throw new Error('Invalid email');
        }
      }
      return doc;
    });

    hooks.afterInsert(async (doc, collection) => {
      console.log(`Inserted ${doc._id} into ${collection.name}`);
    });
  }
};
```

## References

- [WordPress Hook System](https://developer.wordpress.org/plugins/hooks/)
- [Fastify Hooks](https://www.fastify.io/docs/latest/Reference/Hooks/)
- [Mongoose Middleware](https://mongoosejs.com/docs/middleware.html)
