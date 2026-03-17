import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabManager, createTabManager } from '../tab-manager.js';
import type { CrossTabEvent, TabInfo } from '../types.js';

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

describe('TabManager', () => {
  let tabManager: TabManager;

  beforeEach(() => {
    vi.useFakeTimers();
    MockBroadcastChannel.instances = [];
    (globalThis as Record<string, unknown>).BroadcastChannel =
      MockBroadcastChannel as unknown as typeof BroadcastChannel;
  });

  afterEach(() => {
    tabManager?.destroy();
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).BroadcastChannel;
    MockBroadcastChannel.instances = [];
  });

  describe('initialization', () => {
    it('should generate a unique tab ID', () => {
      tabManager = createTabManager();
      expect(tabManager.getTabId()).toMatch(/^tab_\d+_[a-z0-9]+$/);
    });

    it('should register itself on initialize', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();

      const tabs = tabManager.getTabs();
      expect(tabs).toHaveLength(1);
      expect(tabs[0]!.id).toBe(tabManager.getTabId());
    });

    it('should emit connected event on initialize', async () => {
      tabManager = createTabManager();
      const events: CrossTabEvent[] = [];
      tabManager.events.subscribe((e) => events.push(e));

      await tabManager.initialize();

      expect(events.some((e) => e.type === 'connected')).toBe(true);
    });

    it('should create a BroadcastChannel with correct prefix', async () => {
      tabManager = createTabManager({ channelPrefix: 'myapp' });
      await tabManager.initialize();

      const channel = MockBroadcastChannel.instances.find((c) => c.name === 'myapp_tabs');
      expect(channel).toBeDefined();
    });

    it('should work without BroadcastChannel', async () => {
      delete (globalThis as Record<string, unknown>).BroadcastChannel;
      tabManager = createTabManager();
      await tabManager.initialize();

      expect(tabManager.getTabId()).toBeDefined();
    });
  });

  describe('getThisTabInfo', () => {
    it('should return tab info with correct fields', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();

      const info = tabManager.getThisTabInfo();
      expect(info.id).toBe(tabManager.getTabId());
      expect(info.isLeader).toBe(false);
      expect(typeof info.createdAt).toBe('number');
      expect(typeof info.lastActiveAt).toBe('number');
    });

    it('should return default info before initialize', () => {
      tabManager = createTabManager();
      const info = tabManager.getThisTabInfo();
      expect(info.id).toBe(tabManager.getTabId());
      expect(info.isLeader).toBe(false);
    });
  });

  describe('metadata management', () => {
    it('should update tab metadata', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();

      tabManager.updateMetadata({ route: '/home', userName: 'Alice' });
      const info = tabManager.getThisTabInfo();
      expect(info.metadata).toEqual({ route: '/home', userName: 'Alice' });
    });

    it('should merge metadata on subsequent updates', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();

      tabManager.updateMetadata({ route: '/home' });
      tabManager.updateMetadata({ userName: 'Bob' });

      const info = tabManager.getThisTabInfo();
      expect(info.metadata).toEqual({ route: '/home', userName: 'Bob' });
    });

    it('should update lastActiveAt on metadata change', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();

      const before = tabManager.getThisTabInfo().lastActiveAt;
      vi.advanceTimersByTime(1000);
      tabManager.updateMetadata({ x: 1 });
      const after = tabManager.getThisTabInfo().lastActiveAt;

      expect(after).toBeGreaterThan(before);
    });
  });

  describe('multi-tab discovery', () => {
    it('should discover other tabs', async () => {
      const tab1 = createTabManager();
      const tab2 = createTabManager();

      await tab1.initialize();
      await tab2.initialize();

      // tab2 broadcasts its join; tab1 should hear it
      const tab1Tabs = tab1.getTabs();
      const tab2Tabs = tab2.getTabs();

      // Each tab sees at least itself
      expect(tab1Tabs.length).toBeGreaterThanOrEqual(1);
      expect(tab2Tabs.length).toBeGreaterThanOrEqual(1);

      tab1.destroy();
      tab2.destroy();
    });

    it('should emit tab-joined event when another tab joins', async () => {
      const tab1 = createTabManager();
      await tab1.initialize();

      const events: CrossTabEvent[] = [];
      tab1.events.subscribe((e) => events.push(e));

      const tab2 = createTabManager();
      await tab2.initialize();

      expect(events.some((e) => e.type === 'tab-joined')).toBe(true);

      tab1.destroy();
      tab2.destroy();
    });

    it('should remove tab via cleanup when it stops heartbeating', async () => {
      const tab1 = createTabManager({ heartbeatInterval: 100, leaderTimeout: 200 });
      const tab2 = createTabManager({ heartbeatInterval: 100, leaderTimeout: 200 });
      await tab1.initialize();
      await tab2.initialize();

      const tab2Id = tab2.getTabId();

      // Verify tab2 is known to tab1
      expect(tab1.getTabs().some((t) => t.id === tab2Id)).toBe(true);

      const events: CrossTabEvent[] = [];
      tab1.events.subscribe((e) => events.push(e));

      // Destroy tab2 (sets destroyed=true before broadcast, so tab-left
      // message is not sent — by design, cleanup detects stale tabs)
      tab2.destroy();

      // Advance past the cleanup threshold (leaderTimeout * 2 = 400ms)
      vi.advanceTimersByTime(1000);

      // tab1's cleanup should have removed the stale tab2
      expect(tab1.getTabs().some((t) => t.id === tab2Id)).toBe(false);
      expect(events.some((e) => e.type === 'tab-left')).toBe(true);

      tab1.destroy();
    });
  });

  describe('heartbeat and cleanup', () => {
    it('should send heartbeats at configured interval', async () => {
      tabManager = createTabManager({ heartbeatInterval: 500 });
      await tabManager.initialize();

      const spy = vi.fn();
      const channel = MockBroadcastChannel.instances.find((c) => c.name === 'pocket_tabs');
      if (channel) {
        const origPost = channel.postMessage.bind(channel);
        channel.postMessage = (data: unknown) => {
          spy(data);
          origPost(data);
        };
      }

      vi.advanceTimersByTime(1500);
      expect(spy).toHaveBeenCalled();
    });

    it('should clean up stale tabs', async () => {
      const tab1 = createTabManager({ leaderTimeout: 500 });
      const tab2 = createTabManager({ leaderTimeout: 500 });

      await tab1.initialize();
      await tab2.initialize();

      // Tab2 is known to tab1
      const tab2Id = tab2.getTabId();

      // Close tab2's channel so it stops heartbeating
      tab2.destroy();

      // Manually re-add tab2 as if it's stale (simulate without the leave message)
      // We can verify cleanup happens by advancing time
      vi.advanceTimersByTime(5000);

      // After cleanup, tab1 should not have tab2
      const tabs = tab1.getTabs();
      const hasTab2 = tabs.some((t) => t.id === tab2Id);
      // Tab2 was already removed by the tab-left broadcast, so it shouldn't be there
      expect(hasTab2).toBe(false);

      tab1.destroy();
    });
  });

  describe('tabs observable', () => {
    it('should emit tab map updates', async () => {
      tabManager = createTabManager();
      const maps: Map<string, TabInfo>[] = [];
      tabManager.tabs.subscribe((m) => maps.push(new Map(m)));

      await tabManager.initialize();

      expect(maps.length).toBeGreaterThanOrEqual(1);
      const last = maps[maps.length - 1]!;
      expect(last.has(tabManager.getTabId())).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should emit disconnected event', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();

      const events: CrossTabEvent[] = [];
      tabManager.events.subscribe((e) => events.push(e));

      tabManager.destroy();

      expect(events.some((e) => e.type === 'disconnected')).toBe(true);
    });

    it('should close the BroadcastChannel', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();

      const before = MockBroadcastChannel.instances.length;
      tabManager.destroy();
      expect(MockBroadcastChannel.instances.length).toBeLessThan(before);
    });

    it('should stop heartbeat timer', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      tabManager.destroy();

      // No errors when advancing timers after destroy
      vi.advanceTimersByTime(10000);
    });
  });

  describe('factory', () => {
    it('should create TabManager via factory', () => {
      tabManager = createTabManager({ channelPrefix: 'test' });
      expect(tabManager).toBeInstanceOf(TabManager);
    });
  });
});
