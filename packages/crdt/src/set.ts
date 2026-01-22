import type { MergeResult, NodeId } from './types.js';

/**
 * G-Set (Grow-only Set)
 * A set that only supports adding elements
 */
export class GSet<T = unknown> {
  private elements: Set<T>;

  constructor(initial?: Iterable<T>) {
    this.elements = new Set(initial);
  }

  /**
   * Add an element to the set
   */
  add(element: T): void {
    this.elements.add(element);
  }

  /**
   * Check if an element exists
   */
  has(element: T): boolean {
    return this.elements.has(element);
  }

  /**
   * Get all elements
   */
  values(): T[] {
    return Array.from(this.elements);
  }

  /**
   * Get the size of the set
   */
  get size(): number {
    return this.elements.size;
  }

  /**
   * Merge with another G-Set
   */
  merge(other: Iterable<T>): MergeResult<T[]> {
    for (const element of other) {
      this.elements.add(element);
    }

    return {
      value: this.values(),
      hadConflict: false,
    };
  }

  /**
   * Get state for serialization
   */
  getState(): T[] {
    return this.values();
  }

  /**
   * Iterate over elements
   */
  [Symbol.iterator](): Iterator<T> {
    return this.elements[Symbol.iterator]();
  }
}

/**
 * OR-Set (Observed-Remove Set)
 * A set that supports both add and remove operations
 */
export class ORSet<T = unknown> {
  private readonly nodeId: NodeId;
  private counter: number;
  // Map from serialized element to { value, tags (unique IDs for each add) }
  private elements: Map<string, { value: T; tags: Set<string> }>;
  // Set of all removed tags
  private tombstones: Set<string>;

  constructor(nodeId: NodeId) {
    this.nodeId = nodeId;
    this.counter = 0;
    this.elements = new Map();
    this.tombstones = new Set();
  }

  /**
   * Serialize an element for use as a map key
   */
  private serialize(element: T): string {
    return JSON.stringify(element);
  }

  /**
   * Generate a unique tag
   */
  private generateTag(): string {
    this.counter++;
    return `${this.nodeId}:${this.counter}`;
  }

  /**
   * Add an element to the set
   */
  add(element: T): { element: T; tag: string } {
    const key = this.serialize(element);
    const tag = this.generateTag();

    const existing = this.elements.get(key);
    if (existing) {
      existing.tags.add(tag);
    } else {
      this.elements.set(key, { value: element, tags: new Set([tag]) });
    }

    return { element, tag };
  }

  /**
   * Remove an element from the set
   */
  remove(element: T): string[] {
    const key = this.serialize(element);
    const existing = this.elements.get(key);

    if (!existing) {
      return [];
    }

    // Move all tags to tombstones
    const removedTags = Array.from(existing.tags);
    for (const tag of removedTags) {
      this.tombstones.add(tag);
    }

    this.elements.delete(key);
    return removedTags;
  }

  /**
   * Check if an element exists
   */
  has(element: T): boolean {
    const key = this.serialize(element);
    const existing = this.elements.get(key);
    return existing !== undefined && existing.tags.size > 0;
  }

  /**
   * Get all elements
   */
  values(): T[] {
    const result: T[] = [];
    for (const entry of this.elements.values()) {
      if (entry.tags.size > 0) {
        result.push(entry.value);
      }
    }
    return result;
  }

  /**
   * Get the size of the set
   */
  get size(): number {
    let count = 0;
    for (const entry of this.elements.values()) {
      if (entry.tags.size > 0) {
        count++;
      }
    }
    return count;
  }

  /**
   * Apply a remote add operation
   */
  applyRemoteAdd(element: T, tag: string): boolean {
    // Don't add if already tombstoned
    if (this.tombstones.has(tag)) {
      return false;
    }

    const key = this.serialize(element);
    const existing = this.elements.get(key);

    if (existing) {
      if (existing.tags.has(tag)) {
        return false; // Already have this tag
      }
      existing.tags.add(tag);
    } else {
      this.elements.set(key, { value: element, tags: new Set([tag]) });
    }

    return true;
  }

  /**
   * Apply a remote remove operation
   */
  applyRemoteRemove(element: T, tags: string[]): boolean {
    const key = this.serialize(element);
    const existing = this.elements.get(key);

    let changed = false;

    for (const tag of tags) {
      if (!this.tombstones.has(tag)) {
        this.tombstones.add(tag);
        changed = true;

        if (existing) {
          existing.tags.delete(tag);
        }
      }
    }

    // Clean up empty entries
    if (existing?.tags.size === 0) {
      this.elements.delete(key);
    }

    return changed;
  }

  /**
   * Merge with another OR-Set state
   */
  merge(other: ORSetState<T>): MergeResult<T[]> {
    // Merge tombstones
    for (const tag of other.tombstones) {
      this.tombstones.add(tag);
    }

    // Merge elements
    for (const [key, otherEntry] of Object.entries(other.elements)) {
      const existing = this.elements.get(key);

      if (existing) {
        // Merge tags, filtering out tombstoned ones
        for (const tag of otherEntry.tags) {
          if (!this.tombstones.has(tag)) {
            existing.tags.add(tag);
          }
        }
      } else {
        // Add new element with non-tombstoned tags
        const validTags = otherEntry.tags.filter((t) => !this.tombstones.has(t));
        if (validTags.length > 0) {
          this.elements.set(key, {
            value: otherEntry.value,
            tags: new Set(validTags),
          });
        }
      }
    }

    // Remove tombstoned tags from existing elements
    for (const [key, entry] of this.elements) {
      for (const tag of this.tombstones) {
        entry.tags.delete(tag);
      }
      if (entry.tags.size === 0) {
        this.elements.delete(key);
      }
    }

    return {
      value: this.values(),
      hadConflict: false,
    };
  }

  /**
   * Get state for serialization
   */
  getState(): ORSetState<T> {
    const elements: Record<string, { value: T; tags: string[] }> = {};

    for (const [key, entry] of this.elements) {
      if (entry.tags.size > 0) {
        elements[key] = {
          value: entry.value,
          tags: Array.from(entry.tags),
        };
      }
    }

    return {
      elements,
      tombstones: Array.from(this.tombstones),
    };
  }

  /**
   * Iterate over elements
   */
  [Symbol.iterator](): Iterator<T> {
    return this.values()[Symbol.iterator]();
  }
}

/**
 * OR-Set serialized state
 */
export interface ORSetState<T = unknown> {
  elements: Record<string, { value: T; tags: string[] }>;
  tombstones: string[];
}

/**
 * Create a G-Set
 */
export function createGSet<T>(initial?: Iterable<T>): GSet<T> {
  return new GSet<T>(initial);
}

/**
 * Create an OR-Set
 */
export function createORSet<T>(nodeId: NodeId): ORSet<T> {
  return new ORSet<T>(nodeId);
}
