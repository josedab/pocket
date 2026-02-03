/**
 * Materialized view implementation for Pocket.
 *
 * A MaterializedView maintains a persistent, incrementally-updated result set
 * for a given view definition. When documents change, the view applies O(delta)
 * updates instead of re-executing the full query, providing significantly
 * better performance for frequently-accessed query results.
 *
 * @module materialized-view
 */

import { BehaviorSubject, type Observable, Subject, shareReplay, takeUntil } from 'rxjs';
import type { ChangeEvent, Document } from '@pocket/core';
import { evaluateFilter, getNestedValue } from './filter-evaluator.js';
import type { ViewDefinition, ViewDelta, ViewState, ViewStats } from './types.js';

/**
 * A single materialized view that maintains an incrementally-updated result set.
 *
 * @typeParam T - The document type, must extend {@link Document}
 *
 * @example
 * ```typescript
 * const view = new MaterializedView({
 *   name: 'active-users',
 *   collection: 'users',
 *   filter: { status: 'active' },
 *   sort: { name: 'asc' },
 *   limit: 100,
 * });
 *
 * // Initialize from existing documents
 * view.initialize(allUsers);
 *
 * // Incrementally update when a document changes
 * const delta = view.applyChange(changeEvent);
 * // delta.added, delta.removed, delta.modified
 * ```
 */
export class MaterializedView<T extends Document = Document> {
  private state: ViewState<T>;
  private readonly definition: ViewDefinition<T>;
  private readonly subject: BehaviorSubject<T[]>;
  private readonly destroy$ = new Subject<void>();
  private updateTimes: number[] = [];
  private disposed = false;

  constructor(definition: ViewDefinition<T>) {
    this.definition = definition;
    this.subject = new BehaviorSubject<T[]>([]);
    this.state = {
      name: definition.name,
      collection: definition.collection,
      results: [],
      resultIds: new Set(),
      lastSequence: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      hitCount: 0,
    };
  }

  /**
   * Gets the view definition.
   */
  getDefinition(): ViewDefinition<T> {
    return this.definition;
  }

  /**
   * Initializes the view from a full collection scan.
   *
   * Filters, sorts, and limits the provided documents to build the initial
   * result set. This should be called once when the view is first created
   * or when a full rebuild is needed.
   *
   * @param docs - All documents from the source collection
   */
  initialize(docs: T[]): void {
    // Filter documents
    let filtered = docs.filter((doc) =>
      evaluateFilter(doc as unknown as Record<string, unknown>, this.definition.filter)
    );

    // Sort documents
    if (this.definition.sort) {
      filtered = this.sortDocuments(filtered);
    }

    // Apply limit
    if (this.definition.limit !== undefined && this.definition.limit > 0) {
      filtered = filtered.slice(0, this.definition.limit);
    }

    // Apply projection
    if (this.definition.projection) {
      filtered = filtered.map((doc) => this.applyProjection(doc));
    }

    // Build result ID set
    const resultIds = new Set<string>();
    for (const doc of filtered) {
      resultIds.add(doc._id);
    }

    this.state = {
      ...this.state,
      results: filtered,
      resultIds,
      updatedAt: Date.now(),
    };

    this.subject.next([...this.state.results]);
  }

  /**
   * Incrementally applies a single change event to the view.
   *
   * This is the core of the incremental maintenance algorithm:
   * - **insert**: If the new document matches the filter, insert it in sorted position
   * - **update**: Check if the document enters, leaves, or stays in the view
   * - **delete**: Remove the document from the view if present
   *
   * After applying the change, the limit constraint is re-enforced.
   *
   * @param change - The change event to process
   * @returns A ViewDelta describing what changed in the view
   */
  applyChange(change: ChangeEvent<T>): ViewDelta<T> {
    const startTime = performance.now();
    const delta: ViewDelta<T> = { added: [], removed: [], modified: [] };

    switch (change.operation) {
      case 'insert':
        this.handleInsert(change, delta);
        break;
      case 'update':
        this.handleUpdate(change, delta);
        break;
      case 'delete':
        this.handleDelete(change, delta);
        break;
    }

    // Update state metadata
    this.state.lastSequence = change.sequence;
    this.state.updatedAt = Date.now();

    // Track update timing
    const elapsed = performance.now() - startTime;
    this.updateTimes.push(elapsed);
    // Keep only last 100 timings for rolling average
    if (this.updateTimes.length > 100) {
      this.updateTimes = this.updateTimes.slice(-100);
    }

    // Emit updated results if there were changes
    if (delta.added.length > 0 || delta.removed.length > 0 || delta.modified.length > 0) {
      this.subject.next([...this.state.results]);
    }

    return delta;
  }

  /**
   * Returns the current materialized result set.
   *
   * Increments the hit counter for stats tracking.
   *
   * @returns A copy of the current results array
   */
  getResults(): T[] {
    this.state.hitCount++;
    return [...this.state.results];
  }

  /**
   * Returns the set of document IDs currently in the view.
   *
   * @returns A new Set containing the IDs
   */
  getResultIds(): Set<string> {
    return new Set(this.state.resultIds);
  }

  /**
   * Returns an Observable that emits the full result set on every update.
   *
   * New subscribers immediately receive the current results. The observable
   * completes when the view is disposed.
   *
   * @returns An RxJS Observable of the results array
   */
  toObservable(): Observable<T[]> {
    return this.subject.asObservable().pipe(
      takeUntil(this.destroy$),
      shareReplay(1)
    );
  }

  /**
   * Returns statistics about this view.
   *
   * @returns ViewStats with counts, timing, and usage information
   */
  getStats(): ViewStats {
    const avgUpdateTimeMs =
      this.updateTimes.length > 0
        ? this.updateTimes.reduce((sum, t) => sum + t, 0) / this.updateTimes.length
        : 0;

    return {
      name: this.state.name,
      resultCount: this.state.results.length,
      lastUpdated: this.state.updatedAt,
      hitCount: this.state.hitCount,
      avgUpdateTimeMs,
    };
  }

  /**
   * Returns the name of the source collection for this view.
   */
  getCollection(): string {
    return this.definition.collection;
  }

  /**
   * Returns the view name.
   */
  getName(): string {
    return this.definition.name;
  }

  /**
   * Releases all resources held by this view.
   *
   * After calling dispose, the observable completes and no further
   * updates can be applied.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.destroy$.next();
    this.destroy$.complete();
    this.subject.complete();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Handles an insert change event.
   */
  private handleInsert(change: ChangeEvent<T>, delta: ViewDelta<T>): void {
    const doc = change.document;
    if (!doc) return;

    const matches = evaluateFilter(
      doc as unknown as Record<string, unknown>,
      this.definition.filter
    );

    if (!matches) return;

    const projected = this.definition.projection ? this.applyProjection(doc) : doc;

    // Insert in sorted position
    this.insertSorted(projected);
    this.state.resultIds.add(projected._id);

    // Enforce limit: if we went over, remove the last document
    if (
      this.definition.limit !== undefined &&
      this.definition.limit > 0 &&
      this.state.results.length > this.definition.limit
    ) {
      const evicted = this.state.results.pop()!;
      this.state.resultIds.delete(evicted._id);

      // If the evicted doc is the one we just added, it's not really added
      if (evicted._id === projected._id) {
        return;
      }
      delta.removed.push(evicted);
    }

    delta.added.push(projected);
  }

  /**
   * Handles an update change event.
   *
   * Four cases:
   * 1. Was in view, still matches -> modified (may need repositioning)
   * 2. Was in view, no longer matches -> removed
   * 3. Was not in view, now matches -> added
   * 4. Was not in view, still doesn't match -> no change
   */
  private handleUpdate(change: ChangeEvent<T>, delta: ViewDelta<T>): void {
    const doc = change.document;
    if (!doc) return;

    const wasInView = this.state.resultIds.has(change.documentId);
    const nowMatches = evaluateFilter(
      doc as unknown as Record<string, unknown>,
      this.definition.filter
    );

    if (wasInView && nowMatches) {
      // Case 1: document stays in view, may need update
      const existingIndex = this.state.results.findIndex((d) => d._id === change.documentId);
      if (existingIndex === -1) return;

      const before = this.state.results[existingIndex]!;
      const after = this.definition.projection ? this.applyProjection(doc) : doc;

      // Remove old, reinsert new in correct sorted position
      this.state.results.splice(existingIndex, 1);
      this.insertSorted(after);

      // Enforce limit after reinsertion
      if (
        this.definition.limit !== undefined &&
        this.definition.limit > 0 &&
        this.state.results.length > this.definition.limit
      ) {
        const evicted = this.state.results.pop()!;
        this.state.resultIds.delete(evicted._id);
        if (evicted._id !== after._id) {
          delta.removed.push(evicted);
        } else {
          // The updated doc got evicted; treat as removal of the before version
          this.state.resultIds.delete(before._id);
          delta.removed.push(before);
          return;
        }
      }

      delta.modified.push({ before, after });
    } else if (wasInView && !nowMatches) {
      // Case 2: document leaves view
      const existingIndex = this.state.results.findIndex((d) => d._id === change.documentId);
      if (existingIndex === -1) return;

      const removed = this.state.results[existingIndex]!;
      this.state.results.splice(existingIndex, 1);
      this.state.resultIds.delete(change.documentId);
      delta.removed.push(removed);
    } else if (!wasInView && nowMatches) {
      // Case 3: document enters view
      const projected = this.definition.projection ? this.applyProjection(doc) : doc;

      this.insertSorted(projected);
      this.state.resultIds.add(projected._id);

      // Enforce limit
      if (
        this.definition.limit !== undefined &&
        this.definition.limit > 0 &&
        this.state.results.length > this.definition.limit
      ) {
        const evicted = this.state.results.pop()!;
        this.state.resultIds.delete(evicted._id);

        if (evicted._id === projected._id) {
          // The new doc did not make it into the view
          return;
        }
        delta.removed.push(evicted);
      }

      delta.added.push(projected);
    }
    // Case 4: not in view and doesn't match -> nothing to do
  }

  /**
   * Handles a delete change event.
   */
  private handleDelete(change: ChangeEvent<T>, delta: ViewDelta<T>): void {
    if (!this.state.resultIds.has(change.documentId)) return;

    const existingIndex = this.state.results.findIndex((d) => d._id === change.documentId);
    if (existingIndex === -1) return;

    const removed = this.state.results[existingIndex]!;
    this.state.results.splice(existingIndex, 1);
    this.state.resultIds.delete(change.documentId);
    delta.removed.push(removed);
  }

  /**
   * Inserts a document into the results array at the correct sorted position
   * using binary search for O(log n) insertion.
   *
   * If no sort is defined, appends to the end.
   */
  private insertSorted(doc: T): void {
    if (!this.definition.sort || Object.keys(this.definition.sort).length === 0) {
      this.state.results.push(doc);
      return;
    }

    const sortEntries = Object.entries(this.definition.sort);
    const results = this.state.results;

    let low = 0;
    let high = results.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      const midDoc = results[mid]!;
      const comparison = this.compareDocuments(doc, midDoc, sortEntries);

      if (comparison > 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    results.splice(low, 0, doc);
  }

  /**
   * Compares two documents according to the sort specification.
   *
   * @returns negative if a < b, positive if a > b, 0 if equal
   */
  private compareDocuments(
    a: T,
    b: T,
    sortEntries: [string, string][]
  ): number {
    for (const [field, direction] of sortEntries) {
      const aVal = getNestedValue(a, field);
      const bVal = getNestedValue(b, field);
      const cmp = compareValues(aVal, bVal, direction as 'asc' | 'desc');
      if (cmp !== 0) return cmp;
    }
    return 0;
  }

  /**
   * Sorts the full array of documents according to the sort specification.
   */
  private sortDocuments(docs: T[]): T[] {
    if (!this.definition.sort) return docs;

    const sortEntries = Object.entries(this.definition.sort);
    return [...docs].sort((a, b) => this.compareDocuments(a, b, sortEntries));
  }

  /**
   * Applies projection to a document, returning only included fields
   * or excluding specified fields.
   */
  private applyProjection(doc: T): T {
    const projection = this.definition.projection;
    if (!projection) return doc;

    const keys = Object.keys(projection);
    if (keys.length === 0) return doc;

    // Determine if this is an inclusion or exclusion projection
    const firstValue = projection[keys[0]!];
    const isInclusion = firstValue === 1;

    if (isInclusion) {
      // Include only specified fields (always include _id)
      const result: Record<string, unknown> = { _id: doc._id };
      for (const key of keys) {
        if (projection[key] === 1) {
          result[key] = getNestedValue(doc, key);
        }
      }
      return result as T;
    } else {
      // Exclude specified fields
      const result = { ...doc } as Record<string, unknown>;
      for (const key of keys) {
        if (projection[key] === 0) {
          delete result[key];
        }
      }
      return result as T;
    }
  }
}

/**
 * Compares two values for sorting with configurable direction.
 *
 * null/undefined values sort last regardless of direction.
 */
function compareValues(a: unknown, b: unknown, direction: 'asc' | 'desc' = 'asc'): number {
  const multiplier = direction === 'asc' ? 1 : -1;

  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;

  if (typeof a === 'number' && typeof b === 'number') {
    return (a - b) * multiplier;
  }

  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b) * multiplier;
  }

  if (a instanceof Date && b instanceof Date) {
    return (a.getTime() - b.getTime()) * multiplier;
  }

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return (a === b ? 0 : a ? 1 : -1) * multiplier;
  }

  return 0;
}
