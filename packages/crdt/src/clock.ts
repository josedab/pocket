import type { LamportTimestamp, NodeId, VectorClock } from './types.js';

/**
 * Lamport clock for ordering distributed events
 */
export class LamportClock {
  private counter: number;
  private readonly nodeId: NodeId;

  constructor(nodeId: NodeId, initialCounter = 0) {
    this.nodeId = nodeId;
    this.counter = initialCounter;
  }

  /**
   * Get the current timestamp
   */
  now(): LamportTimestamp {
    return {
      counter: this.counter,
      nodeId: this.nodeId,
    };
  }

  /**
   * Increment and get a new timestamp (for local events)
   */
  tick(): LamportTimestamp {
    this.counter++;
    return this.now();
  }

  /**
   * Update based on a received timestamp and get a new timestamp
   */
  receive(received: LamportTimestamp): LamportTimestamp {
    this.counter = Math.max(this.counter, received.counter) + 1;
    return this.now();
  }

  /**
   * Get current counter value
   */
  getCounter(): number {
    return this.counter;
  }

  /**
   * Get node ID
   */
  getNodeId(): NodeId {
    return this.nodeId;
  }
}

/**
 * Compare two Lamport timestamps
 * Returns: negative if a < b, positive if a > b, 0 if equal
 */
export function compareLamportTimestamps(a: LamportTimestamp, b: LamportTimestamp): number {
  if (a.counter !== b.counter) {
    return a.counter - b.counter;
  }
  return a.nodeId.localeCompare(b.nodeId);
}

/**
 * Check if timestamp a is before timestamp b
 */
export function isBefore(a: LamportTimestamp, b: LamportTimestamp): boolean {
  return compareLamportTimestamps(a, b) < 0;
}

/**
 * Check if timestamp a is after timestamp b
 */
export function isAfter(a: LamportTimestamp, b: LamportTimestamp): boolean {
  return compareLamportTimestamps(a, b) > 0;
}

/**
 * Check if two timestamps are concurrent (neither happens-before the other)
 */
export function isConcurrent(a: LamportTimestamp, b: LamportTimestamp): boolean {
  return compareLamportTimestamps(a, b) === 0;
}

/**
 * Vector clock implementation
 */
export class VectorClockImpl {
  private clock: VectorClock;
  private readonly nodeId: NodeId;

  constructor(nodeId: NodeId, initial?: VectorClock) {
    this.nodeId = nodeId;
    this.clock = initial ? { ...initial } : {};
  }

  /**
   * Get the current vector clock
   */
  getClock(): VectorClock {
    return { ...this.clock };
  }

  /**
   * Increment local counter
   */
  increment(): VectorClock {
    this.clock[this.nodeId] = (this.clock[this.nodeId] ?? 0) + 1;
    return this.getClock();
  }

  /**
   * Merge with another vector clock
   */
  merge(other: VectorClock): VectorClock {
    const allNodes = new Set([...Object.keys(this.clock), ...Object.keys(other)]);

    for (const nodeId of allNodes) {
      this.clock[nodeId] = Math.max(this.clock[nodeId] ?? 0, other[nodeId] ?? 0);
    }

    return this.getClock();
  }

  /**
   * Get the local counter value
   */
  getLocalCounter(): number {
    return this.clock[this.nodeId] ?? 0;
  }

  /**
   * Get counter for a specific node
   */
  getCounter(nodeId: NodeId): number {
    return this.clock[nodeId] ?? 0;
  }
}

/**
 * Compare two vector clocks
 * Returns:
 * - 'before' if a happened-before b
 * - 'after' if a happened-after b
 * - 'concurrent' if neither happened-before the other
 * - 'equal' if they are identical
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
 * Check if vector clock a happened-before vector clock b
 */
export function vcHappenedBefore(a: VectorClock, b: VectorClock): boolean {
  const comparison = compareVectorClocks(a, b);
  return comparison === 'before';
}

/**
 * Check if vector clock a happened-after vector clock b
 */
export function vcHappenedAfter(a: VectorClock, b: VectorClock): boolean {
  const comparison = compareVectorClocks(a, b);
  return comparison === 'after';
}

/**
 * Check if two vector clocks are concurrent
 */
export function vcConcurrent(a: VectorClock, b: VectorClock): boolean {
  return compareVectorClocks(a, b) === 'concurrent';
}

/**
 * Merge two vector clocks (element-wise maximum)
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
 * Create an empty vector clock
 */
export function emptyVectorClock(): VectorClock {
  return {};
}

/**
 * Create a vector clock for a single node
 */
export function singletonVectorClock(nodeId: NodeId, counter = 1): VectorClock {
  return { [nodeId]: counter };
}

/**
 * Generate a unique operation ID
 */
export function generateOpId(nodeId: NodeId, counter: number): string {
  return `${nodeId}:${counter}`;
}

/**
 * Parse an operation ID
 */
export function parseOpId(opId: string): { nodeId: NodeId; counter: number } {
  const parts = opId.split(':');
  return {
    nodeId: parts[0] ?? '',
    counter: parseInt(parts[1] ?? '0', 10),
  };
}
