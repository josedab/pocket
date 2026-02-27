import { describe, expect, it } from 'vitest';
import { createGenericAdapter, createInMemoryEngine, runBenchmarkSuite } from '../index.js';

describe('Competitor Adapters', () => {
  it('should create a generic adapter from a Map store', async () => {
    const store = new Map<string, Record<string, unknown>>();
    const adapter = createGenericAdapter('MapStore', '1.0', {
      set(k, v) {
        store.set(k, v);
      },
      get(k) {
        return store.get(k);
      },
      delete(k) {
        store.delete(k);
      },
      entries() {
        return store.entries();
      },
      clear() {
        store.clear();
      },
    });

    expect(adapter.name).toBe('MapStore');

    await adapter.setup();
    await adapter.insertOne({ _id: 'x', value: 1 });
    const all = await adapter.findAll();
    expect(all).toHaveLength(1);

    await adapter.updateOne('x', { value: 2 });
    const updated = await adapter.findAll();
    expect((updated[0] as Record<string, unknown>)['value']).toBe(2);

    await adapter.deleteOne('x');
    expect(await adapter.findAll()).toHaveLength(0);

    await adapter.teardown();
  });

  it('should run benchmark with generic adapter', async () => {
    const store = new Map<string, Record<string, unknown>>();
    const adapter = createGenericAdapter('TestStore', '1.0', {
      set(k, v) {
        store.set(k, v);
      },
      get(k) {
        return store.get(k);
      },
      delete(k) {
        store.delete(k);
      },
      entries() {
        return store.entries();
      },
      clear() {
        store.clear();
      },
    });

    const report = await runBenchmarkSuite({
      engines: [adapter],
      documentCount: 10,
      iterations: 3,
    });

    expect(report.results.length).toBeGreaterThan(0);
    expect(report.results.every((r) => r.engine === 'TestStore')).toBe(true);
  });

  it('should compare in-memory engine with generic adapter', async () => {
    const store = new Map<string, Record<string, unknown>>();
    const generic = createGenericAdapter('MapDB', '1.0', {
      set(k, v) {
        store.set(k, v);
      },
      get(k) {
        return store.get(k);
      },
      delete(k) {
        store.delete(k);
      },
      entries() {
        return store.entries();
      },
      clear() {
        store.clear();
      },
    });

    const pocket = createInMemoryEngine('Pocket');

    const report = await runBenchmarkSuite({
      engines: [pocket, generic],
      documentCount: 10,
      iterations: 3,
    });

    const engines = new Set(report.results.map((r) => r.engine));
    expect(engines.size).toBe(2);
    expect(engines.has('Pocket')).toBe(true);
    expect(engines.has('MapDB')).toBe(true);
    expect(Object.keys(report.winner).length).toBeGreaterThan(0);
  });

  it('should filter with generic adapter', async () => {
    const store = new Map<string, Record<string, unknown>>();
    const adapter = createGenericAdapter('FilterTest', '1.0', {
      set(k, v) {
        store.set(k, v);
      },
      get(k) {
        return store.get(k);
      },
      delete(k) {
        store.delete(k);
      },
      entries() {
        return store.entries();
      },
      clear() {
        store.clear();
      },
    });

    await adapter.setup();
    await adapter.insertOne({ _id: 'a', active: true });
    await adapter.insertOne({ _id: 'b', active: false });
    await adapter.insertOne({ _id: 'c', active: true });

    const filtered = await adapter.findWithFilter({ active: true });
    expect(filtered).toHaveLength(2);
    await adapter.teardown();
  });
});
