import { LamportClock, compareLamportTimestamps } from './clock.js';
import type { LamportTimestamp, MergeResult, NodeId } from './types.js';

/**
 * Internal entry structure for LWW-Map values.
 *
 * @internal
 */
interface LWWMapEntry<V> {
  /** The stored value */
  value: V;
  /** Lamport timestamp of the last write */
  timestamp: LamportTimestamp;
  /** Whether this entry has been deleted */
  tombstone: boolean;
}

/**
 * Last-Writer-Wins Map (LWW-Map) for distributed key-value storage.
 *
 * A CRDT map where each key behaves as an independent LWW-Register.
 * Concurrent updates to the same key are resolved by timestamp comparison,
 * with the most recent write winning. Node ID is used as a tiebreaker
 * for operations with identical timestamps.
 *
 * Key features:
 * - Arbitrary key/value types with JSON serialization for non-string keys
 * - Tombstone-based deletion that respects causal ordering
 * - Efficient merge operations for synchronization
 * - Full state serialization for persistence and network transfer
 *
 * @typeParam K - Key type (default: string)
 * @typeParam V - Value type (default: unknown)
 *
 * @example Basic usage
 * ```typescript
 * const map = createLWWMap<string, number>('node-1');
 *
 * map.set('counter', 42);
 * map.set('score', 100);
 *
 * console.log(map.get('counter')); // 42
 * console.log(map.has('score')); // true
 * console.log(map.size); // 2
 * ```
 *
 * @example Distributed synchronization
 * ```typescript
 * // Node A
 * const mapA = createLWWMap<string, string>('node-a');
 * const op1 = mapA.set('title', 'Hello');
 * broadcast(op1);
 *
 * // Node B receives and applies
 * const mapB = createLWWMap<string, string>('node-b');
 * mapB.applyRemoteSet('title', op1.value, op1.timestamp);
 *
 * // Both maps converge to the same state
 * ```
 *
 * @example Conflict resolution
 * ```typescript
 * // Two nodes update the same key concurrently
 * const mapA = createLWWMap<string, number>('node-a');
 * const mapB = createLWWMap<string, number>('node-b');
 *
 * // Concurrent updates
 * mapA.set('score', 100);
 * mapB.set('score', 200);
 *
 * // After merge, the later timestamp (or higher nodeId) wins
 * const result = mapA.merge(mapB.getState());
 * ```
 *
 * @see {@link createLWWMap} - Factory function for creating LWW-Maps
 * @see {@link LWWMapState} - Serialized state format
 */
export class LWWMap<K = string, V = unknown> {
  private entries: Map<string, LWWMapEntry<V>>;
  private readonly clock: LamportClock;

  /**
   * Create a new LWW-Map.
   *
   * @param nodeId - Unique identifier for this node/replica
   */
  constructor(nodeId: NodeId) {
    this.clock = new LamportClock(nodeId);
    this.entries = new Map();
  }

  /**
   * Serialize a key to string for internal storage.
   * @internal
   */
  private serializeKey(key: K): string {
    return typeof key === 'string' ? key : JSON.stringify(key);
  }

  /**
   * Get a value by key.
   *
   * @param key - The key to look up
   * @returns The value if found and not deleted, undefined otherwise
   *
   * @example
   * ```typescript
   * const map = createLWWMap<string, User>('node-1');
   * map.set('user1', { name: 'Alice' });
   *
   * const user = map.get('user1');
   * console.log(user?.name); // 'Alice'
   *
   * console.log(map.get('nonexistent')); // undefined
   * ```
   */
  get(key: K): V | undefined {
    const serialized = this.serializeKey(key);
    const entry = this.entries.get(serialized);

    if (!entry || entry.tombstone) {
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a value for a key (local operation).
   *
   * Creates or updates the entry with a new Lamport timestamp.
   * Returns the operation details for broadcasting to other nodes.
   *
   * @param key - The key to set
   * @param value - The value to store
   * @returns Operation details including key, value, and timestamp for replication
   *
   * @example
   * ```typescript
   * const map = createLWWMap<string, number>('node-1');
   *
   * // Set a value and broadcast the operation
   * const op = map.set('score', 100);
   * broadcastToOtherNodes({ type: 'set', ...op });
   * ```
   */
  set(key: K, value: V): { key: K; value: V; timestamp: LamportTimestamp } {
    const serialized = this.serializeKey(key);
    const timestamp = this.clock.tick();

    this.entries.set(serialized, {
      value,
      timestamp,
      tombstone: false,
    });

    return { key, value, timestamp };
  }

  /**
   * Delete a key (local operation).
   *
   * Marks the entry as a tombstone rather than removing it,
   * preserving causal ordering during merges.
   *
   * @param key - The key to delete
   * @returns Operation details for replication, or null if key doesn't exist
   *
   * @example
   * ```typescript
   * const map = createLWWMap<string, number>('node-1');
   * map.set('temp', 42);
   *
   * const op = map.delete('temp');
   * if (op) {
   *   broadcastToOtherNodes({ type: 'delete', ...op });
   * }
   *
   * console.log(map.has('temp')); // false
   * ```
   */
  delete(key: K): { key: K; timestamp: LamportTimestamp } | null {
    const serialized = this.serializeKey(key);
    const existing = this.entries.get(serialized);

    if (!existing || existing.tombstone) {
      return null;
    }

    const timestamp = this.clock.tick();

    this.entries.set(serialized, {
      value: existing.value,
      timestamp,
      tombstone: true,
    });

    return { key, timestamp };
  }

  /**
   * Check if a key exists and is not deleted.
   *
   * @param key - The key to check
   * @returns True if the key exists and is not tombstoned
   */
  has(key: K): boolean {
    const serialized = this.serializeKey(key);
    const entry = this.entries.get(serialized);
    return entry !== undefined && !entry.tombstone;
  }

  /**
   * Get all non-deleted keys.
   *
   * @returns Array of keys that are not tombstoned
   *
   * @example
   * ```typescript
   * const map = createLWWMap<string, number>('node-1');
   * map.set('a', 1);
   * map.set('b', 2);
   * map.delete('a');
   *
   * console.log(map.keys()); // ['b']
   * ```
   */
  keys(): K[] {
    const result: K[] = [];
    for (const [serialized, entry] of this.entries) {
      if (!entry.tombstone) {
        try {
          result.push(JSON.parse(serialized) as K);
        } catch {
          result.push(serialized as unknown as K);
        }
      }
    }
    return result;
  }

  /**
   * Get all non-deleted values.
   *
   * @returns Array of values for non-tombstoned entries
   */
  values(): V[] {
    const result: V[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.tombstone) {
        result.push(entry.value);
      }
    }
    return result;
  }

  /**
   * Get all non-deleted entries as key-value pairs.
   *
   * Named `entries2` to avoid conflict with the internal `entries` property.
   *
   * @returns Array of [key, value] tuples for non-tombstoned entries
   *
   * @example
   * ```typescript
   * const map = createLWWMap<string, number>('node-1');
   * map.set('x', 10);
   * map.set('y', 20);
   *
   * for (const [key, value] of map.entries2()) {
   *   console.log(`${key}: ${value}`);
   * }
   * ```
   */
  entries2(): [K, V][] {
    const result: [K, V][] = [];
    for (const [serialized, entry] of this.entries) {
      if (!entry.tombstone) {
        try {
          result.push([JSON.parse(serialized) as K, entry.value]);
        } catch {
          result.push([serialized as unknown as K, entry.value]);
        }
      }
    }
    return result;
  }

  /**
   * Get the number of non-deleted entries.
   *
   * @returns Count of entries that are not tombstoned
   */
  get size(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (!entry.tombstone) {
        count++;
      }
    }
    return count;
  }

  /**
   * Apply a remote set operation from another node.
   *
   * Updates the entry only if the remote timestamp is greater than
   * the existing timestamp (LWW semantics).
   *
   * @param key - The key being set
   * @param value - The value to set
   * @param timestamp - The Lamport timestamp of the remote operation
   * @returns True if the operation was applied, false if it was older
   *
   * @example
   * ```typescript
   * // Receive operation from network
   * socket.on('set', (op) => {
   *   const applied = map.applyRemoteSet(op.key, op.value, op.timestamp);
   *   if (applied) {
   *     updateUI();
   *   }
   * });
   * ```
   */
  applyRemoteSet(key: K, value: V, timestamp: LamportTimestamp): boolean {
    this.clock.receive(timestamp);
    const serialized = this.serializeKey(key);
    const existing = this.entries.get(serialized);

    if (!existing || compareLamportTimestamps(timestamp, existing.timestamp) > 0) {
      this.entries.set(serialized, {
        value,
        timestamp,
        tombstone: false,
      });
      return true;
    }

    return false;
  }

  /**
   * Apply a remote delete operation from another node.
   *
   * Marks the entry as tombstoned only if the remote timestamp
   * is greater than the existing timestamp.
   *
   * @param key - The key being deleted
   * @param timestamp - The Lamport timestamp of the remote operation
   * @returns True if the operation was applied, false if it was older
   */
  applyRemoteDelete(key: K, timestamp: LamportTimestamp): boolean {
    this.clock.receive(timestamp);
    const serialized = this.serializeKey(key);
    const existing = this.entries.get(serialized);

    if (!existing || compareLamportTimestamps(timestamp, existing.timestamp) > 0) {
      this.entries.set(serialized, {
        value: existing?.value as V,
        timestamp,
        tombstone: true,
      });
      return true;
    }

    return false;
  }

  /**
   * Merge with another LWW-Map state.
   *
   * Combines entries using LWW semantics: for each key, the entry
   * with the greater timestamp wins.
   *
   * @param other - Serialized state from another LWW-Map
   * @returns Merge result with the combined map and conflict indicator
   *
   * @example
   * ```typescript
   * // Sync two maps after reconnection
   * const remoteState = await fetchRemoteState();
   * const result = localMap.merge(remoteState);
   *
   * if (result.hadConflict) {
   *   console.log('Concurrent edits were resolved');
   * }
   * ```
   */
  merge(other: LWWMapState<V>): MergeResult<Map<string, V>> {
    let hadConflict = false;

    for (const [key, otherEntry] of Object.entries(other.entries)) {
      const existing = this.entries.get(key);

      if (!existing) {
        this.entries.set(key, {
          value: otherEntry.value,
          timestamp: otherEntry.timestamp,
          tombstone: otherEntry.tombstone,
        });
      } else if (compareLamportTimestamps(otherEntry.timestamp, existing.timestamp) > 0) {
        this.entries.set(key, {
          value: otherEntry.value,
          timestamp: otherEntry.timestamp,
          tombstone: otherEntry.tombstone,
        });
      } else if (compareLamportTimestamps(otherEntry.timestamp, existing.timestamp) === 0) {
        hadConflict = true;
      }
    }

    const result = new Map<string, V>();
    for (const [key, entry] of this.entries) {
      if (!entry.tombstone) {
        result.set(key, entry.value);
      }
    }

    return {
      value: result,
      hadConflict,
    };
  }

  /**
   * Get the full state for serialization and network transfer.
   *
   * @returns Serializable state object containing all entries
   *
   * @example
   * ```typescript
   * const state = map.getState();
   * await saveToStorage(JSON.stringify(state));
   *
   * // Or send over network
   * socket.emit('sync', state);
   * ```
   */
  getState(): LWWMapState<V> {
    const entries: Record<string, { value: V; timestamp: LamportTimestamp; tombstone: boolean }> =
      {};

    for (const [key, entry] of this.entries) {
      entries[key] = {
        value: entry.value,
        timestamp: entry.timestamp,
        tombstone: entry.tombstone,
      };
    }

    return { entries };
  }

  /**
   * Convert to a plain JavaScript object.
   *
   * Returns only non-tombstoned entries.
   *
   * @returns Plain object with string keys and values
   *
   * @example
   * ```typescript
   * const map = createLWWMap<string, number>('node-1');
   * map.set('a', 1);
   * map.set('b', 2);
   *
   * console.log(map.toObject()); // { a: 1, b: 2 }
   * ```
   */
  toObject(): Record<string, V> {
    const result: Record<string, V> = {};
    for (const [key, entry] of this.entries) {
      if (!entry.tombstone) {
        result[key] = entry.value;
      }
    }
    return result;
  }

  /**
   * Clear all entries by tombstoning them.
   *
   * Marks all entries as deleted with a new timestamp,
   * which will propagate during merge operations.
   */
  clear(): void {
    const timestamp = this.clock.tick();
    for (const [key, entry] of this.entries) {
      if (!entry.tombstone) {
        this.entries.set(key, {
          value: entry.value,
          timestamp,
          tombstone: true,
        });
      }
    }
  }
}

/**
 * Serialized state format for LWW-Map persistence and network transfer.
 *
 * @typeParam V - Value type
 *
 * @example
 * ```typescript
 * const state: LWWMapState<number> = {
 *   entries: {
 *     'score': {
 *       value: 100,
 *       timestamp: { counter: 5, nodeId: 'node-1' },
 *       tombstone: false,
 *     },
 *   },
 * };
 * ```
 */
export interface LWWMapState<V = unknown> {
  /** Map of serialized keys to entry data */
  entries: Record<
    string,
    {
      /** The stored value */
      value: V;
      /** Lamport timestamp of the last write */
      timestamp: LamportTimestamp;
      /** Whether this entry has been deleted */
      tombstone: boolean;
    }
  >;
}

/**
 * Create a new Last-Writer-Wins Map.
 *
 * Factory function for creating LWW-Map instances with type-safe
 * key and value types.
 *
 * @typeParam K - Key type (default: string)
 * @typeParam V - Value type (default: unknown)
 * @param nodeId - Unique identifier for this node/replica
 * @returns A new LWW-Map instance
 *
 * @example
 * ```typescript
 * // String keys with typed values
 * const userScores = createLWWMap<string, number>('node-1');
 * userScores.set('alice', 100);
 * userScores.set('bob', 85);
 *
 * // Complex key types
 * const grid = createLWWMap<[number, number], string>('node-1');
 * grid.set([0, 0], 'X');
 * grid.set([1, 1], 'O');
 * ```
 *
 * @see {@link LWWMap} - The LWW-Map class
 */
export function createLWWMap<K = string, V = unknown>(nodeId: NodeId): LWWMap<K, V> {
  return new LWWMap<K, V>(nodeId);
}
