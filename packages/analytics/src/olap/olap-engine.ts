/**
 * OLAPEngine - Embedded OLAP analytics for Pocket.
 *
 * Provides groupBy, rollup, cube, pivot, and window functions
 * for in-memory analytical processing.
 */

import type {
  AggregateFunction,
  CubeSpec,
  GroupBySpec,
  OLAPEngineConfig,
  OLAPResult,
  PivotResult,
  PivotSpec,
  RollupSpec,
  WindowFunctionDef,
} from './types.js';

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function getField(obj: Record<string, unknown>, field: string): unknown {
  return obj[field];
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export class OLAPEngine {
  readonly config: Required<OLAPEngineConfig>;

  constructor(config?: OLAPEngineConfig) {
    this.config = {
      workerThreshold: config?.workerThreshold ?? 100_000,
      enableIncrementalUpdates: config?.enableIncrementalUpdates ?? false,
      cacheResults: config?.cacheResults ?? false,
      cacheTTLMs: config?.cacheTTLMs ?? 60_000,
    };
  }

  /** Compute an aggregate over a set of values */
  aggregate(values: unknown[], fn: AggregateFunction): number | null {
    const nums = values.map(toNumber).filter((v): v is number => v !== null);

    switch (fn) {
      case 'count':
        return values.length;
      case 'sum':
        return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0);
      case 'avg':
        return nums.length === 0
          ? null
          : nums.reduce((a, b) => a + b, 0) / nums.length;
      case 'min':
        return nums.length === 0 ? null : Math.min(...nums);
      case 'max':
        return nums.length === 0 ? null : Math.max(...nums);
      case 'median':
        return this.computeMedian(nums);
      case 'stddev':
        return this.computeStddev(nums);
      case 'variance':
        return this.computeVariance(nums);
      case 'first':
        return nums.length === 0 ? null : nums[0]!;
      case 'last':
        return nums.length === 0 ? null : nums[nums.length - 1]!;
      default:
        return null;
    }
  }

  /** Group records by fields and apply aggregations */
  groupBy<T extends Record<string, unknown>>(
    data: T[],
    spec: GroupBySpec,
  ): OLAPResult {
    const start = now();
    const groups = new Map<string, T[]>();

    for (const row of data) {
      const key = spec.fields.map((f) => String(getField(row, f))).join('\0');
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(row);
    }

    let results: Record<string, unknown>[] = [];
    for (const [, rows] of groups) {
      const result: Record<string, unknown> = {};
      for (const f of spec.fields) {
        result[f] = getField(rows[0]!, f);
      }
      for (const agg of spec.aggregations) {
        const vals = rows.map((r) => getField(r, agg.field));
        result[agg.alias] = this.aggregate(vals, agg.fn);
      }
      results.push(result);
    }

    if (spec.having) {
      results = results.filter(spec.having);
    }

    return {
      data: results,
      metadata: {
        rowCount: results.length,
        executionTimeMs: now() - start,
        dimensions: spec.fields,
        measures: spec.aggregations.map((a) => a.alias),
        engine: 'main-thread',
      },
    };
  }

  /** Hierarchical aggregation: for dimensions [A,B,C] produce (A,B,C), (A,B), (A), () */
  rollup<T extends Record<string, unknown>>(
    data: T[],
    spec: RollupSpec,
  ): OLAPResult {
    const start = now();
    const allResults: Record<string, unknown>[] = [];

    for (let i = spec.dimensions.length; i >= 0; i--) {
      const dims = spec.dimensions.slice(0, i);
      const grouped = this.groupByRaw(data, dims, spec.measures);
      for (const row of grouped) {
        // Set null for dimensions not included in this level
        for (let j = i; j < spec.dimensions.length; j++) {
          row[spec.dimensions[j]!] = null;
        }
        allResults.push(row);
      }
    }

    return {
      data: allResults,
      metadata: {
        rowCount: allResults.length,
        executionTimeMs: now() - start,
        dimensions: spec.dimensions,
        measures: spec.measures.map((m) => m.alias),
        engine: 'main-thread',
      },
    };
  }

  /** All combinations of dimensions */
  cube<T extends Record<string, unknown>>(
    data: T[],
    spec: CubeSpec,
  ): OLAPResult {
    const start = now();
    const allResults: Record<string, unknown>[] = [];
    const n = spec.dimensions.length;
    const total = 1 << n;

    for (let mask = total - 1; mask >= 0; mask--) {
      const dims: string[] = [];
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          dims.push(spec.dimensions[i]!);
        }
      }
      const grouped = this.groupByRaw(data, dims, spec.measures);
      for (const row of grouped) {
        for (const d of spec.dimensions) {
          if (!dims.includes(d)) {
            row[d] = null;
          }
        }
        allResults.push(row);
      }
    }

    return {
      data: allResults,
      metadata: {
        rowCount: allResults.length,
        executionTimeMs: now() - start,
        dimensions: spec.dimensions,
        measures: spec.measures.map((m) => m.alias),
        engine: 'main-thread',
      },
    };
  }

  /** Pivot rows into columns */
  pivot<T extends Record<string, unknown>>(
    data: T[],
    spec: PivotSpec,
  ): PivotResult {
    const columnValues = [
      ...new Set(data.map((r) => getField(r, spec.columnField))),
    ];
    const rowGroups = new Map<string, Map<unknown, unknown[]>>();

    for (const row of data) {
      const rowKey = spec.rowFields
        .map((f) => String(getField(row, f)))
        .join('\0');
      if (!rowGroups.has(rowKey)) {
        rowGroups.set(rowKey, new Map());
      }
      const colMap = rowGroups.get(rowKey)!;
      const colVal = getField(row, spec.columnField);
      if (!colMap.has(colVal)) {
        colMap.set(colVal, []);
      }
      colMap.get(colVal)!.push(getField(row, spec.valueField));
    }

    const rows: Record<string, unknown>[] = [];
    const totalsByCol = new Map<unknown, unknown[]>();

    for (const [rowKey, colMap] of rowGroups) {
      const rowParts = rowKey.split('\0');
      const result: Record<string, unknown> = {};
      for (let i = 0; i < spec.rowFields.length; i++) {
        result[spec.rowFields[i]!] = rowParts[i];
      }
      for (const cv of columnValues) {
        const vals = colMap.get(cv) ?? [];
        result[String(cv)] = this.aggregate(vals, spec.aggregation);
        if (!totalsByCol.has(cv)) {
          totalsByCol.set(cv, []);
        }
        totalsByCol.get(cv)!.push(...vals);
      }
      rows.push(result);
    }

    const totals: Record<string, unknown> = {};
    for (const cv of columnValues) {
      totals[String(cv)] = this.aggregate(
        totalsByCol.get(cv) ?? [],
        spec.aggregation,
      );
    }

    return { rows, columnValues, totals };
  }

  /** Apply window functions to data */
  windowFunction<T extends Record<string, unknown>>(
    data: T[],
    fns: WindowFunctionDef[],
  ): OLAPResult<T & Record<string, unknown>> {
    const start = now();
    const result: Array<Record<string, unknown>> = data.map((row) => ({
      ...row,
    }));

    for (const def of fns) {
      const partitions = this.partition(result, def.windowSpec.partitionBy);

      for (const partition of partitions) {
        const sorted = this.sortPartition(partition, def.windowSpec.orderBy);

        for (let i = 0; i < sorted.length; i++) {
          const row = sorted[i]!;
          row[def.alias] = this.computeWindowValue(def, sorted, i);
        }
      }
    }

    return {
      data: result as Array<T & Record<string, unknown>>,
      metadata: {
        rowCount: result.length,
        executionTimeMs: now() - start,
        dimensions: [],
        measures: fns.map((f) => f.alias),
        engine: 'main-thread',
      },
    };
  }

  /** Clean up resources */
  destroy(): void {
    // Reserved for future worker cleanup
  }

  // --- Private helpers ---

  private groupByRaw<T extends Record<string, unknown>>(
    data: T[],
    dims: string[],
    measures: Array<{ field: string; fn: AggregateFunction; alias: string }>,
  ): Record<string, unknown>[] {
    const groups = new Map<string, T[]>();
    for (const row of data) {
      const key = dims.map((f) => String(getField(row, f))).join('\0');
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(row);
    }

    const results: Record<string, unknown>[] = [];
    for (const [, rows] of groups) {
      const result: Record<string, unknown> = {};
      for (const d of dims) {
        result[d] = getField(rows[0]!, d);
      }
      for (const m of measures) {
        const vals = rows.map((r) => getField(r, m.field));
        result[m.alias] = this.aggregate(vals, m.fn);
      }
      results.push(result);
    }
    return results;
  }

  private computeMedian(nums: number[]): number | null {
    if (nums.length === 0) return null;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  }

  private computeVariance(nums: number[]): number | null {
    if (nums.length === 0) return null;
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    return (
      nums.reduce((sum, v) => sum + (v - mean) ** 2, 0) / nums.length
    );
  }

  private computeStddev(nums: number[]): number | null {
    const v = this.computeVariance(nums);
    return v === null ? null : Math.sqrt(v);
  }

  private partition<T extends Record<string, unknown>>(
    data: T[],
    partitionBy?: string[],
  ): T[][] {
    if (!partitionBy || partitionBy.length === 0) return [data];
    const map = new Map<string, T[]>();
    for (const row of data) {
      const key = partitionBy.map((f) => String(getField(row, f))).join('\0');
      let group = map.get(key);
      if (!group) {
        group = [];
        map.set(key, group);
      }
      group.push(row);
    }
    return [...map.values()];
  }

  private sortPartition<T extends Record<string, unknown>>(
    data: T[],
    orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>,
  ): T[] {
    if (!orderBy || orderBy.length === 0) return data;
    return [...data].sort((a, b) => {
      for (const { field, direction } of orderBy) {
        const va = getField(a, field);
        const vb = getField(b, field);
        if (va === vb) continue;
        const cmp = va! < vb! ? -1 : 1;
        return direction === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }

  private computeWindowValue(
    def: WindowFunctionDef,
    partition: Record<string, unknown>[],
    index: number,
  ): number | null {
    switch (def.fn) {
      case 'row_number':
        return index + 1;
      case 'rank':
        return this.computeRank(partition, index, def.windowSpec);
      case 'dense_rank':
        return this.computeDenseRank(partition, index, def.windowSpec);
      case 'lag':
        return index > 0
          ? toNumber(getField(partition[index - 1]!, def.field ?? ''))
          : null;
      case 'lead':
        return index < partition.length - 1
          ? toNumber(getField(partition[index + 1]!, def.field ?? ''))
          : null;
      case 'ntile': {
        const n = toNumber(def.field) ?? 4;
        return Math.floor((index * n) / partition.length) + 1;
      }
      default: {
        // Aggregate window function over frame
        const frame = this.getFrameRows(partition, index, def);
        const vals = frame.map((r) => getField(r, def.field ?? ''));
        return this.aggregate(vals, def.fn as AggregateFunction);
      }
    }
  }

  private computeRank(
    partition: Record<string, unknown>[],
    index: number,
    spec: WindowFunctionDef['windowSpec'],
  ): number {
    if (!spec.orderBy || spec.orderBy.length === 0) return 1;
    let rank = 1;
    for (let i = 0; i < index; i++) {
      if (!this.orderEqual(partition[i]!, partition[index]!, spec.orderBy)) {
        rank = i + 1;
      }
    }
    if (
      index > 0 &&
      !this.orderEqual(
        partition[index - 1]!,
        partition[index]!,
        spec.orderBy,
      )
    ) {
      rank = index + 1;
    }
    return rank;
  }

  private computeDenseRank(
    partition: Record<string, unknown>[],
    index: number,
    spec: WindowFunctionDef['windowSpec'],
  ): number {
    if (!spec.orderBy || spec.orderBy.length === 0) return 1;
    let rank = 1;
    for (let i = 1; i <= index; i++) {
      if (!this.orderEqual(partition[i - 1]!, partition[i]!, spec.orderBy)) {
        rank++;
      }
    }
    return rank;
  }

  private orderEqual(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    orderBy: Array<{ field: string; direction: 'asc' | 'desc' }>,
  ): boolean {
    return orderBy.every(({ field }) => getField(a, field) === getField(b, field));
  }

  private getFrameRows(
    partition: Record<string, unknown>[],
    index: number,
    def: WindowFunctionDef,
  ): Record<string, unknown>[] {
    const frame = def.windowSpec.frame;
    if (!frame) {
      // Default: unbounded preceding to current row
      return partition.slice(0, index + 1);
    }
    const start = this.resolveFrameBound(frame.start, index, partition.length);
    const end = this.resolveFrameBound(frame.end, index, partition.length);
    return partition.slice(
      Math.max(0, start),
      Math.min(partition.length, end + 1),
    );
  }

  private resolveFrameBound(
    bound: import('./types.js').WindowFrameBound,
    currentIndex: number,
    length: number,
  ): number {
    if (bound === 'unbounded_preceding') return 0;
    if (bound === 'current_row') return currentIndex;
    if (bound === 'unbounded_following') return length - 1;
    return currentIndex + bound;
  }
}

/** Factory function */
export function createOLAPEngine(config?: OLAPEngineConfig): OLAPEngine {
  return new OLAPEngine(config);
}
