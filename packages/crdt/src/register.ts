import {
  compareLamportTimestamps,
  LamportClock,
  mergeVectorClocks,
  vcHappenedAfter,
} from './clock.js';
import type {
  CRDTMetadata,
  LamportTimestamp,
  LWWRegisterValue,
  MergeResult,
  MVRegisterValue,
  NodeId,
  VectorClock,
} from './types.js';

/**
 * Last-Writer-Wins Register (LWW-Register)
 * Concurrent writes are resolved by timestamp, with node ID as tie-breaker
 */
export class LWWRegister<T = unknown> {
  private value: T | undefined;
  private timestamp: LamportTimestamp;
  private readonly clock: LamportClock;

  constructor(nodeId: NodeId, initialValue?: T, initialTimestamp?: LamportTimestamp) {
    this.clock = new LamportClock(nodeId);
    this.value = initialValue;
    this.timestamp = initialTimestamp ?? { counter: 0, nodeId };
  }

  /**
   * Get current value
   */
  get(): T | undefined {
    return this.value;
  }

  /**
   * Set a new value (local operation)
   */
  set(value: T): LWWRegisterValue<T> {
    const newTimestamp = this.clock.tick();
    this.value = value;
    this.timestamp = newTimestamp;

    return { value, timestamp: newTimestamp };
  }

  /**
   * Apply a remote update
   */
  applyRemote(value: T, timestamp: LamportTimestamp): boolean {
    // Update clock based on received timestamp
    this.clock.receive(timestamp);

    // Only apply if the new timestamp is greater
    if (compareLamportTimestamps(timestamp, this.timestamp) > 0) {
      this.value = value;
      this.timestamp = timestamp;
      return true;
    }

    return false;
  }

  /**
   * Merge with another LWW-Register
   */
  merge(other: LWWRegisterValue<T>): MergeResult<T | undefined> {
    const hadConflict = compareLamportTimestamps(this.timestamp, other.timestamp) !== 0;

    if (compareLamportTimestamps(other.timestamp, this.timestamp) > 0) {
      this.value = other.value;
      this.timestamp = other.timestamp;
    }

    return {
      value: this.value,
      hadConflict,
      conflictingValues: hadConflict ? [this.value as T, other.value] : undefined,
    };
  }

  /**
   * Get state for serialization
   */
  getState(): LWWRegisterValue<T | undefined> {
    return {
      value: this.value,
      timestamp: this.timestamp,
    };
  }

  /**
   * Get metadata
   */
  getMetadata(): CRDTMetadata {
    return {
      timestamp: this.timestamp,
      vclock: { [this.clock.getNodeId()]: this.clock.getCounter() },
    };
  }
}

/**
 * Multi-Value Register (MV-Register)
 * Preserves all concurrent values, allowing application-level conflict resolution
 */
export class MVRegister<T = unknown> {
  private values: Map<string, { value: T; vclock: VectorClock }>;
  private vclock: VectorClock;
  private readonly nodeId: NodeId;
  private counter: number;

  constructor(nodeId: NodeId, initialValue?: T) {
    this.nodeId = nodeId;
    this.values = new Map();
    this.vclock = {};
    this.counter = 0;

    if (initialValue !== undefined) {
      this.set(initialValue);
    }
  }

  /**
   * Get all current values (may be multiple during conflict)
   */
  getAll(): T[] {
    return Array.from(this.values.values()).map((v) => v.value);
  }

  /**
   * Get a single value (first one, or undefined if conflict)
   */
  get(): T | undefined {
    const values = this.getAll();
    return values.length === 1 ? values[0] : undefined;
  }

  /**
   * Check if there's a conflict (multiple concurrent values)
   */
  hasConflict(): boolean {
    return this.values.size > 1;
  }

  /**
   * Get conflicting values
   */
  getConflicts(): T[] {
    return this.hasConflict() ? this.getAll() : [];
  }

  /**
   * Set a new value (local operation)
   */
  set(value: T): MVRegisterValue<T> {
    this.counter++;
    this.vclock[this.nodeId] = this.counter;

    // Clear all previous values (they're all now dominated)
    this.values.clear();

    const key = `${this.nodeId}:${this.counter}`;
    this.values.set(key, { value, vclock: { ...this.vclock } });

    return {
      values: [
        {
          value,
          timestamp: { counter: this.counter, nodeId: this.nodeId },
          vclock: { ...this.vclock },
        },
      ],
    };
  }

  /**
   * Resolve conflict by choosing a value
   */
  resolve(value: T): void {
    this.set(value);
  }

  /**
   * Apply a remote update
   */
  applyRemote(value: T, vclock: VectorClock): boolean {
    // Check if this is dominated by any existing value
    for (const existing of this.values.values()) {
      if (vcHappenedAfter(existing.vclock, vclock)) {
        // New value is dominated, ignore
        return false;
      }
    }

    // Remove any values dominated by the new one
    for (const [key, existing] of this.values) {
      if (vcHappenedAfter(vclock, existing.vclock)) {
        this.values.delete(key);
      }
    }

    // Add the new value if it's concurrent with all remaining
    const nodeId = Object.keys(vclock)[0] ?? this.nodeId;
    const counter = vclock[nodeId] ?? 0;
    const key = `${nodeId}:${counter}`;
    this.values.set(key, { value, vclock: { ...vclock } });

    // Merge vector clocks
    this.vclock = mergeVectorClocks(this.vclock, vclock);
    this.counter = Math.max(this.counter, this.vclock[this.nodeId] ?? 0);

    return true;
  }

  /**
   * Merge with another MV-Register
   */
  merge(other: MVRegisterValue<T>): MergeResult<T[]> {
    let hadConflict = false;

    for (const otherVal of other.values) {
      const applied = this.applyRemote(otherVal.value, otherVal.vclock);
      if (applied && this.values.size > 1) {
        hadConflict = true;
      }
    }

    return {
      value: this.getAll(),
      hadConflict,
      conflictingValues: hadConflict ? [this.getAll()] : undefined,
    };
  }

  /**
   * Get state for serialization
   */
  getState(): MVRegisterValue<T> {
    return {
      values: Array.from(this.values.values()).map((v) => ({
        value: v.value,
        timestamp: {
          counter: v.vclock[this.nodeId] ?? 0,
          nodeId: this.nodeId,
        },
        vclock: v.vclock,
      })),
    };
  }

  /**
   * Get vector clock
   */
  getVectorClock(): VectorClock {
    return { ...this.vclock };
  }
}

/**
 * Create an LWW-Register
 */
export function createLWWRegister<T>(nodeId: NodeId, initialValue?: T): LWWRegister<T> {
  return new LWWRegister<T>(nodeId, initialValue);
}

/**
 * Create an MV-Register
 */
export function createMVRegister<T>(nodeId: NodeId, initialValue?: T): MVRegister<T> {
  return new MVRegister<T>(nodeId, initialValue);
}
