import type { CounterValue, MergeResult, NodeId } from './types.js';

/**
 * G-Counter (Grow-only Counter)
 * A counter that can only be incremented
 */
export class GCounter {
  private counts: Record<NodeId, number>;
  private readonly nodeId: NodeId;

  constructor(nodeId: NodeId, initial?: Record<NodeId, number>) {
    this.nodeId = nodeId;
    this.counts = initial ? { ...initial } : {};
  }

  /**
   * Get the current value
   */
  value(): number {
    return Object.values(this.counts).reduce((sum, n) => sum + n, 0);
  }

  /**
   * Increment the counter
   */
  increment(amount = 1): number {
    if (amount < 0) {
      throw new Error('G-Counter can only be incremented with positive values');
    }
    this.counts[this.nodeId] = (this.counts[this.nodeId] ?? 0) + amount;
    return this.value();
  }

  /**
   * Merge with another G-Counter
   */
  merge(other: Record<NodeId, number>): MergeResult<number> {
    const allNodes = new Set([...Object.keys(this.counts), ...Object.keys(other)]);

    for (const nodeId of allNodes) {
      this.counts[nodeId] = Math.max(this.counts[nodeId] ?? 0, other[nodeId] ?? 0);
    }

    return {
      value: this.value(),
      hadConflict: false,
    };
  }

  /**
   * Get state for serialization
   */
  getState(): Record<NodeId, number> {
    return { ...this.counts };
  }

  /**
   * Get local count
   */
  getLocalCount(): number {
    return this.counts[this.nodeId] ?? 0;
  }
}

/**
 * PN-Counter (Positive-Negative Counter)
 * A counter that can be incremented and decremented
 */
export class PNCounter {
  private positive: Record<NodeId, number>;
  private negative: Record<NodeId, number>;
  private readonly nodeId: NodeId;

  constructor(
    nodeId: NodeId,
    initial?: { positive?: Record<NodeId, number>; negative?: Record<NodeId, number> }
  ) {
    this.nodeId = nodeId;
    this.positive = initial?.positive ? { ...initial.positive } : {};
    this.negative = initial?.negative ? { ...initial.negative } : {};
  }

  /**
   * Get the current value
   */
  value(): number {
    const positiveSum = Object.values(this.positive).reduce((sum, n) => sum + n, 0);
    const negativeSum = Object.values(this.negative).reduce((sum, n) => sum + n, 0);
    return positiveSum - negativeSum;
  }

  /**
   * Increment the counter
   */
  increment(amount = 1): number {
    if (amount < 0) {
      return this.decrement(-amount);
    }
    this.positive[this.nodeId] = (this.positive[this.nodeId] ?? 0) + amount;
    return this.value();
  }

  /**
   * Decrement the counter
   */
  decrement(amount = 1): number {
    if (amount < 0) {
      return this.increment(-amount);
    }
    this.negative[this.nodeId] = (this.negative[this.nodeId] ?? 0) + amount;
    return this.value();
  }

  /**
   * Merge with another PN-Counter
   */
  merge(other: CounterValue): MergeResult<number> {
    // Merge positive counters
    const allPositiveNodes = new Set([
      ...Object.keys(this.positive),
      ...Object.keys(other.positive),
    ]);

    for (const nodeId of allPositiveNodes) {
      this.positive[nodeId] = Math.max(this.positive[nodeId] ?? 0, other.positive[nodeId] ?? 0);
    }

    // Merge negative counters
    if (other.negative) {
      const allNegativeNodes = new Set([
        ...Object.keys(this.negative),
        ...Object.keys(other.negative),
      ]);

      for (const nodeId of allNegativeNodes) {
        this.negative[nodeId] = Math.max(this.negative[nodeId] ?? 0, other.negative[nodeId] ?? 0);
      }
    }

    return {
      value: this.value(),
      hadConflict: false,
    };
  }

  /**
   * Get state for serialization
   */
  getState(): CounterValue {
    return {
      positive: { ...this.positive },
      negative: { ...this.negative },
    };
  }

  /**
   * Get local positive count
   */
  getLocalPositive(): number {
    return this.positive[this.nodeId] ?? 0;
  }

  /**
   * Get local negative count
   */
  getLocalNegative(): number {
    return this.negative[this.nodeId] ?? 0;
  }
}

/**
 * Create a G-Counter
 */
export function createGCounter(nodeId: NodeId, initial?: Record<NodeId, number>): GCounter {
  return new GCounter(nodeId, initial);
}

/**
 * Create a PN-Counter
 */
export function createPNCounter(
  nodeId: NodeId,
  initial?: { positive?: Record<NodeId, number>; negative?: Record<NodeId, number> }
): PNCounter {
  return new PNCounter(nodeId, initial);
}
