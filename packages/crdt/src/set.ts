import type { MergeResult, NodeId } from './types.js';

/**
 * Grow-only Set (G-Set) for distributed set operations.
 *
 * A CRDT set that only supports adding elements. Once an element
 * is added, it cannot be removed. Merging is done via set union,
 * which is naturally conflict-free.
 *
 * Key properties:
 * - Elements can only be added, never removed
 * - Conflict-free via set union
 * - Eventually consistent across all replicas
 *
 * Use cases:
 * - Tracking items that should never be removed (audit logs)
 * - User IDs that have accessed a resource
 * - Tags that have been applied
 *
 * @typeParam T - Element type
 *
 * @example Basic usage
 * ```typescript
 * const tags = createGSet<string>();
 *
 * tags.add('important');
 * tags.add('urgent');
 *
 * console.log(tags.has('important')); // true
 * console.log(tags.values()); // ['important', 'urgent']
 * ```
 *
 * @example Distributed merging
 * ```typescript
 * const setA = createGSet<string>(['a', 'b']);
 * const setB = createGSet<string>(['b', 'c']);
 *
 * setA.merge(setB.getState());
 * // setA now contains ['a', 'b', 'c']
 * ```
 *
 * @see {@link createGSet} - Factory function
 * @see {@link ORSet} - Set with remove support
 */
export class GSet<T = unknown> {
  private elements: Set<T>;

  /**
   * Create a new G-Set.
   *
   * @param initial - Optional initial elements
   */
  constructor(initial?: Iterable<T>) {
    this.elements = new Set(initial);
  }

  /**
   * Add an element to the set.
   *
   * @param element - Element to add
   */
  add(element: T): void {
    this.elements.add(element);
  }

  /**
   * Check if an element exists in the set.
   *
   * @param element - Element to check
   * @returns True if element is in the set
   */
  has(element: T): boolean {
    return this.elements.has(element);
  }

  /**
   * Get all elements as an array.
   *
   * @returns Array of all elements
   */
  values(): T[] {
    return Array.from(this.elements);
  }

  /**
   * Get the number of elements in the set.
   */
  get size(): number {
    return this.elements.size;
  }

  /**
   * Merge with another G-Set's elements.
   *
   * Performs set union with the other elements.
   *
   * @param other - Elements from another G-Set
   * @returns Merge result (never has conflicts for G-Set)
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
   * Get state for serialization.
   *
   * @returns Array of all elements
   */
  getState(): T[] {
    return this.values();
  }

  /**
   * Iterate over elements.
   */
  [Symbol.iterator](): Iterator<T> {
    return this.elements[Symbol.iterator]();
  }
}

/**
 * Observed-Remove Set (OR-Set) for distributed set operations.
 *
 * A CRDT set that supports both add and remove operations using
 * unique tags for each add operation. When removing, only the
 * currently observed tags are removed, allowing concurrent adds
 * of the same element to survive.
 *
 * Key properties:
 * - Supports add and remove operations
 * - Add-wins semantics (concurrent add and remove = element exists)
 * - Conflict-free merging
 *
 * Use cases:
 * - Shopping cart items
 * - User presence/membership
 * - Any set where items can be added and removed
 *
 * @typeParam T - Element type (must be JSON-serializable)
 *
 * @example Basic usage
 * ```typescript
 * const cart = createORSet<string>('user-1');
 *
 * cart.add('apple');
 * cart.add('banana');
 * cart.remove('apple');
 *
 * console.log(cart.values()); // ['banana']
 * ```
 *
 * @example Concurrent operations
 * ```typescript
 * // Node A removes item
 * const cartA = createORSet<string>('node-a');
 * cartA.add('item');
 * const removedTags = cartA.remove('item');
 *
 * // Node B concurrently adds same item (different tag)
 * const cartB = createORSet<string>('node-b');
 * cartB.add('item');
 *
 * // After merge, item exists (add wins)
 * cartA.merge(cartB.getState());
 * // cartA.has('item') === true
 * ```
 *
 * @see {@link createORSet} - Factory function
 * @see {@link GSet} - Simpler grow-only set
 */
export class ORSet<T = unknown> {
  private readonly nodeId: NodeId;
  private counter: number;
  /** Map from serialized element to { value, tags (unique IDs for each add) } */
  private elements: Map<string, { value: T; tags: Set<string> }>;
  /** Set of all removed tags */
  private tombstones: Set<string>;

  /**
   * Create a new OR-Set.
   *
   * @param nodeId - Unique identifier for this node
   */
  constructor(nodeId: NodeId) {
    this.nodeId = nodeId;
    this.counter = 0;
    this.elements = new Map();
    this.tombstones = new Set();
  }

  /**
   * Serialize an element for use as a map key.
   * @internal
   */
  private serialize(element: T): string {
    return JSON.stringify(element);
  }

  /**
   * Generate a unique tag for an add operation.
   * @internal
   */
  private generateTag(): string {
    this.counter++;
    return `${this.nodeId}:${this.counter}`;
  }

  /**
   * Add an element to the set (local operation).
   *
   * Creates a new unique tag for this add operation.
   *
   * @param element - Element to add
   * @returns Operation details for replication (element and tag)
   *
   * @example
   * ```typescript
   * const op = set.add('item');
   * broadcastToOthers({ type: 'add', element: op.element, tag: op.tag });
   * ```
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
   * Remove an element from the set (local operation).
   *
   * Removes all currently observed tags for this element.
   * Returns the removed tags for replication.
   *
   * @param element - Element to remove
   * @returns Array of removed tags for replication
   *
   * @example
   * ```typescript
   * const tags = set.remove('item');
   * if (tags.length > 0) {
   *   broadcastToOthers({ type: 'remove', element: 'item', tags });
   * }
   * ```
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
   * Check if an element exists in the set.
   *
   * @param element - Element to check
   * @returns True if element has any non-tombstoned tags
   */
  has(element: T): boolean {
    const key = this.serialize(element);
    const existing = this.elements.get(key);
    return existing !== undefined && existing.tags.size > 0;
  }

  /**
   * Get all elements currently in the set.
   *
   * @returns Array of elements with at least one active tag
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
   * Get the number of elements in the set.
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
   * Apply a remote add operation from another node.
   *
   * @param element - Element being added
   * @param tag - Unique tag for this add operation
   * @returns True if the operation changed the set
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
   * Apply a remote remove operation from another node.
   *
   * @param element - Element being removed
   * @param tags - Tags being removed
   * @returns True if the operation changed the set
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
   * Merge with another OR-Set state.
   *
   * Combines elements and tombstones, with add-wins semantics.
   *
   * @param other - State from another OR-Set
   * @returns Merge result (never has conflicts for OR-Set)
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
   * Get the full state for serialization.
   *
   * @returns Serializable state with elements and tombstones
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
   * Iterate over elements.
   */
  [Symbol.iterator](): Iterator<T> {
    return this.values()[Symbol.iterator]();
  }
}

/**
 * Serialized state format for OR-Set persistence and network transfer.
 *
 * @typeParam T - Element type
 */
export interface ORSetState<T = unknown> {
  /** Map of serialized elements to their values and active tags */
  elements: Record<string, { value: T; tags: string[] }>;
  /** All tombstoned (removed) tags */
  tombstones: string[];
}

/**
 * Create a new Grow-only Set.
 *
 * @typeParam T - Element type
 * @param initial - Optional initial elements
 * @returns A new GSet instance
 *
 * @example
 * ```typescript
 * const visited = createGSet<string>();
 * visited.add('page-1');
 * visited.add('page-2');
 * ```
 *
 * @see {@link GSet}
 */
export function createGSet<T>(initial?: Iterable<T>): GSet<T> {
  return new GSet<T>(initial);
}

/**
 * Create a new Observed-Remove Set.
 *
 * @typeParam T - Element type (must be JSON-serializable)
 * @param nodeId - Unique identifier for this node
 * @returns A new ORSet instance
 *
 * @example
 * ```typescript
 * const cart = createORSet<string>('user-session-123');
 * cart.add('product-a');
 * cart.add('product-b');
 * cart.remove('product-a');
 * ```
 *
 * @see {@link ORSet}
 */
export function createORSet<T>(nodeId: NodeId): ORSet<T> {
  return new ORSet<T>(nodeId);
}
