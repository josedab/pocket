# Pocket Benchmark Results

**Date**: 2026-02-20
**Environment**: Node.js v24.4.1, macOS 15.7.3 (Darwin arm64)
**Storage**: In-memory (@pocket/storage-memory)
**Runner**: vitest bench v3.2.4 (tinybench)

## CRUD Operations

| Benchmark | ops/sec | Mean (ms) | Margin | Samples |
|-----------|---------|-----------|--------|---------|
| single insert | 156,451 | 0.0064 | ±5.07% | 78,226 |
| bulk insert 100 | 1,888 | 0.5296 | ±2.99% | 945 |
| bulk insert 1000 | 157 | 6.3757 | ±7.84% | 79 |
| get by id | 3,729,637 | 0.0003 | ±3.00% | 1,864,819 |
| update single | 124,821 | 0.0080 | ±0.60% | 62,411 |
| delete single | 5,214,374 | 0.0002 | ±1.31% | 2,607,187 |

## Query Operations

| Benchmark | ops/sec | Mean (ms) | Margin | Samples |
|-----------|---------|-----------|--------|---------|
| find all (100 docs) | 1,181,993 | 0.0008 | ±0.78% | 590,997 |
| find with filter (100 docs) | 92,320 | 0.0108 | ±1.07% | 46,160 |
| find with sort (100 docs) | 64,641 | 0.0155 | ±0.36% | 32,321 |
| find with limit (1000 docs) | 444,979 | 0.0022 | ±0.91% | 222,490 |
| count documents | 5,933,176 | 0.0002 | ±1.23% | 2,966,589 |

## Relative Performance

**Insert operations:**
- single insert is 82.85× faster than bulk insert 100
- single insert is 997.49× faster than bulk insert 1000

**Query operations (100-doc collection):**
- find all is 12.80× faster than find with filter
- find all is 18.29× faster than find with sort

**Query operations (1000-doc collection):**
- count documents is 13.33× faster than find with limit

## Summary

Pocket's in-memory storage delivers strong performance across all operations. Read-heavy operations are exceptionally fast — `get by id` achieves ~3.7M ops/sec and `count` reaches ~5.9M ops/sec thanks to in-memory data structures. Single document inserts sustain ~156K ops/sec while updates reach ~125K ops/sec. Query performance scales well: a full scan of 100 documents runs at ~1.2M ops/sec, with filtered and sorted queries still achieving 64–92K ops/sec. Bulk inserts show expected linear scaling with batch size (100-doc batches at ~1,888 ops/sec, 1000-doc batches at ~157 ops/sec).
