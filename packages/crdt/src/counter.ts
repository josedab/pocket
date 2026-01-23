import type { CounterValue, MergeResult, NodeId } from './types.js';

/**
 * Grow-only Counter (G-Counter) for distributed counting.
 *
 * A CRDT counter that can only be incremented. Each node maintains
 * its own counter, and the global value is the sum of all node
 * counters. This ensures convergence without conflicts.
 *
 * Key properties:
 * - Monotonically increasing (can only grow)
 * - Conflict-free merging via max of per-node counters
 * - Eventually consistent across all replicas
 *
 * Use cases:
 * - View counts, like counts
 * - Event counters
 * - Any metric that only increases
 *
 * @example Basic usage
 * ```typescript
 * const counter = createGCounter('node-1');
 *
 * counter.increment();     // value: 1
 * counter.increment(5);    // value: 6
 *
 * console.log(counter.value()); // 6
 * ```
 *
 * @example Distributed counting
 * ```typescript
 * // Node A
 * const counterA = createGCounter('node-a');
 * counterA.increment(10);
 *
 * // Node B
 * const counterB = createGCounter('node-b');
 * counterB.increment(5);
 *
 * // Merge states
 * counterA.merge(counterB.getState());
 * // counterA.value() === 15 (10 + 5)
 * ```
 *
 * @see {@link createGCounter} - Factory function
 * @see {@link PNCounter} - Counter that supports decrement
 */
export class GCounter {
  private counts: Record<NodeId, number>;
  private readonly nodeId: NodeId;

  /**
   * Create a new G-Counter.
   *
   * @param nodeId - Unique identifier for this node
   * @param initial - Optional initial state (for restoration)
   */
  constructor(nodeId: NodeId, initial?: Record<NodeId, number>) {
    this.nodeId = nodeId;
    this.counts = initial ? { ...initial } : {};
  }

  /**
   * Get the current counter value (sum of all node counters).
   *
   * @returns Total count across all nodes
   */
  value(): number {
    return Object.values(this.counts).reduce((sum, n) => sum + n, 0);
  }

  /**
   * Increment the counter by a positive amount.
   *
   * @param amount - Amount to add (must be positive, default: 1)
   * @returns New total value
   * @throws Error if amount is negative
   *
   * @example
   * ```typescript
   * counter.increment();    // Add 1
   * counter.increment(10);  // Add 10
   * ```
   */
  increment(amount = 1): number {
    if (amount < 0) {
      throw new Error('G-Counter can only be incremented with positive values');
    }
    this.counts[this.nodeId] = (this.counts[this.nodeId] ?? 0) + amount;
    return this.value();
  }

  /**
   * Merge with another G-Counter state.
   *
   * Takes the maximum value for each node's counter.
   *
   * @param other - State from another G-Counter
   * @returns Merge result (never has conflicts for G-Counter)
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
   * Get the full state for serialization.
   *
   * @returns Map of node IDs to their counter values
   */
  getState(): Record<NodeId, number> {
    return { ...this.counts };
  }

  /**
   * Get this node's contribution to the count.
   *
   * @returns Count from this node only
   */
  getLocalCount(): number {
    return this.counts[this.nodeId] ?? 0;
  }
}

/**
 * Positive-Negative Counter (PN-Counter) for distributed counting.
 *
 * A CRDT counter that supports both increment and decrement operations.
 * Internally uses two G-Counters: one for increments and one for
 * decrements. The value is the difference between them.
 *
 * Key properties:
 * - Supports both increment and decrement
 * - Conflict-free merging
 * - Value can become negative
 *
 * Use cases:
 * - Inventory counts
 * - Balance tracking
 * - Any metric that can increase or decrease
 *
 * @example Basic usage
 * ```typescript
 * const counter = createPNCounter('node-1');
 *
 * counter.increment(10);  // value: 10
 * counter.decrement(3);   // value: 7
 * counter.decrement(10);  // value: -3
 * ```
 *
 * @example Distributed operations
 * ```typescript
 * // Node A increments
 * const counterA = createPNCounter('node-a');
 * counterA.increment(100);
 *
 * // Node B decrements
 * const counterB = createPNCounter('node-b');
 * counterB.decrement(30);
 *
 * // Merge
 * counterA.merge(counterB.getState());
 * // counterA.value() === 70
 * ```
 *
 * @see {@link createPNCounter} - Factory function
 * @see {@link GCounter} - Grow-only counter
 */
export class PNCounter {
  private positive: Record<NodeId, number>;
  private negative: Record<NodeId, number>;
  private readonly nodeId: NodeId;

  /**
   * Create a new PN-Counter.
   *
   * @param nodeId - Unique identifier for this node
   * @param initial - Optional initial state (for restoration)
   */
  constructor(
    nodeId: NodeId,
    initial?: { positive?: Record<NodeId, number>; negative?: Record<NodeId, number> }
  ) {
    this.nodeId = nodeId;
    this.positive = initial?.positive ? { ...initial.positive } : {};
    this.negative = initial?.negative ? { ...initial.negative } : {};
  }

  /**
   * Get the current counter value (increments minus decrements).
   *
   * @returns Net counter value (can be negative)
   */
  value(): number {
    const positiveSum = Object.values(this.positive).reduce((sum, n) => sum + n, 0);
    const negativeSum = Object.values(this.negative).reduce((sum, n) => sum + n, 0);
    return positiveSum - negativeSum;
  }

  /**
   * Increment the counter.
   *
   * Negative amounts are converted to decrements.
   *
   * @param amount - Amount to add (default: 1)
   * @returns New total value
   */
  increment(amount = 1): number {
    if (amount < 0) {
      return this.decrement(-amount);
    }
    this.positive[this.nodeId] = (this.positive[this.nodeId] ?? 0) + amount;
    return this.value();
  }

  /**
   * Decrement the counter.
   *
   * Negative amounts are converted to increments.
   *
   * @param amount - Amount to subtract (default: 1)
   * @returns New total value
   */
  decrement(amount = 1): number {
    if (amount < 0) {
      return this.increment(-amount);
    }
    this.negative[this.nodeId] = (this.negative[this.nodeId] ?? 0) + amount;
    return this.value();
  }

  /**
   * Merge with another PN-Counter state.
   *
   * Takes the maximum for both positive and negative counters.
   *
   * @param other - State from another PN-Counter
   * @returns Merge result (never has conflicts for PN-Counter)
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
   * Get the full state for serialization.
   *
   * @returns State with positive and negative counter maps
   */
  getState(): CounterValue {
    return {
      positive: { ...this.positive },
      negative: { ...this.negative },
    };
  }

  /**
   * Get this node's positive (increment) contribution.
   *
   * @returns Positive count from this node only
   */
  getLocalPositive(): number {
    return this.positive[this.nodeId] ?? 0;
  }

  /**
   * Get this node's negative (decrement) contribution.
   *
   * @returns Negative count from this node only
   */
  getLocalNegative(): number {
    return this.negative[this.nodeId] ?? 0;
  }
}

/**
 * Create a new Grow-only Counter.
 *
 * @param nodeId - Unique identifier for this node
 * @param initial - Optional initial state (for restoration)
 * @returns A new GCounter instance
 *
 * @example
 * ```typescript
 * const viewCount = createGCounter('server-1');
 * viewCount.increment();
 * ```
 *
 * @see {@link GCounter}
 */
export function createGCounter(nodeId: NodeId, initial?: Record<NodeId, number>): GCounter {
  return new GCounter(nodeId, initial);
}

/**
 * Create a new Positive-Negative Counter.
 *
 * @param nodeId - Unique identifier for this node
 * @param initial - Optional initial state (for restoration)
 * @returns A new PNCounter instance
 *
 * @example
 * ```typescript
 * const stockCount = createPNCounter('warehouse-1');
 * stockCount.increment(100); // Stock in
 * stockCount.decrement(20);  // Stock out
 * ```
 *
 * @see {@link PNCounter}
 */
export function createPNCounter(
  nodeId: NodeId,
  initial?: { positive?: Record<NodeId, number>; negative?: Record<NodeId, number> }
): PNCounter {
  return new PNCounter(nodeId, initial);
}
