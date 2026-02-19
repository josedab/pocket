# ADR-002: RxJS for Reactivity

## Status

Accepted

## Context

Pocket needs a reactivity system for live queries - queries that automatically update when underlying data changes. This requires:

- Observable data streams
- Operators for transformation and composition
- Subscription management
- Debouncing and throttling
- Memory-safe cleanup

Several options exist:
- Custom event emitters
- Built-in browser APIs (EventTarget)
- Reactive libraries (RxJS, MobX, signals)
- Framework-specific solutions (React Query, SWR)

## Decision

Use RxJS as the reactivity foundation for Pocket.

### Implementation

```typescript
// Live query returns an RxJS Observable
const subscription = todos
  .find({ completed: false })
  .live()
  .subscribe((results) => {
    updateUI(results);
  });

// Change stream is also an Observable
collection.changes().subscribe((event) => {
  console.log(event.operation, event.document);
});
```

### Integration Points

1. **Collection.changes()** - Returns `Observable<ChangeEvent>`
2. **QueryBuilder.live()** - Returns `Observable<T[]>`
3. **SyncEngine status/stats** - Returns `Observable<Status>`
4. **Document observation** - Returns `Observable<T | null>`

## Consequences

### Positive

- **Battle-tested**: RxJS is mature and widely used
- **Powerful operators**: map, filter, debounce, merge, etc.
- **Memory management**: Proper subscription cleanup
- **Composability**: Combine multiple observables easily
- **TypeScript support**: Excellent type definitions
- **Framework agnostic**: Works with React, Vue, Angular, or vanilla JS

### Negative

- **Bundle size**: RxJS adds ~30KB minified
- **Learning curve**: RxJS has a steep learning curve
- **Complexity**: Can be overkill for simple use cases
- **Peer dependency**: Users need to install rxjs

### Mitigations

1. **Tree-shaking**: Only import needed operators
2. **Simple API**: Hide RxJS complexity behind `.live()` and `.subscribe()`
3. **Documentation**: Provide clear examples for common patterns
4. **React hooks**: Provide `@pocket/react` that handles subscriptions

## Alternatives Considered

### 1. Custom Event System

Build a simple EventEmitter-based system.

```typescript
collection.on('change', (event) => { ... });
```

Rejected because:
- Reinventing the wheel
- Missing operators for debouncing, combining, etc.
- Manual memory management
- No TypeScript support for event types

### 2. Signals (Preact/Solid style)

Use a signals-based reactivity system.

```typescript
const todos = signal([]);
effect(() => console.log(todos.value));
```

Rejected because:
- Less mature ecosystem
- Tighter coupling to specific frameworks
- Fewer transformation operators
- Would need to build from scratch or use smaller library

### 3. MobX

Use MobX observables.

```typescript
const todos = observable([]);
autorun(() => console.log(todos));
```

Rejected because:
- Heavier than needed (proxies, decorators)
- More opinionated about state management
- Overkill for query result streams

### 4. No Reactivity (Polling)

Let users poll for updates manually.

```typescript
setInterval(async () => {
  const results = await collection.find(filter).exec();
  updateUI(results);
}, 1000);
```

Rejected because:
- Poor user experience (stale data)
- Wasteful (constant queries even with no changes)
- Complex for users to implement correctly

## References

- [RxJS Documentation](https://rxjs.dev/)
- [The introduction to Reactive Programming you've been missing](https://gist.github.com/staltz/868e7e9bc2a7b8c1f754)
- [RxDB - Uses RxJS for reactivity](https://rxdb.info/)
