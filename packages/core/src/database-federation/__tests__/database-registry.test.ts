import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseRegistry, type FederatableDatabase } from '../database-registry.js';

function createMockDb(
  name: string,
  data: Record<string, Record<string, unknown>[]> = {}
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
    listCollections: async () => Object.keys(data),
    close: async () => {},
  };
}

describe('DatabaseRegistry', () => {
  let registry: DatabaseRegistry;

  beforeEach(() => {
    registry = new DatabaseRegistry({ maxDatabases: 5 });
  });

  it('should register and retrieve databases', () => {
    const db = createMockDb('users-db');
    registry.register('users-db', db);
    expect(registry.get('users-db')).toBe(db);
    expect(registry.list()).toHaveLength(1);
  });

  it('should prevent duplicate registration', () => {
    registry.register('db1', createMockDb('db1'));
    expect(() => registry.register('db1', createMockDb('db1'))).toThrow('already registered');
  });

  it('should enforce max database limit', () => {
    for (let i = 0; i < 5; i++) registry.register(`db${i}`, createMockDb(`db${i}`));
    expect(() => registry.register('db5', createMockDb('db5'))).toThrow('Max databases');
  });

  it('should unregister databases', async () => {
    registry.register('db1', createMockDb('db1'));
    await registry.unregister('db1');
    expect(registry.get('db1')).toBeUndefined();
  });

  it('should track access statistics', () => {
    registry.register('db1', createMockDb('db1'));
    registry.get('db1');
    registry.get('db1');
    registry.get('db1');

    const entry = registry.list()[0]!;
    expect(entry.accessCount).toBe(3);
  });

  describe('federated queries', () => {
    it('should query a single database', async () => {
      registry.register(
        'users-db',
        createMockDb('users-db', {
          users: [
            { _id: 'u1', name: 'Alice', active: true },
            { _id: 'u2', name: 'Bob', active: false },
          ],
        })
      );

      const result = await registry.federatedQuery({
        from: { db: 'users-db', collection: 'users', filter: { active: true } },
      });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.name).toBe('Alice');
      expect(result.sources).toEqual(['users-db']);
    });

    it('should join across two databases', async () => {
      registry.register(
        'users-db',
        createMockDb('users-db', {
          users: [
            { _id: 'u1', name: 'Alice' },
            { _id: 'u2', name: 'Bob' },
          ],
        })
      );
      registry.register(
        'orders-db',
        createMockDb('orders-db', {
          orders: [
            { _id: 'o1', userId: 'u1', amount: 100 },
            { _id: 'o2', userId: 'u1', amount: 200 },
            { _id: 'o3', userId: 'u2', amount: 50 },
          ],
        })
      );

      const result = await registry.federatedQuery({
        from: { db: 'users-db', collection: 'users' },
        join: { db: 'orders-db', collection: 'orders', on: '_id', foreignKey: 'userId' },
      });

      expect(result.sources).toEqual(['users-db', 'orders-db']);
      expect(result.joinedCount).toBe(3);
      expect(result.rows.length).toBe(3);
    });

    it('should apply filter to federated query', async () => {
      registry.register(
        'db',
        createMockDb('db', {
          items: [
            { _id: '1', type: 'A', value: 10 },
            { _id: '2', type: 'B', value: 20 },
            { _id: '3', type: 'A', value: 30 },
          ],
        })
      );

      const result = await registry.federatedQuery({
        from: { db: 'db', collection: 'items' },
        filter: { type: 'A' },
      });

      expect(result.rows).toHaveLength(2);
      expect(result.rows.every((r) => r.type === 'A')).toBe(true);
    });

    it('should apply limit to federated query', async () => {
      registry.register(
        'db',
        createMockDb('db', {
          items: Array.from({ length: 20 }, (_, i) => ({ _id: `${i}`, v: i })),
        })
      );

      const result = await registry.federatedQuery({
        from: { db: 'db', collection: 'items' },
        limit: 5,
      });

      expect(result.rows).toHaveLength(5);
    });

    it('should throw for unknown databases', async () => {
      await expect(
        registry.federatedQuery({
          from: { db: 'missing', collection: 'items' },
        })
      ).rejects.toThrow('not found');
    });
  });

  it('should emit events', () => {
    const events: unknown[] = [];
    registry.events$.subscribe((e) => events.push(e));

    registry.register('db1', createMockDb('db1'));
    registry.get('db1');

    expect(events.some((e) => (e as { type: string }).type === 'db:registered')).toBe(true);
    expect(events.some((e) => (e as { type: string }).type === 'db:accessed')).toBe(true);
  });

  it('should destroy and close all databases', async () => {
    registry.register('db1', createMockDb('db1'));
    registry.register('db2', createMockDb('db2'));

    await registry.destroy();
    expect(registry.list()).toHaveLength(0);
  });
});
