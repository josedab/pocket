/**
 * Additional edge-case and cross-cutting tests for @pocket/solid primitives.
 *
 * Complements the per-module test files (create-document, create-live-query,
 * create-mutation, create-sync-status, provider) by covering:
 *   - Edge inputs (empty strings, null-ish values)
 *   - Error wrapping consistency across ALL mutation operation types
 *   - Optimistic mutation partial-option combinations
 *   - Sync-status error clearing across different operations
 *   - Behavioral invariants that hold across all query primitives
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Hoisted shared state (available inside vi.mock factories)         */
/* ------------------------------------------------------------------ */
const {
  cleanupFns,
  mountFns,
  mockCollection,
  mockQueryBuilder,
  mockUnsubscribe,
  subscribeCbs,
  observeByIdCbs,
  changesCbs,
} = vi.hoisted(() => ({
  cleanupFns: [] as (() => void)[],
  mountFns: [] as (() => void)[],
  mockUnsubscribe: vi.fn(),
  subscribeCbs: {
    next: null as null | ((d: unknown[]) => void),
    error: null as null | ((e: unknown) => void),
  },
  observeByIdCbs: {
    next: null as null | ((d: unknown) => void),
    error: null as null | ((e: unknown) => void),
  },
  changesCbs: {
    next: null as null | ((d: unknown) => void),
  },
  mockQueryBuilder: {
    live: vi.fn(),
    exec: vi.fn(),
    where: vi.fn(),
    sort: vi.fn(),
    limit: vi.fn(),
    skip: vi.fn(),
  },
  mockCollection: {
    find: vi.fn(),
    findOne: vi.fn(),
    observeById: vi.fn(),
    get: vi.fn(),
    changes: vi.fn(),
    insert: vi.fn(),
    insertMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

/* ------------------------------------------------------------------ */
/*  Mock solid-js (synchronous primitives)                            */
/* ------------------------------------------------------------------ */
vi.mock('solid-js', () => ({
  createSignal: <T>(initial: T): [() => T, (v: T | ((p: T) => T)) => void] => {
    let value = initial;
    return [
      () => value,
      (v: unknown) => {
        value = typeof v === 'function' ? (v as (p: T) => T)(value) : (v as T);
      },
    ];
  },
  createEffect: (fn: () => void) => fn(),
  onCleanup: (fn: () => void) => {
    cleanupFns.push(fn);
  },
  onMount: (fn: () => void) => {
    mountFns.push(fn);
  },
}));

/* ------------------------------------------------------------------ */
/*  Mock context provider                                             */
/* ------------------------------------------------------------------ */
vi.mock('../context/provider.js', () => ({
  useCollection: () => mockCollection,
}));

/* ------------------------------------------------------------------ */
/*  Imports under test                                                */
/* ------------------------------------------------------------------ */
import { createDocument, createFindOne } from '../primitives/create-document.js';
import { createLiveQuery, createQuery } from '../primitives/create-live-query.js';
import { createMutation, createOptimisticMutation } from '../primitives/create-mutation.js';
import type { SyncEngine, SyncStats, SyncStatus } from '../primitives/create-sync-status.js';
import { createSyncStatus } from '../primitives/create-sync-status.js';

/* ------------------------------------------------------------------ */
/*  Test helpers                                                      */
/* ------------------------------------------------------------------ */
interface TestDoc {
  _id: string;
  name: string;
  value?: number;
}

function resetAll() {
  vi.clearAllMocks();
  cleanupFns.length = 0;
  mountFns.length = 0;
}

function setupObserveById() {
  observeByIdCbs.next = null;
  observeByIdCbs.error = null;
  mockCollection.observeById.mockReturnValue({
    subscribe: vi.fn((cbs: { next: (d: unknown) => void; error?: (e: unknown) => void }) => {
      observeByIdCbs.next = cbs.next;
      observeByIdCbs.error = cbs.error ?? null;
      return { unsubscribe: mockUnsubscribe };
    }),
  });
}

function setupChanges() {
  changesCbs.next = null;
  mockCollection.changes.mockReturnValue({
    subscribe: vi.fn((cbs: { next: (d: unknown) => void }) => {
      changesCbs.next = cbs.next;
      return { unsubscribe: vi.fn() };
    }),
  });
}

function setupQuery() {
  subscribeCbs.next = null;
  subscribeCbs.error = null;
  mockQueryBuilder.live.mockReturnValue({
    subscribe: vi.fn((cbs: { next: (d: unknown[]) => void; error: (e: unknown) => void }) => {
      subscribeCbs.next = cbs.next;
      subscribeCbs.error = cbs.error;
      return { unsubscribe: mockUnsubscribe };
    }),
  });
  mockQueryBuilder.exec.mockResolvedValue([]);
  mockQueryBuilder.where.mockReturnThis();
  mockQueryBuilder.sort.mockReturnThis();
  mockQueryBuilder.limit.mockReturnThis();
  mockQueryBuilder.skip.mockReturnThis();
  mockCollection.find.mockReturnValue(mockQueryBuilder);
}

function setupMutations() {
  mockCollection.insert.mockResolvedValue({ _id: '1', name: 'New' });
  mockCollection.insertMany.mockResolvedValue([
    { _id: '1', name: 'A' },
    { _id: '2', name: 'B' },
  ]);
  mockCollection.update.mockResolvedValue({ _id: '1', name: 'Updated' });
  mockCollection.upsert.mockResolvedValue({ _id: '1', name: 'Upserted' });
  mockCollection.delete.mockResolvedValue(undefined);
  mockCollection.deleteMany.mockResolvedValue(undefined);
}

function createMockSyncEngine() {
  let statusCb: null | ((s: SyncStatus) => void) = null;
  let statsCb: null | ((s: SyncStats) => void) = null;

  const engine: SyncEngine & {
    _emitStatus: (s: SyncStatus) => void;
    _emitStats: (s: SyncStats) => void;
  } = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    forceSync: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    pull: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue({
      subscribe: vi.fn((cbs: { next: (s: SyncStatus) => void }) => {
        statusCb = cbs.next;
        return { unsubscribe: vi.fn() };
      }),
    }),
    getStats: vi.fn().mockReturnValue({
      subscribe: vi.fn((cbs: { next: (s: SyncStats) => void }) => {
        statsCb = cbs.next;
        return { unsubscribe: vi.fn() };
      }),
    }),
    _emitStatus: (s: SyncStatus) => statusCb?.(s),
    _emitStats: (s: SyncStats) => statsCb?.(s),
  };

  return engine;
}

const defaultStats: SyncStats = {
  pushCount: 0,
  pullCount: 0,
  conflictCount: 0,
  lastSyncAt: null,
  lastError: null,
};

function runMountFns() {
  for (const fn of mountFns) fn();
}

/* ================================================================== */
/*  createDocument — edge cases                                       */
/* ================================================================== */
describe('createDocument — edge cases', () => {
  beforeEach(() => {
    resetAll();
    setupObserveById();
  });

  it('should not subscribe when id is empty string', () => {
    const result = createDocument<TestDoc>('users', '');

    expect(mockCollection.observeById).not.toHaveBeenCalled();
    expect(result.data()).toBe(null);
    expect(result.isLoading()).toBe(false);
  });

  it('should not subscribe when accessor returns empty string', () => {
    const result = createDocument<TestDoc>('users', () => '');

    expect(mockCollection.observeById).not.toHaveBeenCalled();
    expect(result.data()).toBe(null);
  });

  it('should recover after error when next is emitted', () => {
    const result = createDocument<TestDoc>('users', 'u1');

    observeByIdCbs.next!({ _id: 'u1', name: 'First' });
    expect(result.data()?.name).toBe('First');
    expect(result.error()).toBe(null);

    observeByIdCbs.error!(new Error('transient'));
    expect(result.error()!.message).toBe('transient');

    observeByIdCbs.next!({ _id: 'u1', name: 'Recovered' });
    expect(result.data()?.name).toBe('Recovered');
    expect(result.error()).toBe(null);
  });

  it('should not refresh when id is empty string', () => {
    mockCollection.get.mockResolvedValue(null);
    const result = createDocument<TestDoc>('users', '');

    result.refresh();
    expect(mockCollection.get).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/*  createFindOne — edge cases                                        */
/* ================================================================== */
describe('createFindOne — edge cases', () => {
  beforeEach(() => {
    resetAll();
    setupChanges();
    mockCollection.findOne.mockResolvedValue(null);
  });

  it('should wrap non-Error rejection from findOne', async () => {
    mockCollection.findOne.mockRejectedValue('string error');

    const result = createFindOne<TestDoc>('users', { name: 'X' });
    await new Promise((r) => setTimeout(r, 0));

    expect(result.error()).toBeInstanceOf(Error);
    expect(result.error()!.message).toBe('string error');
  });

  it('should not subscribe when enabled accessor returns false', () => {
    createFindOne<TestDoc>('users', { name: 'X' }, { enabled: () => false });

    expect(mockCollection.findOne).not.toHaveBeenCalled();
    expect(mockCollection.changes).not.toHaveBeenCalled();
  });

  it('should set isLoading=false and data=null when disabled', () => {
    const result = createFindOne<TestDoc>('users', { name: 'X' }, { enabled: false });

    expect(result.isLoading()).toBe(false);
    expect(result.data()).toBe(null);
  });

  it('should wrap non-Error rejection from findOne with numeric value', async () => {
    mockCollection.findOne.mockRejectedValue(404);

    const result = createFindOne<TestDoc>('users', { name: 'X' });
    await new Promise((r) => setTimeout(r, 0));

    expect(result.error()).toBeInstanceOf(Error);
    expect(result.error()!.message).toBe('404');
  });
});

/* ================================================================== */
/*  createLiveQuery — edge cases                                      */
/* ================================================================== */
describe('createLiveQuery — edge cases', () => {
  beforeEach(() => {
    resetAll();
    setupQuery();
  });

  it('should pass filter through queryFn to collection.find', () => {
    const queryFn = vi.fn((c: typeof mockCollection) => c.find({ name: 'test' }));
    createLiveQuery<TestDoc>('items', queryFn as any);

    expect(queryFn).toHaveBeenCalledWith(mockCollection);
    expect(mockCollection.find).toHaveBeenCalledWith({ name: 'test' });
  });

  it('should handle large result sets without issue', () => {
    const result = createLiveQuery<TestDoc>('items');
    const largeDocs = Array.from({ length: 1000 }, (_, i) => ({
      _id: `${i}`,
      name: `Item ${i}`,
    }));

    subscribeCbs.next!(largeDocs);

    expect(result.data()).toHaveLength(1000);
    expect(result.isLoading()).toBe(false);
  });

  it('should clear previous error on new successful emission', () => {
    const result = createLiveQuery<TestDoc>('items');

    subscribeCbs.error!(new Error('fail'));
    expect(result.error()).toBeTruthy();

    subscribeCbs.next!([{ _id: '1', name: 'OK' }]);
    expect(result.error()).toBe(null);
    expect(result.data()).toHaveLength(1);
  });
});

/* ================================================================== */
/*  createQuery — edge cases                                          */
/* ================================================================== */
describe('createQuery — edge cases', () => {
  beforeEach(() => {
    resetAll();
    setupQuery();
  });

  it('should not subscribe when enabled=false', () => {
    const result = createQuery<TestDoc>('todos', undefined, { enabled: false });

    expect(mockCollection.find).not.toHaveBeenCalled();
    expect(result.data()).toEqual([]);
    expect(result.isLoading()).toBe(false);
  });

  it('should pass enabled accessor through to live query', () => {
    createQuery<TestDoc>('todos', undefined, { enabled: () => false });

    expect(mockCollection.find).not.toHaveBeenCalled();
  });

  it('should handle filter with undefined values', () => {
    createQuery<TestDoc>('todos', { name: undefined as unknown as string });

    expect(mockCollection.find).toHaveBeenCalledWith({ name: undefined });
  });
});

/* ================================================================== */
/*  createMutation — error handling across all operation types         */
/* ================================================================== */
describe('createMutation — error handling for all operations', () => {
  beforeEach(() => {
    resetAll();
    setupMutations();
  });

  it('should set error when update fails', async () => {
    mockCollection.update.mockRejectedValue(new Error('update error'));
    const m = createMutation<TestDoc>('items');

    await expect(m.update('1', { name: 'bad' })).rejects.toThrow('update error');
    expect(m.error()!.message).toBe('update error');
    expect(m.isLoading()).toBe(false);
  });

  it('should set error when upsert fails', async () => {
    mockCollection.upsert.mockRejectedValue(new Error('upsert error'));
    const m = createMutation<TestDoc>('items');

    await expect(m.upsert('1', { name: 'bad' })).rejects.toThrow('upsert error');
    expect(m.error()!.message).toBe('upsert error');
  });

  it('should set error when remove fails', async () => {
    mockCollection.delete.mockRejectedValue(new Error('delete error'));
    const m = createMutation<TestDoc>('items');

    await expect(m.remove('1')).rejects.toThrow('delete error');
    expect(m.error()!.message).toBe('delete error');
  });

  it('should set error when removeMany fails', async () => {
    mockCollection.deleteMany.mockRejectedValue(new Error('deleteMany error'));
    const m = createMutation<TestDoc>('items');

    await expect(m.removeMany(['1', '2'])).rejects.toThrow('deleteMany error');
    expect(m.error()!.message).toBe('deleteMany error');
  });

  it('should set error when insertMany fails', async () => {
    mockCollection.insertMany.mockRejectedValue(new Error('insertMany error'));
    const m = createMutation<TestDoc>('items');

    await expect(m.insertMany([{ name: 'A' }])).rejects.toThrow('insertMany error');
    expect(m.error()!.message).toBe('insertMany error');
  });

  it('should clear error from a failed insert when update succeeds', async () => {
    mockCollection.insert.mockRejectedValueOnce(new Error('fail'));
    const m = createMutation<TestDoc>('items');

    await m.insert({ name: 'bad' }).catch(() => {});
    expect(m.error()).toBeTruthy();

    await m.update('1', { name: 'good' });
    expect(m.error()).toBe(null);
  });

  it('should wrap non-Error for update rejection', async () => {
    mockCollection.update.mockRejectedValue(42);
    const m = createMutation<TestDoc>('items');

    await m.update('1', { name: 'x' }).catch(() => {});
    expect(m.error()).toBeInstanceOf(Error);
    expect(m.error()!.message).toBe('42');
  });

  it('should wrap non-Error for remove rejection', async () => {
    mockCollection.delete.mockRejectedValue(null);
    const m = createMutation<TestDoc>('items');

    await m.remove('1').catch(() => {});
    expect(m.error()).toBeInstanceOf(Error);
  });

  it('should wrap non-Error for removeMany rejection', async () => {
    mockCollection.deleteMany.mockRejectedValue(false);
    const m = createMutation<TestDoc>('items');

    await m.removeMany(['1']).catch(() => {});
    expect(m.error()).toBeInstanceOf(Error);
  });

  it('should call onError for update failure', async () => {
    const onError = vi.fn();
    mockCollection.update.mockRejectedValue(new Error('e'));
    const m = createMutation<TestDoc>('items', { onError });

    await m.update('1', { name: 'x' }).catch(() => {});

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should call onError for remove failure', async () => {
    const onError = vi.fn();
    mockCollection.delete.mockRejectedValue(new Error('e'));
    const m = createMutation<TestDoc>('items', { onError });

    await m.remove('1').catch(() => {});

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should call onSuccess for upsert', async () => {
    const onSuccess = vi.fn();
    const m = createMutation<TestDoc>('items', { onSuccess });

    await m.upsert('1', { name: 'Upserted' });
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ name: 'Upserted' }));
  });

  it('should call onSuccess for removeMany', async () => {
    const onSuccess = vi.fn();
    const m = createMutation<TestDoc>('items', { onSuccess });

    await m.removeMany(['1', '2']);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});

/* ================================================================== */
/*  createOptimisticMutation — additional edge cases                  */
/* ================================================================== */
describe('createOptimisticMutation — additional edge cases', () => {
  beforeEach(() => {
    resetAll();
    setupMutations();
  });

  it('should not crash when calling rollback without prior optimistic update', () => {
    const m = createOptimisticMutation<TestDoc>('items');
    expect(() => m.rollback()).not.toThrow();
  });

  it('should generate temp ID starting with "temp_" during insert', async () => {
    const setData = vi.fn();
    const m = createOptimisticMutation<TestDoc>('items', {
      data: () => [],
      setData,
      optimisticUpdate: (data, mutation) => {
        if (mutation.type === 'insert') return [...data, mutation.doc];
        return data;
      },
    });

    await m.insert({ name: 'Temp' });

    expect(setData).toHaveBeenCalled();
    const firstCall = setData.mock.calls[0][0] as TestDoc[];
    expect(firstCall[0]._id).toMatch(/^temp_\d+$/);
  });

  it('should not apply optimistic update when only data/setData are given', async () => {
    const setData = vi.fn();
    const m = createOptimisticMutation<TestDoc>('items', {
      data: () => [],
      setData,
      // No optimisticUpdate → applyOptimistic is a no-op
    });

    await m.insert({ name: 'Plain' });
    expect(setData).not.toHaveBeenCalled();
  });

  it('should not apply optimistic update when only optimisticUpdate is given', async () => {
    const m = createOptimisticMutation<TestDoc>('items', {
      optimisticUpdate: (data, mutation) => {
        if (mutation.type === 'insert') return [...data, mutation.doc as TestDoc];
        return data;
      },
      // No data or setData
    });

    const result = await m.insert({ name: 'NoOp' });
    expect(result).toEqual({ _id: '1', name: 'New' });
  });

  it('should delegate insertMany to base mutation without optimistic logic', async () => {
    const setData = vi.fn();
    const m = createOptimisticMutation<TestDoc>('items', {
      data: () => [],
      setData,
      optimisticUpdate: () => [],
    });

    const result = await m.insertMany([{ name: 'A' }, { name: 'B' }]);

    expect(result).toHaveLength(2);
    expect(mockCollection.insertMany).toHaveBeenCalled();
  });

  it('should delegate upsert to base mutation', async () => {
    const m = createOptimisticMutation<TestDoc>('items');
    const result = await m.upsert('1', { name: 'Upserted' });

    expect(result.name).toBe('Upserted');
    expect(mockCollection.upsert).toHaveBeenCalledWith('1', { name: 'Upserted' });
  });

  it('should delegate removeMany to base mutation', async () => {
    const m = createOptimisticMutation<TestDoc>('items');
    await expect(m.removeMany(['1', '2'])).resolves.toBeUndefined();
    expect(mockCollection.deleteMany).toHaveBeenCalledWith(['1', '2']);
  });

  it('should rollback and propagate error on update failure', async () => {
    mockCollection.update.mockRejectedValue(new Error('fail'));
    const original = [{ _id: '1', name: 'Original', value: 1 }];
    const setData = vi.fn();

    const m = createOptimisticMutation<TestDoc>('items', {
      data: () => [...original],
      setData,
      optimisticUpdate: (data, mutation) => {
        if (mutation.type === 'update') {
          return data.map((d) => (d._id === mutation.id ? { ...d, ...mutation.changes } : d));
        }
        return data;
      },
    });

    await expect(m.update('1', { name: 'Bad' })).rejects.toThrow('fail');

    // Last setData call is the rollback
    const rollbackCall = setData.mock.calls[setData.mock.calls.length - 1][0];
    expect(rollbackCall[0].name).toBe('Original');
  });
});

/* ================================================================== */
/*  createSyncStatus — error consistency across operations            */
/* ================================================================== */
describe('createSyncStatus — error consistency', () => {
  beforeEach(() => {
    resetAll();
  });

  it('should wrap non-Error for push operation', async () => {
    const engine = createMockSyncEngine();
    (engine.push as ReturnType<typeof vi.fn>).mockRejectedValue(42);
    const result = createSyncStatus(engine);

    await result.push().catch(() => {});

    expect(result.error()).toBeInstanceOf(Error);
    expect(result.error()!.message).toBe('42');
  });

  it('should wrap non-Error for pull operation', async () => {
    const engine = createMockSyncEngine();
    (engine.pull as ReturnType<typeof vi.fn>).mockRejectedValue(null);
    const result = createSyncStatus(engine);

    await result.pull().catch(() => {});

    expect(result.error()).toBeInstanceOf(Error);
  });

  it('should wrap non-Error for start operation', async () => {
    const engine = createMockSyncEngine();
    (engine.start as ReturnType<typeof vi.fn>).mockRejectedValue('start-err');
    const result = createSyncStatus(engine, { autoStart: false });

    await result.start().catch(() => {});

    expect(result.error()).toBeInstanceOf(Error);
    expect(result.error()!.message).toBe('start-err');
  });

  it('should wrap non-Error for stop operation', async () => {
    const engine = createMockSyncEngine();
    (engine.stop as ReturnType<typeof vi.fn>).mockRejectedValue(false);
    const result = createSyncStatus(engine);

    await result.stop().catch(() => {});

    expect(result.error()).toBeInstanceOf(Error);
  });

  it('should clear forceSync error on subsequent successful push', async () => {
    const engine = createMockSyncEngine();
    (engine.forceSync as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('sync fail'));
    const result = createSyncStatus(engine);

    await result.forceSync().catch(() => {});
    expect(result.error()).toBeTruthy();

    await result.push();
    expect(result.error()).toBe(null);
  });

  it('should handle full status transition cycle', () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);
    runMountFns();

    engine._emitStatus('syncing');
    expect(result.status()).toBe('syncing');
    expect(result.isSyncing()).toBe(true);

    engine._emitStatus('idle');
    expect(result.status()).toBe('idle');
    expect(result.isSyncing()).toBe(false);

    engine._emitStatus('error');
    expect(result.status()).toBe('error');

    engine._emitStatus('offline');
    expect(result.status()).toBe('offline');

    engine._emitStatus('idle');
    expect(result.status()).toBe('idle');
    expect(result.error()).toBe(null);
  });

  it('should accumulate stats from successive emissions', () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);
    runMountFns();

    engine._emitStats({ ...defaultStats, pushCount: 5 });
    expect(result.stats().pushCount).toBe(5);

    engine._emitStats({ ...defaultStats, pushCount: 10, pullCount: 3 });
    expect(result.stats().pushCount).toBe(10);
    expect(result.stats().pullCount).toBe(3);
  });

  it('should handle null syncEngine for all operations without error', async () => {
    const result = createSyncStatus(null);

    await expect(result.forceSync()).resolves.toBeUndefined();
    await expect(result.push()).resolves.toBeUndefined();
    await expect(result.pull()).resolves.toBeUndefined();
    await expect(result.start()).resolves.toBeUndefined();
    await expect(result.stop()).resolves.toBeUndefined();
    expect(result.error()).toBe(null);
  });
});

/* ================================================================== */
/*  Behavioral invariants across primitives                           */
/* ================================================================== */
describe('behavioral invariants across primitives', () => {
  beforeEach(() => {
    resetAll();
    setupObserveById();
    setupQuery();
    setupChanges();
    mockCollection.findOne.mockResolvedValue(null);
    setupMutations();
  });

  it('all query primitives report isLoading=false when disabled', () => {
    expect(createDocument<TestDoc>('c', 'id', { enabled: false }).isLoading()).toBe(false);
    expect(createFindOne<TestDoc>('c', {}, { enabled: false }).isLoading()).toBe(false);
    expect(createLiveQuery<TestDoc>('c', undefined, { enabled: false }).isLoading()).toBe(false);
    expect(createQuery<TestDoc>('c', undefined, { enabled: false }).isLoading()).toBe(false);
  });

  it('all query primitives return empty data when disabled', () => {
    expect(createDocument<TestDoc>('c', 'id', { enabled: false }).data()).toBe(null);
    expect(createFindOne<TestDoc>('c', {}, { enabled: false }).data()).toBe(null);
    expect(createLiveQuery<TestDoc>('c', undefined, { enabled: false }).data()).toEqual([]);
    expect(createQuery<TestDoc>('c', undefined, { enabled: false }).data()).toEqual([]);
  });

  it('all query primitives start with error=null', () => {
    expect(createDocument<TestDoc>('c', 'id').error()).toBe(null);
    expect(createFindOne<TestDoc>('c', {}).error()).toBe(null);
    expect(createLiveQuery<TestDoc>('c').error()).toBe(null);
    expect(createQuery<TestDoc>('c').error()).toBe(null);
  });

  it('mutation primitives start with isLoading=false and error=null', () => {
    const m = createMutation<TestDoc>('c');
    expect(m.isLoading()).toBe(false);
    expect(m.error()).toBe(null);

    const om = createOptimisticMutation<TestDoc>('c');
    expect(om.isLoading()).toBe(false);
    expect(om.error()).toBe(null);
  });

  it('createSyncStatus with null engine has safe defaults', () => {
    const result = createSyncStatus(null);

    expect(result.status()).toBe('idle');
    expect(result.isSyncing()).toBe(false);
    expect(result.stats()).toEqual(defaultStats);
    expect(result.error()).toBe(null);
  });

  it('all query primitives expose refresh as a function', () => {
    expect(typeof createDocument<TestDoc>('c', 'id').refresh).toBe('function');
    expect(typeof createFindOne<TestDoc>('c', {}).refresh).toBe('function');
    expect(typeof createLiveQuery<TestDoc>('c').refresh).toBe('function');
    expect(typeof createQuery<TestDoc>('c').refresh).toBe('function');
  });

  it('mutation result has resetError that clears error state', async () => {
    mockCollection.insert.mockRejectedValueOnce(new Error('fail'));
    const m = createMutation<TestDoc>('c');

    await m.insert({ name: 'bad' }).catch(() => {});
    expect(m.error()).toBeTruthy();

    m.resetError();
    expect(m.error()).toBe(null);
  });
});
