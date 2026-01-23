import { LamportClock, compareLamportTimestamps } from './clock.js';
import type { LamportTimestamp, MergeResult, NodeId } from './types.js';

/**
 * LWW-Map entry
 */
interface LWWMapEntry<V> {
  value: V;
  timestamp: LamportTimestamp;
  tombstone: boolean;
}

/**
 * LWW-Map (Last-Writer-Wins Map)
 * A map where each key has an LWW-Register semantic
 */
export class LWWMap<K = string, V = unknown> {
  private entries: Map<string, LWWMapEntry<V>>;
  private readonly clock: LamportClock;

  constructor(nodeId: NodeId) {
    this.clock = new LamportClock(nodeId);
    this.entries = new Map();
  }

  /**
   * Serialize a key
   */
  private serializeKey(key: K): string {
    return typeof key === 'string' ? key : JSON.stringify(key);
  }

  /**
   * Get a value by key
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
   * Set a value (local operation)
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
   * Delete a key (local operation)
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
   * Check if a key exists
   */
  has(key: K): boolean {
    const serialized = this.serializeKey(key);
    const entry = this.entries.get(serialized);
    return entry !== undefined && !entry.tombstone;
  }

  /**
   * Get all keys
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
   * Get all values
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
   * Get all entries
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
   * Get the size
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
   * Apply a remote set operation
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
   * Apply a remote delete operation
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
   * Merge with another LWW-Map state
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
   * Get state for serialization
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
   * Convert to a plain object
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
   * Clear all entries
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
 * LWW-Map serialized state
 */
export interface LWWMapState<V = unknown> {
  entries: Record<
    string,
    {
      value: V;
      timestamp: LamportTimestamp;
      tombstone: boolean;
    }
  >;
}

/**
 * Create an LWW-Map
 */
export function createLWWMap<K = string, V = unknown>(nodeId: NodeId): LWWMap<K, V> {
  return new LWWMap<K, V>(nodeId);
}
