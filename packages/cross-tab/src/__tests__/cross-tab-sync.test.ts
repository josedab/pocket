import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrossTabSync, createCrossTabSync } from '../cross-tab-sync.js';
import { type TabManager, createTabManager } from '../tab-manager.js';
import type { CollectionSyncState, CrossTabEvent, CrossTabMessage } from '../types.js';

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

describe('CrossTabSync', () => {
  let tabManager: TabManager;
  let sync: CrossTabSync;

  beforeEach(() => {
    vi.useFakeTimers();
    MockBroadcastChannel.instances = [];
    (globalThis as Record<string, unknown>).BroadcastChannel =
      MockBroadcastChannel as unknown as typeof BroadcastChannel;
  });

  afterEach(() => {
    sync?.destroy();
    tabManager?.destroy();
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).BroadcastChannel;
    MockBroadcastChannel.instances = [];
  });

  describe('initialization', () => {
    it('should initialize without errors', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();
    });

    it('should accept custom config', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager, {
        channelPrefix: 'myapp',
        deduplicationWindow: 10000,
      });
      await sync.initialize();
    });
  });

  describe('subscribe', () => {
    it('should create a channel on subscribe', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();

      const handler = vi.fn();
      sync.subscribe('todos', handler);

      const channel = MockBroadcastChannel.instances.find((c) => c.name === 'pocket_todos');
      expect(channel).toBeDefined();
    });

    it('should return unsubscribe function', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();

      const handler = vi.fn();
      const unsub = sync.subscribe('todos', handler);
      expect(typeof unsub).toBe('function');

      unsub();
    });

    it('should clean up channel when last handler unsubscribes', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();

      const handler = vi.fn();
      const unsub = sync.subscribe('todos', handler);

      const channelsBefore = MockBroadcastChannel.instances.filter(
        (c) => c.name === 'pocket_todos'
      ).length;

      unsub();

      const channelsAfter = MockBroadcastChannel.instances.filter(
        (c) => c.name === 'pocket_todos'
      ).length;

      expect(channelsAfter).toBeLessThan(channelsBefore);
    });

    it('should support multiple handlers per collection', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      sync.subscribe('todos', handler1);
      sync.subscribe('todos', handler2);

      // Only one channel should be created
      const channels = MockBroadcastChannel.instances.filter((c) => c.name === 'pocket_todos');
      expect(channels.length).toBe(1);
    });

    it('should not subscribe without BroadcastChannel', async () => {
      delete (globalThis as Record<string, unknown>).BroadcastChannel;
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();

      const handler = vi.fn();
      const unsub = sync.subscribe('todos', handler);
      expect(typeof unsub).toBe('function');
      unsub();
    });
  });

  describe('broadcastChange', () => {
    it('should broadcast change message to other tabs', async () => {
      const tm1 = createTabManager();
      await tm1.initialize();
      const sync1 = createCrossTabSync(tm1);
      await sync1.initialize();

      const tm2 = createTabManager();
      await tm2.initialize();
      const sync2 = createCrossTabSync(tm2);
      await sync2.initialize();

      const handler = vi.fn();
      sync2.subscribe('todos', handler);

      sync1.broadcastChange('todos', 'todo-1', { text: 'Buy milk' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'change',
          channel: 'todos',
          senderId: tm1.getTabId(),
        })
      );

      sync1.destroy();
      sync2.destroy();
      tm1.destroy();
      tm2.destroy();
    });

    it('should include version in change payload', async () => {
      const tm1 = createTabManager();
      await tm1.initialize();
      const sync1 = createCrossTabSync(tm1);
      await sync1.initialize();

      const tm2 = createTabManager();
      await tm2.initialize();
      const sync2 = createCrossTabSync(tm2);
      await sync2.initialize();

      const handler = vi.fn();
      sync2.subscribe('todos', handler);

      sync1.broadcastChange('todos', 'todo-1', { text: 'Hello' }, 5);

      expect(handler).toHaveBeenCalled();
      const msg = handler.mock.calls[0]![0] as CrossTabMessage;
      expect((msg.payload as Record<string, unknown>).version).toBe(5);

      sync1.destroy();
      sync2.destroy();
      tm1.destroy();
      tm2.destroy();
    });
  });

  describe('broadcastDelete', () => {
    it('should broadcast delete message', async () => {
      const tm1 = createTabManager();
      await tm1.initialize();
      const sync1 = createCrossTabSync(tm1);
      await sync1.initialize();

      const tm2 = createTabManager();
      await tm2.initialize();
      const sync2 = createCrossTabSync(tm2);
      await sync2.initialize();

      const handler = vi.fn();
      sync2.subscribe('todos', handler);

      sync1.broadcastDelete('todos', 'todo-1');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'delete',
          channel: 'todos',
        })
      );

      sync1.destroy();
      sync2.destroy();
      tm1.destroy();
      tm2.destroy();
    });
  });

  describe('broadcastClear', () => {
    it('should broadcast clear message', async () => {
      const tm1 = createTabManager();
      await tm1.initialize();
      const sync1 = createCrossTabSync(tm1);
      await sync1.initialize();

      const tm2 = createTabManager();
      await tm2.initialize();
      const sync2 = createCrossTabSync(tm2);
      await sync2.initialize();

      const handler = vi.fn();
      sync2.subscribe('todos', handler);

      sync1.broadcastClear('todos');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'clear',
          channel: 'todos',
        })
      );

      sync1.destroy();
      sync2.destroy();
      tm1.destroy();
      tm2.destroy();
    });
  });

  describe('message deduplication', () => {
    it('should not deliver the same message twice', async () => {
      const tm1 = createTabManager();
      await tm1.initialize();
      const sync1 = createCrossTabSync(tm1);
      await sync1.initialize();

      const tm2 = createTabManager();
      await tm2.initialize();
      const sync2 = createCrossTabSync(tm2);
      await sync2.initialize();

      const handler = vi.fn();
      sync2.subscribe('todos', handler);

      // Send a message
      sync1.broadcastChange('todos', 'todo-1', { text: 'Hello' });

      // The handler should be called once
      const callCount = handler.mock.calls.length;

      // Replaying the same message won't increase count because messageId is unique each time
      // But if we manually simulate a duplicate:
      const channel = MockBroadcastChannel.instances.find((c) => c.name === 'pocket_todos');
      if (channel?.onmessage && handler.mock.calls.length > 0) {
        const originalMsg = handler.mock.calls[0]![0];
        // Re-deliver the same message
        channel.onmessage(new MessageEvent('message', { data: originalMsg }));
        // Should still be the same call count since it's deduped
        expect(handler.mock.calls.length).toBe(callCount);
      }

      sync1.destroy();
      sync2.destroy();
      tm1.destroy();
      tm2.destroy();
    });

    it('should clean up old message IDs', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager, { deduplicationWindow: 200 });
      await sync.initialize();

      sync.subscribe('todos', vi.fn());

      // Advance past deduplication window cleanup
      vi.advanceTimersByTime(500);

      // Should not throw
    });
  });

  describe('sync request/response', () => {
    it('should broadcast sync request', async () => {
      const tm1 = createTabManager();
      await tm1.initialize();
      const sync1 = createCrossTabSync(tm1);
      await sync1.initialize();

      const tm2 = createTabManager();
      await tm2.initialize();
      const sync2 = createCrossTabSync(tm2);
      await sync2.initialize();

      const handler = vi.fn();
      sync2.subscribe('todos', handler);

      sync1.requestSync('todos', 1000);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sync-request',
          channel: 'todos',
        })
      );

      sync1.destroy();
      sync2.destroy();
      tm1.destroy();
      tm2.destroy();
    });

    it('should update sync state to syncing on request', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();

      sync.subscribe('todos', vi.fn());
      sync.requestSync('todos');

      const state = sync.getCollectionSyncState('todos');
      expect(state?.syncing).toBe(true);
    });

    it('should respond to sync request with documents', async () => {
      const tm1 = createTabManager();
      await tm1.initialize();
      const sync1 = createCrossTabSync(tm1);
      await sync1.initialize();

      const tm2 = createTabManager();
      await tm2.initialize();
      const sync2 = createCrossTabSync(tm2);
      await sync2.initialize();

      const handler = vi.fn();
      sync1.subscribe('todos', handler);

      const docs = [
        { id: '1', data: { text: 'A' }, timestamp: Date.now() },
        { id: '2', data: { text: 'B' }, timestamp: Date.now() },
      ];
      sync2.respondToSync('todos', tm1.getTabId(), docs);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sync-response',
        })
      );

      sync1.destroy();
      sync2.destroy();
      tm1.destroy();
      tm2.destroy();
    });
  });

  describe('sync state', () => {
    it('should initialize collection sync state on subscribe', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();

      sync.subscribe('todos', vi.fn());

      const state = sync.getCollectionSyncState('todos');
      expect(state).toBeDefined();
      expect(state!.collection).toBe('todos');
      expect(state!.lastSyncAt).toBe(0);
      expect(state!.pendingChanges).toBe(0);
      expect(state!.syncing).toBe(false);
    });

    it('should return undefined for unsubscribed collection', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();

      expect(sync.getCollectionSyncState('unknown')).toBeUndefined();
    });

    it('should expose sync state observable', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();

      const states: Map<string, CollectionSyncState>[] = [];
      sync.syncState.subscribe((s) => states.push(new Map(s)));

      sync.subscribe('todos', vi.fn());

      expect(states.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('events', () => {
    it('should emit message-received events on broadcast', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();

      const events: CrossTabEvent[] = [];
      sync.events.subscribe((e) => events.push(e));

      sync.broadcastChange('todos', 'todo-1', { text: 'Hi' });

      expect(events.some((e) => e.type === 'message-received')).toBe(true);
    });

    it('should emit sync-complete event on sync response', async () => {
      const tm1 = createTabManager();
      await tm1.initialize();
      const sync1 = createCrossTabSync(tm1);
      await sync1.initialize();

      const tm2 = createTabManager();
      await tm2.initialize();
      const sync2 = createCrossTabSync(tm2);
      await sync2.initialize();

      const events: CrossTabEvent[] = [];
      sync1.events.subscribe((e) => events.push(e));

      // Subscribe to establish state
      sync1.subscribe('todos', vi.fn());
      sync1.requestSync('todos');

      // Other tab responds
      sync2.respondToSync('todos', tm1.getTabId(), [
        { id: '1', data: { text: 'Test' }, timestamp: Date.now() },
      ]);

      expect(events.some((e) => e.type === 'sync-complete')).toBe(true);

      sync1.destroy();
      sync2.destroy();
      tm1.destroy();
      tm2.destroy();
    });
  });

  describe('handler errors', () => {
    it('should not crash when handler throws', async () => {
      const tm1 = createTabManager();
      await tm1.initialize();
      const sync1 = createCrossTabSync(tm1);
      await sync1.initialize();

      const tm2 = createTabManager();
      await tm2.initialize();
      const sync2 = createCrossTabSync(tm2);
      await sync2.initialize();

      const throwingHandler = vi.fn(() => {
        throw new Error('Handler error');
      });
      const normalHandler = vi.fn();

      sync2.subscribe('todos', throwingHandler);
      sync2.subscribe('todos', normalHandler);

      sync1.broadcastChange('todos', 'todo-1', { text: 'Test' });

      expect(throwingHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();

      sync1.destroy();
      sync2.destroy();
      tm1.destroy();
      tm2.destroy();
    });
  });

  describe('self-message filtering', () => {
    it('should not deliver messages from own tab', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();

      const handler = vi.fn();
      sync.subscribe('todos', handler);

      sync.broadcastChange('todos', 'todo-1', { text: 'Self message' });

      // Handler should NOT be called because sender is the same tab
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should close all channels', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();

      sync.subscribe('todos', vi.fn());
      sync.subscribe('notes', vi.fn());

      const channelsBefore = MockBroadcastChannel.instances.length;
      sync.destroy();
      expect(MockBroadcastChannel.instances.length).toBeLessThan(channelsBefore);
    });

    it('should not broadcast after destroy', async () => {
      tabManager = createTabManager();
      await tabManager.initialize();
      sync = createCrossTabSync(tabManager);
      await sync.initialize();

      sync.destroy();

      // Should not throw
      sync.broadcastChange('todos', 'todo-1', { text: 'After destroy' });
    });
  });

  describe('factory', () => {
    it('should create via factory function', () => {
      tabManager = createTabManager();
      sync = createCrossTabSync(tabManager);
      expect(sync).toBeInstanceOf(CrossTabSync);
    });
  });
});
