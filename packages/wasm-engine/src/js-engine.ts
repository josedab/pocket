/**
 * JavaScript reference implementation of the query engine.
 *
 * This serves as both the fallback when Wasm is unavailable and the
 * reference specification for the Wasm-compiled engine to match.
 */

import type {
  AggregateClause,
  AggregateResult,
  FilterCondition,
  FilterGroup,
  GroupByClause,
  QueryEngine,
  QueryPlan,
  QueryResult,
  SortClause,
} from './types.js';

/** Resolve a nested field path (e.g. "address.city") from a document. */
function getField(doc: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = doc;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Evaluate a single filter condition against a document. */
function evaluateCondition(doc: Record<string, unknown>, condition: FilterCondition): boolean {
  const fieldValue = getField(doc, condition.field);
  const target = condition.value;

  switch (condition.operator) {
    case 'eq':
      return fieldValue === target;
    case 'ne':
      return fieldValue !== target;
    case 'gt':
      return (fieldValue as number) > (target as number);
    case 'gte':
      return (fieldValue as number) >= (target as number);
    case 'lt':
      return (fieldValue as number) < (target as number);
    case 'lte':
      return (fieldValue as number) <= (target as number);
    case 'in':
      return Array.isArray(target) && target.includes(fieldValue);
    case 'nin':
      return Array.isArray(target) && !target.includes(fieldValue);
    case 'contains':
      return (
        typeof fieldValue === 'string' && typeof target === 'string' && fieldValue.includes(target)
      );
    case 'startsWith':
      return (
        typeof fieldValue === 'string' &&
        typeof target === 'string' &&
        fieldValue.startsWith(target)
      );
    case 'endsWith':
      return (
        typeof fieldValue === 'string' && typeof target === 'string' && fieldValue.endsWith(target)
      );
    case 'exists':
      return target ? fieldValue !== undefined : fieldValue === undefined;
    case 'regex':
      return (
        typeof fieldValue === 'string' &&
        typeof target === 'string' &&
        new RegExp(target).test(fieldValue)
      );
    default:
      return false;
  }
}

/** Evaluate a filter (condition or group) against a document. */
function evaluateFilter(
  doc: Record<string, unknown>,
  filter: FilterCondition | FilterGroup
): boolean {
  if ('logic' in filter) {
    const group = filter;
    if (group.logic === 'and') {
      return group.conditions.every((c) => evaluateFilter(doc, c));
    }
    return group.conditions.some((c) => evaluateFilter(doc, c));
  }
  return evaluateCondition(doc, filter);
}

/** Compare two values for sorting. */
function compareValues(a: unknown, b: unknown, direction: 'asc' | 'desc'): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return direction === 'asc' ? -1 : 1;
  if (b === undefined || b === null) return direction === 'asc' ? 1 : -1;

  let result: number;
  if (typeof a === 'string' && typeof b === 'string') {
    result = a.localeCompare(b);
  } else {
    result = (a as number) < (b as number) ? -1 : 1;
  }
  return direction === 'desc' ? -result : result;
}

/** Sort documents by multiple sort clauses. */
function sortDocuments<T extends Record<string, unknown>>(
  docs: T[],
  sortClauses: readonly SortClause[]
): T[] {
  return docs.sort((a, b) => {
    for (const clause of sortClauses) {
      const aVal = getField(a, clause.field);
      const bVal = getField(b, clause.field);
      const cmp = compareValues(aVal, bVal, clause.direction);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

/** Apply field projection to a document. */
function applyProjection<T extends Record<string, unknown>>(
  doc: T,
  include?: readonly string[],
  exclude?: readonly string[]
): T {
  if (include && include.length > 0) {
    const result: Record<string, unknown> = {};
    for (const field of include) {
      const val = getField(doc, field);
      if (val !== undefined) result[field] = val;
    }
    return result as T;
  }
  if (exclude && exclude.length > 0) {
    const result = { ...doc };
    for (const field of exclude) {
      delete (result as Record<string, unknown>)[field];
    }
    return result;
  }
  return doc;
}

/** Compute a single aggregate function over a set of values. */
function computeAggregate(values: unknown[], agg: AggregateClause): unknown {
  const nums = values.filter((v): v is number => typeof v === 'number');

  switch (agg.function) {
    case 'count':
      return values.length;
    case 'sum':
      return nums.reduce((s, n) => s + n, 0);
    case 'avg':
      return nums.length > 0 ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
    case 'min':
      return nums.length > 0 ? Math.min(...nums) : null;
    case 'max':
      return nums.length > 0 ? Math.max(...nums) : null;
    default:
      return null;
  }
}

/**
 * JavaScript fallback query engine.
 *
 * Implements the full QueryEngine interface using pure JS. Used both
 * as the fallback when Wasm is unavailable and as the reference
 * implementation for correctness testing.
 */
export class JsQueryEngine implements QueryEngine {
  execute<T extends Record<string, unknown>>(
    documents: readonly T[],
    plan: QueryPlan
  ): QueryResult<T> {
    const start = performance.now();

    // 1. Filter
    let results: T[] = plan.filter
      ? documents.filter((doc) => evaluateFilter(doc, plan.filter!))
      : [...documents];

    const totalMatched = results.length;

    // 2. Sort
    if (plan.sort && plan.sort.length > 0) {
      results = sortDocuments(results, plan.sort);
    }

    // 3. Skip
    if (plan.skip && plan.skip > 0) {
      results = results.slice(plan.skip);
    }

    // 4. Limit
    if (plan.limit !== undefined && plan.limit >= 0) {
      results = results.slice(0, plan.limit);
    }

    // 5. Projection
    if (plan.projection) {
      results = results.map((doc) =>
        applyProjection(doc, plan.projection!.include, plan.projection!.exclude)
      );
    }

    return {
      documents: results,
      totalMatched,
      executionTimeMs: performance.now() - start,
      engine: 'js',
    };
  }

  aggregate(
    documents: readonly Record<string, unknown>[],
    groupBy: GroupByClause,
    filter?: FilterCondition | FilterGroup
  ): AggregateResult {
    const start = performance.now();

    // 1. Apply filter
    const filtered = filter ? documents.filter((doc) => evaluateFilter(doc, filter)) : documents;

    // 2. Group
    const groupMap = new Map<string, Record<string, unknown>[]>();
    for (const doc of filtered) {
      const key = groupBy.fields.map((f) => JSON.stringify(getField(doc, f))).join('|');
      const group = groupMap.get(key);
      if (group) {
        group.push(doc);
      } else {
        groupMap.set(key, [doc]);
      }
    }

    // 3. Compute aggregates per group
    const groups: Record<string, unknown>[] = [];
    for (const [, groupDocs] of groupMap) {
      const row: Record<string, unknown> = {};

      // Add group-by field values from the first doc
      for (const field of groupBy.fields) {
        row[field] = getField(groupDocs[0]!, field);
      }

      // Compute each aggregate
      for (const agg of groupBy.aggregates) {
        const values = agg.field ? groupDocs.map((d) => getField(d, agg.field!)) : groupDocs;
        row[agg.alias] = computeAggregate(values, agg);
      }

      groups.push(row);
    }

    return {
      groups,
      executionTimeMs: performance.now() - start,
      engine: 'js',
    };
  }
}

export function createJsQueryEngine(): JsQueryEngine {
  return new JsQueryEngine();
}
