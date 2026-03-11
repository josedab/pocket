// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { useMutation } from '../composables/use-mutation.js';
import {
  PocketKey,
  createPocketPlugin,
  providePocket,
  useCollection,
  useDatabase,
  usePocketContext,
  usePocketReady,
  type PocketContextValue,
} from '../context/provider.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockCollection() {
  return {
    insert: vi.fn().mockResolvedValue({ _id: '1', title: 'Test' }),
    insertMany: vi.fn().mockResolvedValue([
      { _id: '1', title: 'A' },
      { _id: '2', title: 'B' },
    ]),
    update: vi.fn().mockResolvedValue({ _id: '1', title: 'Updated' }),
    upsert: vi.fn().mockResolvedValue({ _id: '1', title: 'Upserted' }),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockReturnValue({
      live: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
      exec: vi.fn().mockResolvedValue([]),
    }),
    findOne: vi.fn().mockResolvedValue(null),
    get: vi.fn().mockResolvedValue(null),
    observeById: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
    changes: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
  };
}

function createMockDatabase(overrides: Record<string, unknown> = {}) {
  const mockCollection = createMockCollection();
  return {
    db: {
      name: 'test-db',
      collection: vi.fn().mockReturnValue(mockCollection),
      isOpen: true,
      version: 1,
      ...overrides,
    },
    mockCollection,
  };
}

function createPocketContext(
  db: unknown,
  ready = true,
  err: Error | null = null
): PocketContextValue {
  return {
    database: shallowRef(db as any),
    isReady: shallowRef(ready),
    error: shallowRef(err),
  };
}

/**
 * Mount a composable inside a component that has Pocket context injected.
 */
function mountWithPocket<T>(
  composable: () => T,
  db: unknown,
  { ready = true, error = null as Error | null } = {}
): { result: T; wrapper: ReturnType<typeof mount> } {
  let result!: T;
  const TestComponent = defineComponent({
    setup() {
      result = composable();
      return () => h('div');
    },
  });
  const wrapper = mount(TestComponent, {
    global: {
      provide: {
        [PocketKey as symbol]: createPocketContext(db, ready, error),
      },
    },
  });
  return { result, wrapper };
}

/**
 * Mount a composable *without* any provider context.
 */
function mountBare<T>(composable: () => T): { result: T; wrapper: ReturnType<typeof mount> } {
  let result!: T;
  const TestComponent = defineComponent({
    setup() {
      result = composable();
      return () => h('div');
    },
  });
  const wrapper = mount(TestComponent);
  return { result, wrapper };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@pocket/vue composables', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;
  let mockDb: Record<string, unknown>;

  beforeEach(() => {
    const mocks = createMockDatabase();
    mockDb = mocks.db;
    mockCollection = mocks.mockCollection;
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Provider / Context
  // -----------------------------------------------------------------------
  describe('providePocket', () => {
    it('provides context with a synchronous database', () => {
      let ctx!: PocketContextValue;

      const Wrapper = defineComponent({
        setup() {
          ctx = providePocket(mockDb as any);
          return () => h('div');
        },
      });
      mount(Wrapper);

      expect(ctx.database.value).toBe(mockDb);
      expect(ctx.isReady.value).toBe(true);
      expect(ctx.error.value).toBeNull();
    });

    it('provides context with a promise database that resolves', async () => {
      let ctx!: PocketContextValue;

      const dbPromise = Promise.resolve(mockDb);
      const Wrapper = defineComponent({
        setup() {
          ctx = providePocket(dbPromise as any);
          return () => h('div');
        },
      });
      mount(Wrapper);

      // Before resolution
      expect(ctx.database.value).toBeNull();
      expect(ctx.isReady.value).toBe(false);

      await dbPromise;
      await nextTick();

      expect(ctx.database.value).toBe(mockDb);
      expect(ctx.isReady.value).toBe(true);
    });

    it('sets error when promise database rejects', async () => {
      let ctx!: PocketContextValue;

      const err = new Error('init failed');
      const dbPromise = Promise.reject(err);
      // Prevent unhandled rejection
      dbPromise.catch(() => {});

      const Wrapper = defineComponent({
        setup() {
          ctx = providePocket(dbPromise as any);
          return () => h('div');
        },
      });
      mount(Wrapper);

      // Let the microtask (rejection handler) run
      await new Promise((r) => setTimeout(r, 10));
      await nextTick();

      expect(ctx.error.value).toBeInstanceOf(Error);
      expect(ctx.error.value!.message).toBe('init failed');
      expect(ctx.isReady.value).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // usePocketContext
  // -----------------------------------------------------------------------
  describe('usePocketContext', () => {
    it('returns context when inside a provider', () => {
      const { result } = mountWithPocket(() => usePocketContext(), mockDb);

      expect(result.database.value).toBe(mockDb);
      expect(result.isReady.value).toBe(true);
      expect(result.error.value).toBeNull();
    });

    it('throws when used outside a provider', () => {
      expect(() => mountBare(() => usePocketContext())).toThrow(
        'usePocketContext must be used within a component that has called providePocket'
      );
    });
  });

  // -----------------------------------------------------------------------
  // useDatabase
  // -----------------------------------------------------------------------
  describe('useDatabase', () => {
    it('returns the database when ready', () => {
      const { result } = mountWithPocket(() => useDatabase(), mockDb);
      expect(result).toBe(mockDb);
    });

    it('throws when database is not ready', () => {
      expect(() => mountWithPocket(() => useDatabase(), null, { ready: false })).toThrow(
        'Database is not ready'
      );
    });

    it('throws when database ref is null even if isReady is true', () => {
      expect(() => mountWithPocket(() => useDatabase(), null, { ready: true })).toThrow(
        'Database is not ready'
      );
    });
  });

  // -----------------------------------------------------------------------
  // usePocketReady
  // -----------------------------------------------------------------------
  describe('usePocketReady', () => {
    it('returns isReady true when database is ready', () => {
      const { result } = mountWithPocket(() => usePocketReady(), mockDb);

      expect(result.isReady.value).toBe(true);
      expect(result.error.value).toBeNull();
    });

    it('returns isReady false and error when provider has error', () => {
      const err = new Error('db error');
      const { result } = mountWithPocket(() => usePocketReady(), null, {
        ready: false,
        error: err,
      });

      expect(result.isReady.value).toBe(false);
      expect(result.error.value).toBe(err);
    });
  });

  // -----------------------------------------------------------------------
  // useCollection
  // -----------------------------------------------------------------------
  describe('useCollection', () => {
    it('returns a collection proxy from the database', () => {
      const { result } = mountWithPocket(() => useCollection('todos'), mockDb);

      expect(mockDb.collection).toHaveBeenCalledWith('todos');
      expect(result).toBe(mockCollection);
    });
  });

  // -----------------------------------------------------------------------
  // useMutation
  // -----------------------------------------------------------------------
  describe('useMutation', () => {
    it('returns all expected mutation functions and state', () => {
      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      expect(typeof result.insert).toBe('function');
      expect(typeof result.insertMany).toBe('function');
      expect(typeof result.update).toBe('function');
      expect(typeof result.upsert).toBe('function');
      expect(typeof result.remove).toBe('function');
      expect(typeof result.removeMany).toBe('function');
      expect(typeof result.resetError).toBe('function');
    });

    it('has isLoading initially false', () => {
      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      expect(result.isLoading.value).toBe(false);
    });

    it('has error initially null', () => {
      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      expect(result.error.value).toBeNull();
    });

    it('insert delegates to collection.insert and returns result', async () => {
      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      const doc = await result.insert({ title: 'New' });
      expect(mockCollection.insert).toHaveBeenCalledWith({ title: 'New' });
      expect(doc).toEqual({ _id: '1', title: 'Test' });
    });

    it('insertMany delegates to collection.insertMany', async () => {
      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      const docs = await result.insertMany([{ title: 'A' }, { title: 'B' }]);
      expect(mockCollection.insertMany).toHaveBeenCalledWith([{ title: 'A' }, { title: 'B' }]);
      expect(docs).toHaveLength(2);
    });

    it('update delegates to collection.update', async () => {
      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      const doc = await result.update('1', { title: 'Changed' });
      expect(mockCollection.update).toHaveBeenCalledWith('1', { title: 'Changed' });
      expect(doc).toEqual({ _id: '1', title: 'Updated' });
    });

    it('upsert delegates to collection.upsert', async () => {
      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      const doc = await result.upsert('1', { title: 'Ups' });
      expect(mockCollection.upsert).toHaveBeenCalledWith('1', { title: 'Ups' });
      expect(doc).toEqual({ _id: '1', title: 'Upserted' });
    });

    it('remove delegates to collection.delete', async () => {
      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      await result.remove('1');
      expect(mockCollection.delete).toHaveBeenCalledWith('1');
    });

    it('removeMany delegates to collection.deleteMany', async () => {
      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      await result.removeMany(['1', '2']);
      expect(mockCollection.deleteMany).toHaveBeenCalledWith(['1', '2']);
    });

    it('sets isLoading to false after successful mutation', async () => {
      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      await result.insert({ title: 'New' });
      expect(result.isLoading.value).toBe(false);
    });

    it('sets error on failed mutation and rethrows', async () => {
      const failError = new Error('insert failed');
      mockCollection.insert.mockRejectedValueOnce(failError);

      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      await expect(result.insert({ title: 'Bad' })).rejects.toThrow('insert failed');
      expect(result.error.value).toBeInstanceOf(Error);
      expect(result.error.value!.message).toBe('insert failed');
      expect(result.isLoading.value).toBe(false);
    });

    it('resetError clears the error state', async () => {
      mockCollection.insert.mockRejectedValueOnce(new Error('fail'));

      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      await result.insert({ title: 'Bad' }).catch(() => {});
      expect(result.error.value).not.toBeNull();

      result.resetError();
      expect(result.error.value).toBeNull();
    });

    it('calls onSuccess callback after successful mutation', async () => {
      const onSuccess = vi.fn();

      const { result } = mountWithPocket(() => useMutation('todos', { onSuccess }), mockDb);

      await result.insert({ title: 'New' });
      expect(onSuccess).toHaveBeenCalledWith({ _id: '1', title: 'Test' });
    });

    it('calls onError callback after failed mutation', async () => {
      const onError = vi.fn();
      mockCollection.update.mockRejectedValueOnce(new Error('update failed'));

      const { result } = mountWithPocket(() => useMutation('todos', { onError }), mockDb);

      await result.update('1', { title: 'Bad' }).catch(() => {});
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'update failed' }));
    });

    it('wraps non-Error rejection into an Error', async () => {
      mockCollection.insert.mockRejectedValueOnce('string error');

      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      await result.insert({ title: 'Bad' }).catch(() => {});
      expect(result.error.value).toBeInstanceOf(Error);
      expect(result.error.value!.message).toBe('string error');
    });

    it('clears previous error on next mutation attempt', async () => {
      mockCollection.insert
        .mockRejectedValueOnce(new Error('first fail'))
        .mockResolvedValueOnce({ _id: '2', title: 'OK' });

      const { result } = mountWithPocket(() => useMutation('todos'), mockDb);

      await result.insert({ title: 'Bad' }).catch(() => {});
      expect(result.error.value).not.toBeNull();

      await result.insert({ title: 'Good' });
      expect(result.error.value).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // createPocketPlugin
  // -----------------------------------------------------------------------
  describe('createPocketPlugin', () => {
    it('creates an installable Vue plugin', () => {
      const plugin = createPocketPlugin({ database: mockDb as any });

      expect(plugin).toBeDefined();
      expect(typeof plugin.install).toBe('function');
    });

    it('provides context via the plugin install method', () => {
      const plugin = createPocketPlugin({ database: mockDb as any });

      let provided: PocketContextValue | undefined;
      const fakeApp = {
        provide: vi.fn((key: any, value: any) => {
          provided = value;
        }),
      };

      plugin.install(fakeApp);

      expect(fakeApp.provide).toHaveBeenCalledTimes(1);
      expect(provided).toBeDefined();
      expect(provided!.database.value).toBe(mockDb);
      expect(provided!.isReady.value).toBe(true);
      expect(provided!.error.value).toBeNull();
    });
  });
});
