import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTriggerEngine, type TriggerEngine } from '../trigger-engine.js';
import type { TriggerEvent } from '../types.js';

describe('TriggerEngine', () => {
  let engine: TriggerEngine;

  beforeEach(() => {
    engine = createTriggerEngine({
      maxRetries: 1,
      defaultTimeoutMs: 500,
      maxTriggerDepth: 3,
    });
  });

  afterEach(() => {
    engine.destroy();
  });

  describe('registration', () => {
    it('should register a trigger and return an ID', () => {
      const id = engine.on('todos', 'insert', vi.fn());
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('should register with custom ID', () => {
      const id = engine.register({
        id: 'my-trigger',
        name: 'My Trigger',
        collection: 'todos',
        operations: ['insert'],
        timing: 'after',
        handler: vi.fn(),
        priority: 0,
        executionEnv: 'local',
      });
      expect(id).toBe('my-trigger');
    });

    it('should retrieve registered trigger', () => {
      const id = engine.on('todos', 'insert', vi.fn());
      const trigger = engine.getTrigger(id);
      expect(trigger).not.toBeNull();
      expect(trigger!.collection).toBe('todos');
    });

    it('should list triggers by collection', () => {
      engine.on('todos', 'insert', vi.fn());
      engine.on('todos', 'update', vi.fn());
      engine.on('users', 'insert', vi.fn());
      expect(engine.getTriggers('todos')).toHaveLength(2);
      expect(engine.getTriggers('users')).toHaveLength(1);
      expect(engine.getTriggers()).toHaveLength(3);
    });

    it('should remove a trigger', () => {
      const id = engine.on('todos', 'insert', vi.fn());
      engine.remove(id);
      expect(engine.getTrigger(id)).toBeNull();
    });

    it('should enable and disable triggers', () => {
      const id = engine.on('todos', 'insert', vi.fn());
      engine.disable(id);
      expect(engine.getTrigger(id)!.enabled).toBe(false);
      engine.enable(id);
      expect(engine.getTrigger(id)!.enabled).toBe(true);
    });
  });

  describe('execution — after triggers', () => {
    it('should execute matching after triggers', async () => {
      const handler = vi.fn();
      engine.on('todos', 'insert', handler);

      await engine.execute('todos', 'insert', { _id: '1', title: 'Test' });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should not execute triggers for different collections', async () => {
      const handler = vi.fn();
      engine.on('users', 'insert', handler);

      await engine.execute('todos', 'insert', { _id: '1' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should not execute triggers for different operations', async () => {
      const handler = vi.fn();
      engine.on('todos', 'delete', handler);

      await engine.execute('todos', 'insert', { _id: '1' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should not execute disabled triggers', async () => {
      const handler = vi.fn();
      const id = engine.on('todos', 'insert', handler);
      engine.disable(id);

      await engine.execute('todos', 'insert', { _id: '1' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should pass context to handler', async () => {
      const handler = vi.fn();
      engine.on('todos', 'update', handler);

      const doc = { _id: '1', title: 'Updated' };
      const prev = { _id: '1', title: 'Original' };
      await engine.execute('todos', 'update', doc, prev);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'todos',
          operation: 'update',
          document: doc,
          previousDocument: prev,
        })
      );
    });

    it('should execute triggers in priority order (higher first)', async () => {
      const order: number[] = [];
      engine.on(
        'todos',
        'insert',
        () => {
          order.push(1);
        },
        { priority: 1, name: 'low' }
      );
      engine.on(
        'todos',
        'insert',
        () => {
          order.push(10);
        },
        { priority: 10, name: 'high' }
      );
      engine.on(
        'todos',
        'insert',
        () => {
          order.push(5);
        },
        { priority: 5, name: 'mid' }
      );

      await engine.execute('todos', 'insert', { _id: '1' });
      expect(order).toEqual([10, 5, 1]);
    });
  });

  describe('execution — before triggers', () => {
    it('should allow before triggers to cancel the operation', async () => {
      engine.on('todos', 'insert', () => ({ cancel: true }), { timing: 'before', name: 'blocker' });

      const result = await engine.execute('todos', 'insert', { _id: '1' });
      expect(result.cancelled).toBe(true);
    });

    it('should allow before triggers to modify the document', async () => {
      engine.on(
        'todos',
        'insert',
        (ctx) => ({
          modifiedDocument: { ...ctx.document!, title: 'Modified' },
        }),
        { timing: 'before', name: 'modifier' }
      );

      const result = await engine.execute('todos', 'insert', { _id: '1', title: 'Original' });
      expect(result.modifiedDocument).toBeDefined();
      expect((result.modifiedDocument as Record<string, unknown>).title).toBe('Modified');
    });

    it('should not execute after triggers when cancelled', async () => {
      engine.on('todos', 'insert', () => ({ cancel: true }), { timing: 'before', name: 'blocker' });
      const afterHandler = vi.fn();
      engine.on('todos', 'insert', afterHandler, { timing: 'after', name: 'after' });

      await engine.execute('todos', 'insert', { _id: '1' });
      expect(afterHandler).not.toHaveBeenCalled();
    });
  });

  describe('execution — error handling', () => {
    it('should retry failed triggers', async () => {
      let calls = 0;
      engine.on('todos', 'insert', () => {
        calls++;
        if (calls <= 1) throw new Error('transient');
      });

      const result = await engine.execute('todos', 'insert', { _id: '1' });
      expect(calls).toBe(2);
      expect(result.results[0]!.status).toBe('success');
    });

    it('should add to dead letter queue after all retries exhausted', async () => {
      engine.on('todos', 'insert', () => {
        throw new Error('permanent');
      });

      await engine.execute('todos', 'insert', { _id: '1' });
      const dlq = engine.getDeadLetterQueue();
      expect(dlq).toHaveLength(1);
      expect(dlq[0]!.error).toBe('permanent');
    });

    it('should detect timeout', async () => {
      engine.on('todos', 'insert', () => new Promise((r) => setTimeout(r, 2000)));

      const result = await engine.execute('todos', 'insert', { _id: '1' });
      expect(result.results[0]!.status).toBe('timeout');
    });

    it('should detect cycle / excessive depth', async () => {
      const deepEngine = createTriggerEngine({
        maxTriggerDepth: 2,
        maxRetries: 0,
        defaultTimeoutMs: 500,
      });
      // Simulate deep nesting by calling execute recursively
      deepEngine.on('todos', 'insert', async () => {
        await deepEngine.execute('todos', 'insert', { _id: '2' });
      });
      deepEngine.on(
        'todos',
        'insert',
        async () => {
          await deepEngine.execute('todos', 'insert', { _id: '3' });
        },
        { priority: -1, name: 'nested' }
      );

      // This should eventually hit the depth limit
      const result = await deepEngine.execute('todos', 'insert', { _id: '1' });
      expect(result.results.length).toBeGreaterThan(0);
      deepEngine.destroy();
    });
  });

  describe('execution — conditions', () => {
    it('should skip trigger if condition returns false', async () => {
      const handler = vi.fn();
      engine.on('todos', 'insert', handler, {
        condition: (doc) => (doc as Record<string, unknown>).important === true,
        name: 'conditional',
      });

      await engine.execute('todos', 'insert', { _id: '1', important: false });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should execute trigger if condition returns true', async () => {
      const handler = vi.fn();
      engine.on('todos', 'insert', handler, {
        condition: (doc) => (doc as Record<string, unknown>).important === true,
        name: 'conditional',
      });

      await engine.execute('todos', 'insert', { _id: '1', important: true });
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('logs', () => {
    it('should record execution logs', async () => {
      engine.on('todos', 'insert', vi.fn());
      await engine.execute('todos', 'insert', { _id: '1' });

      const logs = engine.getExecutionLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0]!.status).toBe('success');
      expect(logs[0]!.collection).toBe('todos');
    });

    it('should filter logs by collection', async () => {
      engine.on('todos', 'insert', vi.fn());
      engine.on('users', 'insert', vi.fn());
      await engine.execute('todos', 'insert', { _id: '1' });
      await engine.execute('users', 'insert', { _id: '2' });

      expect(engine.getExecutionLogs({ collection: 'todos' })).toHaveLength(1);
    });

    it('should limit log count', async () => {
      engine.on('todos', 'insert', vi.fn());
      for (let i = 0; i < 5; i++) {
        await engine.execute('todos', 'insert', { _id: String(i) });
      }

      expect(engine.getExecutionLogs({ limit: 2 })).toHaveLength(2);
    });

    it('should clear logs', async () => {
      engine.on('todos', 'insert', vi.fn());
      await engine.execute('todos', 'insert', { _id: '1' });
      engine.clearLogs();
      expect(engine.getExecutionLogs()).toHaveLength(0);
    });
  });

  describe('dead letter queue', () => {
    it('should clear DLQ', async () => {
      engine.on('todos', 'insert', () => {
        throw new Error('fail');
      });
      await engine.execute('todos', 'insert', { _id: '1' });
      engine.clearDeadLetterQueue();
      expect(engine.getDeadLetterQueue()).toHaveLength(0);
    });
  });

  describe('events', () => {
    it('should emit registration events', () => {
      const events: TriggerEvent[] = [];
      engine.events.subscribe((e) => events.push(e));
      engine.on('todos', 'insert', vi.fn());
      expect(events.some((e) => e.type === 'trigger_registered')).toBe(true);
    });

    it('should emit execution events', async () => {
      const events: TriggerEvent[] = [];
      engine.events.subscribe((e) => events.push(e));
      engine.on('todos', 'insert', vi.fn());
      await engine.execute('todos', 'insert', { _id: '1' });
      expect(events.some((e) => e.type === 'execution_started')).toBe(true);
      expect(events.some((e) => e.type === 'execution_completed')).toBe(true);
    });

    it('should emit failure events on exhausted retries', async () => {
      const events: TriggerEvent[] = [];
      engine.events.subscribe((e) => events.push(e));
      engine.on('todos', 'insert', () => {
        throw new Error('fail');
      });
      await engine.execute('todos', 'insert', { _id: '1' });
      expect(events.some((e) => e.type === 'execution_failed')).toBe(true);
      expect(events.some((e) => e.type === 'dead_letter_added')).toBe(true);
    });
  });

  describe('state', () => {
    it('should track engine state', () => {
      const states: { totalTriggers: number }[] = [];
      engine.state.subscribe((s) => states.push(s));
      engine.on('todos', 'insert', vi.fn());
      expect(states[states.length - 1]!.totalTriggers).toBe(1);
    });
  });

  describe('lifecycle', () => {
    it('should throw after destroy', () => {
      engine.destroy();
      expect(() => engine.on('todos', 'insert', vi.fn())).toThrow('destroyed');
    });

    it('should complete observables on destroy', () => {
      let completed = false;
      engine.events.subscribe({ complete: () => (completed = true) });
      engine.destroy();
      expect(completed).toBe(true);
    });
  });
});
