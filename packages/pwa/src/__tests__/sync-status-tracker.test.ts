import { firstValueFrom } from 'rxjs';
import { skip } from 'rxjs/operators';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SyncStatusTracker,
  createSyncStatusTracker,
  type OnlineProvider,
} from '../sync-status-tracker.js';

function createMockProvider(initiallyOnline = true): OnlineProvider & {
  goOnline: () => void;
  goOffline: () => void;
} {
  let online = initiallyOnline;
  const onlineCallbacks: (() => void)[] = [];
  const offlineCallbacks: (() => void)[] = [];

  return {
    isOnline: () => online,
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
      online = true;
      onlineCallbacks.forEach((cb) => cb());
    },
    goOffline() {
      online = false;
      offlineCallbacks.forEach((cb) => cb());
    },
  };
}

describe('SyncStatusTracker', () => {
  let tracker: SyncStatusTracker;
  let provider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    provider = createMockProvider(true);
    tracker = new SyncStatusTracker(undefined, provider);
  });

  afterEach(() => {
    tracker.destroy();
  });

  describe('initial state', () => {
    it('starts as online when provider is online', () => {
      expect(tracker.getStatus()).toBe('online');
      expect(tracker.isOnline()).toBe(true);
    });

    it('starts as offline when provider is offline', () => {
      const offlineProvider = createMockProvider(false);
      const offlineTracker = new SyncStatusTracker(undefined, offlineProvider);
      expect(offlineTracker.getStatus()).toBe('offline');
      expect(offlineTracker.isOnline()).toBe(false);
      offlineTracker.destroy();
    });
  });

  describe('start/stop', () => {
    it('subscribes to online/offline events on start', async () => {
      tracker.start();
      const nextStatus = firstValueFrom(tracker.status$.pipe(skip(1)));
      provider.goOffline();
      const status = await nextStatus;
      expect(status).toBe('offline');
    });

    it('stops listening on stop', async () => {
      tracker.start();
      tracker.stop();

      // After stop, changes should not propagate
      let changed = false;
      const sub = tracker.status$.pipe(skip(1)).subscribe(() => {
        changed = true;
      });
      provider.goOffline();

      // Give a tick for any potential async emission
      await new Promise((r) => setTimeout(r, 10));
      expect(changed).toBe(false);
      sub.unsubscribe();
    });

    it('is idempotent for start/stop', () => {
      tracker.start();
      tracker.start(); // should not throw
      tracker.stop();
      tracker.stop(); // should not throw
    });
  });

  describe('status$ observable', () => {
    it('emits current status immediately', async () => {
      const status = await firstValueFrom(tracker.status$);
      expect(status).toBe('online');
    });

    it('emits when going offline then online', async () => {
      tracker.start();

      const statuses: string[] = [];
      const sub = tracker.status$.subscribe((s) => statuses.push(s));

      provider.goOffline();
      provider.goOnline();

      expect(statuses).toContain('offline');
      expect(statuses).toContain('online');
      sub.unsubscribe();
    });
  });

  describe('setStatus', () => {
    it('manually sets status', () => {
      tracker.setStatus('syncing');
      expect(tracker.getStatus()).toBe('syncing');
    });

    it('sets lastSyncTimestamp when transitioning to online', () => {
      tracker.setStatus('offline');
      const statsBefore = tracker.getStats(0, []);
      expect(statsBefore.lastSyncTimestamp).toBeNull();

      tracker.setStatus('online');
      const statsAfter = tracker.getStats(0, []);
      expect(statsAfter.lastSyncTimestamp).toBeGreaterThan(0);
    });

    it('emits via status$ observable', async () => {
      const nextStatus = firstValueFrom(tracker.status$.pipe(skip(1)));
      tracker.setStatus('error');
      expect(await nextStatus).toBe('error');
    });
  });

  describe('getStats', () => {
    it('returns correct stats', () => {
      const stats = tracker.getStats(5, ['users', 'todos']);
      expect(stats.offlineQueueSize).toBe(5);
      expect(stats.cachedCollections).toEqual(['users', 'todos']);
      expect(stats.isOnline).toBe(true);
      expect(stats.lastSyncTimestamp).toBeNull();
    });

    it('reflects online state from provider', () => {
      provider.goOffline();
      const stats = tracker.getStats(0, []);
      expect(stats.isOnline).toBe(false);
    });
  });

  describe('destroy', () => {
    it('stops tracking and completes observable', () => {
      tracker.start();
      const completeSpy = vi.fn();
      tracker.status$.subscribe({ complete: completeSpy });

      tracker.destroy();
      expect(completeSpy).toHaveBeenCalled();
    });
  });

  describe('createSyncStatusTracker', () => {
    it('creates a tracker with config and provider', () => {
      const t = createSyncStatusTracker(undefined, provider);
      expect(t).toBeInstanceOf(SyncStatusTracker);
      expect(t.isOnline()).toBe(true);
      t.destroy();
    });
  });
});
