import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectionPool,
  createConnectionPool,
  type ConnectionPoolStats,
  type ConnectionPoolStatus,
} from '../connection-pool.js';

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    for (const instance of MockBroadcastChannel.instances) {
      if (instance !== this && instance.name === this.name && instance.onmessage) {
        instance.onmessage(new MessageEvent('message', { data }));
      }
    }
  }

  close(): void {
    const idx = MockBroadcastChannel.instances.indexOf(this);
    if (idx >= 0) MockBroadcastChannel.instances.splice(idx, 1);
  }
}

describe('ConnectionPool', () => {
  let pool: ConnectionPool;

  beforeEach(() => {
    vi.useFakeTimers();
    MockBroadcastChannel.instances = [];
    (globalThis as Record<string, unknown>).BroadcastChannel =
      MockBroadcastChannel as unknown as typeof BroadcastChannel;
  });

  afterEach(() => {
    pool?.destroy();
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).BroadcastChannel;
    MockBroadcastChannel.instances = [];
  });

  describe('initialization', () => {
    it('should start as idle', () => {
      pool = createConnectionPool();
      const stats = pool.getCurrentStats();
      expect(stats.status).toBe('idle');
    });

    it('should become leader when no BroadcastChannel', () => {
      delete (globalThis as Record<string, unknown>).BroadcastChannel;
      pool = createConnectionPool();
      pool.start();

      expect(pool.getIsLeader()).toBe(true);
      expect(pool.getLeaderId()).toBe(pool.getTabId());
    });

    it('should become leader when alone', () => {
      pool = createConnectionPool();
      pool.start();

      // Wait for the leader election timeout (500ms)
      vi.advanceTimersByTime(600);

      expect(pool.getIsLeader()).toBe(true);
    });

    it('should generate a unique tab ID', () => {
      pool = createConnectionPool();
      expect(pool.getTabId()).toMatch(/^tab_\d+_[a-z0-9]+$/);
    });
  });

  describe('leader election', () => {
    it('should recognize existing leader via heartbeats', () => {
      const pool1 = createConnectionPool({ heartbeatIntervalMs: 100 });
      pool1.start();
      vi.advanceTimersByTime(600);
      expect(pool1.getIsLeader()).toBe(true);

      const pool2 = createConnectionPool({ heartbeatIntervalMs: 100 });
      pool2.start();

      // pool1 sends a heartbeat with leaderId before pool2's 500ms timeout
      vi.advanceTimersByTime(150);

      // pool2 should have received pool1's heartbeat and know the leader
      expect(pool2.getLeaderId()).toBe(pool1.getTabId());

      // After pool2's initial 500ms timeout, it should be follower (leader exists)
      vi.advanceTimersByTime(400);
      expect(pool2.getIsLeader()).toBe(false);

      pool1.destroy();
      pool2.destroy();
    });

    it('should trigger failover when leader stops', () => {
      const pool1 = createConnectionPool({
        heartbeatIntervalMs: 100,
        connectionTimeoutMs: 500,
      });
      pool1.start();
      vi.advanceTimersByTime(600);
      expect(pool1.getIsLeader()).toBe(true);

      const pool2 = createConnectionPool({
        heartbeatIntervalMs: 100,
        connectionTimeoutMs: 500,
      });
      pool2.start();
      vi.advanceTimersByTime(200);

      // Destroy leader
      pool1.destroy();

      // Wait for failover timeout
      vi.advanceTimersByTime(3000);

      expect(pool2.getIsLeader()).toBe(true);

      pool2.destroy();
    });

    it('should force leadership', () => {
      pool = createConnectionPool();
      pool.start();

      pool.forceLeadership();

      expect(pool.getIsLeader()).toBe(true);
      expect(pool.getLeaderId()).toBe(pool.getTabId());
    });
  });

  describe('sync request routing', () => {
    it('should process request directly when leader', () => {
      pool = createConnectionPool();
      pool.start();
      vi.advanceTimersByTime(600);

      pool.routeSyncRequest({ collection: 'todos', query: {} });

      const stats = pool.getCurrentStats();
      expect(stats.messagesRouted).toBe(1);
      expect(stats.messagesQueued).toBe(0);
    });

    it('should queue requests when follower', () => {
      const leader = createConnectionPool({ heartbeatIntervalMs: 100 });
      leader.start();
      vi.advanceTimersByTime(600);
      expect(leader.getIsLeader()).toBe(true);

      const follower = createConnectionPool({ heartbeatIntervalMs: 100 });
      follower.start();

      // Let follower receive leader's heartbeat but not yet timeout
      vi.advanceTimersByTime(150);
      // Now follower knows about the leader

      // After 500ms timeout, follower sees a leader and becomes follower
      vi.advanceTimersByTime(400);
      expect(follower.getIsLeader()).toBe(false);

      follower.routeSyncRequest({ collection: 'todos', query: {} });

      const stats = follower.getCurrentStats();
      expect(stats.messagesQueued).toBe(1);

      leader.destroy();
      follower.destroy();
    });

    it('should respect maxQueueSize', () => {
      const leader = createConnectionPool();
      leader.start();
      vi.advanceTimersByTime(600);

      const follower = createConnectionPool({ maxQueueSize: 2 });
      follower.start();
      vi.advanceTimersByTime(600);

      follower.routeSyncRequest({ id: 1 });
      follower.routeSyncRequest({ id: 2 });
      follower.routeSyncRequest({ id: 3 });

      const stats = follower.getCurrentStats();
      expect(stats.messagesQueued).toBeLessThanOrEqual(2);

      leader.destroy();
      follower.destroy();
    });

    it('should process queued messages when becoming leader', () => {
      pool = createConnectionPool();
      pool.start();

      // Before leader election, queue some messages
      // pool is not leader yet (hasn't waited 500ms)
      pool.routeSyncRequest({ id: 1 });
      pool.routeSyncRequest({ id: 2 });

      // Become leader
      vi.advanceTimersByTime(600);

      const stats = pool.getCurrentStats();
      // Queued messages should be processed
      expect(stats.messagesRouted).toBeGreaterThanOrEqual(2);
      expect(stats.messagesQueued).toBe(0);
    });
  });

  describe('status observable', () => {
    it('should emit status changes', () => {
      pool = createConnectionPool();
      const statuses: ConnectionPoolStatus[] = [];
      pool.getStatus().subscribe((s) => statuses.push(s));

      pool.start();
      vi.advanceTimersByTime(600);

      expect(statuses).toContain('idle');
      expect(statuses).toContain('leader');
    });

    it('should emit follower status when another pool is leader', () => {
      const pool1 = createConnectionPool({ heartbeatIntervalMs: 100 });
      pool1.start();
      vi.advanceTimersByTime(600);
      expect(pool1.getIsLeader()).toBe(true);

      const pool2 = createConnectionPool({ heartbeatIntervalMs: 100 });
      const statuses: ConnectionPoolStatus[] = [];
      pool2.getStatus().subscribe((s) => statuses.push(s));

      pool2.start();

      // Let follower receive heartbeat from leader
      vi.advanceTimersByTime(150);

      // After 500ms timeout, pool2 has a leader and becomes follower
      vi.advanceTimersByTime(400);

      expect(statuses).toContain('follower');

      pool1.destroy();
      pool2.destroy();
    });
  });

  describe('stats', () => {
    it('should provide current stats', () => {
      pool = createConnectionPool();
      pool.start();
      vi.advanceTimersByTime(600);

      const stats = pool.getCurrentStats();
      expect(stats.tabId).toBe(pool.getTabId());
      expect(stats.leaderId).toBe(pool.getTabId());
      expect(stats.status).toBe('leader');
      expect(stats.connectionShared).toBe(true);
    });

    it('should expose stats observable', () => {
      pool = createConnectionPool();
      const allStats: ConnectionPoolStats[] = [];
      pool.getStats().subscribe((s) => allStats.push(s));

      pool.start();
      vi.advanceTimersByTime(600);

      expect(allStats.length).toBeGreaterThanOrEqual(1);
    });

    it('should report connectionShared correctly', () => {
      pool = createConnectionPool();
      expect(pool.getCurrentStats().connectionShared).toBe(false);

      pool.start();
      vi.advanceTimersByTime(600);
      expect(pool.getCurrentStats().connectionShared).toBe(true);
    });
  });

  describe('stop', () => {
    it('should reset to idle on stop', () => {
      pool = createConnectionPool();
      pool.start();
      vi.advanceTimersByTime(600);

      pool.stop();

      expect(pool.getIsLeader()).toBe(false);
      expect(pool.getLeaderId()).toBeNull();
      expect(pool.getCurrentStats().status).toBe('idle');
    });

    it('should notify other pools when leader stops', () => {
      const pool1 = createConnectionPool({
        heartbeatIntervalMs: 100,
        connectionTimeoutMs: 500,
      });
      pool1.start();
      vi.advanceTimersByTime(600);

      const pool2 = createConnectionPool({
        heartbeatIntervalMs: 100,
        connectionTimeoutMs: 500,
      });
      pool2.start();
      vi.advanceTimersByTime(200);

      pool1.stop();

      // pool2 should detect leader departure
      vi.advanceTimersByTime(3000);
      expect(pool2.getIsLeader()).toBe(true);

      pool1.destroy();
      pool2.destroy();
    });
  });

  describe('destroy', () => {
    it('should clean up all resources', () => {
      pool = createConnectionPool();
      pool.start();
      vi.advanceTimersByTime(600);

      pool.destroy();

      // No errors on timer advance
      vi.advanceTimersByTime(10000);
    });

    it('should complete all observables', () => {
      pool = createConnectionPool();
      let statusCompleted = false;
      let statsCompleted = false;

      pool.getStatus().subscribe({
        complete: () => {
          statusCompleted = true;
        },
      });
      pool.getStats().subscribe({
        complete: () => {
          statsCompleted = true;
        },
      });

      pool.destroy();

      expect(statusCompleted).toBe(true);
      expect(statsCompleted).toBe(true);
    });
  });

  describe('factory', () => {
    it('should create via factory function', () => {
      pool = createConnectionPool();
      expect(pool).toBeInstanceOf(ConnectionPool);
    });

    it('should accept config', () => {
      pool = createConnectionPool({
        channelName: 'my-pool',
        heartbeatIntervalMs: 3000,
        connectionTimeoutMs: 15000,
        maxQueueSize: 500,
      });
      expect(pool).toBeInstanceOf(ConnectionPool);
    });
  });
});
