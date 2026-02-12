import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNodeBroadcastAdapter } from '../broadcast-adapter.js';
import { createLeaderElection } from '../leader-election.js';
import type { LeaderElection } from '../leader-election.js';
import { createQueryDeduplicator } from '../query-dedup.js';
import type { QueryDeduplicator } from '../query-dedup.js';
import { createTabCoordinator } from '../tab-coordinator.js';
import type { TabCoordinator } from '../tab-coordinator.js';
import type { BroadcastAdapter, BroadcastMessage } from '../types.js';

describe('BroadcastAdapter', () => {
  let adapter1: BroadcastAdapter;
  let adapter2: BroadcastAdapter;

  beforeEach(() => {
    adapter1 = createNodeBroadcastAdapter('test-channel');
    adapter2 = createNodeBroadcastAdapter('test-channel');
  });

  afterEach(() => {
    adapter1.close();
    adapter2.close();
  });

  it('should send and receive messages between adapters', () => {
    const received: BroadcastMessage[] = [];
    adapter2.onMessage((msg) => received.push(msg));

    const message: BroadcastMessage = {
      type: 'heartbeat',
      senderId: 'tab-1',
      payload: { tabId: 'tab-1' },
    };
    adapter1.postMessage(message);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(message);
  });

  it('should not receive own messages', () => {
    const received: BroadcastMessage[] = [];
    adapter1.onMessage((msg) => received.push(msg));

    adapter1.postMessage({
      type: 'heartbeat',
      senderId: 'tab-1',
      payload: {},
    });

    expect(received).toHaveLength(0);
  });

  it('should unsubscribe from messages', () => {
    const received: BroadcastMessage[] = [];
    const unsub = adapter2.onMessage((msg) => received.push(msg));
    unsub();

    adapter1.postMessage({
      type: 'heartbeat',
      senderId: 'tab-1',
      payload: {},
    });

    expect(received).toHaveLength(0);
  });

  it('should not receive messages after close', () => {
    const received: BroadcastMessage[] = [];
    adapter2.onMessage((msg) => received.push(msg));
    adapter2.close();

    adapter1.postMessage({
      type: 'heartbeat',
      senderId: 'tab-1',
      payload: {},
    });

    expect(received).toHaveLength(0);
  });
});

describe('LeaderElection', () => {
  let adapter1: BroadcastAdapter;
  let adapter2: BroadcastAdapter;
  let leader1: LeaderElection;

  beforeEach(() => {
    vi.useFakeTimers();
    adapter1 = createNodeBroadcastAdapter('leader-test');
    adapter2 = createNodeBroadcastAdapter('leader-test');
  });

  afterEach(() => {
    leader1?.stop();
    adapter1.close();
    adapter2.close();
    vi.useRealTimers();
  });

  it('should elect single tab as leader', () => {
    leader1 = createLeaderElection(
      { heartbeatIntervalMs: 100, leaderTimeoutMs: 300, channelName: 'leader-test' },
      adapter1,
    );
    leader1.start();

    expect(leader1.isLeader()).toBe(true);
    expect(leader1.getState().leaderId).toBeTruthy();
  });

  it('should transfer leadership on tab close', () => {
    leader1 = createLeaderElection(
      { heartbeatIntervalMs: 100, leaderTimeoutMs: 300, channelName: 'leader-test' },
      adapter1,
    );
    leader1.start();
    expect(leader1.isLeader()).toBe(true);

    const leader2 = createLeaderElection(
      { heartbeatIntervalMs: 100, leaderTimeoutMs: 300, channelName: 'leader-test' },
      adapter2,
    );
    leader2.start();

    // leader1 stops (simulates tab close)
    leader1.stop();

    // Advance timers so leader2 detects timeout
    vi.advanceTimersByTime(300);

    expect(leader2.isLeader()).toBe(true);
    leader2.stop();
  });

  it('should notify on leader change via callback', () => {
    leader1 = createLeaderElection(
      { heartbeatIntervalMs: 100, leaderTimeoutMs: 300, channelName: 'leader-test' },
      adapter1,
    );

    const states: boolean[] = [];
    const unsub = leader1.onLeaderChange((state) => states.push(state.isLeader));
    leader1.start();

    expect(states.length).toBeGreaterThan(0);
    expect(states[states.length - 1]).toBe(true);

    unsub();
  });
});

describe('QueryDeduplicator', () => {
  let dedup: QueryDeduplicator;

  beforeEach(() => {
    vi.useFakeTimers();
    dedup = createQueryDeduplicator({ ttlMs: 1000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should execute on cache miss and return result', async () => {
    const result = await dedup.deduplicate('q1', async () => 'result-1');
    expect(result).toBe('result-1');

    const stats = dedup.getStats();
    expect(stats.cacheMisses).toBe(1);
    expect(stats.cacheSize).toBe(1);
  });

  it('should return cached result on cache hit', async () => {
    const executeFn = vi.fn().mockResolvedValue('result-1');
    await dedup.deduplicate('q1', executeFn);
    const result = await dedup.deduplicate('q1', executeFn);

    expect(result).toBe('result-1');
    expect(executeFn).toHaveBeenCalledTimes(1);

    const stats = dedup.getStats();
    expect(stats.cacheHits).toBe(1);
    expect(stats.cacheMisses).toBe(1);
  });

  it('should expire cache entries after TTL', async () => {
    const executeFn = vi.fn().mockResolvedValue('result-1');
    await dedup.deduplicate('q1', executeFn);

    vi.advanceTimersByTime(1500);

    const executeFn2 = vi.fn().mockResolvedValue('result-2');
    const result = await dedup.deduplicate('q1', executeFn2);

    expect(result).toBe('result-2');
    expect(executeFn2).toHaveBeenCalledTimes(1);
  });

  it('should invalidate specific query', async () => {
    await dedup.deduplicate('q1', async () => 'result-1');
    dedup.invalidate('q1');

    const stats = dedup.getStats();
    expect(stats.cacheSize).toBe(0);
  });

  it('should invalidate all queries', async () => {
    await dedup.deduplicate('q1', async () => 'r1');
    await dedup.deduplicate('q2', async () => 'r2');
    dedup.invalidateAll();

    const stats = dedup.getStats();
    expect(stats.cacheSize).toBe(0);
  });

  it('should report correct stats', async () => {
    await dedup.deduplicate('q1', async () => 'r1');
    await dedup.deduplicate('q1', async () => 'r1');
    await dedup.deduplicate('q2', async () => 'r2');

    const stats = dedup.getStats();
    expect(stats.cacheHits).toBe(1);
    expect(stats.cacheMisses).toBe(2);
    expect(stats.cacheSize).toBe(2);
  });
});

describe('TabCoordinator', () => {
  let coordinator: TabCoordinator;

  beforeEach(() => {
    vi.useFakeTimers();
    coordinator = createTabCoordinator({ databaseName: 'test-db' });
  });

  afterEach(() => {
    coordinator.destroy();
    vi.useRealTimers();
  });

  it('should register a tab and return tab info', () => {
    const tab = coordinator.register();
    expect(tab).toBeDefined();
    expect(tab.tabId).toBeTruthy();
  });

  it('should return registered tabs', () => {
    coordinator.register();
    const tabs = coordinator.getTabs();
    expect(tabs.length).toBeGreaterThanOrEqual(1);
  });

  it('should unregister and update state', () => {
    coordinator.register();
    coordinator.unregister();

    const states: boolean[] = [];
    coordinator.state$.subscribe((s) => states.push(s.isConnected));
    expect(states).toContain(false);
  });

  it('should broadcast messages to listeners', () => {
    coordinator.register();

    const coordinator2 = createTabCoordinator({ databaseName: 'test-db' });
    coordinator2.register();

    const received: BroadcastMessage[] = [];
    coordinator2.onMessage((msg) => received.push(msg));

    coordinator.broadcast({
      type: 'change',
      senderId: 'test-sender',
      payload: { data: 'test' },
    });

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].type).toBe('change');

    coordinator2.destroy();
  });
});
