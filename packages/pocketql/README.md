# @pocket/pocketql

Type-safe query language for Pocket with compile-time type inference.

## Installation

```bash
pnpm add @pocket/pocketql
```

## Features

- Fluent query builder with full TypeScript type inference
- Query compilation to optimized execution plans
- Query executor with collection-aware execution
- Composable and serializable query definitions

## Usage

```typescript
import { createQueryBuilder, createQueryExecutor } from '@pocket/pocketql';

const query = createQueryBuilder('users')
  .where('age', '>', 18)
  .select('name', 'email')
  .limit(10);

const executor = createQueryExecutor(db);
const results = await executor.execute(query);
```

## API Reference

- `createQueryBuilder` / `QueryBuilder` — Build type-safe queries
- `createQueryCompiler` / `QueryCompiler` — Compile queries to execution plans
- `createQueryExecutor` / `QueryExecutor` — Execute compiled queries

## License

MIT
