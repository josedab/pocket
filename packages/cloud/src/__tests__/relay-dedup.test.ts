import { describe, it, expect, beforeEach } from 'vitest';
import { RelayDedup, createRelayDedup } from '../relay-dedup.js';

describe('RelayDedup', () => {
  let dedup: RelayDedup;

  beforeEach(() => {
    dedup = createRelayDedup({ maxWindowSize: 100 });
  });

  describe('duplicate detection', () => {
    it('should not detect new messages as duplicates', () => {
      expect(dedup.isDuplicate('t1', 'msg-1')).toBe(false);
    });

    it('should detect recorded messages as duplicates', () => {
      dedup.record('t1', 'msg-1');
      expect(dedup.isDuplicate('t1', 'msg-1')).toBe(true);
    });

    it('should isolate per tenant', () => {
      dedup.record('t1', 'msg-1');
      expect(dedup.isDuplicate('t2', 'msg-1')).toBe(false);
    });

    it('should not double-record', () => {
      dedup.record('t1', 'msg-1');
      dedup.record('t1', 'msg-1');
      expect(dedup.getWindowSize('t1')).toBe(1);
    });
  });

  describe('window management', () => {
    it('should track window size', () => {
      dedup.record('t1', 'a');
      dedup.record('t1', 'b');
      dedup.record('t1', 'c');
      expect(dedup.getWindowSize('t1')).toBe(3);
    });

    it('should enforce max window size', () => {
      const small = createRelayDedup({ maxWindowSize: 3 });
      for (let i = 0; i < 10; i++) small.record('t1', `msg-${i}`);
      expect(small.getWindowSize('t1')).toBeLessThanOrEqual(3);
    });

    it('should return 0 for unknown tenant', () => {
      expect(dedup.getWindowSize('unknown')).toBe(0);
    });
  });

  describe('tenant management', () => {
    it('should clear tenant data', () => {
      dedup.record('t1', 'msg-1');
      dedup.clearTenant('t1');
      expect(dedup.isDuplicate('t1', 'msg-1')).toBe(false);
    });

    it('should clear all data', () => {
      dedup.record('t1', 'a');
      dedup.record('t2', 'b');
      dedup.clear();
      expect(dedup.getWindowSize('t1')).toBe(0);
      expect(dedup.getWindowSize('t2')).toBe(0);
    });
  });

  describe('message ID generation', () => {
    it('should generate unique IDs', () => {
      const id1 = dedup.generateMessageId();
      const id2 = dedup.generateMessageId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^msg_/);
    });
  });
});
