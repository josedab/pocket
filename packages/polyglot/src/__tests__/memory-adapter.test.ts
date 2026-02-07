import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryAdapter, createMemoryAdapter } from '../memory-adapter.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let adapter: MemoryAdapter;

beforeEach(async () => {
  adapter = createMemoryAdapter('test');
  await adapter.connect();
});

afterEach(async () => {
  await adapter.disconnect();
});

/* ================================================================== */
/*  MemoryAdapter                                                      */
/* ================================================================== */

describe('MemoryAdapter', () => {
  describe('lifecycle', () => {
    it('should connect and disconnect', async () => {
      const a = createMemoryAdapter('lifecycle-test');
      expect(await a.healthCheck()).toBe(false);

      await a.connect();
      expect(await a.healthCheck()).toBe(true);

      await a.disconnect();
      expect(await a.healthCheck()).toBe(false);
    });

    it('should throw when executing without connecting', async () => {
      const a = createMemoryAdapter('not-connected');
      await expect(
        a.execute({ source: 'test', operation: 'select' }),
      ).rejects.toThrow('not connected');
    });

    it('should have correct name and type', () => {
      expect(adapter.name).toBe('test');
      expect(adapter.type).toBe('memory');
    });
  });

  describe('insert and select', () => {
    it('should insert and select documents', async () => {
      await adapter.execute({
        source: 'users',
        operation: 'insert',
        data: [
          { id: 1, name: 'Alice', age: 30 },
          { id: 2, name: 'Bob', age: 25 },
        ],
      });

      const result = await adapter.execute({
        source: 'users',
        operation: 'select',
      });

      expect(result.data).toHaveLength(2);
      expect(result.totalCount).toBe(2);
      expect(result.sources).toEqual(['test']);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should insert a single document', async () => {
      await adapter.execute({
        source: 'users',
        operation: 'insert',
        data: { id: 1, name: 'Alice' },
      });

      const result = await adapter.execute({
        source: 'users',
        operation: 'select',
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({ id: 1, name: 'Alice' });
    });

    it('should return empty array for non-existent collection', async () => {
      const result = await adapter.execute({
        source: 'nonexistent',
        operation: 'select',
      });

      expect(result.data).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('filtering', () => {
    beforeEach(async () => {
      await adapter.execute({
        source: 'products',
        operation: 'insert',
        data: [
          { id: 1, name: 'Widget', price: 10, category: 'tools' },
          { id: 2, name: 'Gadget', price: 25, category: 'electronics' },
          { id: 3, name: 'Doohickey', price: 5, category: 'tools' },
          { id: 4, name: 'Thingamajig', price: 50, category: 'electronics' },
        ],
      });
    });

    it('should filter with exact match', async () => {
      const result = await adapter.execute({
        source: 'products',
        operation: 'select',
        filter: { category: 'tools' },
      });

      expect(result.data).toHaveLength(2);
      expect(result.data.every((d: any) => d.category === 'tools')).toBe(true);
    });

    it('should filter with $eq operator', async () => {
      const result = await adapter.execute({
        source: 'products',
        operation: 'select',
        filter: { price: { $eq: 25 } },
      });

      expect(result.data).toHaveLength(1);
      expect((result.data[0] as any).name).toBe('Gadget');
    });

    it('should filter with $gt operator', async () => {
      const result = await adapter.execute({
        source: 'products',
        operation: 'select',
        filter: { price: { $gt: 20 } },
      });

      expect(result.data).toHaveLength(2);
      expect(result.data.every((d: any) => d.price > 20)).toBe(true);
    });

    it('should filter with $lt operator', async () => {
      const result = await adapter.execute({
        source: 'products',
        operation: 'select',
        filter: { price: { $lt: 15 } },
      });

      expect(result.data).toHaveLength(2);
      expect(result.data.every((d: any) => d.price < 15)).toBe(true);
    });

    it('should filter with $in operator', async () => {
      const result = await adapter.execute({
        source: 'products',
        operation: 'select',
        filter: { name: { $in: ['Widget', 'Gadget'] } },
      });

      expect(result.data).toHaveLength(2);
    });
  });

  describe('sorting and pagination', () => {
    beforeEach(async () => {
      await adapter.execute({
        source: 'items',
        operation: 'insert',
        data: [
          { id: 1, name: 'C', score: 30 },
          { id: 2, name: 'A', score: 10 },
          { id: 3, name: 'B', score: 20 },
        ],
      });
    });

    it('should sort ascending', async () => {
      const result = await adapter.execute({
        source: 'items',
        operation: 'select',
        sort: { name: 1 },
      });

      expect(result.data.map((d: any) => d.name)).toEqual(['A', 'B', 'C']);
    });

    it('should sort descending', async () => {
      const result = await adapter.execute({
        source: 'items',
        operation: 'select',
        sort: { score: -1 },
      });

      expect(result.data.map((d: any) => d.score)).toEqual([30, 20, 10]);
    });

    it('should limit results', async () => {
      const result = await adapter.execute({
        source: 'items',
        operation: 'select',
        sort: { score: 1 },
        limit: 2,
      });

      expect(result.data).toHaveLength(2);
      expect(result.data.map((d: any) => d.score)).toEqual([10, 20]);
    });
  });

  describe('update', () => {
    it('should update matching documents', async () => {
      await adapter.execute({
        source: 'users',
        operation: 'insert',
        data: [
          { id: 1, name: 'Alice', active: true },
          { id: 2, name: 'Bob', active: true },
        ],
      });

      const updateResult = await adapter.execute({
        source: 'users',
        operation: 'update',
        filter: { id: 1 },
        data: { active: false },
      });

      expect(updateResult.data).toHaveLength(1);
      expect((updateResult.data[0] as any).active).toBe(false);

      const selectResult = await adapter.execute({
        source: 'users',
        operation: 'select',
        filter: { id: 1 },
      });

      expect((selectResult.data[0] as any).active).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete matching documents', async () => {
      await adapter.execute({
        source: 'users',
        operation: 'insert',
        data: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' },
        ],
      });

      const deleteResult = await adapter.execute({
        source: 'users',
        operation: 'delete',
        filter: { id: 2 },
      });

      expect(deleteResult.data).toHaveLength(1);
      expect((deleteResult.data[0] as any).name).toBe('Bob');

      const remaining = await adapter.execute({
        source: 'users',
        operation: 'select',
      });

      expect(remaining.data).toHaveLength(2);
    });
  });

  describe('health check', () => {
    it('should return true when connected', async () => {
      expect(await adapter.healthCheck()).toBe(true);
    });

    it('should return false when disconnected', async () => {
      await adapter.disconnect();
      expect(await adapter.healthCheck()).toBe(false);
    });
  });
});
