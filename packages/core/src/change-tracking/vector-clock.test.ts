import { describe, expect, it } from 'vitest';
import { HybridLogicalClock, LamportClock, VectorClockUtil } from './vector-clock.js';

describe('VectorClockUtil', () => {
  describe('create', () => {
    it('should create a new vector clock with initial timestamp', () => {
      const clock = VectorClockUtil.create('nodeA');
      expect(clock).toEqual({ nodeA: 1 });
    });

    it('should allow custom initial timestamp', () => {
      const clock = VectorClockUtil.create('nodeA', 5);
      expect(clock).toEqual({ nodeA: 5 });
    });
  });

  describe('increment', () => {
    it('should increment existing node timestamp', () => {
      const clock = { nodeA: 1 };
      const result = VectorClockUtil.increment(clock, 'nodeA');
      expect(result).toEqual({ nodeA: 2 });
    });

    it('should add new node with timestamp 1', () => {
      const clock = { nodeA: 1 };
      const result = VectorClockUtil.increment(clock, 'nodeB');
      expect(result).toEqual({ nodeA: 1, nodeB: 1 });
    });

    it('should not mutate original clock', () => {
      const clock = { nodeA: 1 };
      VectorClockUtil.increment(clock, 'nodeA');
      expect(clock).toEqual({ nodeA: 1 });
    });
  });

  describe('merge', () => {
    it('should merge two clocks taking max of each node', () => {
      const a = { nodeA: 2, nodeB: 1 };
      const b = { nodeA: 1, nodeB: 3 };
      const result = VectorClockUtil.merge(a, b);
      expect(result).toEqual({ nodeA: 2, nodeB: 3 });
    });

    it('should include nodes only in one clock', () => {
      const a = { nodeA: 2 };
      const b = { nodeB: 3 };
      const result = VectorClockUtil.merge(a, b);
      expect(result).toEqual({ nodeA: 2, nodeB: 3 });
    });

    it('should handle empty clocks', () => {
      const a = {};
      const b = { nodeA: 1 };
      expect(VectorClockUtil.merge(a, b)).toEqual({ nodeA: 1 });
      expect(VectorClockUtil.merge(b, a)).toEqual({ nodeA: 1 });
    });
  });

  describe('compare', () => {
    it('should return -1 when a happened-before b', () => {
      const a = { nodeA: 1 };
      const b = { nodeA: 2 };
      expect(VectorClockUtil.compare(a, b)).toBe(-1);
    });

    it('should return 1 when b happened-before a', () => {
      const a = { nodeA: 2 };
      const b = { nodeA: 1 };
      expect(VectorClockUtil.compare(a, b)).toBe(1);
    });

    it('should return 0 when clocks are concurrent', () => {
      const a = { nodeA: 2, nodeB: 1 };
      const b = { nodeA: 1, nodeB: 2 };
      expect(VectorClockUtil.compare(a, b)).toBe(0);
    });

    it('should handle clocks with different nodes', () => {
      const a = { nodeA: 1 };
      const b = { nodeB: 1 };
      expect(VectorClockUtil.compare(a, b)).toBe(0);
    });

    it('should handle when one is strict subset of other', () => {
      const a = { nodeA: 1, nodeB: 1 };
      const b = { nodeA: 2, nodeB: 2 };
      expect(VectorClockUtil.compare(a, b)).toBe(-1);
    });
  });

  describe('happenedBefore', () => {
    it('should return true when a happened before b', () => {
      const a = { nodeA: 1 };
      const b = { nodeA: 2 };
      expect(VectorClockUtil.happenedBefore(a, b)).toBe(true);
    });

    it('should return false when a did not happen before b', () => {
      const a = { nodeA: 2 };
      const b = { nodeA: 1 };
      expect(VectorClockUtil.happenedBefore(a, b)).toBe(false);
    });
  });

  describe('happenedAfter', () => {
    it('should return true when a happened after b', () => {
      const a = { nodeA: 2 };
      const b = { nodeA: 1 };
      expect(VectorClockUtil.happenedAfter(a, b)).toBe(true);
    });

    it('should return false when a did not happen after b', () => {
      const a = { nodeA: 1 };
      const b = { nodeA: 2 };
      expect(VectorClockUtil.happenedAfter(a, b)).toBe(false);
    });
  });

  describe('areConcurrent', () => {
    it('should return true for concurrent clocks', () => {
      const a = { nodeA: 2, nodeB: 1 };
      const b = { nodeA: 1, nodeB: 2 };
      expect(VectorClockUtil.areConcurrent(a, b)).toBe(true);
    });

    it('should return false for ordered clocks', () => {
      const a = { nodeA: 1 };
      const b = { nodeA: 2 };
      expect(VectorClockUtil.areConcurrent(a, b)).toBe(false);
    });
  });

  describe('equals', () => {
    it('should return true for equal clocks', () => {
      const a = { nodeA: 1, nodeB: 2 };
      const b = { nodeA: 1, nodeB: 2 };
      expect(VectorClockUtil.equals(a, b)).toBe(true);
    });

    it('should return false for different clocks', () => {
      const a = { nodeA: 1 };
      const b = { nodeA: 2 };
      expect(VectorClockUtil.equals(a, b)).toBe(false);
    });

    it('should return false for clocks with different keys', () => {
      const a = { nodeA: 1 };
      const b = { nodeA: 1, nodeB: 1 };
      expect(VectorClockUtil.equals(a, b)).toBe(false);
    });
  });

  describe('sum', () => {
    it('should return sum of all timestamps', () => {
      const clock = { nodeA: 3, nodeB: 5, nodeC: 2 };
      expect(VectorClockUtil.sum(clock)).toBe(10);
    });

    it('should return 0 for empty clock', () => {
      expect(VectorClockUtil.sum({})).toBe(0);
    });
  });

  describe('clone', () => {
    it('should create a copy of the clock', () => {
      const original = { nodeA: 1, nodeB: 2 };
      const cloned = VectorClockUtil.clone(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
    });
  });

  describe('getTimestamp', () => {
    it('should return timestamp for existing node', () => {
      const clock = { nodeA: 5 };
      expect(VectorClockUtil.getTimestamp(clock, 'nodeA')).toBe(5);
    });

    it('should return 0 for non-existing node', () => {
      const clock = { nodeA: 5 };
      expect(VectorClockUtil.getTimestamp(clock, 'nodeB')).toBe(0);
    });
  });

  describe('descends', () => {
    it('should return true when a descends from b', () => {
      const a = { nodeA: 3, nodeB: 2 };
      const b = { nodeA: 2, nodeB: 1 };
      expect(VectorClockUtil.descends(a, b)).toBe(true);
    });

    it('should return true when a equals b', () => {
      const a = { nodeA: 2, nodeB: 1 };
      const b = { nodeA: 2, nodeB: 1 };
      expect(VectorClockUtil.descends(a, b)).toBe(true);
    });

    it('should return false when a does not descend from b', () => {
      const a = { nodeA: 1 };
      const b = { nodeA: 2 };
      expect(VectorClockUtil.descends(a, b)).toBe(false);
    });

    it('should handle missing keys in a', () => {
      const a = { nodeA: 2 };
      const b = { nodeA: 1, nodeB: 1 };
      expect(VectorClockUtil.descends(a, b)).toBe(false);
    });
  });

  describe('serialize/deserialize', () => {
    it('should serialize clock to string', () => {
      const clock = { nodeA: 1, nodeB: 2 };
      const serialized = VectorClockUtil.serialize(clock);
      expect(serialized).toBe('nodeA:1,nodeB:2');
    });

    it('should deserialize string to clock', () => {
      const str = 'nodeA:1,nodeB:2';
      const clock = VectorClockUtil.deserialize(str);
      expect(clock).toEqual({ nodeA: 1, nodeB: 2 });
    });

    it('should handle empty string', () => {
      expect(VectorClockUtil.deserialize('')).toEqual({});
    });

    it('should roundtrip serialize/deserialize', () => {
      const original = { nodeA: 5, nodeB: 3, nodeC: 1 };
      const roundtripped = VectorClockUtil.deserialize(VectorClockUtil.serialize(original));
      expect(roundtripped).toEqual(original);
    });
  });
});

describe('LamportClock', () => {
  describe('constructor', () => {
    it('should initialize with 0 by default', () => {
      const clock = new LamportClock();
      expect(clock.value).toBe(0);
    });

    it('should initialize with provided value', () => {
      const clock = new LamportClock(10);
      expect(clock.value).toBe(10);
    });
  });

  describe('tick', () => {
    it('should increment and return new timestamp', () => {
      const clock = new LamportClock(5);
      expect(clock.tick()).toBe(6);
      expect(clock.tick()).toBe(7);
    });
  });

  describe('receive', () => {
    it('should update to max(local, remote) + 1 when remote is greater', () => {
      const clock = new LamportClock(5);
      expect(clock.receive(10)).toBe(11);
    });

    it('should update to local + 1 when local is greater', () => {
      const clock = new LamportClock(10);
      expect(clock.receive(5)).toBe(11);
    });

    it('should update to local + 1 when equal', () => {
      const clock = new LamportClock(5);
      expect(clock.receive(5)).toBe(6);
    });
  });

  describe('serialize/deserialize', () => {
    it('should serialize to string', () => {
      const clock = new LamportClock(42);
      expect(clock.serialize()).toBe('42');
    });

    it('should deserialize from string', () => {
      const clock = LamportClock.deserialize('42');
      expect(clock.value).toBe(42);
    });

    it('should handle invalid string', () => {
      const clock = LamportClock.deserialize('invalid');
      expect(clock.value).toBe(0);
    });
  });
});

describe('HybridLogicalClock', () => {
  describe('constructor', () => {
    it('should initialize with current time', () => {
      const before = Date.now();
      const clock = new HybridLogicalClock();
      const after = Date.now();
      expect(clock.timestamp.pt).toBeGreaterThanOrEqual(before);
      expect(clock.timestamp.pt).toBeLessThanOrEqual(after);
      expect(clock.timestamp.lc).toBe(0);
    });

    it('should accept custom physical time and counter', () => {
      const clock = new HybridLogicalClock(1000, 5);
      expect(clock.timestamp.pt).toBe(1000);
      expect(clock.timestamp.lc).toBe(5);
    });
  });

  describe('tick', () => {
    it('should update to current time when time advances', () => {
      const clock = new HybridLogicalClock(1000, 5);
      const ts = clock.tick();
      expect(ts.pt).toBeGreaterThanOrEqual(Date.now() - 100);
      expect(ts.lc).toBe(0);
    });

    it('should increment counter when time has not advanced', () => {
      // Create a clock with future time to force counter increment
      const futureTime = Date.now() + 10000;
      const clock = new HybridLogicalClock(futureTime, 0);
      const ts = clock.tick();
      expect(ts.pt).toBe(futureTime);
      expect(ts.lc).toBe(1);
    });
  });

  describe('receive', () => {
    it('should update from remote timestamp', () => {
      const clock = new HybridLogicalClock(1000, 0);
      const ts = clock.receive(2000, 5);
      expect(ts.pt).toBeGreaterThanOrEqual(Date.now() - 100);
    });

    it('should increment counter when physical times match', () => {
      const futureTime = Date.now() + 10000;
      const clock = new HybridLogicalClock(futureTime, 2);
      const ts = clock.receive(futureTime, 5);
      expect(ts.pt).toBe(futureTime);
      expect(ts.lc).toBe(6);
    });
  });

  describe('compare', () => {
    it('should compare by physical time first', () => {
      expect(HybridLogicalClock.compare({ pt: 1000, lc: 0 }, { pt: 2000, lc: 0 })).toBeLessThan(0);
      expect(HybridLogicalClock.compare({ pt: 2000, lc: 0 }, { pt: 1000, lc: 0 })).toBeGreaterThan(
        0
      );
    });

    it('should compare by logical counter when physical times equal', () => {
      expect(HybridLogicalClock.compare({ pt: 1000, lc: 1 }, { pt: 1000, lc: 2 })).toBeLessThan(0);
      expect(HybridLogicalClock.compare({ pt: 1000, lc: 2 }, { pt: 1000, lc: 1 })).toBeGreaterThan(
        0
      );
    });

    it('should return 0 for equal timestamps', () => {
      expect(HybridLogicalClock.compare({ pt: 1000, lc: 1 }, { pt: 1000, lc: 1 })).toBe(0);
    });
  });

  describe('serialize/deserialize', () => {
    it('should serialize to string', () => {
      const clock = new HybridLogicalClock(1000, 5);
      expect(clock.serialize()).toBe('1000.5');
    });

    it('should deserialize from string', () => {
      const clock = HybridLogicalClock.deserialize('1000.5');
      expect(clock.timestamp.pt).toBe(1000);
      expect(clock.timestamp.lc).toBe(5);
    });

    it('should roundtrip serialize/deserialize', () => {
      const original = new HybridLogicalClock(1234567890, 42);
      const roundtripped = HybridLogicalClock.deserialize(original.serialize());
      expect(roundtripped.timestamp).toEqual(original.timestamp);
    });
  });
});
