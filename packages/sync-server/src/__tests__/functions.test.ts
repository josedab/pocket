import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createFunctionRegistry,
  FunctionRegistry,
  type FunctionContext,
  type FunctionResult,
  type PocketFunction,
} from '../functions.js';

function makeCtx(overrides?: Partial<FunctionContext>): FunctionContext {
  return {
    collection: 'users',
    documentId: 'doc-1',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeFn(overrides?: Partial<PocketFunction>): PocketFunction {
  return {
    name: 'testFn',
    collection: 'users',
    trigger: 'afterInsert',
    enabled: true,
    handler: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('FunctionRegistry', () => {
  let registry: FunctionRegistry;

  beforeEach(() => {
    registry = createFunctionRegistry();
  });

  afterEach(() => {
    registry.dispose();
  });

  // -----------------------------------------------------------------------
  // Register & list
  // -----------------------------------------------------------------------
  describe('register and list', () => {
    it('should register and list functions', () => {
      const fn = makeFn();
      registry.register(fn);

      const list = registry.list();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('testFn');
    });

    it('should throw on duplicate name', () => {
      registry.register(makeFn());
      expect(() => registry.register(makeFn())).toThrow('already registered');
    });

    it('should throw when max functions reached', () => {
      const small = createFunctionRegistry({ maxFunctions: 1 });
      small.register(makeFn({ name: 'a' }));
      expect(() => small.register(makeFn({ name: 'b' }))).toThrow('Maximum');
      small.dispose();
    });

    it('should unregister a function', () => {
      registry.register(makeFn());
      registry.unregister('testFn');
      expect(registry.list()).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Trigger matching functions
  // -----------------------------------------------------------------------
  describe('trigger', () => {
    it('should trigger matching functions', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      registry.register(makeFn({ handler }));

      const results = await registry.trigger('afterInsert', makeCtx());

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should return empty results when no match', async () => {
      registry.register(makeFn({ trigger: 'afterDelete' }));
      const results = await registry.trigger('afterInsert', makeCtx());
      expect(results).toHaveLength(0);
    });

    it('should not trigger functions for other collections', async () => {
      registry.register(makeFn({ collection: 'posts' }));
      const results = await registry.trigger('afterInsert', makeCtx({ collection: 'users' }));
      expect(results).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Timeout handling
  // -----------------------------------------------------------------------
  describe('timeout handling', () => {
    it('should fail when handler exceeds timeout', async () => {
      const slow = makeFn({
        name: 'slowFn',
        timeout: 50,
        handler: () => new Promise((resolve) => setTimeout(resolve, 500)),
      });
      registry.register(slow);

      const results = await registry.trigger('afterInsert', makeCtx());

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('timed out');
    });

    it('should use defaultTimeoutMs from config', async () => {
      const r = createFunctionRegistry({ defaultTimeoutMs: 50 });
      r.register(
        makeFn({
          handler: () => new Promise((resolve) => setTimeout(resolve, 500)),
        }),
      );

      const results = await r.trigger('afterInsert', makeCtx());
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('timed out');
      r.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Error isolation
  // -----------------------------------------------------------------------
  describe('error isolation', () => {
    it('should not let one failure stop others', async () => {
      const goodHandler = vi.fn().mockResolvedValue(undefined);

      registry.register(
        makeFn({
          name: 'bad',
          handler: () => Promise.reject(new Error('boom')),
        }),
      );
      registry.register(makeFn({ name: 'good', handler: goodHandler }));

      const results = await registry.trigger('afterInsert', makeCtx());

      expect(results).toHaveLength(2);
      const bad = results.find((r) => r.functionName === 'bad')!;
      const good = results.find((r) => r.functionName === 'good')!;
      expect(bad.success).toBe(false);
      expect(bad.error).toBe('boom');
      expect(good.success).toBe(true);
      expect(goodHandler).toHaveBeenCalledOnce();
    });

    it('should invoke onError callback on failure', async () => {
      const onError = vi.fn();
      const r = createFunctionRegistry({ onError });
      r.register(
        makeFn({
          handler: () => Promise.reject(new Error('oops')),
        }),
      );

      await r.trigger('afterInsert', makeCtx());

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      r.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Enable / disable
  // -----------------------------------------------------------------------
  describe('enable / disable', () => {
    it('should not trigger disabled functions', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      registry.register(makeFn({ handler }));
      registry.disable('testFn');

      const results = await registry.trigger('afterInsert', makeCtx());
      expect(results).toHaveLength(0);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should trigger after re-enabling', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      registry.register(makeFn({ handler }));
      registry.disable('testFn');
      registry.enable('testFn');

      const results = await registry.trigger('afterInsert', makeCtx());
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------
  describe('stats tracking', () => {
    it('should track execution stats', async () => {
      registry.register(makeFn({ name: 'ok' }));
      registry.register(
        makeFn({ name: 'fail', handler: () => Promise.reject(new Error('err')) }),
      );

      await registry.trigger('afterInsert', makeCtx());

      const stats = registry.getStats();
      expect(stats.totalFunctions).toBe(2);
      expect(stats.totalExecutions).toBe(2);
      expect(stats.successCount).toBe(1);
      expect(stats.errorCount).toBe(1);
      expect(stats.avgExecutionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should return zero avg when no executions', () => {
      const stats = registry.getStats();
      expect(stats.avgExecutionTimeMs).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Observable emissions
  // -----------------------------------------------------------------------
  describe('results$ observable', () => {
    it('should emit results for each execution', async () => {
      const collected: FunctionResult[] = [];
      registry.results$.subscribe((r) => collected.push(r));

      registry.register(makeFn({ name: 'a' }));
      registry.register(makeFn({ name: 'b' }));

      await registry.trigger('afterInsert', makeCtx());

      expect(collected).toHaveLength(2);
      expect(collected.map((r) => r.functionName).sort()).toEqual(['a', 'b']);
    });

    it('should complete on dispose', async () => {
      let completed = false;
      registry.results$.subscribe({ complete: () => (completed = true) });

      registry.dispose();
      expect(completed).toBe(true);
    });
  });
});
