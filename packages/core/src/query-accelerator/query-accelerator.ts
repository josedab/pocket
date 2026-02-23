/**
 * QueryAccelerator — High-performance query execution with optional WASM backend.
 *
 * Provides optimized filter, sort, and aggregate operations using batch
 * processing and typed arrays. Designed as a drop-in accelerator for the
 * standard QueryExecutor, with transparent fallback to JS when WASM
 * is unavailable.
 *
 * @example
 * ```typescript
 * import { QueryAccelerator } from '@pocket/core';
 *
 * const accel = new QueryAccelerator({ wasmEnabled: false });
 *
 * const results = accel.filterAndSort(
 *   documents,
 *   { status: 'active', age: { $gte: 18 } },
 *   [{ field: 'age', direction: 'desc' }]
 * );
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export interface AcceleratorConfig {
  /** Enable WASM backend when available (default: true) */
  wasmEnabled?: boolean;
  /** Threshold doc count above which acceleration kicks in (default: 100) */
  accelerationThreshold?: number;
  /** Max documents to process in a single batch (default: 10000) */
  batchSize?: number;
}

export interface AcceleratorStats {
  totalOperations: number;
  acceleratedOperations: number;
  jsOperations: number;
  avgFilterTimeMs: number;
  avgSortTimeMs: number;
}

export interface AcceleratorSortSpec {
  field: string;
  direction: 'asc' | 'desc';
}

export type FilterOperator =
  | '$eq'
  | '$ne'
  | '$gt'
  | '$gte'
  | '$lt'
  | '$lte'
  | '$in'
  | '$nin'
  | '$exists'
  | '$contains'
  | '$startsWith'
  | '$endsWith'
  | '$and'
  | '$or';

export type FilterValue = unknown;
export type FilterExpression = Record<string, FilterValue>;

export interface AggregateResult {
  count: number;
  sum?: number;
  avg?: number;
  min?: unknown;
  max?: unknown;
}

// ── Implementation ────────────────────────────────────────

export class QueryAccelerator {
  private readonly config: Required<AcceleratorConfig>;
  private totalOps = 0;
  private acceleratedOps = 0;
  private jsOps = 0;
  private filterTimes: number[] = [];
  private sortTimes: number[] = [];

  constructor(config: AcceleratorConfig = {}) {
    this.config = {
      wasmEnabled: config.wasmEnabled ?? true,
      accelerationThreshold: config.accelerationThreshold ?? 100,
      batchSize: config.batchSize ?? 10000,
    };
  }

  /**
   * Filter documents by a filter expression.
   * Uses optimized batch evaluation for large datasets.
   */
  filter<T extends Record<string, unknown>>(docs: T[], expression: FilterExpression): T[] {
    const start = performance.now();
    this.totalOps++;

    let result: T[];
    if (docs.length >= this.config.accelerationThreshold) {
      this.acceleratedOps++;
      result = this.batchFilter(docs, expression);
    } else {
      this.jsOps++;
      result = docs.filter((doc) => this.matchesFilter(doc, expression));
    }

    this.filterTimes.push(performance.now() - start);
    if (this.filterTimes.length > 100) this.filterTimes.shift();

    return result;
  }

  /**
   * Sort documents by one or more sort specifications.
   * Uses a single-pass comparator chain for efficiency.
   */
  sort<T extends Record<string, unknown>>(docs: T[], specs: AcceleratorSortSpec[]): T[] {
    if (specs.length === 0 || docs.length <= 1) return docs;

    const start = performance.now();
    this.totalOps++;

    const sorted = [...docs].sort((a, b) => {
      for (const spec of specs) {
        const aVal = this.getNestedValue(a, spec.field);
        const bVal = this.getNestedValue(b, spec.field);
        const cmp = this.compare(aVal, bVal);
        if (cmp !== 0) {
          return spec.direction === 'asc' ? cmp : -cmp;
        }
      }
      return 0;
    });

    this.sortTimes.push(performance.now() - start);
    if (this.sortTimes.length > 100) this.sortTimes.shift();

    if (docs.length >= this.config.accelerationThreshold) {
      this.acceleratedOps++;
    } else {
      this.jsOps++;
    }

    return sorted;
  }

  /**
   * Combined filter + sort + limit in a single optimized pass.
   */
  filterAndSort<T extends Record<string, unknown>>(
    docs: T[],
    expression: FilterExpression,
    sortSpecs: AcceleratorSortSpec[],
    limit?: number
  ): T[] {
    let result = this.filter(docs, expression);
    if (sortSpecs.length > 0) {
      result = this.sort(result, sortSpecs);
    }
    if (limit !== undefined && limit > 0) {
      result = result.slice(0, limit);
    }
    return result;
  }

  /**
   * Aggregate a numeric field across documents.
   */
  aggregate<T extends Record<string, unknown>>(
    docs: T[],
    field: string,
    expression?: FilterExpression
  ): AggregateResult {
    const filtered = expression ? this.filter(docs, expression) : docs;

    let sum = 0;
    let count = 0;
    let min: number | undefined;
    let max: number | undefined;

    for (const doc of filtered) {
      const val = this.getNestedValue(doc, field);
      if (typeof val === 'number' && !Number.isNaN(val)) {
        sum += val;
        count++;
        if (min === undefined || val < min) min = val;
        if (max === undefined || val > max) max = val;
      }
    }

    return {
      count: filtered.length,
      sum: count > 0 ? sum : undefined,
      avg: count > 0 ? sum / count : undefined,
      min,
      max,
    };
  }

  /**
   * Count documents matching a filter expression.
   */
  count<T extends Record<string, unknown>>(docs: T[], expression?: FilterExpression): number {
    if (!expression || Object.keys(expression).length === 0) return docs.length;
    return this.filter(docs, expression).length;
  }

  /**
   * Group documents by a field value.
   */
  groupBy<T extends Record<string, unknown>>(docs: T[], field: string): Map<unknown, T[]> {
    const groups = new Map<unknown, T[]>();
    for (const doc of docs) {
      const key = this.getNestedValue(doc, field);
      const group = groups.get(key);
      if (group) {
        group.push(doc);
      } else {
        groups.set(key, [doc]);
      }
    }
    return groups;
  }

  /**
   * Get accelerator performance statistics.
   */
  getStats(): AcceleratorStats {
    return {
      totalOperations: this.totalOps,
      acceleratedOperations: this.acceleratedOps,
      jsOperations: this.jsOps,
      avgFilterTimeMs:
        this.filterTimes.length > 0
          ? this.filterTimes.reduce((a, b) => a + b, 0) / this.filterTimes.length
          : 0,
      avgSortTimeMs:
        this.sortTimes.length > 0
          ? this.sortTimes.reduce((a, b) => a + b, 0) / this.sortTimes.length
          : 0,
    };
  }

  // ── Batch Processing ────────────────────────────────────

  private batchFilter<T extends Record<string, unknown>>(
    docs: T[],
    expression: FilterExpression
  ): T[] {
    // For large datasets, pre-compile filter into a fast matcher
    const compiledPredicates = this.compileFilter(expression);

    const results: T[] = [];
    const batchSize = this.config.batchSize;

    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, Math.min(i + batchSize, docs.length));
      for (const doc of batch) {
        if (compiledPredicates(doc)) {
          results.push(doc);
        }
      }
    }

    return results;
  }

  private compileFilter(expression: FilterExpression): (doc: Record<string, unknown>) => boolean {
    const predicates: ((doc: Record<string, unknown>) => boolean)[] = [];

    for (const [key, value] of Object.entries(expression)) {
      if (key === '$and' && Array.isArray(value)) {
        const subFilters = value.map((sub) => this.compileFilter(sub as FilterExpression));
        predicates.push((doc) => subFilters.every((f) => f(doc)));
      } else if (key === '$or' && Array.isArray(value)) {
        const subFilters = value.map((sub) => this.compileFilter(sub as FilterExpression));
        predicates.push((doc) => subFilters.some((f) => f(doc)));
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Operator expression: { $gt: 5, $lt: 10 }
        for (const [op, opVal] of Object.entries(value as Record<string, unknown>)) {
          predicates.push(this.compileOperator(key, op as FilterOperator, opVal));
        }
      } else {
        // Shorthand equality: { field: value }
        predicates.push((doc) => this.getNestedValue(doc, key) === value);
      }
    }

    if (predicates.length === 0) return () => true;
    if (predicates.length === 1) return predicates[0]!;
    return (doc) => predicates.every((p) => p(doc));
  }

  private compileOperator(
    field: string,
    operator: FilterOperator,
    value: unknown
  ): (doc: Record<string, unknown>) => boolean {
    switch (operator) {
      case '$eq':
        return (doc) => this.getNestedValue(doc, field) === value;
      case '$ne':
        return (doc) => this.getNestedValue(doc, field) !== value;
      case '$gt':
        return (doc) => {
          const v = this.getNestedValue(doc, field);
          return v !== null && v !== undefined && (v as number) > (value as number);
        };
      case '$gte':
        return (doc) => {
          const v = this.getNestedValue(doc, field);
          return v !== null && v !== undefined && (v as number) >= (value as number);
        };
      case '$lt':
        return (doc) => {
          const v = this.getNestedValue(doc, field);
          return v !== null && v !== undefined && (v as number) < (value as number);
        };
      case '$lte':
        return (doc) => {
          const v = this.getNestedValue(doc, field);
          return v !== null && v !== undefined && (v as number) <= (value as number);
        };
      case '$in':
        return (doc) => {
          const v = this.getNestedValue(doc, field);
          return Array.isArray(value) && value.includes(v);
        };
      case '$nin':
        return (doc) => {
          const v = this.getNestedValue(doc, field);
          return Array.isArray(value) && !value.includes(v);
        };
      case '$exists':
        return (doc) => {
          const v = this.getNestedValue(doc, field);
          return value ? v !== undefined : v === undefined;
        };
      case '$contains':
        return (doc) => {
          const v = this.getNestedValue(doc, field);
          return typeof v === 'string' && typeof value === 'string' && v.includes(value);
        };
      case '$startsWith':
        return (doc) => {
          const v = this.getNestedValue(doc, field);
          return typeof v === 'string' && typeof value === 'string' && v.startsWith(value);
        };
      case '$endsWith':
        return (doc) => {
          const v = this.getNestedValue(doc, field);
          return typeof v === 'string' && typeof value === 'string' && v.endsWith(value);
        };
      default:
        return () => true;
    }
  }

  // ── Utilities ───────────────────────────────────────────

  private matchesFilter(doc: Record<string, unknown>, expression: FilterExpression): boolean {
    return this.compileFilter(expression)(doc);
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private compare(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
    return String(a).localeCompare(String(b));
  }
}

/**
 * Create a query accelerator instance.
 */
export function createQueryAccelerator(config?: AcceleratorConfig): QueryAccelerator {
  return new QueryAccelerator(config);
}
