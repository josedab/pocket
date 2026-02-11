import { describe, expect, it } from 'vitest';
import type { AggregateResult, GroupedResult } from '../live-view.js';
import { createLiveView } from '../live-view.js';
import { createViewCache } from '../lru-cache.js';

// ---- Live View ----

describe('createLiveView', () => {
  it('should compute aggregates from inserted documents', () => {
    const view = createLiveView({
      name: 'order-stats',
      sourceCollection: 'orders',
      aggregate: { amount: 'sum', count: true },
    });

    view.processChange({
      type: 'insert',
      document: { _id: '1', amount: 100 },
      collection: 'orders',
    });
    view.processChange({
      type: 'insert',
      document: { _id: '2', amount: 200 },
      collection: 'orders',
    });

    const result = view.getValue() as AggregateResult;
    expect(result.count).toBe(2);
    expect(result.amount_sum).toBe(300);
    view.destroy();
  });

  it('should support avg, min, max operations', () => {
    const view = createLiveView({
      name: 'price-stats',
      sourceCollection: 'products',
      aggregate: { price: 'avg' },
    });

    view.processChange({
      type: 'insert',
      document: { _id: '1', price: 10 },
      collection: 'products',
    });
    view.processChange({
      type: 'insert',
      document: { _id: '2', price: 20 },
      collection: 'products',
    });
    view.processChange({
      type: 'insert',
      document: { _id: '3', price: 30 },
      collection: 'products',
    });

    const result = view.getValue() as AggregateResult;
    expect(result.price_avg).toBe(20);
    view.destroy();
  });

  it('should support group-by', () => {
    const view = createLiveView({
      name: 'status-counts',
      sourceCollection: 'todos',
      aggregate: { count: true },
      groupBy: 'status',
    });

    view.processChange({
      type: 'insert',
      document: { _id: '1', status: 'active' },
      collection: 'todos',
    });
    view.processChange({
      type: 'insert',
      document: { _id: '2', status: 'active' },
      collection: 'todos',
    });
    view.processChange({
      type: 'insert',
      document: { _id: '3', status: 'done' },
      collection: 'todos',
    });

    const result = view.getValue() as GroupedResult;
    expect(result['active']?.count).toBe(2);
    expect(result['done']?.count).toBe(1);
    view.destroy();
  });

  it('should update on document deletion', () => {
    const view = createLiveView({
      name: 'user-count',
      sourceCollection: 'users',
      aggregate: { count: true },
    });

    view.processChange({
      type: 'insert',
      document: { _id: '1', name: 'Alice' },
      collection: 'users',
    });
    view.processChange({
      type: 'insert',
      document: { _id: '2', name: 'Bob' },
      collection: 'users',
    });
    expect((view.getValue() as AggregateResult).count).toBe(2);

    view.processChange({
      type: 'delete',
      document: { _id: '1', name: 'Alice' },
      collection: 'users',
    });
    expect((view.getValue() as AggregateResult).count).toBe(1);
    view.destroy();
  });

  it('should update on document update', () => {
    const view = createLiveView({
      name: 'total-amount',
      sourceCollection: 'orders',
      aggregate: { amount: 'sum' },
    });

    view.processChange({
      type: 'insert',
      document: { _id: '1', amount: 100 },
      collection: 'orders',
    });
    view.processChange({
      type: 'update',
      document: { _id: '1', amount: 150 },
      collection: 'orders',
    });

    const result = view.getValue() as AggregateResult;
    expect(result.amount_sum).toBe(150);
    view.destroy();
  });

  it('should ignore changes from other collections', () => {
    const view = createLiveView({
      name: 'user-stats',
      sourceCollection: 'users',
      aggregate: { count: true },
    });

    view.processChange({ type: 'insert', document: { _id: '1' }, collection: 'posts' });
    expect((view.getValue() as AggregateResult).count).toBe(0);
    view.destroy();
  });

  it('should apply filter before aggregation', () => {
    const view = createLiveView({
      name: 'active-count',
      sourceCollection: 'users',
      aggregate: { count: true },
      filter: (doc) => doc.active === true,
    });

    view.processChange({
      type: 'insert',
      document: { _id: '1', active: true },
      collection: 'users',
    });
    view.processChange({
      type: 'insert',
      document: { _id: '2', active: false },
      collection: 'users',
    });
    view.processChange({
      type: 'insert',
      document: { _id: '3', active: true },
      collection: 'users',
    });

    expect((view.getValue() as AggregateResult).count).toBe(2);
    view.destroy();
  });

  it('should emit updates via observable', () => {
    const view = createLiveView({
      name: 'live-count',
      sourceCollection: 'items',
      aggregate: { count: true },
    });

    const values: AggregateResult[] = [];
    view.value$.subscribe((v) => values.push(v as AggregateResult));

    view.processChange({ type: 'insert', document: { _id: '1' }, collection: 'items' });
    view.processChange({ type: 'insert', document: { _id: '2' }, collection: 'items' });

    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(values[values.length - 1]!.count).toBe(2);
    view.destroy();
  });
});

// ---- LRU Cache ----

describe('createViewCache', () => {
  it('should store and retrieve values', () => {
    const cache = createViewCache<number>({ maxSize: 5 });
    cache.set('a', 1);
    cache.set('b', 2);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.size).toBe(2);
  });

  it('should evict LRU entry when exceeding maxSize', () => {
    const cache = createViewCache<number>({ maxSize: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // should evict 'a'

    expect(cache.has('a')).toBe(false);
    expect(cache.has('d')).toBe(true);
    expect(cache.size).toBe(3);
  });

  it('should update LRU order on get', () => {
    const cache = createViewCache<number>({ maxSize: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    cache.get('a'); // move 'a' to front

    cache.set('d', 4); // should evict 'b' (not 'a')

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('should track cache stats', () => {
    const cache = createViewCache<number>({ maxSize: 5 });
    cache.set('a', 1);
    cache.get('a'); // hit
    cache.get('b'); // miss

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
    expect(stats.size).toBe(1);
  });

  it('should call onEvict callback', () => {
    const evicted: string[] = [];
    const cache = createViewCache<number>({
      maxSize: 2,
      onEvict: (key) => evicted.push(key),
    });

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // evicts 'a'

    expect(evicted).toContain('a');
  });

  it('should support delete and clear', () => {
    const cache = createViewCache<number>({ maxSize: 5 });
    cache.set('a', 1);
    cache.set('b', 2);

    cache.delete('a');
    expect(cache.has('a')).toBe(false);
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('should list all keys', () => {
    const cache = createViewCache<number>({ maxSize: 5 });
    cache.set('x', 1);
    cache.set('y', 2);
    cache.set('z', 3);

    expect(cache.keys()).toEqual(expect.arrayContaining(['x', 'y', 'z']));
  });

  it('should track eviction count', () => {
    const cache = createViewCache<number>({ maxSize: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4);

    expect(cache.getStats().evictions).toBe(2);
  });
});
