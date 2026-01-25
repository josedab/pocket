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
 * Last-Writer-Wins Register (LWW-Register) for single-value storage.
 *
 * A CRDT register that resolves concurrent writes by choosing the
 * value with the most recent timestamp. Node ID is used as a
 * deterministic tiebreaker for identical timestamps.
 *
 * Key properties:
 * - Simple conflict resolution (last write wins)
 * - Single value at any time
 * - May lose concurrent writes
 *
 * Use cases:
 * - User preferences
 * - Configuration values
 * - Any single-value setting where latest wins is acceptable
 *
 * @typeParam T - Value type
 *
 * @example Basic usage
 * ```typescript
 * const name = createLWWRegister<string>('node-1', 'Initial');
 *
 * const op = name.set('New Value');
 * console.log(name.get()); // 'New Value'
 *
 * // Broadcast operation for replication
 * broadcastToOthers(op);
 * ```
 *
 * @example Conflict resolution
 * ```typescript
 * // Two nodes write concurrently
 * const regA = createLWWRegister<string>('node-a', 'initial');
 * const regB = createLWWRegister<string>('node-b', 'initial');
 *
 * const opA = regA.set('value-A'); // timestamp: 1
 * const opB = regB.set('value-B'); // timestamp: 1
 *
 * // After merge, one value wins based on timestamp/nodeId
 * regA.merge(opB);
 * // regA.get() === 'value-A' or 'value-B' (deterministic)
 * ```
 *
 * @see {@link createLWWRegister} - Factory function
 * @see {@link MVRegister} - Register that preserves concurrent values
 */
export class LWWRegister<T = unknown> {
  private value: T | undefined;
  private timestamp: LamportTimestamp;
  private readonly clock: LamportClock;

  /**
   * Create a new LWW-Register.
   *
   * @param nodeId - Unique identifier for this node
   * @param initialValue - Optional initial value
   * @param initialTimestamp - Optional initial timestamp
   */
  constructor(nodeId: NodeId, initialValue?: T, initialTimestamp?: LamportTimestamp) {
    this.clock = new LamportClock(nodeId);
    this.value = initialValue;
    this.timestamp = initialTimestamp ?? { counter: 0, nodeId };
  }

  /**
   * Get the current value.
   *
   * @returns Current value, or undefined if not set
   */
  get(): T | undefined {
    return this.value;
  }

  /**
   * Set a new value (local operation).
   *
   * @param value - New value to set
   * @returns Operation details for replication
   */
  set(value: T): LWWRegisterValue<T> {
    const newTimestamp = this.clock.tick();
    this.value = value;
    this.timestamp = newTimestamp;

    return { value, timestamp: newTimestamp };
  }

  /**
   * Apply a remote update from another node.
   *
   * Only applies if the remote timestamp is greater than the current one.
   *
   * @param value - Remote value
   * @param timestamp - Remote timestamp
   * @returns True if the value was updated
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
   * Merge with another LWW-Register state.
   *
   * @param other - State from another LWW-Register
   * @returns Merge result with conflict information
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
   * Get the full state for serialization.
   *
   * @returns Value and timestamp for persistence/replication
   */
  getState(): LWWRegisterValue<T | undefined> {
    return {
      value: this.value,
      timestamp: this.timestamp,
    };
  }

  /**
   * Get CRDT metadata.
   *
   * @returns Metadata including timestamp and vector clock
   */
  getMetadata(): CRDTMetadata {
    return {
      timestamp: this.timestamp,
      vclock: { [this.clock.getNodeId()]: this.clock.getCounter() },
    };
  }
}

/**
 * Multi-Value Register (MV-Register) for conflict-preserving storage.
 *
 * A CRDT register that preserves all concurrent values instead of
 * choosing a winner. This allows application-level conflict resolution
 * when concurrent writes occur.
 *
 * Key properties:
 * - Preserves all concurrent values (no data loss)
 * - Requires application to resolve conflicts
 * - Uses vector clocks for concurrency detection
 *
 * Use cases:
 * - Document editing (show merge conflicts)
 * - Data where all versions matter
 * - Situations requiring manual conflict resolution
 *
 * @typeParam T - Value type
 *
 * @example Basic usage
 * ```typescript
 * const doc = createMVRegister<string>('node-1');
 *
 * doc.set('Version A');
 * console.log(doc.get()); // 'Version A'
 * console.log(doc.hasConflict()); // false
 * ```
 *
 * @example Handling conflicts
 * ```typescript
 * // After concurrent writes from different nodes
 * if (doc.hasConflict()) {
 *   const versions = doc.getConflicts();
 *   console.log('Conflicts:', versions);
 *
 *   // Application resolves the conflict
 *   doc.resolve(mergeVersions(versions));
 * }
 * ```
 *
 * @see {@link createMVRegister} - Factory function
 * @see {@link LWWRegister} - Register with automatic conflict resolution
 */
export class MVRegister<T = unknown> {
  private values: Map<string, { value: T; vclock: VectorClock }>;
  private vclock: VectorClock;
  private readonly nodeId: NodeId;
  private counter: number;

  /**
   * Create a new MV-Register.
   *
   * @param nodeId - Unique identifier for this node
   * @param initialValue - Optional initial value
   */
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
   * Get all current values.
   *
   * Returns multiple values if there are unresolved conflicts.
   *
   * @returns Array of all current values
   */
  getAll(): T[] {
    return Array.from(this.values.values()).map((v) => v.value);
  }

  /**
   * Get a single value.
   *
   * Returns the value only if there's exactly one. Returns undefined
   * if there are conflicts (multiple values) or no value.
   *
   * @returns Single value, or undefined if conflicts or empty
   */
  get(): T | undefined {
    const values = this.getAll();
    return values.length === 1 ? values[0] : undefined;
  }

  /**
   * Check if there are unresolved conflicts.
   *
   * @returns True if multiple concurrent values exist
   */
  hasConflict(): boolean {
    return this.values.size > 1;
  }

  /**
   * Get all conflicting values.
   *
   * @returns Array of conflicting values, or empty if no conflict
   */
  getConflicts(): T[] {
    return this.hasConflict() ? this.getAll() : [];
  }

  /**
   * Set a new value (local operation).
   *
   * Clears any existing conflicts and sets a single value.
   *
   * @param value - New value to set
   * @returns Operation details for replication
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
   * Resolve conflicts by choosing a value.
   *
   * Sets the register to a single value, clearing all conflicts.
   *
   * @param value - Chosen value for resolution
   */
  resolve(value: T): void {
    this.set(value);
  }

  /**
   * Apply a remote update from another node.
   *
   * May result in conflicts if the update is concurrent with
   * existing values.
   *
   * @param value - Remote value
   * @param vclock - Remote vector clock
   * @returns True if the update was applied
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
   * Merge with another MV-Register state.
   *
   * @param other - State from another MV-Register
   * @returns Merge result with conflict information
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
   * Get the full state for serialization.
   *
   * @returns All values with their vector clocks
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
   * Get the current vector clock.
   *
   * @returns Copy of the vector clock
   */
  getVectorClock(): VectorClock {
    return { ...this.vclock };
  }
}

/**
 * Create a new Last-Writer-Wins Register.
 *
 * @typeParam T - Value type
 * @param nodeId - Unique identifier for this node
 * @param initialValue - Optional initial value
 * @returns A new LWWRegister instance
 *
 * @example
 * ```typescript
 * const setting = createLWWRegister<boolean>('device-1', true);
 * setting.set(false);
 * ```
 *
 * @see {@link LWWRegister}
 */
export function createLWWRegister<T>(nodeId: NodeId, initialValue?: T): LWWRegister<T> {
  return new LWWRegister<T>(nodeId, initialValue);
}

/**
 * Create a new Multi-Value Register.
 *
 * @typeParam T - Value type
 * @param nodeId - Unique identifier for this node
 * @param initialValue - Optional initial value
 * @returns A new MVRegister instance
 *
 * @example
 * ```typescript
 * const content = createMVRegister<string>('editor-1', 'Initial text');
 * content.set('Updated text');
 *
 * if (content.hasConflict()) {
 *   // Handle merge conflict
 * }
 * ```
 *
 * @see {@link MVRegister}
 */
export function createMVRegister<T>(nodeId: NodeId, initialValue?: T): MVRegister<T> {
  return new MVRegister<T>(nodeId, initialValue);
}
