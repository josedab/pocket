/**
 * Tests for createDocument and createFindOne primitives.
 *
 * Strategy: Mock solid-js and useCollection, then verify subscription
 * lifecycle, data flow, and cleanup for single-document observers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Hoisted shared state                                              */
/* ------------------------------------------------------------------ */
const { cleanupFns, mockCollection, mockUnsubscribe, observeByIdCbs, changesCbs } = vi.hoisted(
  () => ({
    cleanupFns: [] as (() => void)[],
    mockUnsubscribe: vi.fn(),
    observeByIdCbs: {
      next: null as null | ((d: unknown) => void),
      error: null as null | ((e: unknown) => void),
    },
    changesCbs: {
      next: null as null | ((d: unknown) => void),
    },
    mockCollection: {
      observeById: vi.fn(),
      get: vi.fn(),
      find: vi.fn(),
      findOne: vi.fn(),
      changes: vi.fn(),
    },
  })
);

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
  onCleanup: (fn: () => void) => {
    cleanupFns.push(fn);
  },
  onMount: (fn: () => void) => fn(),
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
import { createDocument, createFindOne } from '../primitives/create-document.js';

/* ------------------------------------------------------------------ */
/*  Test helpers                                                      */
/* ------------------------------------------------------------------ */
interface TestDoc {
  _id: string;
  name: string;
}

function setupObserveByIdMock() {
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

function setupChangesMock() {
  changesCbs.next = null;
  mockCollection.changes.mockReturnValue({
    subscribe: vi.fn((cbs: { next: (d: unknown) => void }) => {
      changesCbs.next = cbs.next;
      return { unsubscribe: vi.fn() };
    }),
  });
}

/* ================================================================== */
/*  createDocument                                                    */
/* ================================================================== */
describe('createDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupFns.length = 0;
    setupObserveByIdMock();
  });

  /* ---------- Initial state ---------- */

  it('should return data, isLoading, error, and refresh', () => {
    const result = createDocument<TestDoc>('users', 'user-1');
    expect(typeof result.data).toBe('function');
    expect(typeof result.isLoading).toBe('function');
    expect(typeof result.error).toBe('function');
    expect(typeof result.refresh).toBe('function');
  });

  it('should start with isLoading=true before first emission', () => {
    const result = createDocument<TestDoc>('users', 'user-1');
    expect(result.isLoading()).toBe(true);
    expect(result.data()).toBe(null);
    expect(result.error()).toBe(null);
  });

  /* ---------- Subscription lifecycle ---------- */

  it('should subscribe to observeById with the correct id', () => {
    createDocument<TestDoc>('users', 'user-42');
    expect(mockCollection.observeById).toHaveBeenCalledWith('user-42');
  });

  it('should subscribe with accessor id', () => {
    createDocument<TestDoc>('users', () => 'user-99');
    expect(mockCollection.observeById).toHaveBeenCalledWith('user-99');
  });

  /* ---------- Reactive updates ---------- */

  it('should update data when document is emitted', () => {
    const result = createDocument<TestDoc>('users', 'user-1');
    const doc = { _id: 'user-1', name: 'Alice' };

    observeByIdCbs.next!(doc);

    expect(result.data()).toEqual(doc);
    expect(result.isLoading()).toBe(false);
    expect(result.error()).toBe(null);
  });

  it('should handle null document (deleted/not found)', () => {
    const result = createDocument<TestDoc>('users', 'user-1');

    observeByIdCbs.next!(null);

    expect(result.data()).toBe(null);
    expect(result.isLoading()).toBe(false);
  });

  it('should handle document updates over time', () => {
    const result = createDocument<TestDoc>('users', 'user-1');

    observeByIdCbs.next!({ _id: 'user-1', name: 'Alice' });
    expect(result.data()?.name).toBe('Alice');

    observeByIdCbs.next!({ _id: 'user-1', name: 'Alice Updated' });
    expect(result.data()?.name).toBe('Alice Updated');
  });

  /* ---------- Error handling ---------- */

  it('should set error when observable errors', () => {
    const result = createDocument<TestDoc>('users', 'user-1');
    const err = new Error('not found');

    observeByIdCbs.error!(err);

    expect(result.error()).toBe(err);
    expect(result.isLoading()).toBe(false);
  });

  it('should wrap non-Error in Error object', () => {
    const result = createDocument<TestDoc>('users', 'user-1');

    observeByIdCbs.error!('string error');

    expect(result.error()).toBeInstanceOf(Error);
    expect(result.error()!.message).toBe('string error');
  });

  it('should clear error on successful emission after error', () => {
    const result = createDocument<TestDoc>('users', 'user-1');

    observeByIdCbs.error!(new Error('fail'));
    expect(result.error()).toBeTruthy();

    observeByIdCbs.next!({ _id: 'user-1', name: 'Recovered' });
    expect(result.error()).toBe(null);
  });

  /* ---------- Null / undefined id ---------- */

  it('should not subscribe when id is null (string)', () => {
    const result = createDocument<TestDoc>('users', null);

    expect(mockCollection.observeById).not.toHaveBeenCalled();
    expect(result.data()).toBe(null);
    expect(result.isLoading()).toBe(false);
  });

  it('should not subscribe when accessor returns null', () => {
    const result = createDocument<TestDoc>('users', () => null);

    expect(mockCollection.observeById).not.toHaveBeenCalled();
    expect(result.data()).toBe(null);
    expect(result.isLoading()).toBe(false);
  });

  /* ---------- enabled option ---------- */

  it('should not subscribe when enabled=false', () => {
    const result = createDocument<TestDoc>('users', 'user-1', {
      enabled: false,
    });

    expect(mockCollection.observeById).not.toHaveBeenCalled();
    expect(result.data()).toBe(null);
    expect(result.isLoading()).toBe(false);
  });

  it('should not subscribe when enabled accessor returns false', () => {
    const result = createDocument<TestDoc>('users', 'user-1', {
      enabled: () => false,
    });

    expect(mockCollection.observeById).not.toHaveBeenCalled();
    expect(result.data()).toBe(null);
    expect(result.isLoading()).toBe(false);
  });

  it('should subscribe when enabled=true', () => {
    createDocument<TestDoc>('users', 'user-1', { enabled: true });
    expect(mockCollection.observeById).toHaveBeenCalled();
  });

  it('should subscribe when enabled accessor returns true', () => {
    createDocument<TestDoc>('users', 'user-1', { enabled: () => true });
    expect(mockCollection.observeById).toHaveBeenCalled();
  });

  /* ---------- Refresh ---------- */

  it('should fetch document on refresh', async () => {
    const doc = { _id: 'user-1', name: 'Fresh' };
    mockCollection.get.mockResolvedValue(doc);

    const result = createDocument<TestDoc>('users', 'user-1');
    result.refresh();

    await new Promise((r) => setTimeout(r, 0));

    expect(mockCollection.get).toHaveBeenCalledWith('user-1');
    expect(result.data()).toEqual(doc);
    expect(result.isLoading()).toBe(false);
    expect(result.error()).toBe(null);
  });

  it('should handle null result on refresh', async () => {
    mockCollection.get.mockResolvedValue(null);

    const result = createDocument<TestDoc>('users', 'user-1');
    result.refresh();

    await new Promise((r) => setTimeout(r, 0));

    expect(result.data()).toBe(null);
    expect(result.isLoading()).toBe(false);
  });

  it('should set error when refresh fails', async () => {
    mockCollection.get.mockRejectedValue(new Error('get failed'));

    const result = createDocument<TestDoc>('users', 'user-1');
    result.refresh();

    await new Promise((r) => setTimeout(r, 0));

    expect(result.error()!.message).toBe('get failed');
    expect(result.isLoading()).toBe(false);
  });

  it('should wrap non-Error on refresh failure', async () => {
    mockCollection.get.mockRejectedValue('raw error');

    const result = createDocument<TestDoc>('users', 'user-1');
    result.refresh();

    await new Promise((r) => setTimeout(r, 0));

    expect(result.error()).toBeInstanceOf(Error);
    expect(result.error()!.message).toBe('raw error');
  });

  it('should do nothing on refresh when disabled', () => {
    const result = createDocument<TestDoc>('users', 'user-1', {
      enabled: false,
    });
    result.refresh();
    expect(mockCollection.get).not.toHaveBeenCalled();
  });

  it('should do nothing on refresh when id is null', () => {
    const result = createDocument<TestDoc>('users', null);
    result.refresh();
    expect(mockCollection.get).not.toHaveBeenCalled();
  });

  /* ---------- Cleanup ---------- */

  it('should register onCleanup', () => {
    createDocument<TestDoc>('users', 'user-1');
    expect(cleanupFns.length).toBeGreaterThan(0);
  });

  it('should unsubscribe on cleanup', () => {
    createDocument<TestDoc>('users', 'user-1');
    for (const fn of cleanupFns) fn();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should handle cleanup without active subscription', () => {
    createDocument<TestDoc>('users', null);
    expect(() => {
      for (const fn of cleanupFns) fn();
    }).not.toThrow();
  });
});

/* ================================================================== */
/*  createFindOne                                                     */
/* ================================================================== */
describe('createFindOne', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupFns.length = 0;
    setupChangesMock();
    mockCollection.findOne.mockResolvedValue(null);
  });

  it('should return DocumentResult shape', () => {
    const result = createFindOne<TestDoc>('users', { name: 'Admin' });
    expect(typeof result.data).toBe('function');
    expect(typeof result.isLoading).toBe('function');
    expect(typeof result.error).toBe('function');
    expect(typeof result.refresh).toBe('function');
  });

  it('should call findOne with static filter', () => {
    createFindOne<TestDoc>('users', { name: 'Admin' });
    expect(mockCollection.findOne).toHaveBeenCalledWith({ name: 'Admin' });
  });

  it('should call findOne with accessor filter', () => {
    createFindOne<TestDoc>('users', () => ({ name: 'Dynamic' }));
    expect(mockCollection.findOne).toHaveBeenCalledWith({ name: 'Dynamic' });
  });

  it('should subscribe to collection changes', () => {
    createFindOne<TestDoc>('users', { name: 'Admin' });
    expect(mockCollection.changes).toHaveBeenCalled();
  });

  it('should update data when findOne resolves', async () => {
    const doc = { _id: '1', name: 'Admin' };
    mockCollection.findOne.mockResolvedValue(doc);

    const result = createFindOne<TestDoc>('users', { name: 'Admin' });

    await new Promise((r) => setTimeout(r, 0));

    expect(result.data()).toEqual(doc);
    expect(result.isLoading()).toBe(false);
  });

  it('should re-fetch when changes occur', async () => {
    mockCollection.findOne.mockResolvedValue({ _id: '1', name: 'First' });

    createFindOne<TestDoc>('users', { name: 'Admin' });
    await new Promise((r) => setTimeout(r, 0));

    // Simulate a collection change
    mockCollection.findOne.mockResolvedValue({ _id: '1', name: 'Updated' });
    changesCbs.next!({});
    await new Promise((r) => setTimeout(r, 0));

    expect(mockCollection.findOne).toHaveBeenCalledTimes(2);
  });

  it('should handle findOne error', async () => {
    mockCollection.findOne.mockRejectedValue(new Error('query failed'));

    const result = createFindOne<TestDoc>('users', { name: 'Admin' });
    await new Promise((r) => setTimeout(r, 0));

    expect(result.error()!.message).toBe('query failed');
    expect(result.isLoading()).toBe(false);
  });

  it('should not subscribe when enabled=false', () => {
    createFindOne<TestDoc>('users', { name: 'Admin' }, { enabled: false });
    expect(mockCollection.findOne).not.toHaveBeenCalled();
    expect(mockCollection.changes).not.toHaveBeenCalled();
  });

  it('should register onCleanup for changes subscription', () => {
    createFindOne<TestDoc>('users', { name: 'Admin' });
    expect(cleanupFns.length).toBeGreaterThan(0);
  });

  it('should support refresh to re-fetch', async () => {
    mockCollection.findOne.mockResolvedValue({ _id: '1', name: 'Refreshed' });

    const result = createFindOne<TestDoc>('users', { name: 'Admin' });
    result.refresh();
    await new Promise((r) => setTimeout(r, 0));

    // findOne called during subscribe + refresh
    expect(mockCollection.findOne).toHaveBeenCalledTimes(2);
  });
});
