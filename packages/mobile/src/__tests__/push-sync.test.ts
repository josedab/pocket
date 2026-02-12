import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPushSync, PushSync } from '../push-sync.js';
import type { PushSyncPayload } from '../types.js';

describe('PushSync', () => {
  let pushSync: PushSync;

  beforeEach(() => {
    pushSync = createPushSync();
  });

  afterEach(() => {
    pushSync.destroy();
  });

  describe('createPushSync', () => {
    it('returns a PushSync instance', () => {
      expect(pushSync).toBeInstanceOf(PushSync);
    });

    it('accepts optional config', () => {
      pushSync.destroy();
      pushSync = createPushSync({
        batchSize: 100,
        maxBatchDelayMs: 10_000,
      });
      expect(pushSync).toBeInstanceOf(PushSync);
    });
  });

  describe('getStatus', () => {
    it('returns disabled initially', () => {
      expect(pushSync.getStatus()).toBe('disabled');
    });

    it('returns idle after enable', () => {
      pushSync.enable();
      expect(pushSync.getStatus()).toBe('idle');
    });
  });

  describe('enable/disable', () => {
    it('enables push sync', () => {
      pushSync.enable();
      expect(pushSync.isEnabled()).toBe(true);
      expect(pushSync.getStatus()).toBe('idle');
    });

    it('disables push sync', () => {
      pushSync.enable();
      pushSync.disable();
      expect(pushSync.isEnabled()).toBe(false);
      expect(pushSync.getStatus()).toBe('disabled');
    });

    it('enable is idempotent', () => {
      pushSync.enable();
      pushSync.enable();
      expect(pushSync.isEnabled()).toBe(true);
    });

    it('disable is idempotent', () => {
      pushSync.disable();
      expect(pushSync.isEnabled()).toBe(false);
    });

    it('disable clears pending payloads', async () => {
      pushSync.enable();
      await pushSync.handlePush(makePayload({ priority: 'low' }));
      expect(pushSync.getPendingCount()).toBeGreaterThanOrEqual(0);
      pushSync.disable();
      expect(pushSync.getPendingCount()).toBe(0);
    });
  });

  describe('handlePush', () => {
    it('processes a push notification and returns result for high priority', async () => {
      pushSync.enable();
      const result = await pushSync.handlePush(makePayload({ priority: 'high' }));
      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.synced).toBeGreaterThanOrEqual(1);
    });

    it('batches normal priority pushes (returns null)', async () => {
      pushSync.destroy();
      pushSync = createPushSync({ batchSize: 5, maxBatchDelayMs: 60_000 });
      pushSync.enable();

      const result = await pushSync.handlePush(makePayload({ priority: 'normal' }));
      expect(result).toBeNull();
      expect(pushSync.getPendingCount()).toBe(1);
    });

    it('flushes when batch size is reached', async () => {
      pushSync.destroy();
      pushSync = createPushSync({ batchSize: 2 });
      pushSync.enable();

      await pushSync.handlePush(makePayload({ priority: 'normal' }));
      const result = await pushSync.handlePush(makePayload({ priority: 'normal' }));
      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
    });

    it('handles push with collections', async () => {
      pushSync.enable();
      const result = await pushSync.handlePush(
        makePayload({ priority: 'high', collections: ['todos', 'notes'] }),
      );
      expect(result).not.toBeNull();
      expect(result!.synced).toBe(2);
    });
  });

  describe('flush', () => {
    it('syncs all pending payloads', async () => {
      pushSync.destroy();
      pushSync = createPushSync({ batchSize: 100 });
      pushSync.enable();

      await pushSync.handlePush(makePayload({ priority: 'low' }));
      await pushSync.handlePush(makePayload({ priority: 'low' }));

      const result = await pushSync.flush();
      expect(result.success).toBe(true);
      expect(result.synced).toBeGreaterThanOrEqual(2);
      expect(pushSync.getPendingCount()).toBe(0);
    });

    it('returns result even with no pending payloads', async () => {
      pushSync.enable();
      const result = await pushSync.flush();
      expect(result).toBeDefined();
      expect(result.synced).toBe(0);
    });

    it('calls onSyncComplete callback', async () => {
      const onSyncComplete = vi.fn();
      pushSync.destroy();
      pushSync = createPushSync({ onSyncComplete });
      pushSync.enable();

      await pushSync.handlePush(makePayload({ priority: 'high' }));
      expect(onSyncComplete).toHaveBeenCalledOnce();
    });
  });

  describe('getPendingCount', () => {
    it('returns 0 initially', () => {
      expect(pushSync.getPendingCount()).toBe(0);
    });

    it('returns the count of pending payloads', async () => {
      pushSync.destroy();
      pushSync = createPushSync({ batchSize: 100, maxBatchDelayMs: 60_000 });
      pushSync.enable();
      await pushSync.handlePush(makePayload({ priority: 'low' }));
      await pushSync.handlePush(makePayload({ priority: 'low' }));
      expect(pushSync.getPendingCount()).toBe(2);
    });
  });

  describe('getHistory', () => {
    it('returns empty array initially', () => {
      expect(pushSync.getHistory()).toEqual([]);
    });

    it('returns past sync results', async () => {
      pushSync.enable();
      await pushSync.handlePush(makePayload({ priority: 'high' }));
      await pushSync.handlePush(makePayload({ priority: 'high' }));

      const history = pushSync.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]!.success).toBe(true);
    });

    it('returns a copy (not a reference)', async () => {
      pushSync.enable();
      await pushSync.handlePush(makePayload({ priority: 'high' }));
      const history = pushSync.getHistory();
      history.length = 0;
      expect(pushSync.getHistory()).toHaveLength(1);
    });
  });

  describe('handlePush when disabled', () => {
    it('returns null when disabled', async () => {
      const result = await pushSync.handlePush(makePayload({ priority: 'high' }));
      expect(result).toBeNull();
    });

    it('does not add to pending count', async () => {
      await pushSync.handlePush(makePayload({ priority: 'normal' }));
      expect(pushSync.getPendingCount()).toBe(0);
    });
  });

  describe('destroy', () => {
    it('disables push sync', () => {
      pushSync.enable();
      pushSync.destroy();
      expect(pushSync.isEnabled()).toBe(false);
    });

    it('clears pending payloads', async () => {
      pushSync.destroy();
      pushSync = createPushSync({ batchSize: 100, maxBatchDelayMs: 60_000 });
      pushSync.enable();
      await pushSync.handlePush(makePayload({ priority: 'low' }));
      pushSync.destroy();
      expect(pushSync.getPendingCount()).toBe(0);
    });

    it('completes status$ observable', () => {
      let completed = false;
      pushSync.status$.subscribe({ complete: () => { completed = true; } });
      pushSync.destroy();
      expect(completed).toBe(true);
    });

    it('completes results$ observable', () => {
      let completed = false;
      pushSync.results$.subscribe({ complete: () => { completed = true; } });
      pushSync.destroy();
      expect(completed).toBe(true);
    });
  });
});

// ────────────────────────────── Helpers ──────────────────────────────

function makePayload(
  overrides: Partial<PushSyncPayload> = {},
): PushSyncPayload {
  return {
    type: 'silent-push',
    priority: 'normal',
    timestamp: Date.now(),
    ...overrides,
  };
}
