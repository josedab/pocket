# @pocket/query

Query subscriptions for Pocket — reactive queries with automatic updates.

## Installation

```bash
pnpm add @pocket/query
```

## Features

- Fluent query builder with serialization and hashing
- Reactive query subscriptions that update on data changes
- Query executor with collection-aware execution
- React hooks for live queries and subscriptions

## Usage

```typescript
import { query, createQueryExecutor } from '@pocket/query';

const q = query('users').where('active', '==', true).limit(10);
const executor = createQueryExecutor(db);
const results = await executor.execute(q);

// React hook
const useLiveQuery = createUseLiveQueryHook(React);
const { data, loading } = useLiveQuery(q);
```

## API Reference

- `query` / `QueryBuilder` — Build and compose queries
- `parseQuery` / `serializeQuery` / `hashQuery` — Serialize and hash queries
- `createQueryExecutor` / `QueryExecutor` / `executeQuery` — Execute queries
- `createQuerySubscription` / `QuerySubscriptionManager` — Subscribe to query changes
- `createUseLiveQueryHook` — React hook for reactive queries
- `createUseQueryHook` — React hook for one-time queries
- `createUseQuerySubscriptionHook` — React hook for subscription management
- `createUseQueryDataHook` — React hook for query data
- `createUseQueryEventsHook` — React hook for query events

## License

MIT
