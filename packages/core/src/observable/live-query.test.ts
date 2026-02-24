import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent, Document } from '../types/document.js';
import { LiveQuery, createLiveQuery } from './live-query.js';

interface TestDoc extends Document {
  _id: string;
  name: string;
  active?: boolean;
}

function createTestSetup(
  options: {
    initialDocs?: TestDoc[];
    debounceMs?: number;
    useEventReduce?: boolean;
  } = {}
) {
  const docs = options.initialDocs ?? [
    { _id: '1', name: 'Alice', active: true } as TestDoc,
    { _id: '2', name: 'Bob', active: false } as TestDoc,
  ];

  const executor = vi.fn(async () => [...docs]);
  const changes$ = new Subject<ChangeEvent<TestDoc>>();

  const liveQuery = new LiveQuery<TestDoc>({ filter: {} }, executor, changes$.asObservable(), {
    debounceMs: options.debounceMs ?? 0,
    useEventReduce: options.useEventReduce ?? false,
  });

  return { liveQuery, executor, changes$, docs };
}

describe('LiveQuery', () => {
  describe('start()', () => {
    it('should execute initial query', async () => {
      const { liveQuery, executor } = createTestSetup();

      await liveQuery.start();

      expect(executor).toHaveBeenCalledTimes(1);
      expect(liveQuery.data).toHaveLength(2);

      liveQuery.destroy();
    });

    it('should set isLoading during execution', async () => {
      const { liveQuery } = createTestSetup();

      // Before start
      expect(liveQuery.isLoading).toBe(true);

      await liveQuery.start();

      expect(liveQuery.isLoading).toBe(false);

      liveQuery.destroy();
    });

    it('should be idempotent', async () => {
      const { liveQuery, executor } = createTestSetup();

      await liveQuery.start();
      await liveQuery.start();

      expect(executor).toHaveBeenCalledTimes(1);

      liveQuery.destroy();
    });

    it('should skip initial query when initialData is provided', async () => {
      const executor = vi.fn(async () => []);
      const changes$ = new Subject<ChangeEvent<TestDoc>>();

      const liveQuery = new LiveQuery<TestDoc>({ filter: {} }, executor, changes$.asObservable(), {
        initialData: [{ _id: '1', name: 'Pre' }],
      });

      await liveQuery.start();

      expect(executor).not.toHaveBeenCalled();
      expect(liveQuery.data).toHaveLength(1);

      liveQuery.destroy();
    });
  });

  describe('stop()', () => {
    it('should stop listening for changes', async () => {
      const { liveQuery, executor, changes$ } = createTestSetup({ useEventReduce: false });

      await liveQuery.start();
      liveQuery.stop();

      // Emit a change after stop
      changes$.next({
        operation: 'insert',
        documentId: '3',
        document: { _id: '3', name: 'Charlie' } as TestDoc,
        timestamp: Date.now(),
        sequence: 1,
      });

      // Wait a tick
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not have re-executed
      expect(executor).toHaveBeenCalledTimes(1);

      liveQuery.destroy();
    });
  });

  describe('destroy()', () => {
    it('should complete the state observable', async () => {
      const { liveQuery } = createTestSetup();

      let completed = false;
      liveQuery.stateObservable().subscribe({
        complete: () => {
          completed = true;
        },
      });

      liveQuery.destroy();

      expect(completed).toBe(true);
    });
  });

  describe('refresh()', () => {
    it('should re-execute the query', async () => {
      const { liveQuery, executor } = createTestSetup();

      await liveQuery.start();
      await liveQuery.refresh();

      expect(executor).toHaveBeenCalledTimes(2);

      liveQuery.destroy();
    });
  });

  describe('state / data / isLoading / error', () => {
    it('should expose current state', async () => {
      const { liveQuery } = createTestSetup();

      await liveQuery.start();

      expect(liveQuery.state).toBeDefined();
      expect(liveQuery.state.data).toHaveLength(2);
      expect(liveQuery.state.isLoading).toBe(false);
      expect(liveQuery.state.error).toBeNull();
      expect(liveQuery.state.lastUpdated).toBeGreaterThan(0);

      liveQuery.destroy();
    });

    it('should handle executor errors', async () => {
      const executor = vi.fn(async () => {
        throw new Error('query failed');
      });
      const changes$ = new Subject<ChangeEvent<TestDoc>>();

      const liveQuery = new LiveQuery<TestDoc>({ filter: {} }, executor, changes$.asObservable());

      await liveQuery.start();

      expect(liveQuery.error).toBeDefined();
      expect(liveQuery.error!.message).toBe('query failed');
      expect(liveQuery.isLoading).toBe(false);

      liveQuery.destroy();
    });
  });

  describe('stateObservable()', () => {
    it('should emit state changes', async () => {
      const { liveQuery } = createTestSetup();
      const states: unknown[] = [];
      liveQuery.stateObservable().subscribe((s) => states.push(s));

      await liveQuery.start();

      expect(states.length).toBeGreaterThanOrEqual(1);

      liveQuery.destroy();
    });
  });

  describe('observable()', () => {
    it('should auto-start and emit data array', async () => {
      const { liveQuery } = createTestSetup();
      const results: TestDoc[][] = [];

      liveQuery.observable().subscribe((d) => results.push(d));

      // Wait for async start
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[results.length - 1]).toHaveLength(2);

      liveQuery.destroy();
    });
  });

  describe('change handling', () => {
    it('should re-execute on change when eventReduce is disabled', async () => {
      const { liveQuery, executor, changes$ } = createTestSetup({ useEventReduce: false });

      await liveQuery.start();
      expect(executor).toHaveBeenCalledTimes(1);

      changes$.next({
        operation: 'insert',
        documentId: '3',
        document: { _id: '3', name: 'Charlie' } as TestDoc,
        timestamp: Date.now(),
        sequence: 1,
      });

      // Wait for async re-execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(executor).toHaveBeenCalledTimes(2);

      liveQuery.destroy();
    });
  });

  describe('debouncing', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should batch rapid changes with debounce', async () => {
      vi.useFakeTimers();
      const { liveQuery, executor, changes$ } = createTestSetup({
        debounceMs: 100,
        useEventReduce: false,
      });

      await liveQuery.start();
      expect(executor).toHaveBeenCalledTimes(1);

      // Emit multiple rapid changes
      for (let i = 0; i < 3; i++) {
        changes$.next({
          operation: 'insert',
          documentId: `new-${i}`,
          document: { _id: `new-${i}`, name: `New ${i}` } as TestDoc,
          timestamp: Date.now(),
          sequence: i + 1,
        });
      }

      // Changes should be pending, not yet processed
      expect(executor).toHaveBeenCalledTimes(1);

      // Advance past debounce timer
      vi.advanceTimersByTime(150);

      // Wait for async execution
      await vi.runAllTimersAsync();

      expect(executor).toHaveBeenCalledTimes(2);

      liveQuery.destroy();
    });
  });

  describe('factory function', () => {
    it('should create LiveQuery via createLiveQuery', () => {
      const lq = createLiveQuery<TestDoc>(
        { filter: {} },
        async () => [],
        new Subject<ChangeEvent<TestDoc>>().asObservable()
      );

      expect(lq).toBeInstanceOf(LiveQuery);
      lq.destroy();
    });
  });
});
