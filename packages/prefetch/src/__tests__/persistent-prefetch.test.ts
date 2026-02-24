import { describe, expect, it } from 'vitest';
import { PersistentPrefetchEngine, type PrefetchStorage } from '../persistent-prefetch.js';

function createInMemoryStorage(): PrefetchStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

describe('PersistentPrefetchEngine', () => {
  it('should save model to storage', async () => {
    const storage = createInMemoryStorage();
    const engine = new PersistentPrefetchEngine(storage, { autoSaveIntervalMs: 0 });

    engine.recordQuery('users', { active: true }, 5);
    engine.recordQuery('users', { active: false }, 3);
    expect(engine.isDirty).toBe(true);

    await engine.save();
    expect(engine.isDirty).toBe(false);
    expect(storage.store.size).toBe(1);
  });

  it('should load model from storage', async () => {
    const storage = createInMemoryStorage();
    const engine1 = new PersistentPrefetchEngine(storage, { autoSaveIntervalMs: 0 });

    engine1.recordQuery('users', { active: true }, 5);
    engine1.recordQuery('orders', {}, 10);
    await engine1.save();
    engine1.stop();

    const engine2 = new PersistentPrefetchEngine(storage, { autoSaveIntervalMs: 0 });
    const loaded = await engine2.load();
    expect(loaded).toBe(true);
    engine2.stop();
  });

  it('should return false when no saved model exists', async () => {
    const storage = createInMemoryStorage();
    const engine = new PersistentPrefetchEngine(storage, { autoSaveIntervalMs: 0 });
    const loaded = await engine.load();
    expect(loaded).toBe(false);
    engine.stop();
  });

  it('should reset persisted model', async () => {
    const storage = createInMemoryStorage();
    const engine = new PersistentPrefetchEngine(storage, { autoSaveIntervalMs: 0 });

    engine.recordQuery('users', {}, 5);
    await engine.save();
    expect(storage.store.size).toBe(1);

    await engine.reset();
    expect(storage.store.size).toBe(0);
    expect(engine.isDirty).toBe(false);
    engine.stop();
  });

  it('should mark as dirty on recordQuery', () => {
    const storage = createInMemoryStorage();
    const engine = new PersistentPrefetchEngine(storage, { autoSaveIntervalMs: 0 });
    expect(engine.isDirty).toBe(false);
    engine.recordQuery('a', {}, 1);
    expect(engine.isDirty).toBe(true);
    engine.stop();
  });
});
