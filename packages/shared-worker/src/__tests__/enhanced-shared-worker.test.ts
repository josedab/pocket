import { describe, expect, it, vi } from 'vitest';
import { createGracefulDegradation } from '../graceful-degradation.js';
import type { SyncEvent, SyncStatus } from '../sync-dedup.js';
import { createSyncConnectionDedup } from '../sync-dedup.js';
import { createWriteCoordinator } from '../write-coordinator.js';

// ---- Sync Connection Dedup ----

describe('createSyncConnectionDedup', () => {
  it('should start in idle status', () => {
    const dedup = createSyncConnectionDedup({ databaseName: 'test' });
    const statuses: SyncStatus[] = [];
    dedup.syncStatus$.subscribe((s) => statuses.push(s));

    expect(statuses).toContain('idle');
    dedup.destroy();
  });

  it('should deduplicate sync requests for the same direction', () => {
    const dedup = createSyncConnectionDedup({ databaseName: 'test' });

    dedup.requestSync('pull');
    dedup.requestSync('pull');
    dedup.requestSync('pull');

    expect(dedup.getQueuedSyncs()).toBeLessThanOrEqual(1);
    dedup.destroy();
  });

  it('should allow queuing different sync directions', () => {
    const dedup = createSyncConnectionDedup({ databaseName: 'test' });

    // Without a handler, queue is consumed but the operations still run
    dedup.requestSync('push');
    dedup.requestSync('pull');

    // Both push and pull can be requested independently
    expect(dedup.getQueuedSyncs()).toBeLessThanOrEqual(2);
    dedup.destroy();
  });

  it('should execute sync handler on leader tab', async () => {
    const dedup = createSyncConnectionDedup({ databaseName: 'test' });
    const handler = vi.fn().mockResolvedValue(undefined);
    dedup.setSyncHandler(handler);

    dedup.requestSync('pull');

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handler).toHaveBeenCalledWith('pull');
    dedup.destroy();
  });

  it('should emit sync events', async () => {
    const dedup = createSyncConnectionDedup({ databaseName: 'test' });
    const events: SyncEvent[] = [];
    dedup.syncEvents$.subscribe((e) => events.push(e));

    dedup.setSyncHandler(vi.fn().mockResolvedValue(undefined));
    dedup.requestSync('push');

    await new Promise((resolve) => setTimeout(resolve, 50));

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('sync-start');
    expect(eventTypes).toContain('sync-complete');
    dedup.destroy();
  });

  it('should report manual sync status', () => {
    const dedup = createSyncConnectionDedup({ databaseName: 'test' });
    const statuses: SyncStatus[] = [];
    dedup.syncStatus$.subscribe((s) => statuses.push(s));

    dedup.reportSyncError('network error');
    expect(statuses).toContain('error');

    dedup.reportSyncComplete();
    expect(statuses).toContain('idle');
    dedup.destroy();
  });
});

// ---- Write Coordinator ----

describe('createWriteCoordinator', () => {
  it('should acquire and release a lock', async () => {
    const coordinator = createWriteCoordinator({ databaseName: 'test' });
    const lock = await coordinator.acquireLock('todos', 'todo-1');

    expect(lock.collection).toBe('todos');
    expect(lock.documentId).toBe('todo-1');
    expect(coordinator.isLocked('todos', 'todo-1')).toBe(true);

    coordinator.releaseLock(lock);
    expect(coordinator.isLocked('todos', 'todo-1')).toBe(false);
    coordinator.destroy();
  });

  it('should allow re-acquiring own lock (extend)', async () => {
    const coordinator = createWriteCoordinator({ databaseName: 'test' });
    const lock1 = await coordinator.acquireLock('todos', 'todo-1');
    const lock2 = await coordinator.acquireLock('todos', 'todo-1');

    // Same tab can re-acquire (extend)
    expect(lock2.expiresAt).toBeGreaterThanOrEqual(lock1.expiresAt);
    coordinator.destroy();
  });

  it('should track active locks', async () => {
    const coordinator = createWriteCoordinator({ databaseName: 'test' });
    await coordinator.acquireLock('todos', 'todo-1');
    await coordinator.acquireLock('todos', 'todo-2');

    const locks = coordinator.getActiveLocks();
    expect(locks).toHaveLength(2);
    coordinator.destroy();
  });

  it('should expire locks after timeout', async () => {
    const coordinator = createWriteCoordinator({
      databaseName: 'test',
      lockTimeoutMs: 50,
    });

    await coordinator.acquireLock('todos', 'todo-1');
    expect(coordinator.isLocked('todos', 'todo-1')).toBe(true);

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(coordinator.isLocked('todos', 'todo-1')).toBe(false);
    coordinator.destroy();
  });

  it('should not be locked for unrelated documents', () => {
    const coordinator = createWriteCoordinator({ databaseName: 'test' });
    expect(coordinator.isLocked('todos', 'nonexistent')).toBe(false);
    coordinator.destroy();
  });
});

// ---- Graceful Degradation ----

describe('createGracefulDegradation', () => {
  it('should detect capabilities', () => {
    const degradation = createGracefulDegradation({ databaseName: 'test' });
    const caps = degradation.detectCapabilities();

    expect(typeof caps.sharedWorker).toBe('boolean');
    expect(typeof caps.broadcastChannel).toBe('boolean');
    expect(typeof caps.localStorage).toBe('boolean');
    expect(typeof caps.serviceWorker).toBe('boolean');
  });

  it('should select best strategy based on available APIs', () => {
    const degradation = createGracefulDegradation({ databaseName: 'test' });
    const strategy = degradation.detectBestStrategy();

    expect(strategy.mode).toBeDefined();
    expect(typeof strategy.supportsLeaderElection).toBe('boolean');
    expect(typeof strategy.estimatedLatencyMs).toBe('number');
  });

  it('should return strategy details for each mode', () => {
    const degradation = createGracefulDegradation({ databaseName: 'test' });

    const sw = degradation.getStrategyForMode('shared-worker');
    expect(sw.supportsQueryDedup).toBe(true);

    const bc = degradation.getStrategyForMode('broadcast');
    expect(bc.supportsLeaderElection).toBe(true);

    const se = degradation.getStrategyForMode('storage-events');
    expect(se.supportsQueryDedup).toBe(false);

    const direct = degradation.getStrategyForMode('direct');
    expect(direct.supportsLeaderElection).toBe(false);
  });

  it('should always report direct mode as supported', () => {
    const degradation = createGracefulDegradation({ databaseName: 'test' });
    expect(degradation.isSupported('direct')).toBe(true);
  });

  it('should use preferred mode when supported', () => {
    const degradation = createGracefulDegradation({
      databaseName: 'test',
      preferredMode: 'direct',
    });
    const strategy = degradation.detectBestStrategy();
    expect(strategy.mode).toBe('direct');
  });
});
