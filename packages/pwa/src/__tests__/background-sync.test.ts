import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { skip } from 'rxjs/operators';
import {
  BackgroundSyncManager,
  createBackgroundSync,
  type ServiceWorkerProvider,
  type BackgroundSyncConfig,
} from '../background-sync.js';
import { OfflineQueue } from '../offline-queue.js';

function createMockSWProvider(shouldFail = false): ServiceWorkerProvider {
  return {
    ready: shouldFail
      ? Promise.reject(new Error('SW not available'))
      : Promise.resolve({
          sync: {
            register: vi.fn().mockResolvedValue(undefined),
          },
        }),
  };
}

function enqueueTestItem(queue: OfflineQueue, collection = 'users') {
  return queue.enqueue({
    collection,
    operation: 'create',
    data: { name: 'Test' },
  });
}

describe('BackgroundSyncManager', () => {
  let queue: OfflineQueue;
  let swProvider: ServiceWorkerProvider;
  let manager: BackgroundSyncManager;
  const config: BackgroundSyncConfig = {
    syncTag: 'test-sync',
    maxRetries: 3,
    minRetryIntervalMs: 1000,
  };

  beforeEach(() => {
    queue = new OfflineQueue();
    swProvider = createMockSWProvider();
    manager = new BackgroundSyncManager(config, queue, swProvider);
  });

  afterEach(() => {
    manager.dispose();
    queue.destroy();
  });

  describe('register and unregister', () => {
    it('should register a background sync tag via SW provider', async () => {
      await manager.register();

      const reg = manager.getRegistration();
      expect(reg).not.toBeNull();
      expect(reg!.tag).toBe('test-sync');
      expect(reg!.status).toBe('pending');
      expect(reg!.registeredAt).toBeTypeOf('number');
    });

    it('should call SW sync.register with the tag', async () => {
      await manager.register();

      const sw = await swProvider.ready;
      expect(sw.sync.register).toHaveBeenCalledWith('test-sync');
    });

    it('should unregister and clear registration', async () => {
      await manager.register();
      manager.unregister();

      expect(manager.getRegistration()).toBeNull();
    });

    it('should fall back when SW sync is not available', async () => {
      vi.useFakeTimers();
      const failingSW = createMockSWProvider(true);
      const fallbackManager = new BackgroundSyncManager(config, queue, failingSW);

      await fallbackManager.register();
      const reg = fallbackManager.getRegistration();
      expect(reg).not.toBeNull();
      expect(reg!.status).toBe('pending');

      fallbackManager.dispose();
      vi.useRealTimers();
    });
  });

  describe('triggerSync', () => {
    it('should manually trigger a sync that drains the queue', async () => {
      enqueueTestItem(queue);
      enqueueTestItem(queue, 'posts');
      expect(queue.size).toBe(2);

      await manager.register();
      await manager.triggerSync();

      expect(queue.size).toBe(0);
    });

    it('should return result with processed count', async () => {
      enqueueTestItem(queue);
      const result = await manager.triggerSync();
      expect(result.processed).toBeGreaterThanOrEqual(0);
      expect(result.failed).toBe(0);
    });

    it('should not sync after dispose', async () => {
      enqueueTestItem(queue);
      manager.dispose();

      const result = await manager.triggerSync();
      expect(result.processed).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('handleSyncEvent', () => {
    it('should drain queue when sync event matches tag', async () => {
      enqueueTestItem(queue);
      enqueueTestItem(queue);

      await manager.handleSyncEvent({ tag: 'test-sync' });

      expect(queue.size).toBe(0);
    });

    it('should ignore sync events with different tags', async () => {
      enqueueTestItem(queue);

      await manager.handleSyncEvent({ tag: 'other-tag' });

      expect(queue.size).toBe(1);
    });

    it('should invoke onSync callback with queue items', async () => {
      const onSync = vi.fn().mockResolvedValue(undefined);
      const syncManager = new BackgroundSyncManager(
        { ...config, onSync },
        queue,
        swProvider,
      );

      enqueueTestItem(queue);
      enqueueTestItem(queue, 'posts');

      await syncManager.handleSyncEvent({ tag: 'test-sync' });

      expect(onSync).toHaveBeenCalledOnce();
      expect(onSync.mock.calls[0][0]).toHaveLength(2);
      expect(onSync.mock.calls[0][0][0].collection).toBe('users');
      expect(onSync.mock.calls[0][0][1].collection).toBe('posts');

      syncManager.dispose();
    });
  });

  describe('stats tracking', () => {
    it('should return initial stats', () => {
      const stats = manager.getStats();
      expect(stats.registrations).toBe(0);
      expect(stats.pendingItems).toBe(0);
      expect(stats.lastSyncAt).toBeNull();
      expect(stats.failedAttempts).toBe(0);
    });

    it('should track registrations', async () => {
      await manager.register();
      expect(manager.getStats().registrations).toBe(1);
    });

    it('should track pending items', () => {
      enqueueTestItem(queue);
      enqueueTestItem(queue);
      expect(manager.getStats().pendingItems).toBe(2);
    });

    it('should update lastSyncAt after sync', async () => {
      enqueueTestItem(queue);
      await manager.triggerSync();
      expect(manager.getStats().lastSyncAt).toBeTypeOf('number');
    });

    it('should track failed attempts', async () => {
      const failingOnSync = vi.fn().mockRejectedValue(new Error('fail'));
      const syncManager = new BackgroundSyncManager(
        { ...config, onSync: failingOnSync },
        queue,
        swProvider,
      );

      enqueueTestItem(queue);
      await syncManager.triggerSync();

      expect(syncManager.getStats().failedAttempts).toBe(1);

      syncManager.dispose();
    });
  });

  describe('status$ observable', () => {
    it('should emit null initially', async () => {
      const value = await firstValueFrom(manager.status$);
      expect(value).toBeNull();
    });

    it('should emit registration after register()', async () => {
      const promise = firstValueFrom(manager.status$.pipe(skip(1)));
      await manager.register();
      const reg = await promise;
      expect(reg).not.toBeNull();
      expect(reg!.tag).toBe('test-sync');
    });

    it('should emit null after unregister()', async () => {
      await manager.register();
      const promise = firstValueFrom(manager.status$.pipe(skip(1)));
      manager.unregister();
      const reg = await promise;
      expect(reg).toBeNull();
    });

    it('should emit syncing status during sync', async () => {
      enqueueTestItem(queue);

      const statuses: Array<string | undefined> = [];
      const sub = manager.status$.subscribe((reg) => {
        statuses.push(reg?.status);
      });

      await manager.triggerSync();

      expect(statuses).toContain('syncing');
      expect(statuses).toContain('completed');

      sub.unsubscribe();
    });
  });

  describe('factory function', () => {
    it('should create an instance via createBackgroundSync', () => {
      const instance = createBackgroundSync(config, queue, swProvider);
      expect(instance).toBeInstanceOf(BackgroundSyncManager);
      instance.dispose();
    });
  });

  describe('fallback when SW not available', () => {
    it('should work without any SW provider', async () => {
      const noSWManager = new BackgroundSyncManager(config, queue, undefined as unknown as ServiceWorkerProvider);
      enqueueTestItem(queue);

      await noSWManager.triggerSync();
      expect(queue.size).toBe(0);

      noSWManager.dispose();
    });
  });
});
