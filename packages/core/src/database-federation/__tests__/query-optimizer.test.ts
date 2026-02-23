import { describe, expect, it } from 'vitest';
import type { FederatableDatabase } from '../database-registry.js';
import { FederatedQueryOptimizer, type FederatedRegistry } from '../query-optimizer.js';

function createMockDb(
  name: string,
  data: Record<string, Record<string, unknown>[]>
): FederatableDatabase {
  return {
    name,
    collection: <T extends Record<string, unknown>>(colName: string) => ({
      find: (filter?: Record<string, unknown>) => ({
        exec: async () => {
          const docs = (data[colName] ?? []) as T[];
          if (!filter || Object.keys(filter).length === 0) return docs;
          return docs.filter((d) =>
            Object.entries(filter).every(([k, v]) => (d as Record<string, unknown>)[k] === v)
          );
        },
      }),
    }),
  };
}

function createRegistry(dbs: Record<string, FederatableDatabase>): FederatedRegistry {
  return { get: (name) => dbs[name] };
}

describe('FederatedQueryOptimizer', () => {
  const optimizer = new FederatedQueryOptimizer();

  const smallUsers = Array.from({ length: 10 }, (_, i) => ({ _id: `u${i}`, name: `User ${i}` }));
  const smallOrders = Array.from({ length: 20 }, (_, i) => ({
    _id: `o${i}`,
    userId: `u${i % 10}`,
    amount: (i + 1) * 10,
  }));

  const largeUsers = Array.from({ length: 200 }, (_, i) => ({ _id: `u${i}`, name: `User ${i}` }));
  const largeOrders = Array.from({ length: 500 }, (_, i) => ({
    _id: `o${i}`,
    userId: `u${i % 200}`,
    amount: (i + 1) * 5,
  }));

  it('should choose nested-loop for small datasets', async () => {
    const reg = createRegistry({
      'users-db': createMockDb('users-db', { users: smallUsers }),
      'orders-db': createMockDb('orders-db', { orders: smallOrders }),
    });

    const plan = await optimizer.plan(reg, {
      from: { db: 'users-db', collection: 'users' },
      join: { db: 'orders-db', collection: 'orders', on: '_id', foreignKey: 'userId' },
    });

    expect(plan.strategy).toBe('nested-loop');
    expect(plan.steps.some((s) => s.operation === 'nested-loop')).toBe(true);
  });

  it('should choose hash-join for large datasets', async () => {
    const reg = createRegistry({
      'users-db': createMockDb('users-db', { users: largeUsers }),
      'orders-db': createMockDb('orders-db', { orders: largeOrders }),
    });

    const plan = await optimizer.plan(reg, {
      from: { db: 'users-db', collection: 'users' },
      join: { db: 'orders-db', collection: 'orders', on: '_id', foreignKey: 'userId' },
    });

    expect(plan.strategy).toBe('hash-join');
    expect(plan.steps.some((s) => s.operation === 'build-index')).toBe(true);
    expect(plan.steps.some((s) => s.operation === 'hash-join')).toBe(true);
  });

  it('should plan no-join for single table queries', async () => {
    const reg = createRegistry({
      db: createMockDb('db', { items: [{ _id: '1', v: 10 }] }),
    });

    const plan = await optimizer.plan(reg, {
      from: { db: 'db', collection: 'items' },
    });

    expect(plan.strategy).toBe('no-join');
    expect(plan.estimatedJoinCost).toBe(0);
  });

  it('should execute a planned hash join correctly', async () => {
    const reg = createRegistry({
      'users-db': createMockDb('users-db', { users: largeUsers }),
      'orders-db': createMockDb('orders-db', { orders: largeOrders }),
    });

    const plan = await optimizer.plan(reg, {
      from: { db: 'users-db', collection: 'users' },
      join: { db: 'orders-db', collection: 'orders', on: '_id', foreignKey: 'userId' },
      limit: 10,
    });

    const result = await optimizer.execute(reg, plan);
    expect(result.rows.length).toBeLessThanOrEqual(10);
    expect(result.sources).toEqual(['users-db', 'orders-db']);
    expect(result.joinedCount).toBeGreaterThan(0);
  });

  it('should execute a nested-loop join correctly', async () => {
    const reg = createRegistry({
      'users-db': createMockDb('users-db', { users: smallUsers }),
      'orders-db': createMockDb('orders-db', { orders: smallOrders }),
    });

    const plan = await optimizer.plan(reg, {
      from: { db: 'users-db', collection: 'users' },
      join: { db: 'orders-db', collection: 'orders', on: '_id', foreignKey: 'userId' },
    });

    const result = await optimizer.execute(reg, plan);
    expect(result.joinedCount).toBe(20); // each user has 2 orders
    expect(result.rows.length).toBe(20);
  });

  it('should include explanation in plan', async () => {
    const reg = createRegistry({
      db: createMockDb('db', { items: [{ _id: '1' }] }),
    });

    const plan = await optimizer.plan(reg, {
      from: { db: 'db', collection: 'items' },
    });

    expect(plan.explanation).toContain('scan');
    expect(plan.explanation.length).toBeGreaterThan(10);
  });

  it('should track optimizer stats', async () => {
    const freshOptimizer = new FederatedQueryOptimizer();
    const reg = createRegistry({
      db: createMockDb('db', { items: smallUsers }),
      db2: createMockDb('db2', { orders: smallOrders }),
    });

    await freshOptimizer.plan(reg, { from: { db: 'db', collection: 'items' } });
    await freshOptimizer.plan(reg, {
      from: { db: 'db', collection: 'items' },
      join: { db: 'db2', collection: 'orders', on: '_id' },
    });

    const stats = freshOptimizer.getStats();
    expect(stats.totalPlans).toBe(2);
    expect(stats.avgPlanTimeMs).toBeGreaterThanOrEqual(0);
  });
});
