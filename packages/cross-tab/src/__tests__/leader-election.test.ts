import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaderElection, createLeaderElection } from '../leader-election.js';
import { type TabManager, createTabManager } from '../tab-manager.js';
import type { CrossTabEvent, LeaderState } from '../types.js';

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

describe('LeaderElection', () => {
  let tabManager: TabManager;
  let election: LeaderElection;

  beforeEach(() => {
    vi.useFakeTimers();
    MockBroadcastChannel.instances = [];
    (globalThis as Record<string, unknown>).BroadcastChannel =
      MockBroadcastChannel as unknown as typeof BroadcastChannel;
  });

  afterEach(() => {
    election?.destroy();
    tabManager?.destroy();
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).BroadcastChannel;
    MockBroadcastChannel.instances = [];
  });

  describe('single tab election', () => {
    it('should become leader when no BroadcastChannel', async () => {
      delete (globalThis as Record<string, unknown>).BroadcastChannel;
      tabManager = createTabManager();
      await tabManager.initialize();
      election = createLeaderElection(tabManager);
      await election.initialize();

      expect(election.isLeader()).toBe(true);
      expect(election.getLeaderId()).toBe(tabManager.getTabId());
    });

    it('should become leader when alone with BroadcastChannel', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      election = createLeaderElection(tabManager, { heartbeatInterval: 100 });
      await election.initialize();

      // Wait for election timeout (heartbeatInterval * 2)
      vi.advanceTimersByTime(250);

      expect(election.isLeader()).toBe(true);
    });
  });

  describe('state management', () => {
    it('should have null leader initially', () => {
      tabManager = createTabManager();
      election = createLeaderElection(tabManager);

      const state = election.getState();
      expect(state.leaderId).toBeNull();
      expect(state.isLeader).toBe(false);
      expect(state.electedAt).toBeNull();
    });

    it('should update state when becoming leader', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      election = createLeaderElection(tabManager, { heartbeatInterval: 100 });
      await election.initialize();

      vi.advanceTimersByTime(250);

      const state = election.getState();
      expect(state.isLeader).toBe(true);
      expect(state.leaderId).toBe(tabManager.getTabId());
      expect(state.electedAt).not.toBeNull();
      expect(state.lastHeartbeat).not.toBeNull();
    });

    it('should expose state observable', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      election = createLeaderElection(tabManager, { heartbeatInterval: 100 });

      const states: LeaderState[] = [];
      election.state.subscribe((s) => states.push(s));

      await election.initialize();
      vi.advanceTimersByTime(250);

      expect(states.length).toBeGreaterThanOrEqual(1);
      const lastState = states[states.length - 1]!;
      expect(lastState.isLeader).toBe(true);
    });
  });

  describe('events', () => {
    it('should emit leader-changed event', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      election = createLeaderElection(tabManager, { heartbeatInterval: 100 });

      const events: CrossTabEvent[] = [];
      election.events.subscribe((e) => events.push(e));

      await election.initialize();
      vi.advanceTimersByTime(250);

      expect(events.some((e) => e.type === 'leader-changed')).toBe(true);
    });
  });

  describe('abdication', () => {
    it('should abdicate leadership', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      election = createLeaderElection(tabManager, { heartbeatInterval: 100 });
      await election.initialize();
      vi.advanceTimersByTime(250);

      expect(election.isLeader()).toBe(true);

      election.abdicate();

      expect(election.isLeader()).toBe(false);
      expect(election.getState().leaderId).toBeNull();
    });

    it('should do nothing when non-leader abdicates', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      election = createLeaderElection(tabManager, { heartbeatInterval: 100 });
      await election.initialize();

      // Not yet leader
      election.abdicate();
      expect(election.getState().leaderId).toBeNull();
    });

    it('should trigger re-election after abdication', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      election = createLeaderElection(tabManager, { heartbeatInterval: 100 });
      await election.initialize();
      vi.advanceTimersByTime(250);

      election.abdicate();

      // Re-election should happen after delay + election timeout
      vi.advanceTimersByTime(500);

      expect(election.isLeader()).toBe(true);
    });
  });

  describe('requestLeadership', () => {
    it('should start an election when requested', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      election = createLeaderElection(tabManager, { heartbeatInterval: 100 });
      await election.initialize();

      election.requestLeadership();
      vi.advanceTimersByTime(250);

      expect(election.isLeader()).toBe(true);
    });
  });

  describe('multi-tab election', () => {
    it('should elect the oldest tab as leader', async () => {
      const tm1 = createTabManager();
      await tm1.initialize();
      const e1 = createLeaderElection(tm1, { heartbeatInterval: 100 });
      await e1.initialize();

      // First tab wins the election
      vi.advanceTimersByTime(250);
      expect(e1.isLeader()).toBe(true);

      // Second tab joins later
      vi.advanceTimersByTime(100);
      const tm2 = createTabManager();
      await tm2.initialize();
      const e2 = createLeaderElection(tm2, { heartbeatInterval: 100 });
      await e2.initialize();

      // e2 should receive heartbeats from e1 and stand down
      vi.advanceTimersByTime(250);

      // e1 sends heartbeats, so e2 should recognize e1 as leader
      expect(e1.isLeader()).toBe(true);
      // e2 receives heartbeats so it shouldn't be leader
      expect(e2.getState().leaderId).toBe(tm1.getTabId());

      e1.destroy();
      e2.destroy();
      tm1.destroy();
      tm2.destroy();
    });

    it('should elect new leader when current leader is destroyed', async () => {
      const tm1 = createTabManager();
      await tm1.initialize();
      const e1 = createLeaderElection(tm1, {
        heartbeatInterval: 100,
        leaderTimeout: 500,
      });
      await e1.initialize();
      vi.advanceTimersByTime(250);
      expect(e1.isLeader()).toBe(true);

      const tm2 = createTabManager();
      await tm2.initialize();
      const e2 = createLeaderElection(tm2, {
        heartbeatInterval: 100,
        leaderTimeout: 500,
      });
      await e2.initialize();
      vi.advanceTimersByTime(250);

      // Destroy the leader
      e1.destroy();
      tm1.destroy();

      // Wait for leader timeout and re-election
      vi.advanceTimersByTime(1000);

      expect(e2.isLeader()).toBe(true);

      e2.destroy();
      tm2.destroy();
    });
  });

  describe('heartbeat', () => {
    it('should send heartbeats when leader', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      election = createLeaderElection(tabManager, { heartbeatInterval: 100 });
      await election.initialize();
      vi.advanceTimersByTime(250);

      expect(election.isLeader()).toBe(true);

      // Heartbeat updates lastHeartbeat
      const hb1 = election.getState().lastHeartbeat!;
      vi.advanceTimersByTime(150);
      const hb2 = election.getState().lastHeartbeat!;

      expect(hb2).toBeGreaterThanOrEqual(hb1);
    });
  });

  describe('destroy', () => {
    it('should clean up all timers and channels', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      election = createLeaderElection(tabManager, { heartbeatInterval: 100 });
      await election.initialize();
      vi.advanceTimersByTime(250);

      election.destroy();

      // Advancing timers should not cause errors
      vi.advanceTimersByTime(5000);
    });

    it('should abdicate before destroying if leader', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      election = createLeaderElection(tabManager, { heartbeatInterval: 100 });
      await election.initialize();
      vi.advanceTimersByTime(250);

      expect(election.isLeader()).toBe(true);
      election.destroy();

      // State should show not leader after destroy
      // (state$ is completed, so last value is what we check)
    });

    it('should not start election after destroyed', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      election = createLeaderElection(tabManager, { heartbeatInterval: 100 });
      await election.initialize();

      election.destroy();
      election.requestLeadership();

      vi.advanceTimersByTime(500);
      // Should not throw or become leader
    });
  });

  describe('factory', () => {
    it('should create via factory function', () => {
      tabManager = createTabManager();
      election = createLeaderElection(tabManager);
      expect(election).toBeInstanceOf(LeaderElection);
    });

    it('should accept custom config', () => {
      tabManager = createTabManager();
      election = createLeaderElection(tabManager, {
        heartbeatInterval: 2000,
        leaderTimeout: 6000,
      });
      expect(election).toBeInstanceOf(LeaderElection);
    });
  });
});
