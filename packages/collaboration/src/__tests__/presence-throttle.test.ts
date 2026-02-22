import { describe, it, expect, beforeEach } from 'vitest';
import { PresenceThrottle, createPresenceThrottle } from '../presence-throttle.js';
import type { CollabCursor, CollabSelection } from '../types.js';

describe('PresenceThrottle', () => {
  let throttle: PresenceThrottle;

  beforeEach(() => {
    throttle = createPresenceThrottle({ cursorIntervalMs: 50, selectionIntervalMs: 100 });
  });

  describe('cursor throttling', () => {
    it('should allow first cursor update', () => {
      expect(throttle.shouldSendCursor('u1')).toBe(true);
    });

    it('should block rapid consecutive updates', () => {
      throttle.recordCursorSent('u1');
      expect(throttle.shouldSendCursor('u1')).toBe(false);
    });

    it('should allow after interval passes', async () => {
      throttle.recordCursorSent('u1');
      await new Promise((r) => setTimeout(r, 60));
      expect(throttle.shouldSendCursor('u1')).toBe(true);
    });

    it('should isolate per user', () => {
      throttle.recordCursorSent('u1');
      expect(throttle.shouldSendCursor('u2')).toBe(true);
    });
  });

  describe('cursor queue', () => {
    it('should return cursor when allowed', () => {
      const cursor: CollabCursor = { userId: 'u1', documentId: 'd1', offset: 10, timestamp: Date.now() };
      const result = throttle.queueCursor('u1', cursor);
      expect(result).not.toBeNull();
      expect(result!.offset).toBe(10);
    });

    it('should queue when throttled', () => {
      throttle.recordCursorSent('u1');
      const cursor: CollabCursor = { userId: 'u1', documentId: 'd1', offset: 20, timestamp: Date.now() };
      const result = throttle.queueCursor('u1', cursor);
      expect(result).toBeNull();
      expect(throttle.getPendingCursor('u1')?.offset).toBe(20);
    });
  });

  describe('selection throttling', () => {
    it('should allow first selection', () => {
      expect(throttle.shouldSendSelection('u1')).toBe(true);
    });

    it('should block rapid selections', () => {
      throttle.recordSelectionSent('u1');
      expect(throttle.shouldSendSelection('u1')).toBe(false);
    });
  });

  describe('typing throttling', () => {
    it('should allow first typing indicator', () => {
      expect(throttle.shouldSendTyping('u1')).toBe(true);
    });

    it('should block rapid typing indicators', () => {
      throttle.recordTypingSent('u1');
      expect(throttle.shouldSendTyping('u1')).toBe(false);
    });
  });

  describe('flush', () => {
    it('should flush pending cursors after interval', async () => {
      throttle.recordCursorSent('u1');
      const cursor: CollabCursor = { userId: 'u1', documentId: 'd1', offset: 30, timestamp: Date.now() };
      throttle.queueCursor('u1', cursor);
      await new Promise((r) => setTimeout(r, 60));
      const flushed = throttle.flushPending();
      expect(flushed.cursors).toHaveLength(1);
      expect(flushed.cursors[0]!.offset).toBe(30);
    });
  });

  describe('stats', () => {
    it('should track sent and dropped counts', () => {
      throttle.queueCursor('u1', { userId: 'u1', documentId: 'd1', offset: 1, timestamp: Date.now() }); // sent
      throttle.queueCursor('u1', { userId: 'u1', documentId: 'd1', offset: 2, timestamp: Date.now() }); // dropped
      const stats = throttle.getStats();
      expect(stats.cursorsSent).toBe(1);
      expect(stats.cursorsDropped).toBe(1);
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      throttle.recordCursorSent('u1');
      throttle.reset();
      expect(throttle.shouldSendCursor('u1')).toBe(true);
      expect(throttle.getStats().cursorsSent).toBe(0);
    });
  });
});
