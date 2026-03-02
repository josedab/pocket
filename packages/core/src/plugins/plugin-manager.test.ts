import { beforeEach, describe, expect, it } from 'vitest';
import { createPluginManager, PluginManager } from './plugin-manager.js';

describe('PluginManager', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = createPluginManager();
  });

  describe('register()', () => {
    it('should register a plugin', () => {
      manager.register({ name: 'test-plugin' });

      expect(manager.hasPlugin('test-plugin')).toBe(true);
      expect(manager.getPluginNames()).toContain('test-plugin');
    });

    it('should throw on duplicate registration', () => {
      manager.register({ name: 'test-plugin' });

      expect(() => manager.register({ name: 'test-plugin' })).toThrow('already registered');
    });

    it('should set initial state to pending', () => {
      manager.register({ name: 'test-plugin' });

      expect(manager.getPluginState('test-plugin')).toBe('pending');
    });
  });

  describe('registerForCollections()', () => {
    it('should register plugin for specific collections', async () => {
      const calls: string[] = [];
      manager.registerForCollections(
        {
          name: 'scoped-plugin',
          beforeInsert: async (ctx) => {
            calls.push(ctx.collection);
            return { document: ctx.document };
          },
        },
        ['users']
      );
      await manager.initialize();

      await manager.runBeforeInsert({ collection: 'users', document: { _id: '1' } });
      await manager.runBeforeInsert({ collection: 'other', document: { _id: '2' } });

      expect(calls).toEqual(['users']);
    });
  });

  describe('initialize()', () => {
    it('should initialize plugins and set state to initialized', async () => {
      manager.register({ name: 'p1' });
      await manager.initialize();

      expect(manager.getPluginState('p1')).toBe('initialized');
    });

    it('should call onInit hook', async () => {
      let initCalled = false;
      manager.register({
        name: 'p1',
        onInit: async () => {
          initCalled = true;
        },
      });
      await manager.initialize();

      expect(initCalled).toBe(true);
    });

    it('should handle onInit errors gracefully', async () => {
      manager.register({
        name: 'failing-plugin',
        onInit: async () => {
          throw new Error('init failed');
        },
      });
      await manager.initialize();

      expect(manager.getPluginState('failing-plugin')).toBe('error');
    });

    it('should be idempotent', async () => {
      let callCount = 0;
      manager.register({
        name: 'p1',
        onInit: async () => {
          callCount++;
        },
      });

      await manager.initialize();
      await manager.initialize();

      expect(callCount).toBe(1);
    });
  });

  describe('destroy()', () => {
    it('should destroy all plugins', async () => {
      let destroyCalled = false;
      manager.register({
        name: 'p1',
        onDestroy: async () => {
          destroyCalled = true;
        },
      });
      await manager.initialize();
      await manager.destroy();

      expect(destroyCalled).toBe(true);
      expect(manager.getPluginState('p1')).toBe('destroyed');
    });

    it('should only destroy initialized plugins', async () => {
      let destroyCalled = false;
      manager.register({
        name: 'p1',
        onInit: async () => {
          throw new Error('fail');
        },
        onDestroy: async () => {
          destroyCalled = true;
        },
      });
      await manager.initialize();
      await manager.destroy();

      expect(destroyCalled).toBe(false);
    });

    it('should ignore errors in onDestroy', async () => {
      manager.register({
        name: 'p1',
        onDestroy: async () => {
          throw new Error('destroy error');
        },
      });
      await manager.initialize();

      // Should not throw
      await expect(manager.destroy()).resolves.not.toThrow();
    });
  });

  describe('unregister()', () => {
    it('should remove a plugin', async () => {
      manager.register({ name: 'p1' });
      await manager.initialize();
      await manager.unregister('p1');

      expect(manager.hasPlugin('p1')).toBe(false);
    });

    it('should call onDestroy when unregistering', async () => {
      let destroyed = false;
      manager.register({
        name: 'p1',
        onDestroy: async () => {
          destroyed = true;
        },
      });
      await manager.initialize();
      await manager.unregister('p1');

      expect(destroyed).toBe(true);
    });

    it('should handle unregister of non-existent plugin', async () => {
      await expect(manager.unregister('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('hook execution - beforeInsert / afterInsert', () => {
    it('should run beforeInsert hook', async () => {
      manager.register({
        name: 'p1',
        beforeInsert: async (ctx) => {
          return { document: { ...ctx.document, injected: true } };
        },
      });
      await manager.initialize();

      const result = await manager.runBeforeInsert({
        collection: 'test',
        document: { _id: '1' },
      });

      expect((result.document as any).injected).toBe(true);
    });

    it('should run afterInsert hook', async () => {
      const afterDocs: unknown[] = [];
      manager.register({
        name: 'p1',
        afterInsert: async (doc) => {
          afterDocs.push(doc);
        },
      });
      await manager.initialize();

      await manager.runAfterInsert({ _id: '1' } as any, {
        collection: 'test',
        document: { _id: '1' },
      });

      expect(afterDocs).toHaveLength(1);
    });

    it('should support skip from beforeInsert', async () => {
      manager.register({
        name: 'p1',
        beforeInsert: async () => ({ skip: true }),
      });
      await manager.initialize();

      const result = await manager.runBeforeInsert({
        collection: 'test',
        document: { _id: '1' },
      });

      expect(result.skip).toBe(true);
    });

    it('should support error from beforeInsert', async () => {
      manager.register({
        name: 'p1',
        beforeInsert: async () => ({ error: new Error('denied') }),
      });
      await manager.initialize();

      const result = await manager.runBeforeInsert({
        collection: 'test',
        document: { _id: '1' },
      });

      expect(result.error).toBeDefined();
      expect(result.error!.message).toBe('denied');
    });
  });

  describe('hook execution - beforeUpdate / afterUpdate', () => {
    it('should run beforeUpdate and modify changes', async () => {
      manager.register({
        name: 'p1',
        beforeUpdate: async (ctx) => {
          return { changes: { ...ctx.changes, updatedBy: 'plugin' } };
        },
      });
      await manager.initialize();

      const result = await manager.runBeforeUpdate({
        collection: 'test',
        documentId: '1',
        changes: { name: 'Bob' },
      } as any);

      expect((result.changes as any).updatedBy).toBe('plugin');
    });

    it('should run afterUpdate hook', async () => {
      let called = false;
      manager.register({
        name: 'p1',
        afterUpdate: async () => {
          called = true;
        },
      });
      await manager.initialize();

      await manager.runAfterUpdate(
        { _id: '1' } as any,
        {
          collection: 'test',
          documentId: '1',
          changes: {},
        } as any
      );

      expect(called).toBe(true);
    });
  });

  describe('hook execution - beforeDelete / afterDelete', () => {
    it('should run beforeDelete and allow skip', async () => {
      manager.register({
        name: 'p1',
        beforeDelete: async () => ({ skip: true }),
      });
      await manager.initialize();

      const result = await manager.runBeforeDelete({
        collection: 'test',
        documentId: '1',
      } as any);

      expect(result.skip).toBe(true);
    });

    it('should run afterDelete hook', async () => {
      let called = false;
      manager.register({
        name: 'p1',
        afterDelete: async () => {
          called = true;
        },
      });
      await manager.initialize();

      await manager.runAfterDelete({
        collection: 'test',
        documentId: '1',
      } as any);

      expect(called).toBe(true);
    });
  });

  describe('hook execution - beforeQuery / afterQuery', () => {
    it('should run beforeQuery and modify spec', async () => {
      manager.register({
        name: 'p1',
        beforeQuery: async (ctx) => {
          return { spec: { ...ctx.spec, limit: 10 } };
        },
      });
      await manager.initialize();

      const result = await manager.runBeforeQuery({
        collection: 'test',
        spec: { filter: {} },
      } as any);

      expect((result.spec as any).limit).toBe(10);
    });

    it('should run afterQuery and transform results', async () => {
      manager.register({
        name: 'p1',
        afterQuery: async (results) => {
          return results.filter((d: any) => d._id !== '2');
        },
      });
      await manager.initialize();

      const results = await manager.runAfterQuery(
        [{ _id: '1' }, { _id: '2' }, { _id: '3' }] as any[],
        { collection: 'test', spec: {} } as any
      );

      expect(results).toHaveLength(2);
    });
  });

  describe('hook execution - beforeGet / afterGet', () => {
    it('should run beforeGet', async () => {
      let called = false;
      manager.register({
        name: 'p1',
        beforeGet: async () => {
          called = true;
          return {};
        },
      });
      await manager.initialize();

      await manager.runBeforeGet({ collection: 'test', documentId: '1' });

      expect(called).toBe(true);
    });

    it('should run afterGet and transform document', async () => {
      manager.register({
        name: 'p1',
        afterGet: async (doc) => {
          if (doc) return { ...doc, extra: true } as any;
          return doc;
        },
      });
      await manager.initialize();

      const result = await manager.runAfterGet({ _id: '1' } as any, {
        collection: 'test',
        documentId: '1',
      });

      expect((result as any).extra).toBe(true);
    });
  });

  describe('hook execution - onError', () => {
    it('should run onError hook', async () => {
      let errorContext: any = null;
      manager.register({
        name: 'p1',
        onError: async (ctx) => {
          errorContext = ctx;
        },
      });
      await manager.initialize();

      await manager.runOnError({
        collection: 'test',
        operation: 'insert',
        error: new Error('test error'),
      });

      expect(errorContext).toBeDefined();
      expect(errorContext.error.message).toBe('test error');
    });

    it('should ignore errors in error handlers', async () => {
      manager.register({
        name: 'p1',
        onError: async () => {
          throw new Error('handler error');
        },
      });
      await manager.initialize();

      await expect(
        manager.runOnError({
          collection: 'test',
          operation: 'insert',
          error: new Error('original'),
        })
      ).resolves.not.toThrow();
    });
  });

  describe('priority ordering', () => {
    it('should execute hooks in priority order (higher first)', async () => {
      const order: string[] = [];

      manager.register({
        name: 'low',
        priority: 1,
        beforeInsert: async (ctx) => {
          order.push('low');
          return { document: ctx.document };
        },
      });
      manager.register({
        name: 'high',
        priority: 100,
        beforeInsert: async (ctx) => {
          order.push('high');
          return { document: ctx.document };
        },
      });
      await manager.initialize();

      await manager.runBeforeInsert({ collection: 'test', document: { _id: '1' } });

      expect(order).toEqual(['high', 'low']);
    });
  });

  describe('edge cases', () => {
    it('should handle no hooks registered', async () => {
      manager.register({ name: 'empty-plugin' });
      await manager.initialize();

      const result = await manager.runBeforeInsert({
        collection: 'test',
        document: { _id: '1' },
      });

      expect(result.document).toEqual({ _id: '1' });
    });

    it('should handle multiple plugins on same hook', async () => {
      const calls: number[] = [];

      manager.register({
        name: 'p1',
        priority: 2,
        beforeInsert: async (ctx) => {
          calls.push(1);
          return { document: ctx.document };
        },
      });
      manager.register({
        name: 'p2',
        priority: 1,
        beforeInsert: async (ctx) => {
          calls.push(2);
          return { document: ctx.document };
        },
      });
      await manager.initialize();

      await manager.runBeforeInsert({ collection: 'test', document: { _id: '1' } });

      expect(calls).toEqual([1, 2]);
    });

    it('should skip hooks for non-initialized plugins', async () => {
      let called = false;
      manager.register({
        name: 'p1',
        onInit: async () => {
          throw new Error('fail');
        },
        beforeInsert: async (ctx) => {
          called = true;
          return { document: ctx.document };
        },
      });
      await manager.initialize();

      await manager.runBeforeInsert({ collection: 'test', document: { _id: '1' } });

      expect(called).toBe(false);
    });

    it('should return undefined for non-existent plugin state', () => {
      expect(manager.getPluginState('nonexistent')).toBeUndefined();
    });
  });

  describe('factory function', () => {
    it('should create plugin manager via createPluginManager', () => {
      const pm = createPluginManager();
      expect(pm).toBeInstanceOf(PluginManager);
    });
  });
});
