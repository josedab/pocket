/**
 * Tests for createLiveQuery and createQuery primitives.
 *
 * Strategy: Mock solid-js with synchronous implementations so createEffect
 * fires immediately, and mock useCollection to return controllable mocks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Hoisted shared state (available inside vi.mock factories)         */
/* ------------------------------------------------------------------ */
const { cleanupFns, mockCollection, mockQueryBuilder, mockUnsubscribe, subscribeCbs } = vi.hoisted(
  () => ({
    cleanupFns: [] as (() => void)[],
    mockUnsubscribe: vi.fn(),
    subscribeCbs: {
      next: null as null | ((d: unknown[]) => void),
      error: null as null | ((e: unknown) => void),
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
    },
  })
);

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
  onMount: (fn: () => void) => fn(),
}));

/* ------------------------------------------------------------------ */
/*  Mock context provider                                             */
/* ------------------------------------------------------------------ */
vi.mock('../context/provider.js', () => ({
  useCollection: () => mockCollection,
}));

/* ------------------------------------------------------------------ */
/*  Import under test (after mocks)                                   */
/* ------------------------------------------------------------------ */
import { createLiveQuery, createQuery } from '../primitives/create-live-query.js';

/* ------------------------------------------------------------------ */
/*  Test helpers                                                      */
/* ------------------------------------------------------------------ */
interface TestDoc {
  _id: string;
  title: string;
}

function setupDefaultMocks() {
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

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */
describe('createLiveQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupFns.length = 0;
    setupDefaultMocks();
  });

  /* ---------- Initial state ---------- */

  it('should return data, isLoading, error, and refresh', () => {
    const result = createLiveQuery<TestDoc>('todos');
    expect(typeof result.data).toBe('function');
    expect(typeof result.isLoading).toBe('function');
    expect(typeof result.error).toBe('function');
    expect(typeof result.refresh).toBe('function');
  });

  it('should start with isLoading=true before first emission', () => {
    const result = createLiveQuery<TestDoc>('todos');
    expect(result.isLoading()).toBe(true);
    expect(result.data()).toEqual([]);
    expect(result.error()).toBe(null);
  });

  /* ---------- Subscription lifecycle ---------- */

  it('should call useCollection with the collection name', () => {
    createLiveQuery<TestDoc>('my-collection');
    // useCollection is called at the top of createLiveQuery; since the mock returns
    // mockCollection, collection.find() would be called – verify via find:
    expect(mockCollection.find).toHaveBeenCalled();
  });

  it('should subscribe to live observable on creation', () => {
    createLiveQuery<TestDoc>('todos');
    expect(mockCollection.find).toHaveBeenCalledTimes(1);
    expect(mockQueryBuilder.live).toHaveBeenCalledTimes(1);
    expect(subscribeCbs.next).toBeDefined();
  });

  it('should pass default options to live()', () => {
    createLiveQuery<TestDoc>('todos');
    expect(mockQueryBuilder.live).toHaveBeenCalledWith({
      debounceMs: 0,
      useEventReduce: true,
    });
  });

  it('should pass custom debounceMs to live()', () => {
    createLiveQuery<TestDoc>('todos', undefined, { debounceMs: 200 });
    expect(mockQueryBuilder.live).toHaveBeenCalledWith(
      expect.objectContaining({ debounceMs: 200 })
    );
  });

  it('should pass custom useEventReduce to live()', () => {
    createLiveQuery<TestDoc>('todos', undefined, { useEventReduce: false });
    expect(mockQueryBuilder.live).toHaveBeenCalledWith(
      expect.objectContaining({ useEventReduce: false })
    );
  });

  /* ---------- Reactive updates ---------- */

  it('should update data when observable emits results', () => {
    const result = createLiveQuery<TestDoc>('todos');
    const docs = [
      { _id: '1', title: 'A' },
      { _id: '2', title: 'B' },
    ];

    subscribeCbs.next!(docs);

    expect(result.data()).toEqual(docs);
    expect(result.isLoading()).toBe(false);
    expect(result.error()).toBe(null);
  });

  it('should handle multiple emissions', () => {
    const result = createLiveQuery<TestDoc>('todos');

    subscribeCbs.next!([{ _id: '1', title: 'First' }]);
    expect(result.data()).toHaveLength(1);

    subscribeCbs.next!([
      { _id: '1', title: 'First' },
      { _id: '2', title: 'Second' },
    ]);
    expect(result.data()).toHaveLength(2);
  });

  it('should handle empty emissions', () => {
    const result = createLiveQuery<TestDoc>('todos');
    subscribeCbs.next!([]);
    expect(result.data()).toEqual([]);
    expect(result.isLoading()).toBe(false);
  });

  /* ---------- Error handling ---------- */

  it('should set error when observable errors with Error instance', () => {
    const result = createLiveQuery<TestDoc>('todos');
    const err = new Error('DB failure');

    subscribeCbs.error!(err);

    expect(result.error()).toBe(err);
    expect(result.isLoading()).toBe(false);
  });

  it('should wrap non-Error in Error object', () => {
    const result = createLiveQuery<TestDoc>('todos');

    subscribeCbs.error!('string error');

    expect(result.error()).toBeInstanceOf(Error);
    expect(result.error()!.message).toBe('string error');
    expect(result.isLoading()).toBe(false);
  });

  it('should clear error on successful emission after error', () => {
    const result = createLiveQuery<TestDoc>('todos');

    subscribeCbs.error!(new Error('fail'));
    expect(result.error()).toBeTruthy();

    subscribeCbs.next!([{ _id: '1', title: 'OK' }]);
    expect(result.error()).toBe(null);
  });

  /* ---------- Query function ---------- */

  it('should use queryFn when provided', () => {
    const customBuilder = {
      live: vi.fn().mockReturnValue({
        subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
      }),
    };
    const queryFn = vi.fn().mockReturnValue(customBuilder);

    createLiveQuery<TestDoc>('todos', queryFn);

    expect(queryFn).toHaveBeenCalledWith(mockCollection);
    expect(customBuilder.live).toHaveBeenCalled();
    // collection.find should NOT be called when queryFn is provided
    expect(mockCollection.find).not.toHaveBeenCalled();
  });

  it('should default to collection.find() without queryFn', () => {
    createLiveQuery<TestDoc>('todos');
    expect(mockCollection.find).toHaveBeenCalledTimes(1);
  });

  /* ---------- enabled option ---------- */

  it('should not subscribe when enabled=false', () => {
    const result = createLiveQuery<TestDoc>('todos', undefined, { enabled: false });

    expect(mockCollection.find).not.toHaveBeenCalled();
    expect(result.data()).toEqual([]);
    expect(result.isLoading()).toBe(false);
  });

  it('should not subscribe when enabled accessor returns false', () => {
    const result = createLiveQuery<TestDoc>('todos', undefined, {
      enabled: () => false,
    });

    expect(mockCollection.find).not.toHaveBeenCalled();
    expect(result.data()).toEqual([]);
    expect(result.isLoading()).toBe(false);
  });

  it('should subscribe when enabled=true', () => {
    createLiveQuery<TestDoc>('todos', undefined, { enabled: true });
    expect(mockCollection.find).toHaveBeenCalled();
  });

  it('should subscribe when enabled accessor returns true', () => {
    createLiveQuery<TestDoc>('todos', undefined, { enabled: () => true });
    expect(mockCollection.find).toHaveBeenCalled();
  });

  /* ---------- Refresh ---------- */

  it('should re-execute query on refresh', async () => {
    const refreshedDocs = [{ _id: '1', title: 'Refreshed' }];
    mockQueryBuilder.exec.mockResolvedValue(refreshedDocs);

    const result = createLiveQuery<TestDoc>('todos');
    result.refresh();

    // Wait for the promise chain to resolve
    await new Promise((r) => setTimeout(r, 0));

    expect(mockQueryBuilder.exec).toHaveBeenCalled();
    expect(result.data()).toEqual(refreshedDocs);
    expect(result.isLoading()).toBe(false);
    expect(result.error()).toBe(null);
  });

  it('should set error when refresh fails', async () => {
    mockQueryBuilder.exec.mockRejectedValue(new Error('refresh fail'));

    const result = createLiveQuery<TestDoc>('todos');
    result.refresh();

    await new Promise((r) => setTimeout(r, 0));

    expect(result.error()).toBeInstanceOf(Error);
    expect(result.error()!.message).toBe('refresh fail');
    expect(result.isLoading()).toBe(false);
  });

  it('should wrap non-Error in Error on refresh failure', async () => {
    mockQueryBuilder.exec.mockRejectedValue('plain string');

    const result = createLiveQuery<TestDoc>('todos');
    result.refresh();

    await new Promise((r) => setTimeout(r, 0));

    expect(result.error()).toBeInstanceOf(Error);
    expect(result.error()!.message).toBe('plain string');
  });

  it('should do nothing on refresh when disabled', () => {
    const result = createLiveQuery<TestDoc>('todos', undefined, { enabled: false });
    result.refresh();
    expect(mockQueryBuilder.exec).not.toHaveBeenCalled();
  });

  /* ---------- Cleanup ---------- */

  it('should register cleanup function via onCleanup', () => {
    createLiveQuery<TestDoc>('todos');
    expect(cleanupFns.length).toBeGreaterThan(0);
  });

  it('should unsubscribe on cleanup', () => {
    createLiveQuery<TestDoc>('todos');
    // Execute cleanup
    for (const fn of cleanupFns) fn();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should handle cleanup when no subscription exists', () => {
    createLiveQuery<TestDoc>('todos', undefined, { enabled: false });
    // No subscription was created, cleanup should not throw
    expect(() => {
      for (const fn of cleanupFns) fn();
    }).not.toThrow();
  });
});

/* ================================================================== */
/*  createQuery                                                       */
/* ================================================================== */
describe('createQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupFns.length = 0;
    setupDefaultMocks();
  });

  it('should create a live query with static filter', () => {
    createQuery<TestDoc>('todos', { title: 'Test' });
    expect(mockCollection.find).toHaveBeenCalledWith({ title: 'Test' });
  });

  it('should create a live query with accessor filter', () => {
    const filter = () => ({ title: 'Dynamic' });
    createQuery<TestDoc>('todos', filter);
    expect(mockCollection.find).toHaveBeenCalledWith({ title: 'Dynamic' });
  });

  it('should create a live query with undefined filter', () => {
    createQuery<TestDoc>('todos');
    expect(mockCollection.find).toHaveBeenCalledWith(undefined);
  });

  it('should pass options through', () => {
    createQuery<TestDoc>('todos', undefined, { debounceMs: 100 });
    expect(mockQueryBuilder.live).toHaveBeenCalledWith(
      expect.objectContaining({ debounceMs: 100 })
    );
  });

  it('should return LiveQueryResult shape', () => {
    const result = createQuery<TestDoc>('todos');
    expect(typeof result.data).toBe('function');
    expect(typeof result.isLoading).toBe('function');
    expect(typeof result.error).toBe('function');
    expect(typeof result.refresh).toBe('function');
  });
});
