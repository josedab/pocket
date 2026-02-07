import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMemoryAdapter } from '../memory-adapter.js';
import { QueryFederation, createQueryFederation } from '../query-federation.js';
import type { MemoryAdapter } from '../memory-adapter.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let federation: QueryFederation;
let usersAdapter: MemoryAdapter;
let ordersAdapter: MemoryAdapter;

beforeEach(async () => {
  federation = createQueryFederation({ queryTimeout: 5000 });
  usersAdapter = createMemoryAdapter('users-db');
  ordersAdapter = createMemoryAdapter('orders-db');

  await usersAdapter.connect();
  await ordersAdapter.connect();

  federation.registerAdapter(usersAdapter);
  federation.registerAdapter(ordersAdapter);
});

afterEach(async () => {
  await usersAdapter.disconnect();
  await ordersAdapter.disconnect();
});

/* ================================================================== */
/*  QueryFederation                                                    */
/* ================================================================== */

describe('QueryFederation', () => {
  describe('single adapter queries', () => {
    it('should execute a query against the default adapter', async () => {
      await usersAdapter.execute({
        source: 'users',
        operation: 'insert',
        data: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      });

      const fed = createQueryFederation({
        defaultAdapter: 'users-db',
        queryTimeout: 5000,
      });
      fed.registerAdapter(usersAdapter);

      const result = await fed.execute({
        source: 'users',
        operation: 'select',
      });

      expect(result.data).toHaveLength(2);
      expect(result.sources).toEqual(['users-db']);
    });

    it('should use the first registered adapter when no default is set', async () => {
      await usersAdapter.execute({
        source: 'users',
        operation: 'insert',
        data: { id: 1, name: 'Alice' },
      });

      const result = await federation.execute({
        source: 'users',
        operation: 'select',
      });

      expect(result.data).toHaveLength(1);
    });
  });

  describe('cross-adapter join', () => {
    beforeEach(async () => {
      await usersAdapter.execute({
        source: 'users',
        operation: 'insert',
        data: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' },
        ],
      });

      await ordersAdapter.execute({
        source: 'orders',
        operation: 'insert',
        data: [
          { orderId: 101, userId: 1, total: 50 },
          { orderId: 102, userId: 1, total: 75 },
          { orderId: 103, userId: 2, total: 30 },
        ],
      });
    });

    it('should perform an inner join across adapters', async () => {
      const fed = createQueryFederation({
        defaultAdapter: 'users-db',
        queryTimeout: 5000,
      });
      fed.registerAdapter(usersAdapter);
      fed.registerAdapter(ordersAdapter);

      const result = await fed.execute({
        source: 'users',
        operation: 'select',
        join: {
          targetAdapter: 'orders-db',
          targetCollection: 'orders',
          localField: 'id',
          foreignField: 'userId',
          type: 'inner',
        },
      });

      // Alice has 2 orders, Bob has 1, Charlie has 0 (excluded by inner join)
      expect(result.data).toHaveLength(3);
      expect(result.sources).toContain('users-db');
      expect(result.sources).toContain('orders-db');
    });

    it('should throw for a missing target adapter in join', async () => {
      const fed = createQueryFederation({
        defaultAdapter: 'users-db',
        queryTimeout: 5000,
      });
      fed.registerAdapter(usersAdapter);

      await expect(
        fed.execute({
          source: 'users',
          operation: 'select',
          join: {
            targetAdapter: 'nonexistent',
            targetCollection: 'orders',
            localField: 'id',
            foreignField: 'userId',
            type: 'inner',
          },
        }),
      ).rejects.toThrow('not found');
    });
  });

  describe('query planning', () => {
    it('should generate a plan for a simple query', () => {
      const fed = createQueryFederation({
        defaultAdapter: 'users-db',
        queryTimeout: 5000,
      });
      fed.registerAdapter(usersAdapter);

      const plan = fed.plan({
        source: 'users',
        operation: 'select',
        filter: { active: true },
      });

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].adapter).toBe('users-db');
      expect(plan.steps[0].operation).toBe('select');
      expect(plan.steps[0].filter).toEqual({ active: true });
      expect(plan.estimatedCost).toBe(1);
    });

    it('should generate a plan for a join query', () => {
      const fed = createQueryFederation({
        defaultAdapter: 'users-db',
        queryTimeout: 5000,
      });
      fed.registerAdapter(usersAdapter);
      fed.registerAdapter(ordersAdapter);

      const plan = fed.plan({
        source: 'users',
        operation: 'select',
        join: {
          targetAdapter: 'orders-db',
          targetCollection: 'orders',
          localField: 'id',
          foreignField: 'userId',
          type: 'inner',
        },
      });

      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[0].adapter).toBe('users-db');
      expect(plan.steps[1].adapter).toBe('orders-db');
      expect(plan.steps[2].operation).toBe('inner-join');
      expect(plan.estimatedCost).toBe(3);
    });
  });

  describe('health check', () => {
    it('should report health of all adapters', async () => {
      const health = await federation.healthCheck();

      expect(health['users-db']).toBe(true);
      expect(health['orders-db']).toBe(true);
    });

    it('should report unhealthy for disconnected adapters', async () => {
      await ordersAdapter.disconnect();

      const health = await federation.healthCheck();

      expect(health['users-db']).toBe(true);
      expect(health['orders-db']).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should throw when no adapters are registered', async () => {
      const emptyFed = createQueryFederation({ queryTimeout: 5000 });

      await expect(
        emptyFed.execute({ source: 'test', operation: 'select' }),
      ).rejects.toThrow();
    });

    it('should allow removing adapters', () => {
      expect(federation.getAdapter('users-db')).toBeDefined();
      federation.removeAdapter('users-db');
      expect(federation.getAdapter('users-db')).toBeUndefined();
    });
  });

  describe('timeout handling', () => {
    it('should timeout on long-running queries', async () => {
      const slowFed = createQueryFederation({ queryTimeout: 1 });

      // Create a slow adapter
      const slowAdapter = createMemoryAdapter('slow-db');
      await slowAdapter.connect();

      // Override execute to be slow
      const originalExecute = slowAdapter.execute.bind(slowAdapter);
      slowAdapter.execute = async (query) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return originalExecute(query);
      };

      slowFed.registerAdapter(slowAdapter);

      await expect(
        slowFed.execute({ source: 'test', operation: 'select' }),
      ).rejects.toThrow('timed out');

      await slowAdapter.disconnect();
    });
  });
});
