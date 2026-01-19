import type { VectorClock } from '../types/document.js';

/**
 * Vector clock utility class
 */
export class VectorClockUtil {
  /**
   * Create a new vector clock for a node
   */
  static create(nodeId: string, timestamp = 1): VectorClock {
    return { [nodeId]: timestamp };
  }

  /**
   * Increment a node's timestamp in the clock
   */
  static increment(clock: VectorClock, nodeId: string): VectorClock {
    return {
      ...clock,
      [nodeId]: (clock[nodeId] ?? 0) + 1,
    };
  }

  /**
   * Merge two vector clocks (take max of each node)
   */
  static merge(a: VectorClock, b: VectorClock): VectorClock {
    const merged: VectorClock = { ...a };

    for (const [nodeId, timestamp] of Object.entries(b)) {
      merged[nodeId] = Math.max(merged[nodeId] ?? 0, timestamp);
    }

    return merged;
  }

  /**
   * Compare two vector clocks
   * Returns:
   *   -1 if a happened-before b
   *    1 if b happened-before a
   *    0 if concurrent (neither happened before the other)
   */
  static compare(a: VectorClock, b: VectorClock): -1 | 0 | 1 {
    let aGreater = false;
    let bGreater = false;

    const allNodes = new Set([...Object.keys(a), ...Object.keys(b)]);

    for (const nodeId of allNodes) {
      const aVal = a[nodeId] ?? 0;
      const bVal = b[nodeId] ?? 0;

      if (aVal > bVal) aGreater = true;
      if (bVal > aVal) bGreater = true;
    }

    if (aGreater && !bGreater) return 1;
    if (bGreater && !aGreater) return -1;
    return 0; // Concurrent
  }

  /**
   * Check if clock a happened before clock b
   */
  static happenedBefore(a: VectorClock, b: VectorClock): boolean {
    return this.compare(a, b) === -1;
  }

  /**
   * Check if clock a happened after clock b
   */
  static happenedAfter(a: VectorClock, b: VectorClock): boolean {
    return this.compare(a, b) === 1;
  }

  /**
   * Check if two clocks are concurrent
   */
  static areConcurrent(a: VectorClock, b: VectorClock): boolean {
    return this.compare(a, b) === 0;
  }

  /**
   * Check if two clocks are equal
   */
  static equals(a: VectorClock, b: VectorClock): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
      if (a[key] !== b[key]) return false;
    }

    return true;
  }

  /**
   * Get the sum of all timestamps (useful for ordering)
   */
  static sum(clock: VectorClock): number {
    return Object.values(clock).reduce((sum, val) => sum + val, 0);
  }

  /**
   * Clone a vector clock
   */
  static clone(clock: VectorClock): VectorClock {
    return { ...clock };
  }

  /**
   * Get the timestamp for a specific node
   */
  static getTimestamp(clock: VectorClock, nodeId: string): number {
    return clock[nodeId] ?? 0;
  }

  /**
   * Check if clock a descends from clock b (a >= b for all nodes)
   */
  static descends(a: VectorClock, b: VectorClock): boolean {
    for (const [nodeId, timestamp] of Object.entries(b)) {
      if ((a[nodeId] ?? 0) < timestamp) {
        return false;
      }
    }
    return true;
  }

  /**
   * Serialize clock to string
   */
  static serialize(clock: VectorClock): string {
    const entries = Object.entries(clock).sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([k, v]) => `${k}:${v}`).join(',');
  }

  /**
   * Deserialize clock from string
   */
  static deserialize(str: string): VectorClock {
    const clock: VectorClock = {};
    if (!str) return clock;

    const pairs = str.split(',');
    for (const pair of pairs) {
      const [nodeId, timestamp] = pair.split(':');
      if (nodeId && timestamp) {
        clock[nodeId] = parseInt(timestamp, 10);
      }
    }

    return clock;
  }
}

/**
 * Lamport timestamp (simpler than vector clock)
 */
export class LamportClock {
  private timestamp: number;

  constructor(initial = 0) {
    this.timestamp = initial;
  }

  /**
   * Get current timestamp
   */
  get value(): number {
    return this.timestamp;
  }

  /**
   * Increment and return new timestamp
   */
  tick(): number {
    return ++this.timestamp;
  }

  /**
   * Update from received timestamp
   */
  receive(otherTimestamp: number): number {
    this.timestamp = Math.max(this.timestamp, otherTimestamp) + 1;
    return this.timestamp;
  }

  /**
   * Serialize to string
   */
  serialize(): string {
    return String(this.timestamp);
  }

  /**
   * Create from serialized string
   */
  static deserialize(str: string): LamportClock {
    return new LamportClock(parseInt(str, 10) || 0);
  }
}

/**
 * Hybrid Logical Clock (HLC)
 * Combines physical time with logical counters for better ordering
 */
export class HybridLogicalClock {
  private physicalTime: number;
  private logicalCounter: number;

  constructor(physicalTime = Date.now(), logicalCounter = 0) {
    this.physicalTime = physicalTime;
    this.logicalCounter = logicalCounter;
  }

  /**
   * Get current timestamp
   */
  get timestamp(): { pt: number; lc: number } {
    return {
      pt: this.physicalTime,
      lc: this.logicalCounter,
    };
  }

  /**
   * Generate a new timestamp for a local event
   */
  tick(): { pt: number; lc: number } {
    const now = Date.now();

    if (now > this.physicalTime) {
      this.physicalTime = now;
      this.logicalCounter = 0;
    } else {
      this.logicalCounter++;
    }

    return this.timestamp;
  }

  /**
   * Update from a received timestamp
   */
  receive(remotePt: number, remoteLc: number): { pt: number; lc: number } {
    const now = Date.now();

    if (now > this.physicalTime && now > remotePt) {
      this.physicalTime = now;
      this.logicalCounter = 0;
    } else if (this.physicalTime === remotePt) {
      this.logicalCounter = Math.max(this.logicalCounter, remoteLc) + 1;
    } else if (this.physicalTime > remotePt) {
      this.logicalCounter++;
    } else {
      this.physicalTime = remotePt;
      this.logicalCounter = remoteLc + 1;
    }

    return this.timestamp;
  }

  /**
   * Compare two HLC timestamps
   */
  static compare(a: { pt: number; lc: number }, b: { pt: number; lc: number }): number {
    if (a.pt !== b.pt) return a.pt - b.pt;
    return a.lc - b.lc;
  }

  /**
   * Serialize to string
   */
  serialize(): string {
    return `${this.physicalTime}.${this.logicalCounter}`;
  }

  /**
   * Create from serialized string
   */
  static deserialize(str: string): HybridLogicalClock {
    const [pt, lc] = str.split('.').map((s) => parseInt(s, 10));
    return new HybridLogicalClock(pt ?? Date.now(), lc ?? 0);
  }
}
