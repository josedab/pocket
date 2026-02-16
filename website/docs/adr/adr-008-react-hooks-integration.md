# ADR-008: React Hooks as Primary Integration Pattern

## Status

Accepted

## Context

Pocket needs to integrate with React applications. Developers expect:
- Familiar React patterns (not custom APIs)
- Automatic re-rendering when data changes
- Proper handling of component lifecycle
- TypeScript support with type inference
- Compatibility with React Suspense and Concurrent Mode

Several integration patterns exist in the React ecosystem:
1. Higher-Order Components (HOCs)
2. Render Props
3. Custom Hooks
4. Context Providers
5. External State Managers (Redux, MobX)

The chosen pattern affects:
- Developer experience
- Bundle size
- Performance characteristics
- Learning curve

## Decision

Use custom React hooks as the primary integration pattern, with a Context provider for database access.

### Core Hooks

| Hook | Purpose | Returns |
|------|---------|---------|
| `useLiveQuery<T>` | Subscribe to reactive query | `{ data, isLoading, error }` |
| `useDocument<T>` | Subscribe to single document | `{ data, isLoading, error, update, remove }` |
| `useMutation<T>` | Insert/update/delete operations | `{ insert, update, remove, isMutating }` |
| `useSuspenseQuery<T>` | Suspense-compatible query | `{ data }` (throws Promise) |
| `useSyncStatus` | Monitor sync engine | `{ state, pendingChanges, lastSyncedAt }` |

### Provider Pattern

```tsx
import { PocketProvider, useLiveQuery } from '@pocket/react';

function App() {
  return (
    <PocketProvider database={db}>
      <TodoList />
    </PocketProvider>
  );
}

function TodoList() {
  const { data: todos, isLoading } = useLiveQuery<Todo>('todos', {
    filter: { completed: false },
    sort: { field: 'createdAt', direction: 'desc' }
  });

  if (isLoading) return <Spinner />;
  return todos.map(todo => <TodoItem key={todo._id} todo={todo} />);
}
```

### Implementation Details

1. **Subscription Management**: Hooks use `useEffect` to subscribe/unsubscribe to RxJS observables
2. **Memoization**: Query options are memoized to prevent unnecessary resubscriptions
3. **State Updates**: Use `useState` with functional updates for batching
4. **Cleanup**: Subscriptions automatically cleaned up on unmount
5. **Error Boundaries**: Errors can be caught by React error boundaries

### Hook Implementation Pattern

```typescript
function useLiveQuery<T extends Document>(
  collection: string,
  options?: LiveQueryOptions<T>
): LiveQueryResult<T> {
  const { database } = usePocketContext();
  const [state, setState] = useState<LiveQueryState<T>>({
    data: [],
    isLoading: true,
    error: null
  });

  // Memoize options to prevent resubscription
  const memoizedOptions = useMemo(() => options, [JSON.stringify(options)]);

  useEffect(() => {
    const col = database.collection<T>(collection);
    const query$ = col.find(memoizedOptions?.filter)
      .sort(memoizedOptions?.sort)
      .limit(memoizedOptions?.limit)
      .$;

    const subscription = query$.subscribe({
      next: (data) => setState({ data, isLoading: false, error: null }),
      error: (error) => setState(s => ({ ...s, isLoading: false, error }))
    });

    return () => subscription.unsubscribe();
  }, [database, collection, memoizedOptions]);

  return state;
}
```

## Consequences

### Positive

- **Familiar API**: Follows React conventions (useState, useEffect patterns)
- **Composable**: Hooks can be combined in custom hooks
- **Type-safe**: Full TypeScript inference for document types
- **Efficient**: Only subscribed components re-render
- **Suspense-ready**: `useSuspenseQuery` works with React 18 Suspense
- **Small footprint**: ~8KB for complete React integration

### Negative

- **Rules of Hooks**: Must follow React's hook rules (top-level, same order)
- **Class components**: Hooks don't work in class components
- **SSR complexity**: Need careful handling for server-side rendering
- **React-specific**: Integration code is React-only (separate packages for Vue, etc.)

### Mitigations

1. **Linter**: ESLint plugin enforces hook rules
2. **Class support**: Provide HOC wrapper for legacy class components
3. **SSR**: Document SSR patterns, provide `getServerSideProps` helpers
4. **Framework-agnostic core**: Core remains framework-agnostic; only integration layer is React-specific

## Alternatives Considered

### 1. Higher-Order Components (HOCs)

```tsx
const TodoList = withLiveQuery('todos', { filter: { completed: false } })(
  ({ todos }) => <div>{todos.map(...)}</div>
);
```

Rejected because:
- "Wrapper hell" with multiple HOCs
- Props name collisions
- Harder to type correctly
- Considered legacy pattern in modern React

### 2. Render Props

```tsx
<LiveQuery collection="todos" filter={{ completed: false }}>
  {({ data, loading }) => loading ? <Spinner /> : <List items={data} />}
</LiveQuery>
```

Rejected because:
- Awkward nesting with multiple queries
- Less composable than hooks
- Verbose syntax

### 3. External State Manager (Redux/MobX)

Integrate Pocket as a Redux middleware or MobX store.

Rejected because:
- Adds dependency on specific state manager
- Users may not use Redux/MobX
- Pocket's reactive system is sufficient

### 4. Direct Observable Subscription

Expose only RxJS observables, let users handle React integration.

```tsx
function TodoList() {
  const [todos, setTodos] = useState([]);
  useEffect(() => {
    const sub = db.collection('todos').find().$..subscribe(setTodos);
    return () => sub.unsubscribe();
  }, []);
  return <div>...</div>;
}
```

Rejected because:
- Boilerplate in every component
- Easy to forget cleanup
- No standardized loading/error handling
- Poor DX

### 5. Signals (SolidJS-style)

Use fine-grained reactivity like SolidJS signals.

Rejected because:
- Not native to React
- Would require React compiler or special JSX transform
- Better suited for SolidJS integration (separate package)

## Framework-Specific Packages

Each framework gets its own integration package:

| Framework | Package | Pattern |
|-----------|---------|---------|
| React | `@pocket/react` | Hooks |
| Vue | `@pocket/vue` | Composition API |
| Svelte | `@pocket/svelte` | Stores |
| SolidJS | `@pocket/solid` | Signals |
| Angular | `@pocket/angular` | Services + RxJS |

This allows each integration to be idiomatic for its framework.

## References

- [React Hooks Documentation](https://react.dev/reference/react)
- [SWR (Stale-While-Revalidate)](https://swr.vercel.app/) - Similar hooks pattern
- [TanStack Query](https://tanstack.com/query) - Inspiration for API design
- [RxJS + React patterns](https://rxjs.dev/guide/overview)
