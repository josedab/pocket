/**
 * Tests for createMutation and createOptimisticMutation primitives.
 *
 * These primitives wrap collection CRUD operations with loading/error state.
 * No createEffect/onCleanup needed – just createSignal for state tracking.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Hoisted shared state                                              */
/* ------------------------------------------------------------------ */
const { mockCollection } = vi.hoisted(() => ({
  mockCollection: {
    insert: vi.fn(),
    insertMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

/* ------------------------------------------------------------------ */
/*  Mock solid-js                                                     */
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
  onCleanup: vi.fn(),
  onMount: vi.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Mock context provider                                             */
/* ------------------------------------------------------------------ */
vi.mock('../context/provider.js', () => ({
  useCollection: () => mockCollection,
}));

/* ------------------------------------------------------------------ */
/*  Import under test                                                 */
/* ------------------------------------------------------------------ */
import { createMutation, createOptimisticMutation } from '../primitives/create-mutation.js';

/* ------------------------------------------------------------------ */
/*  Test helpers                                                      */
/* ------------------------------------------------------------------ */
interface TestDoc {
  _id: string;
  title: string;
  done: boolean;
}

/* ================================================================== */
/*  createMutation                                                    */
/* ================================================================== */
describe('createMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default successful mocks
    mockCollection.insert.mockResolvedValue({ _id: '1', title: 'New', done: false });
    mockCollection.insertMany.mockResolvedValue([
      { _id: '1', title: 'A', done: false },
      { _id: '2', title: 'B', done: false },
    ]);
    mockCollection.update.mockResolvedValue({ _id: '1', title: 'Updated', done: true });
    mockCollection.upsert.mockResolvedValue({ _id: '1', title: 'Upserted', done: false });
    mockCollection.delete.mockResolvedValue(undefined);
    mockCollection.deleteMany.mockResolvedValue(undefined);
  });

  /* ---------- Return shape ---------- */

  it('should return all expected mutation functions and state', () => {
    const m = createMutation<TestDoc>('todos');
    expect(typeof m.insert).toBe('function');
    expect(typeof m.insertMany).toBe('function');
    expect(typeof m.update).toBe('function');
    expect(typeof m.upsert).toBe('function');
    expect(typeof m.remove).toBe('function');
    expect(typeof m.removeMany).toBe('function');
    expect(typeof m.isLoading).toBe('function');
    expect(typeof m.error).toBe('function');
    expect(typeof m.resetError).toBe('function');
  });

  it('should start with isLoading=false and error=null', () => {
    const m = createMutation<TestDoc>('todos');
    expect(m.isLoading()).toBe(false);
    expect(m.error()).toBe(null);
  });

  /* ---------- Insert ---------- */

  it('should call collection.insert and return result', async () => {
    const m = createMutation<TestDoc>('todos');
    const doc = { title: 'New', done: false };

    const result = await m.insert(doc);

    expect(mockCollection.insert).toHaveBeenCalledWith(doc);
    expect(result).toEqual({ _id: '1', title: 'New', done: false });
  });

  it('should set isLoading=false after insert completes', async () => {
    const m = createMutation<TestDoc>('todos');
    await m.insert({ title: 'Test', done: false });
    expect(m.isLoading()).toBe(false);
  });

  /* ---------- InsertMany ---------- */

  it('should call collection.insertMany and return results', async () => {
    const m = createMutation<TestDoc>('todos');
    const docs = [
      { title: 'A', done: false },
      { title: 'B', done: false },
    ];

    const result = await m.insertMany(docs);

    expect(mockCollection.insertMany).toHaveBeenCalledWith(docs);
    expect(result).toHaveLength(2);
  });

  /* ---------- Update ---------- */

  it('should call collection.update with id and changes', async () => {
    const m = createMutation<TestDoc>('todos');

    const result = await m.update('1', { title: 'Updated' });

    expect(mockCollection.update).toHaveBeenCalledWith('1', { title: 'Updated' });
    expect(result.title).toBe('Updated');
  });

  /* ---------- Upsert ---------- */

  it('should call collection.upsert with id and doc', async () => {
    const m = createMutation<TestDoc>('todos');

    const result = await m.upsert('1', { title: 'Upserted', done: false });

    expect(mockCollection.upsert).toHaveBeenCalledWith('1', {
      title: 'Upserted',
      done: false,
    });
    expect(result.title).toBe('Upserted');
  });

  /* ---------- Remove ---------- */

  it('should call collection.delete with id', async () => {
    const m = createMutation<TestDoc>('todos');

    await m.remove('1');

    expect(mockCollection.delete).toHaveBeenCalledWith('1');
  });

  /* ---------- RemoveMany ---------- */

  it('should call collection.deleteMany with ids', async () => {
    const m = createMutation<TestDoc>('todos');

    await m.removeMany(['1', '2', '3']);

    expect(mockCollection.deleteMany).toHaveBeenCalledWith(['1', '2', '3']);
  });

  /* ---------- Loading state ---------- */

  it('should set isLoading=true during operation', async () => {
    let resolveInsert!: (v: TestDoc) => void;
    mockCollection.insert.mockReturnValue(
      new Promise((resolve) => {
        resolveInsert = resolve;
      })
    );

    const m = createMutation<TestDoc>('todos');
    const promise = m.insert({ title: 'Pending', done: false });

    // isLoading should be true while promise is pending
    expect(m.isLoading()).toBe(true);

    resolveInsert({ _id: '1', title: 'Pending', done: false });
    await promise;

    expect(m.isLoading()).toBe(false);
  });

  /* ---------- Error handling ---------- */

  it('should set error on mutation failure', async () => {
    mockCollection.insert.mockRejectedValue(new Error('insert failed'));
    const m = createMutation<TestDoc>('todos');

    await expect(m.insert({ title: 'Bad', done: false })).rejects.toThrow('insert failed');

    expect(m.error()!.message).toBe('insert failed');
    expect(m.isLoading()).toBe(false);
  });

  it('should wrap non-Error in Error object', async () => {
    mockCollection.insert.mockRejectedValue('raw string');
    const m = createMutation<TestDoc>('todos');

    await expect(m.insert({ title: 'Bad', done: false })).rejects.toThrow('raw string');

    expect(m.error()).toBeInstanceOf(Error);
    expect(m.error()!.message).toBe('raw string');
  });

  it('should clear error on next successful mutation', async () => {
    mockCollection.insert.mockRejectedValueOnce(new Error('fail'));
    mockCollection.insert.mockResolvedValueOnce({ _id: '1', title: 'OK', done: false });

    const m = createMutation<TestDoc>('todos');

    await m.insert({ title: 'Bad', done: false }).catch(() => {});
    expect(m.error()).toBeTruthy();

    await m.insert({ title: 'OK', done: false });
    expect(m.error()).toBe(null);
  });

  it('should reset error via resetError()', async () => {
    mockCollection.insert.mockRejectedValue(new Error('fail'));
    const m = createMutation<TestDoc>('todos');

    await m.insert({ title: 'Bad', done: false }).catch(() => {});
    expect(m.error()).toBeTruthy();

    m.resetError();
    expect(m.error()).toBe(null);
  });

  /* ---------- Callbacks ---------- */

  it('should call onSuccess callback after successful mutation', async () => {
    const onSuccess = vi.fn();
    const m = createMutation<TestDoc>('todos', { onSuccess });

    await m.insert({ title: 'Test', done: false });

    expect(onSuccess).toHaveBeenCalledWith({ _id: '1', title: 'New', done: false });
  });

  it('should call onError callback on mutation failure', async () => {
    const onError = vi.fn();
    mockCollection.insert.mockRejectedValue(new Error('fail'));

    const m = createMutation<TestDoc>('todos', { onError });

    await m.insert({ title: 'Bad', done: false }).catch(() => {});

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe('fail');
  });

  it('should re-throw error after setting state', async () => {
    mockCollection.update.mockRejectedValue(new Error('update failed'));
    const m = createMutation<TestDoc>('todos');

    await expect(m.update('1', { title: 'Bad' })).rejects.toThrow('update failed');
  });

  it('should call onSuccess for all mutation types', async () => {
    const onSuccess = vi.fn();
    const m = createMutation<TestDoc>('todos', { onSuccess });

    await m.insert({ title: 'A', done: false });
    expect(onSuccess).toHaveBeenCalledTimes(1);

    await m.update('1', { title: 'B' });
    expect(onSuccess).toHaveBeenCalledTimes(2);

    await m.remove('1');
    expect(onSuccess).toHaveBeenCalledTimes(3);
  });
});

/* ================================================================== */
/*  createOptimisticMutation                                          */
/* ================================================================== */
describe('createOptimisticMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.insert.mockResolvedValue({ _id: 'real-1', title: 'From DB', done: false });
    mockCollection.update.mockResolvedValue({ _id: '1', title: 'Updated', done: true });
    mockCollection.delete.mockResolvedValue(undefined);
    mockCollection.insertMany.mockResolvedValue([]);
    mockCollection.upsert.mockResolvedValue({ _id: '1', title: 'Upserted', done: false });
    mockCollection.deleteMany.mockResolvedValue(undefined);
  });

  it('should return all mutation functions plus rollback', () => {
    const m = createOptimisticMutation<TestDoc>('todos');
    expect(typeof m.insert).toBe('function');
    expect(typeof m.update).toBe('function');
    expect(typeof m.remove).toBe('function');
    expect(typeof m.rollback).toBe('function');
    expect(typeof m.insertMany).toBe('function');
    expect(typeof m.upsert).toBe('function');
    expect(typeof m.removeMany).toBe('function');
  });

  it('should apply optimistic insert', async () => {
    const items: TestDoc[] = [];
    const setData = vi.fn((d: TestDoc[]) => {
      items.length = 0;
      items.push(...d);
    });

    const m = createOptimisticMutation<TestDoc>('todos', {
      data: () => items,
      setData,
      optimisticUpdate: (data, mutation) => {
        if (mutation.type === 'insert') return [...data, mutation.doc];
        return data;
      },
    });

    await m.insert({ title: 'Optimistic', done: false });

    // setData should have been called with the optimistic data
    expect(setData).toHaveBeenCalled();
    const firstCall = setData.mock.calls[0][0];
    expect(firstCall).toHaveLength(1);
    expect(firstCall[0].title).toBe('Optimistic');
  });

  it('should apply optimistic update', async () => {
    const items: TestDoc[] = [{ _id: '1', title: 'Old', done: false }];
    const setData = vi.fn((d: TestDoc[]) => {
      items.length = 0;
      items.push(...d);
    });

    const m = createOptimisticMutation<TestDoc>('todos', {
      data: () => [...items],
      setData,
      optimisticUpdate: (data, mutation) => {
        if (mutation.type === 'update') {
          return data.map((d) => (d._id === mutation.id ? { ...d, ...mutation.changes } : d));
        }
        return data;
      },
    });

    await m.update('1', { title: 'New Title' });

    expect(setData).toHaveBeenCalled();
  });

  it('should apply optimistic delete', async () => {
    const items: TestDoc[] = [
      { _id: '1', title: 'Keep', done: false },
      { _id: '2', title: 'Remove', done: false },
    ];
    const setData = vi.fn((d: TestDoc[]) => {
      items.length = 0;
      items.push(...d);
    });

    const m = createOptimisticMutation<TestDoc>('todos', {
      data: () => [...items],
      setData,
      optimisticUpdate: (data, mutation) => {
        if (mutation.type === 'delete') {
          return data.filter((d) => d._id !== mutation.id);
        }
        return data;
      },
    });

    await m.remove('2');

    expect(setData).toHaveBeenCalled();
    const firstCall = setData.mock.calls[0][0];
    expect(firstCall).toHaveLength(1);
    expect(firstCall[0]._id).toBe('1');
  });

  it('should rollback on insert failure', async () => {
    mockCollection.insert.mockRejectedValue(new Error('insert failed'));

    const items: TestDoc[] = [{ _id: 'existing', title: 'Existing', done: false }];
    const setData = vi.fn();

    const m = createOptimisticMutation<TestDoc>('todos', {
      data: () => [...items],
      setData,
      optimisticUpdate: (data, mutation) => {
        if (mutation.type === 'insert') return [...data, mutation.doc];
        return data;
      },
    });

    await expect(m.insert({ title: 'Bad', done: false })).rejects.toThrow('insert failed');

    // setData should have been called twice: once for optimistic, once for rollback
    expect(setData).toHaveBeenCalledTimes(2);
    // The rollback call should restore original data
    const rollbackCall = setData.mock.calls[1][0];
    expect(rollbackCall).toHaveLength(1);
    expect(rollbackCall[0]._id).toBe('existing');
  });

  it('should rollback on update failure', async () => {
    mockCollection.update.mockRejectedValue(new Error('update failed'));

    const original = [{ _id: '1', title: 'Original', done: false }];
    const setData = vi.fn();

    const m = createOptimisticMutation<TestDoc>('todos', {
      data: () => [...original],
      setData,
      optimisticUpdate: (data, mutation) => {
        if (mutation.type === 'update') {
          return data.map((d) => (d._id === mutation.id ? { ...d, ...mutation.changes } : d));
        }
        return data;
      },
    });

    await expect(m.update('1', { title: 'Bad' })).rejects.toThrow('update failed');

    // Rollback should restore original data
    const rollbackCall = setData.mock.calls[setData.mock.calls.length - 1][0];
    expect(rollbackCall[0].title).toBe('Original');
  });

  it('should rollback on remove failure', async () => {
    mockCollection.delete.mockRejectedValue(new Error('delete failed'));

    const original = [
      { _id: '1', title: 'A', done: false },
      { _id: '2', title: 'B', done: false },
    ];
    const setData = vi.fn();

    const m = createOptimisticMutation<TestDoc>('todos', {
      data: () => [...original],
      setData,
      optimisticUpdate: (data, mutation) => {
        if (mutation.type === 'delete') {
          return data.filter((d) => d._id !== mutation.id);
        }
        return data;
      },
    });

    await expect(m.remove('2')).rejects.toThrow('delete failed');

    const rollbackCall = setData.mock.calls[setData.mock.calls.length - 1][0];
    expect(rollbackCall).toHaveLength(2);
  });

  it('should work without optimisticUpdate options', async () => {
    const m = createOptimisticMutation<TestDoc>('todos');

    const result = await m.insert({ title: 'Plain', done: false });
    expect(result).toEqual({ _id: 'real-1', title: 'From DB', done: false });
  });

  it('should manual rollback restore previous data', () => {
    const setData = vi.fn();

    const m = createOptimisticMutation<TestDoc>('todos', {
      data: () => [{ _id: '1', title: 'Current', done: false }],
      setData,
      optimisticUpdate: (data, mutation) => {
        if (mutation.type === 'insert') return [...data, mutation.doc];
        return data;
      },
    });

    // Start an insert but don't await (to test manual rollback)
    // We can call rollback after the optimistic update is applied
    // Since insert is async and we mock it, the optimistic update happens synchronously
    const promise = m.insert({ title: 'Temp', done: false });
    // At this point, setData was called with optimistic data

    m.rollback();

    // The rollback call should restore data
    const lastCall = setData.mock.calls[setData.mock.calls.length - 1][0];
    expect(lastCall).toHaveLength(1);
    expect(lastCall[0].title).toBe('Current');

    // Clean up the promise
    return promise.catch(() => {});
  });
});
