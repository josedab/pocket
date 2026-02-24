import { describe, expect, it } from 'vitest';
import {
  createHydrationPayload,
  createServerPocket,
  serverQuery,
  validateHydrationPayload,
  type ServerDatabase,
} from '../rsc-bridge.js';

const mockDb: ServerDatabase = {
  name: 'test-db',
  async query<T extends Record<string, unknown>>(
    collection: string,
    filter?: Record<string, unknown>
  ) {
    const data = [
      { _id: '1', title: 'Post A', published: true },
      { _id: '2', title: 'Post B', published: false },
    ] as T[];
    if (filter?.published !== undefined)
      return data.filter(
        (d) => (d as Record<string, unknown>).published === filter.published
      ) as T[];
    return data;
  },
};

describe('RSC Bridge', () => {
  it('should execute server queries', async () => {
    const result = await serverQuery(mockDb, 'posts', { published: true });
    expect(result.data).toHaveLength(1);
    expect(result.meta.collection).toBe('posts');
    expect(result.meta.count).toBe(1);
  });

  it('should create hydration payloads', () => {
    const payload = createHydrationPayload('my-db', [
      { collection: 'posts', filter: {}, data: [{ _id: '1' }] },
    ]);
    expect(payload.databaseName).toBe('my-db');
    expect(payload.queries).toHaveLength(1);
  });

  it('should validate hydration payloads', () => {
    const valid = createHydrationPayload('db', [{ collection: 'c', filter: {}, data: [] }]);
    expect(validateHydrationPayload(valid)).toBe(true);
    expect(validateHydrationPayload(null)).toBe(false);
    expect(validateHydrationPayload({})).toBe(false);
  });

  it('should create server pocket instance', async () => {
    const sp = createServerPocket({ databaseName: 'test', revalidate: 30 });
    const result = await sp.query(mockDb, 'posts');
    expect(result.data.length).toBe(2);
    expect(result.meta.revalidateAt).not.toBeNull();
  });
});
