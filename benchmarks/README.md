# Pocket Benchmarks

Standardized benchmark suite for measuring Pocket database performance.

## Quick Start

From the repository root:

```bash
# Run all vitest benchmarks
pnpm bench

# Run specific suites
pnpm --filter @pocket/benchmarks bench:crud
pnpm --filter @pocket/benchmarks bench:query
```

From the `benchmarks/` directory:

```bash
pnpm bench            # All suites
pnpm bench:crud       # CRUD operations only
pnpm bench:query      # Query operations only
```

## Benchmark Suites

### CRUD (`src/suites/crud.bench.ts`)

Core create/read/update/delete operations:

| Benchmark | Description |
|-----------|-------------|
| single insert | Insert one document |
| bulk insert 100 | Insert 100 documents at once |
| bulk insert 1000 | Insert 1000 documents at once |
| get by id | Retrieve a single document by ID |
| update single | Update one document |
| delete single | Delete one document |

### Query (`src/suites/query.bench.ts`)

Query and filtering operations:

| Benchmark | Description |
|-----------|-------------|
| find all (100 docs) | Retrieve all documents from a 100-doc collection |
| find with filter (100 docs) | Equality filter on 100 documents |
| find with sort (100 docs) | Sorted query on 100 documents |
| find with limit (1000 docs) | Limited query on a 1000-doc collection |
| count documents | Count operation on 1000 documents |

## Results Reporter

The `src/results-reporter.ts` module provides a `createResultsReporter()` factory for formatting benchmark data as markdown tables.

```typescript
import { createResultsReporter, type BenchmarkEntry } from './src/results-reporter.js';

const reporter = createResultsReporter('benchmarks/results/latest.md');
reporter.write(entries);
```

Output includes: benchmark name, ops/sec, margin of error, relative speed, and sample count. Results are written to `benchmarks/results/latest.md`.

## Interpreting Results

- **ops/sec** — Operations per second. Higher is better.
- **Margin (±%)** — Statistical margin of error. Lower means more stable.
- **Relative** — Performance relative to the fastest benchmark in the table. `fastest` marks the top performer; percentages show how other benchmarks compare.
- **Samples** — Number of iterations run. More samples → more reliable results.

## Legacy Benchmarks

The original tinybench-based benchmarks are still available:

```bash
pnpm bench:legacy           # Run all legacy benchmarks
pnpm bench:legacy:core      # Core operations
pnpm bench:legacy:query     # Query operations
```
