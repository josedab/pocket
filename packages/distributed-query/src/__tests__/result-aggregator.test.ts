import { describe, it, expect, beforeEach } from 'vitest';
import { ResultAggregator, createResultAggregator } from '../result-aggregator.js';
import type { AggregationSpec, QueryResult } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    queryId: overrides.queryId ?? 'q-1',
    data: overrides.data ?? [],
    respondedNodes: overrides.respondedNodes ?? ['node-1'],
    failedNodes: overrides.failedNodes ?? [],
    executionTimeMs: overrides.executionTimeMs ?? 10,
    aggregationResult: overrides.aggregationResult,
  };
}

/* ================================================================== */
/*  ResultAggregator                                                   */
/* ================================================================== */

describe('ResultAggregator', () => {
  let aggregator: ResultAggregator;

  beforeEach(() => {
    aggregator = createResultAggregator();
  });

  describe('merge', () => {
    it('should merge results from multiple nodes', () => {
      const r1 = makeResult({ data: [{ id: 1 }], respondedNodes: ['n1'] });
      const r2 = makeResult({ data: [{ id: 2 }], respondedNodes: ['n2'] });

      const merged = aggregator.merge([r1, r2]);
      expect(merged.data).toHaveLength(2);
      expect(merged.respondedNodes).toEqual(expect.arrayContaining(['n1', 'n2']));
      expect(merged.failedNodes).toHaveLength(0);
    });

    it('should merge aggregation results additively', () => {
      const r1 = makeResult({ aggregationResult: { total: 100 }, respondedNodes: ['n1'] });
      const r2 = makeResult({ aggregationResult: { total: 200 }, respondedNodes: ['n2'] });

      const merged = aggregator.merge([r1, r2]);
      expect(merged.aggregationResult).toEqual({ total: 300 });
    });

    it('should deduplicate responded and failed nodes', () => {
      const r1 = makeResult({ respondedNodes: ['n1'], failedNodes: ['n3'] });
      const r2 = makeResult({ respondedNodes: ['n1'], failedNodes: ['n3'] });

      const merged = aggregator.merge([r1, r2]);
      expect(merged.respondedNodes).toEqual(['n1']);
      expect(merged.failedNodes).toEqual(['n3']);
    });
  });

  describe('aggregate', () => {
    const data = [
      { category: 'A', amount: 10 },
      { category: 'A', amount: 20 },
      { category: 'B', amount: 30 },
    ];

    it('should compute sum aggregation', () => {
      const spec: AggregationSpec = { function: 'sum', field: 'amount' };
      const result = aggregator.aggregate(data, spec);
      expect(result._all).toBe(60);
    });

    it('should compute average aggregation', () => {
      const spec: AggregationSpec = { function: 'avg', field: 'amount' };
      const result = aggregator.aggregate(data, spec);
      expect(result._all).toBe(20);
    });

    it('should compute min aggregation', () => {
      const spec: AggregationSpec = { function: 'min', field: 'amount' };
      const result = aggregator.aggregate(data, spec);
      expect(result._all).toBe(10);
    });

    it('should compute max aggregation', () => {
      const spec: AggregationSpec = { function: 'max', field: 'amount' };
      const result = aggregator.aggregate(data, spec);
      expect(result._all).toBe(30);
    });

    it('should compute count aggregation', () => {
      const spec: AggregationSpec = { function: 'count', field: 'amount' };
      const result = aggregator.aggregate(data, spec);
      expect(result._all).toBe(3);
    });

    it('should aggregate with groupBy', () => {
      const spec: AggregationSpec = { function: 'sum', field: 'amount', groupBy: 'category' };
      const result = aggregator.aggregate(data, spec);
      expect(result.A).toBe(30);
      expect(result.B).toBe(30);
    });
  });

  describe('dedup', () => {
    it('should remove duplicates by key field', () => {
      const data = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
        { id: '1', name: 'Alice duplicate' },
      ];

      const result = aggregator.dedup(data, 'id');
      expect(result).toHaveLength(2);
      expect((result[0] as Record<string, unknown>).name).toBe('Alice');
    });

    it('should remove duplicates by full object comparison', () => {
      const data = [{ a: 1 }, { a: 2 }, { a: 1 }];

      const result = aggregator.dedup(data);
      expect(result).toHaveLength(2);
    });
  });

  describe('sort', () => {
    it('should sort results ascending', () => {
      const data = [{ val: 3 }, { val: 1 }, { val: 2 }];

      const sorted = aggregator.sort(data, { val: 'asc' });
      expect((sorted[0] as Record<string, unknown>).val).toBe(1);
      expect((sorted[2] as Record<string, unknown>).val).toBe(3);
    });

    it('should sort results descending', () => {
      const data = [{ val: 1 }, { val: 3 }, { val: 2 }];

      const sorted = aggregator.sort(data, { val: 'desc' });
      expect((sorted[0] as Record<string, unknown>).val).toBe(3);
      expect((sorted[2] as Record<string, unknown>).val).toBe(1);
    });
  });

  describe('applyLimit', () => {
    it('should limit results', () => {
      const data = [1, 2, 3, 4, 5];
      expect(aggregator.applyLimit(data, 3)).toEqual([1, 2, 3]);
    });

    it('should return all data when limit exceeds length', () => {
      const data = [1, 2];
      expect(aggregator.applyLimit(data, 10)).toEqual([1, 2]);
    });
  });
});
