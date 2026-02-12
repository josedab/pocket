/**
 * Result Aggregator - Merges and processes results from distributed sub-queries
 */

import type { AggregationSpec, QueryResult } from './types.js';

/**
 * Aggregates partial results from multiple nodes into a unified result
 */
export class ResultAggregator {
  /**
   * Merge multiple partial query results into one
   */
  merge(results: QueryResult[]): QueryResult {
    const startTime = Date.now();

    const respondedNodes: string[] = [];
    const failedNodes: string[] = [];
    let data: unknown[] = [];
    const aggregationResult: Record<string, number> = {};

    for (const result of results) {
      data = data.concat(result.data);
      respondedNodes.push(...result.respondedNodes);
      failedNodes.push(...result.failedNodes);

      if (result.aggregationResult) {
        for (const [key, value] of Object.entries(result.aggregationResult)) {
          aggregationResult[key] = (aggregationResult[key] ?? 0) + value;
        }
      }
    }

    const queryId = results.length > 0 ? results[0]!.queryId : '';

    return {
      queryId,
      data,
      aggregationResult: Object.keys(aggregationResult).length > 0 ? aggregationResult : undefined,
      respondedNodes: [...new Set(respondedNodes)],
      failedNodes: [...new Set(failedNodes)],
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Apply an aggregation function to a data set
   */
  aggregate(data: unknown[], spec: AggregationSpec): Record<string, number> {
    const groups = this.groupData(data, spec.groupBy);
    const result: Record<string, number> = {};

    for (const [groupKey, items] of Object.entries(groups)) {
      result[groupKey] = this.applyAggregation(items, spec);
    }

    return result;
  }

  /**
   * Sort data by the given sort specification
   */
  sort(data: unknown[], sortSpec: Record<string, 'asc' | 'desc'>): unknown[] {
    const entries = Object.entries(sortSpec);
    if (entries.length === 0) return data;

    return [...data].sort((a, b) => {
      for (const [field, direction] of entries) {
        const aVal = (a as Record<string, unknown>)[field];
        const bVal = (b as Record<string, unknown>)[field];

        if (aVal === bVal) continue;
        if (aVal == null) return direction === 'asc' ? -1 : 1;
        if (bVal == null) return direction === 'asc' ? 1 : -1;

        const cmp = aVal < bVal ? -1 : 1;
        return direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  /**
   * Remove duplicate entries from data
   */
  dedup(data: unknown[], keyField?: string): unknown[] {
    const seen = new Set<string>();
    const result: unknown[] = [];

    for (const item of data) {
      const key = keyField
        ? String((item as Record<string, unknown>)[keyField])
        : JSON.stringify(item);

      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    return result;
  }

  /**
   * Apply a limit to the data set
   */
  applyLimit(data: unknown[], limit: number): unknown[] {
    return data.slice(0, limit);
  }

  /**
   * Group data by a field value
   */
  private groupData(data: unknown[], groupBy?: string): Record<string, unknown[]> {
    if (!groupBy) {
      return { _all: data };
    }

    const groups: Record<string, unknown[]> = {};
    for (const item of data) {
      const key = String((item as Record<string, unknown>)[groupBy] ?? '_null');
      groups[key] ??= [];
      groups[key]!.push(item);
    }

    return groups;
  }

  /**
   * Apply an aggregation function to a set of items
   */
  private applyAggregation(items: unknown[], spec: AggregationSpec): number {
    const values = items
      .map((item) => (item as Record<string, unknown>)[spec.field])
      .filter((v): v is number => typeof v === 'number');

    switch (spec.function) {
      case 'count':
        return items.length;

      case 'sum':
        return values.reduce((acc, v) => acc + v, 0);

      case 'avg':
        return values.length > 0 ? values.reduce((acc, v) => acc + v, 0) / values.length : 0;

      case 'min':
        return values.length > 0 ? Math.min(...values) : 0;

      case 'max':
        return values.length > 0 ? Math.max(...values) : 0;
    }
  }
}

/**
 * Create a result aggregator
 */
export function createResultAggregator(): ResultAggregator {
  return new ResultAggregator();
}
