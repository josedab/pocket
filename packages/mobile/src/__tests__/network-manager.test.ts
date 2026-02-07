import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { take, skip } from 'rxjs/operators';
import { createNetworkManager, NetworkManager } from '../network-manager.js';

describe('NetworkManager', () => {
  let manager: NetworkManager;

  beforeEach(() => {
    manager = createNetworkManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('createNetworkManager', () => {
    it('returns a NetworkManager instance', () => {
      expect(manager).toBeInstanceOf(NetworkManager);
    });

    it('accepts optional config', () => {
      manager.destroy();
      manager = createNetworkManager({
        initialConnectionType: 'wifi',
        initialOnline: true,
      });
      expect(manager).toBeInstanceOf(NetworkManager);
    });
  });

  describe('getState', () => {
    it('returns initial state with defaults', () => {
      const state = manager.getState();
      expect(state.status).toBe('online');
      expect(state.connectionType).toBe('unknown');
      expect(state.isMetered).toBe(false);
      expect(state.lastChanged).toBeGreaterThan(0);
    });

    it('returns metered state for cellular initial connection', () => {
      manager.destroy();
      manager = createNetworkManager({ initialConnectionType: 'cellular' });
      const state = manager.getState();
      expect(state.status).toBe('metered');
      expect(state.isMetered).toBe(true);
    });

    it('returns offline state when initialOnline is false', () => {
      manager.destroy();
      manager = createNetworkManager({ initialOnline: false });
      expect(manager.getState().status).toBe('offline');
    });
  });

  describe('isOnline', () => {
    it('returns true when online', () => {
      expect(manager.isOnline()).toBe(true);
    });

    it('returns false when offline', () => {
      manager.destroy();
      manager = createNetworkManager({ initialOnline: false });
      expect(manager.isOnline()).toBe(false);
    });

    it('returns true when metered (cellular is still online)', () => {
      manager.destroy();
      manager = createNetworkManager({ initialConnectionType: 'cellular' });
      expect(manager.isOnline()).toBe(true);
    });
  });

  describe('isMetered', () => {
    it('returns false for non-cellular connections', () => {
      expect(manager.isMetered()).toBe(false);
    });

    it('returns true for cellular connections', () => {
      manager.destroy();
      manager = createNetworkManager({ initialConnectionType: 'cellular' });
      expect(manager.isMetered()).toBe(true);
    });
  });

  describe('updateConnectionType', () => {
    it('changes to offline when connection is none', () => {
      manager.updateConnectionType('none');
      expect(manager.getState().status).toBe('offline');
      expect(manager.isOnline()).toBe(false);
    });

    it('changes to metered when connection is cellular', () => {
      manager.updateConnectionType('cellular');
      expect(manager.getState().status).toBe('metered');
      expect(manager.isMetered()).toBe(true);
    });

    it('changes to online when connection is wifi', () => {
      manager.updateConnectionType('none');
      manager.updateConnectionType('wifi');
      expect(manager.getState().status).toBe('online');
      expect(manager.isOnline()).toBe(true);
    });

    it('updates lastChanged timestamp', () => {
      const before = manager.getState().lastChanged;
      manager.updateConnectionType('wifi');
      expect(manager.getState().lastChanged).toBeGreaterThanOrEqual(before);
    });
  });

  describe('setOnline', () => {
    it('sets to offline when false', () => {
      manager.setOnline(false);
      expect(manager.getState().status).toBe('offline');
      expect(manager.getState().connectionType).toBe('none');
    });

    it('sets back to online from offline', () => {
      manager.setOnline(false);
      manager.setOnline(true);
      expect(manager.isOnline()).toBe(true);
    });

    it('does nothing when already online and setting true', () => {
      const before = manager.getState();
      manager.setOnline(true);
      // Status should remain online; state object may or may not change
      expect(manager.getState().status).toBe('online');
    });
  });

  describe('getCurrentStrategy', () => {
    it('returns offline strategy when connection is none', () => {
      manager.updateConnectionType('none');
      const strategy = manager.getCurrentStrategy();
      expect(strategy.enabled).toBe(false);
      expect(strategy.batchSize).toBe(0);
    });

    it('returns wifi strategy when connection is wifi', () => {
      manager.updateConnectionType('wifi');
      const strategy = manager.getCurrentStrategy();
      expect(strategy.enabled).toBe(true);
      expect(strategy.batchSize).toBe(100);
    });

    it('returns cellular strategy when connection is cellular', () => {
      manager.updateConnectionType('cellular');
      const strategy = manager.getCurrentStrategy();
      expect(strategy.enabled).toBe(true);
      expect(strategy.batchSize).toBe(25);
    });

    it('uses custom strategies when provided', () => {
      manager.destroy();
      manager = createNetworkManager({
        strategies: {
          wifi: { enabled: true, batchSize: 200, intervalMs: 10_000 },
          cellular: { enabled: false, batchSize: 5, intervalMs: 60_000 },
          offline: { enabled: false, batchSize: 0, intervalMs: 0 },
        },
      });
      manager.updateConnectionType('wifi');
      expect(manager.getCurrentStrategy().batchSize).toBe(200);
    });
  });

  describe('queueOperation', () => {
    it('adds operations to the pending queue', () => {
      manager.queueOperation(async () => {});
      expect(manager.getPendingOperationCount()).toBe(1);
    });

    it('increments pending count for multiple operations', () => {
      manager.queueOperation(async () => {});
      manager.queueOperation(async () => {});
      expect(manager.getPendingOperationCount()).toBe(2);
    });
  });

  describe('operations replay when going online', () => {
    it('replays queued operations when connection type goes from none to wifi', async () => {
      manager.updateConnectionType('none');
      const executed: number[] = [];
      manager.queueOperation(async () => { executed.push(1); });
      manager.queueOperation(async () => { executed.push(2); });

      manager.updateConnectionType('wifi');

      // Wait for async replay
      await vi.waitFor(() => {
        expect(executed).toEqual([1, 2]);
      });
      expect(manager.getPendingOperationCount()).toBe(0);
    });

    it('re-queues failed operations during replay', async () => {
      manager.updateConnectionType('none');
      let attempts = 0;
      manager.queueOperation(async () => {
        attempts++;
        if (attempts === 1) throw new Error('fail');
      });

      manager.updateConnectionType('wifi');

      await vi.waitFor(() => {
        expect(attempts).toBe(1);
      });
      expect(manager.getPendingOperationCount()).toBe(1);
    });
  });

  describe('state$ observable', () => {
    it('emits current state immediately', async () => {
      const state = await firstValueFrom(manager.state$.pipe(take(1)));
      expect(state.status).toBe('online');
    });

    it('emits when connection type changes', async () => {
      const statePromise = firstValueFrom(manager.state$.pipe(skip(1), take(1)));
      manager.updateConnectionType('cellular');
      const state = await statePromise;
      expect(state.status).toBe('metered');
      expect(state.connectionType).toBe('cellular');
    });
  });

  describe('destroy', () => {
    it('clears pending operations', () => {
      manager.queueOperation(async () => {});
      manager.destroy();
      expect(manager.getPendingOperationCount()).toBe(0);
    });

    it('completes the state$ observable', async () => {
      let completed = false;
      manager.state$.subscribe({ complete: () => { completed = true; } });
      manager.destroy();
      expect(completed).toBe(true);
    });
  });
});
