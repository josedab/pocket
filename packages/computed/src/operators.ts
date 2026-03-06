/**
 * @pocket/computed — Built-in compute operators: joins, aggregations, transforms.
 *
 * @module @pocket/computed
 */

import type { AggregationConfig, AggregationField, ComputeFunction, JoinConfig } from './types.js';

// ── Join Operator ─────────────────────────────────────────

/**
 * Create a compute function that joins two source collections.
 *
 * ```ts
 * manager.addComputed({
 *   name: 'user-orders',
 *   sources: ['users', 'orders'],
 *   compute: join({
 *     leftSource: 'users',
 *     rightSource: 'orders',
 *     leftKey: 'id',
 *     rightKey: 'userId',
 *     type: 'inner',
 *   }),
 * });
 * ```
 */
export function join(config: JoinConfig): ComputeFunction {
  return (sources) => {
    const left = sources[config.leftSource] ?? [];
    const right = sources[config.rightSource] ?? [];

    // Build right index for O(n) lookups
    const rightIndex = new Map<unknown, Record<string, unknown>[]>();
    for (const doc of right) {
      const key = doc[config.rightKey];
      if (!rightIndex.has(key)) rightIndex.set(key, []);
      rightIndex.get(key)!.push(doc);
    }

    const results: Record<string, unknown>[] = [];
    const matchedRight = new Set<Record<string, unknown>>();
    const selectFn = config.select ?? defaultJoinSelect;

    for (const leftDoc of left) {
      const key = leftDoc[config.leftKey];
      const matches = rightIndex.get(key) ?? [];

      if (matches.length > 0) {
        for (const rightDoc of matches) {
          results.push(selectFn(leftDoc, rightDoc));
          matchedRight.add(rightDoc);
        }
      } else if (config.type === 'left' || config.type === 'full') {
        results.push(selectFn(leftDoc, null));
      }
    }

    if (config.type === 'right' || config.type === 'full') {
      for (const rightDoc of right) {
        if (!matchedRight.has(rightDoc)) {
          results.push(selectFn({}, rightDoc));
        }
      }
    }

    return results;
  };
}

function defaultJoinSelect(
  left: Record<string, unknown>,
  right: Record<string, unknown> | null,
): Record<string, unknown> {
  return { ...left, ...(right ?? {}) };
}

// ── Aggregation Operator ──────────────────────────────────

/**
 * Create a compute function that aggregates source data.
 *
 * ```ts
 * manager.addComputed({
 *   name: 'order-stats',
 *   sources: ['orders'],
 *   compute: aggregate({
 *     source: 'orders',
 *     groupBy: 'status',
 *     aggregations: [
 *       { field: '*', operation: 'count', alias: 'total' },
 *       { field: 'amount', operation: 'sum', alias: 'totalAmount' },
 *     ],
 *   }),
 * });
 * ```
 */
export function aggregate(config: AggregationConfig): ComputeFunction {
  return (sources) => {
    const data = sources[config.source] ?? [];

    if (!config.groupBy) {
      return [computeAggregations(data, config.aggregations, { _group: '__all__' })];
    }

    const groupKeys = Array.isArray(config.groupBy) ? config.groupBy : [config.groupBy];
    const groups = new Map<string, Record<string, unknown>[]>();

    for (const doc of data) {
      const key = groupKeys.map((k) => String(doc[k] ?? 'null')).join('::');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(doc);
    }

    const results: Record<string, unknown>[] = [];
    for (const [key, groupDocs] of groups) {
      const groupFields: Record<string, unknown> = {};
      const keyParts = key.split('::');
      for (let i = 0; i < groupKeys.length; i++) {
        groupFields[groupKeys[i]!] = keyParts[i];
      }
      results.push(computeAggregations(groupDocs, config.aggregations, groupFields));
    }

    return results;
  };
}

function computeAggregations(
  docs: Record<string, unknown>[],
  aggregations: AggregationField[],
  baseFields: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...baseFields };

  for (const agg of aggregations) {
    const alias = agg.alias ?? `${agg.operation}_${agg.field}`;
    const values = agg.field === '*'
      ? docs.map(() => 1)
      : docs.map((d) => d[agg.field]).filter((v) => v !== undefined && v !== null);

    switch (agg.operation) {
      case 'count':
        result[alias] = values.length;
        break;
      case 'sum':
        result[alias] = values.reduce<number>((s, v) => s + (Number(v) || 0), 0);
        break;
      case 'avg':
        result[alias] = values.length > 0
          ? values.reduce<number>((s, v) => s + (Number(v) || 0), 0) / values.length
          : 0;
        break;
      case 'min':
        result[alias] = values.length > 0 ? Math.min(...values.map(Number)) : null;
        break;
      case 'max':
        result[alias] = values.length > 0 ? Math.max(...values.map(Number)) : null;
        break;
      case 'first':
        result[alias] = values[0] ?? null;
        break;
      case 'last':
        result[alias] = values[values.length - 1] ?? null;
        break;
      case 'collect':
        result[alias] = values;
        break;
    }
  }

  return result;
}

// ── Transform Operators ───────────────────────────────────

/** Filter source documents */
export function filter(
  source: string,
  predicate: (doc: Record<string, unknown>) => boolean,
): ComputeFunction {
  return (sources) => (sources[source] ?? []).filter(predicate);
}

/** Map source documents */
export function transform(
  source: string,
  mapper: (doc: Record<string, unknown>) => Record<string, unknown>,
): ComputeFunction {
  return (sources) => (sources[source] ?? []).map(mapper);
}

/** Sort source documents */
export function sort(
  source: string,
  comparator: (a: Record<string, unknown>, b: Record<string, unknown>) => number,
): ComputeFunction {
  return (sources) => [...(sources[source] ?? [])].sort(comparator);
}

/** Union multiple source collections */
export function union(...sourceNames: string[]): ComputeFunction {
  return (sources) => {
    const result: Record<string, unknown>[] = [];
    for (const name of sourceNames) {
      result.push(...(sources[name] ?? []));
    }
    return result;
  };
}

/** Pipe multiple compute functions */
export function pipe(...fns: ComputeFunction[]): ComputeFunction {
  return (sources, context) => {
    let current = sources;
    let result: Record<string, unknown>[] = [];
    for (const fn of fns) {
      result = fn(current, context);
      current = { __pipe__: result };
    }
    return result;
  };
}
