import type { LamportTimestamp, NodeId, VectorClock } from './types.js';

/**
 * Lamport logical clock for ordering distributed events.
 *
 * Implements Lamport's logical clock algorithm for establishing
 * a partial ordering of events in a distributed system. The clock
 * guarantees that if event A causally precedes event B, then
 * timestamp(A) < timestamp(B).
 *
 * Key properties:
 * - Monotonically increasing counter within a node
 * - Updates based on received timestamps to maintain ordering
 * - Node ID used as tiebreaker for concurrent events
 *
 * @example Basic usage
 * ```typescript
 * const clock = new LamportClock('node-1');
 *
 * // Generate timestamps for local events
 * const ts1 = clock.tick(); // { counter: 1, nodeId: 'node-1' }
 * const ts2 = clock.tick(); // { counter: 2, nodeId: 'node-1' }
 *
 * // Current time without incrementing
 * const current = clock.now();
 * ```
 *
 * @example Handling received messages
 * ```typescript
 * // Receive timestamp from another node
 * const remoteTs = { counter: 10, nodeId: 'node-2' };
 *
 * // Update clock and get new timestamp for response
 * const responseTs = clock.receive(remoteTs);
 * // Clock is now at max(local, 10) + 1
 * ```
 *
 * @see {@link LamportTimestamp} - The timestamp type
 * @see {@link compareLamportTimestamps} - Timestamp comparison
 */
export class LamportClock {
  private counter: number;
  private readonly nodeId: NodeId;

  /**
   * Create a new Lamport clock.
   *
   * @param nodeId - Unique identifier for this node
   * @param initialCounter - Starting counter value (default: 0)
   */
  constructor(nodeId: NodeId, initialCounter = 0) {
    this.nodeId = nodeId;
    this.counter = initialCounter;
  }

  /**
   * Get the current timestamp without incrementing.
   *
   * @returns Current Lamport timestamp
   */
  now(): LamportTimestamp {
    return {
      counter: this.counter,
      nodeId: this.nodeId,
    };
  }

  /**
   * Increment the clock and get a new timestamp for local events.
   *
   * Should be called before sending any message or performing
   * any operation that needs to be ordered.
   *
   * @returns New Lamport timestamp with incremented counter
   */
  tick(): LamportTimestamp {
    this.counter++;
    return this.now();
  }

  /**
   * Update the clock based on a received timestamp.
   *
   * Sets the counter to max(local, received) + 1 to maintain
   * the happens-before relationship.
   *
   * @param received - Timestamp from a received message
   * @returns New timestamp for the receive event
   */
  receive(received: LamportTimestamp): LamportTimestamp {
    this.counter = Math.max(this.counter, received.counter) + 1;
    return this.now();
  }

  /**
   * Get the current counter value.
   *
   * @returns Current logical clock counter
   */
  getCounter(): number {
    return this.counter;
  }

  /**
   * Get this clock's node ID.
   *
   * @returns The node ID assigned to this clock
   */
  getNodeId(): NodeId {
    return this.nodeId;
  }
}

/**
 * Compare two Lamport timestamps for ordering.
 *
 * Compares first by counter value, then by node ID as a
 * deterministic tiebreaker for concurrent events.
 *
 * @param a - First timestamp
 * @param b - Second timestamp
 * @returns Negative if a < b, positive if a > b, 0 if equal
 *
 * @example
 * ```typescript
 * const ts1 = { counter: 5, nodeId: 'a' };
 * const ts2 = { counter: 5, nodeId: 'b' };
 *
 * compareLamportTimestamps(ts1, ts2); // negative (a < b)
 *
 * const ts3 = { counter: 10, nodeId: 'a' };
 * compareLamportTimestamps(ts1, ts3); // negative (5 < 10)
 * ```
 */
export function compareLamportTimestamps(a: LamportTimestamp, b: LamportTimestamp): number {
  if (a.counter !== b.counter) {
    return a.counter - b.counter;
  }
  return a.nodeId.localeCompare(b.nodeId);
}

/**
 * Check if timestamp a is before timestamp b.
 *
 * @param a - First timestamp
 * @param b - Second timestamp
 * @returns True if a < b
 */
export function isBefore(a: LamportTimestamp, b: LamportTimestamp): boolean {
  return compareLamportTimestamps(a, b) < 0;
}

/**
 * Check if timestamp a is after timestamp b.
 *
 * @param a - First timestamp
 * @param b - Second timestamp
 * @returns True if a > b
 */
export function isAfter(a: LamportTimestamp, b: LamportTimestamp): boolean {
  return compareLamportTimestamps(a, b) > 0;
}

/**
 * Check if two timestamps are concurrent.
 *
 * Note: With Lamport timestamps, this only means the timestamps
 * are identical (same counter and nodeId). For true concurrency
 * detection, use vector clocks.
 *
 * @param a - First timestamp
 * @param b - Second timestamp
 * @returns True if timestamps are identical
 */
export function isConcurrent(a: LamportTimestamp, b: LamportTimestamp): boolean {
  return compareLamportTimestamps(a, b) === 0;
}

/**
 * Vector clock implementation for tracking causality.
 *
 * Vector clocks extend Lamport clocks to detect concurrent events
 * (events that don't have a causal relationship). Each node maintains
 * a counter for every node in the system.
 *
 * Key properties:
 * - Can detect concurrent events (unlike Lamport clocks)
 * - Provides happens-before relationship tracking
 * - Grows with the number of nodes
 *
 * @example Basic usage
 * ```typescript
 * const vcA = new VectorClockImpl('node-a');
 * vcA.increment(); // { 'node-a': 1 }
 *
 * const vcB = new VectorClockImpl('node-b');
 * vcB.increment(); // { 'node-b': 1 }
 *
 * // Merge after message exchange
 * vcA.merge(vcB.getClock()); // { 'node-a': 1, 'node-b': 1 }
 * ```
 *
 * @example Detecting concurrency
 * ```typescript
 * const comparison = compareVectorClocks(vc1.getClock(), vc2.getClock());
 * if (comparison === 'concurrent') {
 *   // Events happened without causal relationship - potential conflict
 * }
 * ```
 *
 * @see {@link VectorClock} - The vector clock type
 * @see {@link compareVectorClocks} - Comparison function
 */
export class VectorClockImpl {
  private clock: VectorClock;
  private readonly nodeId: NodeId;

  /**
   * Create a new vector clock.
   *
   * @param nodeId - Unique identifier for this node
   * @param initial - Optional initial clock state
   */
  constructor(nodeId: NodeId, initial?: VectorClock) {
    this.nodeId = nodeId;
    this.clock = initial ? { ...initial } : {};
  }

  /**
   * Get a copy of the current vector clock state.
   *
   * @returns Copy of the clock (safe to modify)
   */
  getClock(): VectorClock {
    return { ...this.clock };
  }

  /**
   * Increment the local node's counter.
   *
   * Should be called before any local event (send, local operation).
   *
   * @returns Updated vector clock
   */
  increment(): VectorClock {
    this.clock[this.nodeId] = (this.clock[this.nodeId] ?? 0) + 1;
    return this.getClock();
  }

  /**
   * Merge with another vector clock (element-wise maximum).
   *
   * Should be called when receiving a message from another node.
   *
   * @param other - Vector clock from received message
   * @returns Updated vector clock
   */
  merge(other: VectorClock): VectorClock {
    const allNodes = new Set([...Object.keys(this.clock), ...Object.keys(other)]);

    for (const nodeId of allNodes) {
      this.clock[nodeId] = Math.max(this.clock[nodeId] ?? 0, other[nodeId] ?? 0);
    }

    return this.getClock();
  }

  /**
   * Get this node's counter value.
   *
   * @returns Counter for the local node
   */
  getLocalCounter(): number {
    return this.clock[this.nodeId] ?? 0;
  }

  /**
   * Get the counter value for a specific node.
   *
   * @param nodeId - Node to get counter for
   * @returns Counter value (0 if node not seen)
   */
  getCounter(nodeId: NodeId): number {
    return this.clock[nodeId] ?? 0;
  }
}

/**
 * Compare two vector clocks to determine causal relationship.
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns Relationship between the clocks:
 *   - 'before': a happened-before b (a ≤ b and a ≠ b)
 *   - 'after': a happened-after b (a ≥ b and a ≠ b)
 *   - 'concurrent': neither happened-before the other (conflict possible)
 *   - 'equal': identical clocks
 *
 * @example
 * ```typescript
 * const a = { 'node-1': 2, 'node-2': 1 };
 * const b = { 'node-1': 2, 'node-2': 2 };
 * compareVectorClocks(a, b); // 'before'
 *
 * const c = { 'node-1': 3, 'node-2': 1 };
 * compareVectorClocks(a, c); // 'concurrent'
 * ```
 */
export function compareVectorClocks(
  a: VectorClock,
  b: VectorClock
): 'before' | 'after' | 'concurrent' | 'equal' {
  const allNodes = new Set([...Object.keys(a), ...Object.keys(b)]);

  let aBeforeB = false;
  let bBeforeA = false;

  for (const nodeId of allNodes) {
    const aVal = a[nodeId] ?? 0;
    const bVal = b[nodeId] ?? 0;

    if (aVal < bVal) {
      aBeforeB = true;
    } else if (aVal > bVal) {
      bBeforeA = true;
    }
  }

  if (aBeforeB && bBeforeA) {
    return 'concurrent';
  } else if (aBeforeB) {
    return 'before';
  } else if (bBeforeA) {
    return 'after';
  } else {
    return 'equal';
  }
}

/**
 * Check if vector clock a happened-before vector clock b.
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns True if a causally precedes b
 */
export function vcHappenedBefore(a: VectorClock, b: VectorClock): boolean {
  const comparison = compareVectorClocks(a, b);
  return comparison === 'before';
}

/**
 * Check if vector clock a happened-after vector clock b.
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns True if a causally follows b
 */
export function vcHappenedAfter(a: VectorClock, b: VectorClock): boolean {
  const comparison = compareVectorClocks(a, b);
  return comparison === 'after';
}

/**
 * Check if two vector clocks are concurrent (no causal relationship).
 *
 * Concurrent events indicate a potential conflict that needs resolution.
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns True if events are concurrent (potential conflict)
 */
export function vcConcurrent(a: VectorClock, b: VectorClock): boolean {
  return compareVectorClocks(a, b) === 'concurrent';
}

/**
 * Merge two vector clocks by taking element-wise maximum.
 *
 * The resulting clock represents knowledge of all events
 * known by either input clock.
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns Merged vector clock
 *
 * @example
 * ```typescript
 * const a = { 'node-1': 3, 'node-2': 1 };
 * const b = { 'node-1': 2, 'node-2': 4 };
 * mergeVectorClocks(a, b); // { 'node-1': 3, 'node-2': 4 }
 * ```
 */
export function mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  const allNodes = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const nodeId of allNodes) {
    result[nodeId] = Math.max(a[nodeId] ?? 0, b[nodeId] ?? 0);
  }

  return result;
}

/**
 * Create an empty vector clock.
 *
 * @returns Empty vector clock (no nodes)
 */
export function emptyVectorClock(): VectorClock {
  return {};
}

/**
 * Create a vector clock with a single node entry.
 *
 * @param nodeId - Node ID
 * @param counter - Counter value (default: 1)
 * @returns Vector clock with one entry
 */
export function singletonVectorClock(nodeId: NodeId, counter = 1): VectorClock {
  return { [nodeId]: counter };
}

/**
 * Generate a unique operation ID from node ID and counter.
 *
 * Format: "nodeId:counter"
 *
 * @param nodeId - Node that created the operation
 * @param counter - Lamport counter at creation time
 * @returns Unique operation identifier
 *
 * @example
 * ```typescript
 * const opId = generateOpId('node-1', 42);
 * // 'node-1:42'
 * ```
 */
export function generateOpId(nodeId: NodeId, counter: number): string {
  return `${nodeId}:${counter}`;
}

/**
 * Parse an operation ID into its components.
 *
 * @param opId - Operation ID in "nodeId:counter" format
 * @returns Parsed node ID and counter
 *
 * @example
 * ```typescript
 * const { nodeId, counter } = parseOpId('node-1:42');
 * // nodeId: 'node-1', counter: 42
 * ```
 */
export function parseOpId(opId: string): { nodeId: NodeId; counter: number } {
  const parts = opId.split(':');
  return {
    nodeId: parts[0] ?? '',
    counter: parseInt(parts[1] ?? '0', 10),
  };
}
