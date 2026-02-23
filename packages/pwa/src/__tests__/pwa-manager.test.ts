import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { PWAManager, createPWAManager } from '../pwa-manager.js';
import type { OnlineProvider } from '../sync-status-tracker.js';
import type { PWAConfig } from '../types.js';

function createMockProvider(online = true): OnlineProvider & { goOnline: () => void; goOffline: () => void } {
  let isOnline = online;
  const onlineCallbacks: Array<() => void> = [];
  const offlineCallbacks: Array<() => void> = [];

  return {
    isOnline: () => isOnline,
    addOnlineListener(cb: () => void) {
      onlineCallbacks.push(cb);
      return () => {
        const idx = onlineCallbacks.indexOf(cb);
        if (idx >= 0) onlineCallbacks.splice(idx, 1);
      };
    },
    addOfflineListener(cb: () => void) {
      offlineCallbacks.push(cb);
      return () => {
        const idx = offlineCallbacks.indexOf(cb);
        if (idx >= 0) offlineCallbacks.splice(idx, 1);
      };
    },
    goOnline() {
      isOnline = true;
      onlineCallbacks.forEach((cb) => cb());
    },
    goOffline() {
      isOnline = false;
      offlineCallbacks.forEach((cb) => cb());
    },
  };
}

describe('PWAManager', () => {
  const config: PWAConfig = {
    cacheName: 'test-cache',
    syncOnReconnect: true,
    maxOfflineQueueSize: 100,
  };
  let provider: ReturnType<typeof createMockProvider>;
  let manager: PWAManager;

  beforeEach(() => {
    provider = createMockProvider(true);
    manager = createPWAManager(config, provider);
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('creation and initial state', () => {
    it('should create via factory function', () => {
      expect(manager).toBeInstanceOf(PWAManager);
    });

    it('should report initial online status', () => {
      expect(manager.getStatus()).toBe('online');
    });

    it('should report initial offline status when offline', () => {
      const offlineProvider = createMockProvider(false);
      const offlineManager = createPWAManager(config, offlineProvider);
      expect(offlineManager.getStatus()).toBe('offline');
      offlineManager.destroy();
    });

    it('should have empty queue initially', () => {
      const stats = manager.getStats();
      expect(stats.offlineQueueSize).toBe(0);
      expect(stats.cachedCollections).toEqual([]);
    });
  });

  describe('start/stop lifecycle', () => {
    it('should start and track status changes', async () => {
      manager.start();

      const statuses: string[] = [];
      const sub = manager.status$.subscribe((s) => statuses.push(s));

      provider.goOffline();
      provider.goOnline();

      expect(statuses).toContain('offline');
      expect(statuses).toContain('online');

      sub.unsubscribe();
    });

    it('should stop listening after stop()', () => {
      manager.start();
      manager.stop();

      const statuses: string[] = [];
      const sub = manager.status$.subscribe((s) => statuses.push(s));
      const initialLength = statuses.length;

      provider.goOffline();

      // After stop, no new status should be pushed
      expect(statuses.length).toBe(initialLength);

      sub.unsubscribe();
    });

    it('should be idempotent for start/stop', () => {
      manager.start();
      manager.start(); // no-op
      manager.stop();
      manager.stop(); // no-op
      expect(manager.getStatus()).toBeDefined();
    });
  });

  describe('offline queue', () => {
    it('should enqueue offline writes', () => {
      const item = manager.enqueueOfflineWrite({
        collection: 'users',
        operation: 'create',
        data: { name: 'Test' },
      });

      expect(item.id).toBeDefined();
      expect(item.collection).toBe('users');
      expect(item.retryCount).toBe(0);
      expect(manager.getStats().offlineQueueSize).toBe(1);
    });

    it('should track cached collections', () => {
      manager.enqueueOfflineWrite({
        collection: 'users',
        operation: 'create',
        data: { name: 'A' },
      });
      manager.enqueueOfflineWrite({
        collection: 'posts',
        operation: 'update',
        data: { title: 'B' },
      });

      const stats = manager.getStats();
      expect(stats.cachedCollections).toContain('users');
      expect(stats.cachedCollections).toContain('posts');
    });

    it('should drain the queue successfully', async () => {
      manager.enqueueOfflineWrite({
        collection: 'users',
        operation: 'create',
        data: { name: 'A' },
      });
      manager.enqueueOfflineWrite({
        collection: 'posts',
        operation: 'create',
        data: { title: 'B' },
      });

      const result = await manager.drainQueue(async () => true);

      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
      expect(manager.getStats().offlineQueueSize).toBe(0);
    });

    it('should retry failed items up to max retries', async () => {
      manager.enqueueOfflineWrite({
        collection: 'users',
        operation: 'create',
        data: { name: 'Fail' },
      });

      // First drain: fail all items
      let result = await manager.drainQueue(async () => false);
      expect(result.processed).toBe(0);
      // item retried, back in queue
      expect(manager.getStats().offlineQueueSize).toBe(1);

      // Drain again to increment retry count
      result = await manager.drainQueue(async () => false);
      expect(manager.getStats().offlineQueueSize).toBe(1);

      // Third drain: hits max retries, item dropped
      result = await manager.drainQueue(async () => false);
      expect(result.failed).toBe(1);
      expect(manager.getStats().offlineQueueSize).toBe(0);
    });

    it('should emit queue changes via queue$', async () => {
      const queue = await firstValueFrom(manager.queue$);
      expect(queue).toEqual([]);

      manager.enqueueOfflineWrite({
        collection: 'users',
        operation: 'create',
        data: {},
      });

      const updated = await firstValueFrom(manager.queue$);
      expect(updated.length).toBe(1);
    });
  });

  describe('status tracking', () => {
    it('should set status to syncing during drain', async () => {
      manager.start();
      manager.enqueueOfflineWrite({
        collection: 'users',
        operation: 'create',
        data: {},
      });

      const statuses: string[] = [];
      const sub = manager.status$.subscribe((s) => statuses.push(s));

      await manager.drainQueue(async () => true);

      expect(statuses).toContain('syncing');
      expect(statuses).toContain('online');

      sub.unsubscribe();
    });
  });

  describe('stats retrieval', () => {
    it('should return complete stats', () => {
      manager.enqueueOfflineWrite({
        collection: 'users',
        operation: 'create',
        data: {},
      });

      const stats = manager.getStats();
      expect(stats).toEqual({
        offlineQueueSize: 1,
        cachedCollections: ['users'],
        lastSyncTimestamp: null,
        isOnline: true,
      });
    });

    it('should update lastSyncTimestamp after drain', async () => {
      manager.enqueueOfflineWrite({
        collection: 'users',
        operation: 'create',
        data: {},
      });

      await manager.drainQueue(async () => true);
      const stats = manager.getStats();
      expect(stats.lastSyncTimestamp).toBeTypeOf('number');
    });
  });
});
