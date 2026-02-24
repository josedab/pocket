import { describe, expect, it } from 'vitest';
import { DeclarativeRLS, policy } from '../declarative-rls.js';
import type { WrappableStore } from '../rls-middleware.js';
import { RLSMiddleware } from '../rls-middleware.js';
import type { AuthContext } from '../types.js';

function createMockStore(docs: Record<string, unknown>[]): WrappableStore {
  const store = new Map(docs.map((d) => [String(d._id), d]));
  return {
    name: 'test-store',
    async get(id) {
      return store.get(id) ?? null;
    },
    async getAll() {
      return [...store.values()];
    },
    async put(doc) {
      store.set(String(doc._id), doc);
      return doc;
    },
    async delete(id) {
      store.delete(id);
    },
    async query() {
      return [...store.values()];
    },
    async count() {
      return store.size;
    },
  };
}

const tenantCtx: AuthContext = { userId: 'u1', tenantId: 't1', roles: ['user'], metadata: {} };
const otherCtx: AuthContext = { userId: 'u2', tenantId: 't2', roles: ['user'], metadata: {} };
const adminCtx: AuthContext = { userId: 'a1', tenantId: 't1', roles: ['admin'], metadata: {} };

describe('RLSMiddleware', () => {
  function setup() {
    const rls = new DeclarativeRLS();
    rls.addPolicy(
      policy()
        .name('tenant-read')
        .collection('orders')
        .actions('read')
        .allow()
        .tenantIsolation('tenantId')
        .build()
    );
    rls.addPolicy(
      policy()
        .name('tenant-write')
        .collection('orders')
        .actions('insert', 'update', 'delete')
        .allow()
        .tenantIsolation('tenantId')
        .build()
    );

    const store = createMockStore([
      { _id: '1', tenantId: 't1', amount: 100 },
      { _id: '2', tenantId: 't2', amount: 200 },
      { _id: '3', tenantId: 't1', amount: 300 },
    ]);

    const middleware = new RLSMiddleware(store, rls, 'orders', () => tenantCtx);
    return { rls, store, middleware };
  }

  it('should filter getAll by tenant', async () => {
    const { middleware } = setup();
    const docs = await middleware.getAll();
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.tenantId === 't1')).toBe(true);
  });

  it('should return null for get on wrong tenant', async () => {
    const { middleware } = setup();
    const doc = await middleware.get('2'); // tenantId t2
    expect(doc).toBeNull();
  });

  it('should allow get on own tenant', async () => {
    const { middleware } = setup();
    const doc = await middleware.get('1');
    expect(doc).not.toBeNull();
    expect(doc!.amount).toBe(100);
  });

  it('should allow put for own tenant', async () => {
    const { middleware } = setup();
    const doc = await middleware.put({ _id: '4', tenantId: 't1', amount: 400 });
    expect(doc._id).toBe('4');
  });

  it('should deny put for wrong tenant', async () => {
    const { middleware } = setup();
    await expect(middleware.put({ _id: '5', tenantId: 't2', amount: 500 })).rejects.toThrow(
      'denied'
    );
  });

  it('should filter query results by RLS', async () => {
    const { middleware } = setup();
    const docs = await middleware.query({});
    expect(docs.every((d) => d.tenantId === 't1')).toBe(true);
  });

  it('should track denied count', async () => {
    const { middleware } = setup();
    await middleware.getAll(); // 1 denial (t2 doc)
    expect(middleware.getDeniedCount()).toBe(1);
  });

  it('should respect context changes', async () => {
    const { rls, store } = setup();
    let currentCtx = tenantCtx;
    const middleware = new RLSMiddleware(store, rls, 'orders', () => currentCtx);

    let docs = await middleware.getAll();
    expect(docs).toHaveLength(2); // t1 docs

    currentCtx = otherCtx;
    docs = await middleware.getAll();
    expect(docs).toHaveLength(1); // t2 docs
  });
});
