import { describe, it, expect } from 'vitest';
import { QueryBuilder, createQueryBuilder } from '../query-builder.js';
import { QueryOptimizer } from '../query-optimizer.js';
import { QuerySerializer } from '../query-serializer.js';
import type { QueryPlan } from '../types.js';

describe('QueryBuilder', () => {
  it('should set collection name', () => {
    const plan = new QueryBuilder('users').build();
    expect(plan.collection).toBe('users');
  });

  it('should set collection name via collection()', () => {
    const plan = new QueryBuilder().collection('orders').build();
    expect(plan.collection).toBe('orders');
  });

  it('should build basic query with where clause', () => {
    const plan = createQueryBuilder('users')
      .where('status', 'eq', 'active')
      .build();

    expect(plan.collection).toBe('users');
    expect(plan.where).toBeDefined();
    expect(plan.where!.operator).toBe('and');
    expect(plan.where!.conditions).toHaveLength(1);

    const condition = plan.where!.conditions[0] as { field: string; operator: string; value: unknown };
    expect(condition.field).toBe('status');
    expect(condition.operator).toBe('eq');
    expect(condition.value).toBe('active');
  });

  it('should chain multiple where conditions', () => {
    const plan = createQueryBuilder('users')
      .where('status', 'eq', 'active')
      .where('age', 'gte', 18)
      .build();

    expect(plan.where!.conditions).toHaveLength(2);

    const first = plan.where!.conditions[0] as { field: string };
    const second = plan.where!.conditions[1] as { field: string };
    expect(first.field).toBe('status');
    expect(second.field).toBe('age');
  });

  it('should add sort clauses', () => {
    const plan = createQueryBuilder('users')
      .orderBy('name', 'asc')
      .orderBy('createdAt', 'desc')
      .build();

    expect(plan.sort).toHaveLength(2);
    expect(plan.sort![0]).toEqual({ field: 'name', direction: 'asc' });
    expect(plan.sort![1]).toEqual({ field: 'createdAt', direction: 'desc' });
  });

  it('should default sort direction to asc', () => {
    const plan = createQueryBuilder('users')
      .orderBy('name')
      .build();

    expect(plan.sort![0].direction).toBe('asc');
  });

  it('should set limit and skip (pagination)', () => {
    const plan = createQueryBuilder('users')
      .limit(10)
      .skip(20)
      .build();

    expect(plan.pagination).toBeDefined();
    expect(plan.pagination!.limit).toBe(10);
    expect(plan.pagination!.skip).toBe(20);
  });

  it('should add aggregate functions (count, sum, avg, min, max)', () => {
    const plan = createQueryBuilder('orders')
      .count('id', 'totalOrders')
      .sum('amount', 'totalAmount')
      .avg('amount', 'avgAmount')
      .min('amount', 'minAmount')
      .max('amount', 'maxAmount')
      .build();

    expect(plan.aggregates).toHaveLength(5);
    expect(plan.aggregates![0]).toEqual({ function: 'count', field: 'id', alias: 'totalOrders' });
    expect(plan.aggregates![1]).toEqual({ function: 'sum', field: 'amount', alias: 'totalAmount' });
    expect(plan.aggregates![2]).toEqual({ function: 'avg', field: 'amount', alias: 'avgAmount' });
    expect(plan.aggregates![3]).toEqual({ function: 'min', field: 'amount', alias: 'minAmount' });
    expect(plan.aggregates![4]).toEqual({ function: 'max', field: 'amount', alias: 'maxAmount' });
  });

  it('should select specific fields', () => {
    const plan = createQueryBuilder('users')
      .select('name', 'email', 'age')
      .build();

    expect(plan.select).toBeDefined();
    expect(plan.select!.fields).toEqual(['name', 'email', 'age']);
  });

  it('should clone without modifying original', () => {
    const original = createQueryBuilder('users')
      .where('status', 'eq', 'active');

    const cloned = original.clone().orderBy('name').limit(5);

    const originalPlan = original.build();
    const clonedPlan = cloned.build();

    expect(originalPlan.sort).toBeUndefined();
    expect(originalPlan.pagination).toBeUndefined();
    expect(clonedPlan.sort).toHaveLength(1);
    expect(clonedPlan.pagination!.limit).toBe(5);
    // Both share same where conditions
    expect(clonedPlan.where!.conditions).toHaveLength(1);
  });

  it('should reset all state', () => {
    const builder = createQueryBuilder('users')
      .select('name')
      .where('status', 'eq', 'active')
      .orderBy('name')
      .limit(10)
      .skip(5)
      .count('id');

    builder.reset().collection('products');
    const plan = builder.build();

    expect(plan.collection).toBe('products');
    expect(plan.select).toBeUndefined();
    expect(plan.where).toBeUndefined();
    expect(plan.sort).toBeUndefined();
    expect(plan.pagination).toBeUndefined();
    expect(plan.aggregates).toBeUndefined();
  });

  it('should build complete query plan from fluent chain', () => {
    const plan = createQueryBuilder('products')
      .select('name', 'price', 'category')
      .where('price', 'gte', 10)
      .where('category', 'eq', 'electronics')
      .orderBy('price', 'desc')
      .limit(20)
      .skip(0)
      .build();

    expect(plan.collection).toBe('products');
    expect(plan.select!.fields).toEqual(['name', 'price', 'category']);
    expect(plan.where!.conditions).toHaveLength(2);
    expect(plan.sort).toEqual([{ field: 'price', direction: 'desc' }]);
    expect(plan.pagination).toEqual({ limit: 20, skip: 0 });
    expect(plan.aggregates).toBeUndefined();
  });

  it('should throw when building without collection', () => {
    expect(() => new QueryBuilder().build()).toThrow('Collection name is required');
  });
});

describe('QueryOptimizer', () => {
  const optimizer = new QueryOptimizer();

  it('should suggest indexes for filtered fields', () => {
    const plan: QueryPlan = {
      collection: 'users',
      where: {
        operator: 'and',
        conditions: [
          { field: 'email', operator: 'eq', value: 'test@example.com' },
        ],
      },
    };

    const suggestions = optimizer.suggestIndexes(plan);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].fields).toContain('email');
    expect(suggestions[0].type).toBe('single');
  });

  it('should detect low complexity for simple queries', () => {
    const plan: QueryPlan = {
      collection: 'users',
      where: {
        operator: 'and',
        conditions: [
          { field: 'status', operator: 'eq', value: 'active' },
        ],
      },
      pagination: { limit: 10 },
    };

    const complexity = optimizer.estimateComplexity(plan);
    expect(complexity).toBe('low');
  });

  it('should detect high complexity for multi-condition queries', () => {
    const plan: QueryPlan = {
      collection: 'users',
      where: {
        operator: 'and',
        conditions: [
          { field: 'status', operator: 'eq', value: 'active' },
          { field: 'name', operator: 'contains', value: 'john' },
          { field: 'age', operator: 'between', value: [18, 65] },
        ],
      },
      sort: [{ field: 'name', direction: 'asc' }],
      aggregates: [{ function: 'count', field: '*' }],
    };

    const complexity = optimizer.estimateComplexity(plan);
    expect(complexity).toBe('high');
  });

  it('should suggest compound indexes for multi-field filters', () => {
    const plan: QueryPlan = {
      collection: 'users',
      where: {
        operator: 'and',
        conditions: [
          { field: 'status', operator: 'eq', value: 'active' },
          { field: 'role', operator: 'eq', value: 'admin' },
        ],
      },
    };

    const suggestions = optimizer.suggestIndexes(plan);
    const compound = suggestions.find((s) => s.type === 'compound');
    expect(compound).toBeDefined();
    expect(compound!.fields).toContain('status');
    expect(compound!.fields).toContain('role');
  });
});

describe('QuerySerializer', () => {
  const serializer = new QuerySerializer();

  const samplePlan: QueryPlan = {
    collection: 'users',
    select: { fields: ['name', 'email'] },
    where: {
      operator: 'and',
      conditions: [
        { field: 'status', operator: 'eq', value: 'active' },
      ],
    },
    sort: [{ field: 'name', direction: 'asc' }],
    pagination: { limit: 10 },
  };

  it('should serialize and deserialize query plan (round-trip)', () => {
    const json = serializer.serialize(samplePlan);
    const restored = serializer.deserialize(json);

    expect(restored.collection).toBe(samplePlan.collection);
    expect(restored.select).toEqual(samplePlan.select);
    expect(restored.where).toEqual(samplePlan.where);
    expect(restored.sort).toEqual(samplePlan.sort);
    expect(restored.pagination).toEqual(samplePlan.pagination);
  });

  it('should generate readable SQL-like string', () => {
    const sql = serializer.toSQL(samplePlan);

    expect(sql).toContain('SELECT name, email');
    expect(sql).toContain('FROM users');
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain('ORDER BY name ASC');
    expect(sql).toContain('LIMIT 10');
  });

  it('should generate TypeScript code', () => {
    const code = serializer.toCode(samplePlan);

    expect(code).toContain("createQueryBuilder('users')");
    expect(code).toContain(".select('name', 'email')");
    expect(code).toContain(".where('status', 'eq', 'active')");
    expect(code).toContain(".orderBy('name', 'asc')");
    expect(code).toContain('.limit(10)');
    expect(code).toContain('.build()');
  });

  it('should generate human-readable description', () => {
    const readable = serializer.toReadable(samplePlan);

    expect(readable).toContain('users');
    expect(readable).toContain('status');
    expect(readable).toContain('active');
    expect(readable).toContain('name');
    expect(readable).toContain('limit 10');
  });

  it('should throw on invalid JSON deserialization', () => {
    expect(() => serializer.deserialize('{"foo":"bar"}')).toThrow('missing collection');
  });
});
