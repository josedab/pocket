import { describe, expect, it } from 'vitest';
import { createJsQueryEngine, createQueryCache, createWasmEngine } from '../index.js';
import type { FilterCondition, FilterGroup, QueryPlan } from '../types.js';

const SAMPLE_DOCS = [
  { _id: '1', name: 'Alice', age: 30, role: 'admin', score: 95 },
  { _id: '2', name: 'Bob', age: 25, role: 'user', score: 80 },
  { _id: '3', name: 'Charlie', age: 35, role: 'admin', score: 88 },
  { _id: '4', name: 'Diana', age: 28, role: 'user', score: 92 },
  { _id: '5', name: 'Eve', age: 22, role: 'user', score: 70 },
];

describe('JsQueryEngine', () => {
  const engine = createJsQueryEngine();

  describe('filtering', () => {
    it('should filter with eq operator', () => {
      const plan: QueryPlan = {
        filter: { field: 'role', operator: 'eq', value: 'admin' },
      };
      const result = engine.execute(SAMPLE_DOCS, plan);
      expect(result.documents).toHaveLength(2);
      expect(result.totalMatched).toBe(2);
      expect(result.engine).toBe('js');
      expect(result.documents.map((d) => d.name)).toEqual(['Alice', 'Charlie']);
    });

    it('should filter with gt operator', () => {
      const plan: QueryPlan = {
        filter: { field: 'age', operator: 'gt', value: 28 },
      };
      const result = engine.execute(SAMPLE_DOCS, plan);
      expect(result.documents).toHaveLength(2);
      expect(result.documents.map((d) => d.name)).toEqual(['Alice', 'Charlie']);
    });

    it('should filter with in operator', () => {
      const plan: QueryPlan = {
        filter: { field: 'name', operator: 'in', value: ['Alice', 'Eve'] },
      };
      const result = engine.execute(SAMPLE_DOCS, plan);
      expect(result.documents).toHaveLength(2);
    });

    it('should filter with contains operator', () => {
      const plan: QueryPlan = {
        filter: { field: 'name', operator: 'contains', value: 'li' },
      };
      const result = engine.execute(SAMPLE_DOCS, plan);
      expect(result.documents).toHaveLength(2); // Alice, Charlie
    });

    it('should handle AND filter groups', () => {
      const filter: FilterGroup = {
        logic: 'and',
        conditions: [
          { field: 'role', operator: 'eq', value: 'user' } as FilterCondition,
          { field: 'age', operator: 'gte', value: 25 } as FilterCondition,
        ],
      };
      const result = engine.execute(SAMPLE_DOCS, { filter });
      expect(result.documents).toHaveLength(2); // Bob(25), Diana(28)
    });

    it('should handle OR filter groups', () => {
      const filter: FilterGroup = {
        logic: 'or',
        conditions: [
          { field: 'name', operator: 'eq', value: 'Alice' } as FilterCondition,
          { field: 'name', operator: 'eq', value: 'Eve' } as FilterCondition,
        ],
      };
      const result = engine.execute(SAMPLE_DOCS, { filter });
      expect(result.documents).toHaveLength(2);
    });
  });

  describe('sorting', () => {
    it('should sort ascending by field', () => {
      const plan: QueryPlan = {
        sort: [{ field: 'age', direction: 'asc' }],
      };
      const result = engine.execute(SAMPLE_DOCS, plan);
      expect(result.documents.map((d) => d.age)).toEqual([22, 25, 28, 30, 35]);
    });

    it('should sort descending by field', () => {
      const plan: QueryPlan = {
        sort: [{ field: 'score', direction: 'desc' }],
      };
      const result = engine.execute(SAMPLE_DOCS, plan);
      expect(result.documents.map((d) => d.score)).toEqual([95, 92, 88, 80, 70]);
    });

    it('should handle multi-field sort', () => {
      const plan: QueryPlan = {
        sort: [
          { field: 'role', direction: 'asc' },
          { field: 'age', direction: 'desc' },
        ],
      };
      const result = engine.execute(SAMPLE_DOCS, plan);
      expect(result.documents.map((d) => d.name)).toEqual([
        'Charlie',
        'Alice', // admins, age desc
        'Diana',
        'Bob',
        'Eve', // users, age desc
      ]);
    });
  });

  describe('pagination', () => {
    it('should apply skip', () => {
      const plan: QueryPlan = { skip: 3 };
      const result = engine.execute(SAMPLE_DOCS, plan);
      expect(result.documents).toHaveLength(2);
      expect(result.totalMatched).toBe(5);
    });

    it('should apply limit', () => {
      const plan: QueryPlan = { limit: 2 };
      const result = engine.execute(SAMPLE_DOCS, plan);
      expect(result.documents).toHaveLength(2);
      expect(result.totalMatched).toBe(5);
    });

    it('should apply skip + limit', () => {
      const plan: QueryPlan = {
        sort: [{ field: 'age', direction: 'asc' }],
        skip: 1,
        limit: 2,
      };
      const result = engine.execute(SAMPLE_DOCS, plan);
      expect(result.documents.map((d) => d.name)).toEqual(['Bob', 'Diana']);
    });
  });

  describe('projection', () => {
    it('should include only specified fields', () => {
      const plan: QueryPlan = {
        projection: { include: ['name', 'age'] },
        limit: 1,
      };
      const result = engine.execute(SAMPLE_DOCS, plan);
      expect(Object.keys(result.documents[0]!)).toEqual(['name', 'age']);
    });

    it('should exclude specified fields', () => {
      const plan: QueryPlan = {
        projection: { exclude: ['score', 'role'] },
        limit: 1,
      };
      const result = engine.execute(SAMPLE_DOCS, plan);
      expect(result.documents[0]).toHaveProperty('name');
      expect(result.documents[0]).not.toHaveProperty('score');
    });
  });

  describe('aggregation', () => {
    it('should group and count', () => {
      const result = engine.aggregate(SAMPLE_DOCS, {
        fields: ['role'],
        aggregates: [{ function: 'count', alias: 'total' }],
      });
      expect(result.groups).toHaveLength(2);
      const adminGroup = result.groups.find((g) => g['role'] === 'admin');
      expect(adminGroup?.['total']).toBe(2);
    });

    it('should compute sum and avg', () => {
      const result = engine.aggregate(SAMPLE_DOCS, {
        fields: ['role'],
        aggregates: [
          { function: 'sum', field: 'score', alias: 'totalScore' },
          { function: 'avg', field: 'age', alias: 'avgAge' },
        ],
      });
      const userGroup = result.groups.find((g) => g['role'] === 'user');
      expect(userGroup?.['totalScore']).toBe(242); // 80+92+70
      expect(userGroup?.['avgAge']).toBe(25); // (25+28+22)/3
    });

    it('should compute min and max', () => {
      const result = engine.aggregate(SAMPLE_DOCS, {
        fields: ['role'],
        aggregates: [
          { function: 'min', field: 'score', alias: 'minScore' },
          { function: 'max', field: 'score', alias: 'maxScore' },
        ],
      });
      const adminGroup = result.groups.find((g) => g['role'] === 'admin');
      expect(adminGroup?.['minScore']).toBe(88);
      expect(adminGroup?.['maxScore']).toBe(95);
    });

    it('should apply filter before aggregating', () => {
      const result = engine.aggregate(
        SAMPLE_DOCS,
        {
          fields: ['role'],
          aggregates: [{ function: 'count', alias: 'n' }],
        },
        { field: 'age', operator: 'gte', value: 28 }
      );
      // Only Alice(30,admin), Charlie(35,admin), Diana(28,user)
      const adminGroup = result.groups.find((g) => g['role'] === 'admin');
      expect(adminGroup?.['n']).toBe(2);
    });
  });
});

describe('QueryCache', () => {
  it('should cache and retrieve results', () => {
    const cache = createQueryCache<string>(10, 5000);
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return undefined for missing keys', () => {
    const cache = createQueryCache<string>(10, 5000);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('should evict oldest when at capacity', () => {
    const cache = createQueryCache<string>(2, 60000);
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    cache.set('k3', 'v3'); // evicts k1
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.get('k3')).toBe('v3');
  });

  it('should track hit rate', () => {
    const cache = createQueryCache<string>(10, 60000);
    cache.set('k1', 'v1');
    cache.get('k1'); // hit
    cache.get('k2'); // miss
    expect(cache.hitRate).toBe(0.5);
  });
});

describe('WasmQueryOrchestrator', () => {
  it('should initialize without errors', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();
    expect(engine.isWasmAvailable).toBe(false); // no wasm binary provided
  });

  it('should execute queries via JS fallback', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const result = await engine.execute(SAMPLE_DOCS, {
      filter: { field: 'role', operator: 'eq', value: 'admin' },
      sort: [{ field: 'name', direction: 'asc' }],
    });

    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]!.name).toBe('Alice');
  });

  it('should cache repeat queries', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const plan: QueryPlan = {
      filter: { field: 'age', operator: 'gt', value: 25 },
    };

    await engine.execute(SAMPLE_DOCS, plan);
    await engine.execute(SAMPLE_DOCS, plan); // should hit cache

    const metrics = engine.getMetrics();
    expect(metrics.queriesExecuted).toBe(1); // only 1 real execution
    expect(metrics.cacheHitRate).toBeGreaterThan(0);
  });

  it('should invalidate cache', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const plan: QueryPlan = { limit: 3 };
    await engine.execute(SAMPLE_DOCS, plan);
    engine.invalidateCache();
    await engine.execute(SAMPLE_DOCS, plan);

    expect(engine.getMetrics().queriesExecuted).toBe(2);
  });

  it('should run aggregations', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();

    const result = await engine.aggregate(SAMPLE_DOCS, {
      fields: ['role'],
      aggregates: [{ function: 'avg', field: 'score', alias: 'avgScore' }],
    });

    expect(result.groups).toHaveLength(2);
    const adminAvg = result.groups.find((g) => g['role'] === 'admin');
    expect(adminAvg?.['avgScore']).toBeCloseTo(91.5);
  });

  it('should clean up on destroy', async () => {
    const engine = createWasmEngine({ enableWorker: false });
    await engine.initialize();
    engine.destroy();
    // Should not throw
  });
});
