import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HeartbeatMonitor,
  createHeartbeatMonitor,
  type HeartbeatStatus,
} from '../heartbeat.js';

// Mock BroadcastChannel for Node.js test environment
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    // Broadcast to all other instances with the same name
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

describe('HeartbeatMonitor', () => {
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    MockBroadcastChannel.instances = [];
    (globalThis as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel as unknown as typeof BroadcastChannel;
    monitor = new HeartbeatMonitor({ heartbeatIntervalMs: 100, missedHeartbeatsThreshold: 3 });
  });

  afterEach(() => {
    monitor.destroy();
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).BroadcastChannel;
    MockBroadcastChannel.instances = [];
  });

  describe('leader mode - sending heartbeats', () => {
    it('should send heartbeats when started as leader', () => {
      const postMessageSpy = vi.fn();

      monitor.start(true);

      // Access the channel from mock instances
      const channel = MockBroadcastChannel.instances.find(
        (c) => c.name === 'pocket-heartbeat',
      );
      expect(channel).toBeDefined();

      // Spy on postMessage
      if (channel) {
        channel.postMessage = postMessageSpy;
      }

      // Advance past one interval
      vi.advanceTimersByTime(100);

      expect(postMessageSpy).toHaveBeenCalled();
      const message = postMessageSpy.mock.calls[0]![0];
      expect(message.type).toBe('heartbeat');
      expect(typeof message.timestamp).toBe('number');
    });

    it('should stop sending when stopped', () => {
      monitor.start(true);
      monitor.stop();

      const channel = MockBroadcastChannel.instances.find(
        (c) => c.name === 'pocket-heartbeat',
      );
      // Channel should be closed
      expect(channel).toBeUndefined();
    });

    it('should report healthy status as leader', () => {
      monitor.start(true);
      expect(monitor.getStatus()).toBe('healthy');
      expect(monitor.isLeaderAlive()).toBe(true);
    });
  });

  describe('follower mode - monitoring heartbeats', () => {
    it('should detect missed heartbeats', () => {
      monitor.start(false);

      // Advance time past threshold (3 missed * 100ms interval * 1.5 factor)
      vi.advanceTimersByTime(600);

      expect(monitor.getStatus()).toBe('leader-lost');
      expect(monitor.isLeaderAlive()).toBe(false);
    });

    it('should transition through degraded status', () => {
      const statuses: HeartbeatStatus[] = [];
      monitor.status$.subscribe((s) => statuses.push(s));

      monitor.start(false);

      // Miss one heartbeat - should become degraded
      vi.advanceTimersByTime(200);

      expect(statuses).toContain('degraded');
    });

    it('should call onLeaderLost when leader is lost', () => {
      const callback = vi.fn();
      monitor.onLeaderLost(callback);

      monitor.start(false);
      vi.advanceTimersByTime(600);

      expect(callback).toHaveBeenCalled();
    });

    it('should call onLeaderRecovered when heartbeat resumes', () => {
      const lostCallback = vi.fn();
      const recoveredCallback = vi.fn();
      monitor.onLeaderLost(lostCallback);
      monitor.onLeaderRecovered(recoveredCallback);

      monitor.start(false);

      // Wait for leader lost
      vi.advanceTimersByTime(600);
      expect(lostCallback).toHaveBeenCalled();

      // Simulate receiving a heartbeat from leader via BroadcastChannel
      const channel = MockBroadcastChannel.instances.find(
        (c) => c.name === 'pocket-heartbeat',
      );
      if (channel?.onmessage) {
        channel.onmessage(
          new MessageEvent('message', {
            data: { type: 'heartbeat', timestamp: Date.now() },
          }),
        );
      }

      expect(recoveredCallback).toHaveBeenCalled();
      expect(monitor.getStatus()).toBe('healthy');
    });

    it('should unsubscribe from callbacks', () => {
      const callback = vi.fn();
      const unsub = monitor.onLeaderLost(callback);
      unsub();

      monitor.start(false);
      vi.advanceTimersByTime(600);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('leader + follower communication', () => {
    it('should keep follower healthy when leader sends heartbeats', () => {
      const leader = new HeartbeatMonitor({
        heartbeatIntervalMs: 100,
        missedHeartbeatsThreshold: 3,
      });
      const follower = new HeartbeatMonitor({
        heartbeatIntervalMs: 100,
        missedHeartbeatsThreshold: 3,
      });

      leader.start(true);
      follower.start(false);

      // Advance several intervals - follower should stay healthy
      vi.advanceTimersByTime(500);

      expect(follower.getStatus()).toBe('healthy');
      expect(follower.isLeaderAlive()).toBe(true);

      leader.destroy();
      follower.destroy();
    });
  });

  describe('status$ observable', () => {
    it('should emit initial healthy status', () => {
      const statuses: HeartbeatStatus[] = [];
      monitor.status$.subscribe((s) => statuses.push(s));

      monitor.start(false);

      expect(statuses[0]).toBe('healthy');
    });

    it('should emit status transitions', () => {
      const statuses: HeartbeatStatus[] = [];
      monitor.status$.subscribe((s) => statuses.push(s));

      monitor.start(false);

      // Miss heartbeats until leader-lost
      vi.advanceTimersByTime(600);

      expect(statuses).toContain('healthy');
      expect(statuses).toContain('leader-lost');
    });
  });

  describe('destroy', () => {
    it('should stop monitoring on destroy', () => {
      const callback = vi.fn();
      monitor.onLeaderLost(callback);

      monitor.start(false);
      monitor.destroy();

      vi.advanceTimersByTime(600);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should be safe to call destroy multiple times', () => {
      monitor.destroy();
      expect(() => monitor.destroy()).not.toThrow();
    });

    it('should close the BroadcastChannel', () => {
      monitor.start(true);
      const channelsBefore = MockBroadcastChannel.instances.length;
      monitor.destroy();
      expect(MockBroadcastChannel.instances.length).toBeLessThan(channelsBefore);
    });
  });

  describe('factory', () => {
    it('should create monitor via factory', () => {
      const m = createHeartbeatMonitor({ heartbeatIntervalMs: 500 });
      expect(m).toBeInstanceOf(HeartbeatMonitor);
      m.destroy();
    });
  });
});
