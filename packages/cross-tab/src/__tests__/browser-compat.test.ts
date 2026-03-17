import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCompatSender, detectCapabilities } from '../browser-compat.js';

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

describe('browser-compat', () => {
  beforeEach(() => {
    MockBroadcastChannel.instances = [];
  });

  afterEach(() => {
    MockBroadcastChannel.instances = [];
  });

  describe('detectCapabilities', () => {
    it('should detect when BroadcastChannel is available', () => {
      (globalThis as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel;
      const caps = detectCapabilities();
      expect(caps.broadcastChannel).toBe(true);
      delete (globalThis as Record<string, unknown>).BroadcastChannel;
    });

    it('should detect when BroadcastChannel is not available', () => {
      delete (globalThis as Record<string, unknown>).BroadcastChannel;
      const caps = detectCapabilities();
      expect(caps.broadcastChannel).toBe(false);
    });

    it('should return best transport based on available APIs', () => {
      delete (globalThis as Record<string, unknown>).BroadcastChannel;
      delete (globalThis as Record<string, unknown>).SharedWorker;

      const caps = detectCapabilities();
      // In Node test environment, none of these browser APIs exist
      expect(['broadcast-channel', 'shared-worker', 'local-storage', 'none']).toContain(
        caps.bestTransport
      );
    });

    it('should detect localStorage availability', () => {
      const caps = detectCapabilities();
      expect(typeof caps.localStorage).toBe('boolean');
    });

    it('should return all expected fields', () => {
      const caps = detectCapabilities();
      expect(caps).toHaveProperty('broadcastChannel');
      expect(caps).toHaveProperty('sharedWorker');
      expect(caps).toHaveProperty('localStorage');
      expect(caps).toHaveProperty('serviceWorker');
      expect(caps).toHaveProperty('locks');
      expect(caps).toHaveProperty('bestTransport');
    });

    it('should prefer shared-worker over broadcast-channel', () => {
      (globalThis as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel;
      (globalThis as Record<string, unknown>).SharedWorker = function SharedWorkerStub() {};

      const caps = detectCapabilities();
      expect(caps.bestTransport).toBe('shared-worker');

      delete (globalThis as Record<string, unknown>).BroadcastChannel;
      delete (globalThis as Record<string, unknown>).SharedWorker;
    });

    it('should prefer broadcast-channel when shared-worker unavailable', () => {
      (globalThis as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel;
      delete (globalThis as Record<string, unknown>).SharedWorker;

      const caps = detectCapabilities();
      expect(caps.bestTransport).toBe('broadcast-channel');

      delete (globalThis as Record<string, unknown>).BroadcastChannel;
    });
  });

  describe('createCompatSender', () => {
    describe('noop transport', () => {
      it('should create noop sender when no transport available', () => {
        const sender = createCompatSender('none');
        expect(sender).toBeDefined();

        // Should not throw
        sender.send('channel', { data: 'test' });

        const unsub = sender.subscribe('channel', vi.fn());
        expect(typeof unsub).toBe('function');
        unsub();

        sender.destroy();
      });
    });

    describe('broadcast-channel transport', () => {
      beforeEach(() => {
        (globalThis as Record<string, unknown>).BroadcastChannel =
          MockBroadcastChannel as unknown as typeof BroadcastChannel;
      });

      afterEach(() => {
        delete (globalThis as Record<string, unknown>).BroadcastChannel;
        MockBroadcastChannel.instances = [];
      });

      it('should send messages via BroadcastChannel', () => {
        const sender = createCompatSender('broadcast-channel');
        const received: unknown[] = [];

        // Subscribe in a second sender to receive
        const sender2 = createCompatSender('broadcast-channel');
        sender2.subscribe('test-channel', (data) => received.push(data));

        sender.send('test-channel', { hello: 'world' });

        expect(received).toEqual([{ hello: 'world' }]);

        sender.destroy();
        sender2.destroy();
      });

      it('should support multiple subscribers on same channel', () => {
        const sender = createCompatSender('broadcast-channel');
        const handler1 = vi.fn();
        const handler2 = vi.fn();

        sender.subscribe('ch', handler1);
        sender.subscribe('ch', handler2);

        // Send from another sender
        const sender2 = createCompatSender('broadcast-channel');
        sender2.send('ch', 'data');

        expect(handler1).toHaveBeenCalledWith('data');
        expect(handler2).toHaveBeenCalledWith('data');

        sender.destroy();
        sender2.destroy();
      });

      it('should unsubscribe correctly', () => {
        const sender = createCompatSender('broadcast-channel');
        const handler = vi.fn();

        const unsub = sender.subscribe('ch', handler);
        unsub();

        const sender2 = createCompatSender('broadcast-channel');
        sender2.send('ch', 'data');

        // Handler was removed but the BroadcastChannel onmessage still fires
        // for other handlers. Since handler was removed from the Set,
        // it should not receive the message.
        expect(handler).not.toHaveBeenCalled();

        sender.destroy();
        sender2.destroy();
      });

      it('should clean up channels on destroy', () => {
        const sender = createCompatSender('broadcast-channel');
        sender.subscribe('ch1', vi.fn());
        sender.subscribe('ch2', vi.fn());

        const before = MockBroadcastChannel.instances.length;
        sender.destroy();
        expect(MockBroadcastChannel.instances.length).toBeLessThan(before);
      });
    });

    describe('shared-worker transport', () => {
      it('should fall back to broadcast-channel for shared-worker', () => {
        (globalThis as Record<string, unknown>).BroadcastChannel =
          MockBroadcastChannel as unknown as typeof BroadcastChannel;

        const sender = createCompatSender('shared-worker');
        expect(sender).toBeDefined();

        sender.destroy();
        delete (globalThis as Record<string, unknown>).BroadcastChannel;
      });
    });

    describe('auto-detection', () => {
      it('should auto-detect transport when not specified', () => {
        (globalThis as Record<string, unknown>).BroadcastChannel =
          MockBroadcastChannel as unknown as typeof BroadcastChannel;

        const sender = createCompatSender();
        expect(sender).toBeDefined();

        sender.destroy();
        delete (globalThis as Record<string, unknown>).BroadcastChannel;
      });
    });
  });
});
