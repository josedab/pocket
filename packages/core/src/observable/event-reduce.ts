/**
 * EventReduce algorithm for efficient live query updates.
 *
 * The EventReduce algorithm is a key performance optimization for reactive queries.
 * Instead of re-executing the entire query whenever data changes, it analyzes the
 * change event and determines the minimal update needed to keep results current.
 *
 * ## How It Works
 *
 * ```
 * Change Event (insert/update/delete)
 *         │
 *         ▼
 * ┌───────────────────┐
 * │   reduceEvent()   │  ← Analyzes change against current results
 * └─────────┬─────────┘
 *           │
 *           ▼
 * ┌───────────────────┐
 * │ EventReduceAction │  ← Minimal action: insert-at, remove-at, move, etc.
 * └─────────┬─────────┘
 *           │
 *           ▼
 * ┌───────────────────┐
 * │   applyAction()   │  ← Applies action to result array
 * └───────────────────┘
 * ```
 *
 * ## Performance Benefits
 *
 * - **O(log n)** for sorted inserts (binary search)
 * - **O(1)** for updates without sort field changes
 * - Avoids full query re-execution in most cases
 * - Only falls back to re-execute when necessary (e.g., limit boundary cases)
 *
 * ## When Re-execution is Required
 *
 * The algorithm returns `'re-execute'` action when:
 * - A document is deleted and results are at limit (need to pull in replacement)
 * - Complex edge cases that can't be handled incrementally
 *
 * @module observable/event-reduce
 * @see {@link LiveQuery} - Uses EventReduce for reactive updates
 * @see {@link reduceEvent} - Main entry point for the algorithm
 */

import { compareValues, getNestedValue, matchesFilter } from '../query/operators.js';
import type { ChangeEvent, Document } from '../types/document.js';
import type { QuerySpec, SortSpec } from '../types/query.js';

/**
 * Represents the action to apply to a result set after analyzing a change event.
 *
 * The action types from most efficient to least:
 * - `'no-change'` - Change doesn't affect results, do nothing
 * - `'update-at'` - Document updated in place (no reordering)
 * - `'insert-at'` - Insert new document at specific index
 * - `'remove-at'` - Remove document at specific index
 * - `'move'` - Document changed position due to sort field change
 * - `'re-execute'` - Must re-run the full query
 *
 * @typeParam T - The document type
 *
 * @example
 * ```typescript
 * // No change - document doesn't match query
 * { type: 'no-change' }
 *
 * // Insert at position 2
 * { type: 'insert-at', index: 2, document: newDoc }
 *
 * // Remove from position 5
 * { type: 'remove-at', index: 5 }
 *
 * // Update in place at position 3
 * { type: 'update-at', index: 3, document: updatedDoc }
 *
 * // Move from position 1 to position 4
 * { type: 'move', fromIndex: 1, toIndex: 4, document: movedDoc }
 *
 * // Full re-execution required
 * { type: 're-execute' }
 * ```
 */
export type EventReduceAction<T extends Document> =
  | { type: 'no-change' }
  | { type: 're-execute' }
  | { type: 'insert-at'; index: number; document: T }
  | { type: 'remove-at'; index: number }
  | { type: 'update-at'; index: number; document: T }
  | { type: 'move'; fromIndex: number; toIndex: number; document: T };

/**
 * Analyzes a change event and determines the minimal action to update cached results.
 *
 * This is the main entry point for the EventReduce algorithm. It examines:
 * 1. The type of change (insert, update, delete)
 * 2. Whether the document currently exists in results
 * 3. Whether the changed document matches the query filter
 * 4. Whether sort fields were affected (for updates)
 *
 * @typeParam T - The document type
 * @param event - The change event containing operation type and document data
 * @param currentResults - The current cached result set
 * @param spec - The query specification (filter, sort, limit, skip)
 * @returns An {@link EventReduceAction} describing the minimal update needed
 *
 * @example
 * ```typescript
 * // Handle a new todo being inserted
 * const action = reduceEvent(
 *   { operation: 'insert', documentId: '123', document: newTodo },
 *   currentTodos,
 *   { filter: { completed: false }, sort: [{ field: 'createdAt', direction: 'desc' }] }
 * );
 *
 * // Apply the action
 * if (action.type !== 're-execute') {
 *   const newResults = applyAction(currentTodos, action, spec);
 * } else {
 *   // Fall back to full query
 *   const newResults = await collection.find(spec).exec();
 * }
 * ```
 */
export function reduceEvent<T extends Document>(
  event: ChangeEvent<T>,
  currentResults: T[],
  spec: QuerySpec<T>
): EventReduceAction<T> {
  const { operation, documentId, document } = event;

  // Find current position in results
  const currentIndex = currentResults.findIndex((d) => d._id === documentId);
  const isInResults = currentIndex !== -1;

  // Check if new document matches filter
  const matchesQuery =
    document && !document._deleted
      ? spec.filter
        ? matchesFilter(document, spec.filter)
        : true
      : false;

  switch (operation) {
    case 'insert':
      return handleInsert(document, matchesQuery, currentResults, spec);

    case 'update':
      return handleUpdate(document, isInResults, currentIndex, matchesQuery, currentResults, spec);

    case 'delete':
      return handleDelete(isInResults, currentIndex, currentResults, spec);

    default:
      return { type: 're-execute' };
  }
}

/**
 * Handles an insert operation, determining where (if anywhere) to add the document.
 *
 * Logic:
 * 1. If document doesn't match query filter → `no-change`
 * 2. If at limit and document would sort after last result → `no-change`
 * 3. Otherwise, find sorted insert position → `insert-at`
 *
 * @internal
 */
function handleInsert<T extends Document>(
  document: T | null,
  matchesQuery: boolean,
  currentResults: T[],
  spec: QuerySpec<T>
): EventReduceAction<T> {
  if (!matchesQuery || !document) {
    return { type: 'no-change' };
  }

  // Check if we're at limit and new doc would be after all results
  if (spec.limit && currentResults.length >= spec.limit) {
    const lastDoc = currentResults[currentResults.length - 1];
    if (lastDoc && spec.sort) {
      const comparison = compareDocuments(document, lastDoc, spec.sort);
      if (comparison > 0) {
        // New doc would be after current last - no visible change
        return { type: 'no-change' };
      }
    }
  }

  // Find insertion position
  const insertIndex = findInsertPosition(document, currentResults, spec.sort);

  // If beyond limit, no visible change
  if (spec.limit && insertIndex >= spec.limit) {
    return { type: 'no-change' };
  }

  return { type: 'insert-at', index: insertIndex, document };
}

/**
 * Handles an update operation, determining the appropriate action.
 *
 * Cases:
 * 1. Was in results, no longer matches → `remove-at`
 * 2. Wasn't in results, now matches → delegate to `handleInsert`
 * 3. Still in results and matches:
 *    - No sort or sort fields unchanged → `update-at` (in place)
 *    - Sort fields changed → calculate new position → `move` or `update-at`
 *
 * @internal
 */
function handleUpdate<T extends Document>(
  document: T | null,
  isInResults: boolean,
  currentIndex: number,
  matchesQuery: boolean,
  currentResults: T[],
  spec: QuerySpec<T>
): EventReduceAction<T> {
  if (isInResults && !matchesQuery) {
    // Document no longer matches - remove it
    return { type: 'remove-at', index: currentIndex };
  }

  if (!isInResults && matchesQuery && document) {
    // Document now matches - insert it
    return handleInsert(document, matchesQuery, currentResults, spec);
  }

  if (isInResults && matchesQuery && document) {
    // Document still matches - check if position changed
    if (!spec.sort || spec.sort.length === 0) {
      // No sort, just update in place
      return { type: 'update-at', index: currentIndex, document };
    }

    // Check if sort fields changed
    const sortFieldsChanged = hasSortFieldChanged(
      document,
      currentResults[currentIndex]!,
      spec.sort
    );

    if (!sortFieldsChanged) {
      // Sort position unchanged, update in place
      return { type: 'update-at', index: currentIndex, document };
    }

    // Sort position may have changed - find new position
    const newIndex = findInsertPosition(document, currentResults, spec.sort, currentIndex);

    if (newIndex === currentIndex) {
      return { type: 'update-at', index: currentIndex, document };
    }

    return { type: 'move', fromIndex: currentIndex, toIndex: newIndex, document };
  }

  return { type: 'no-change' };
}

/**
 * Handles a delete operation.
 *
 * Cases:
 * 1. Document not in results → `no-change`
 * 2. At limit capacity → `re-execute` (need to pull in replacement document)
 * 3. Otherwise → `remove-at`
 *
 * The re-execute case is necessary because we can't know what document
 * would fill the vacated slot without running the full query.
 *
 * @internal
 */
function handleDelete<T extends Document>(
  isInResults: boolean,
  currentIndex: number,
  currentResults: T[],
  spec: QuerySpec<T>
): EventReduceAction<T> {
  if (!isInResults) {
    return { type: 'no-change' };
  }

  // If we have a limit and were at capacity, we need to re-execute
  // to potentially pull in a new document
  if (spec.limit && currentResults.length >= spec.limit) {
    return { type: 're-execute' };
  }

  return { type: 'remove-at', index: currentIndex };
}

/**
 * Finds the correct position to insert a document while maintaining sort order.
 *
 * Uses binary search for O(log n) performance. Handles the special case of
 * moving a document (where we need to skip its current position).
 *
 * @param document - The document to insert
 * @param results - The current sorted results
 * @param sort - The sort specification (if any)
 * @param skipIndex - Index to skip (used when moving a document)
 * @returns The index where the document should be inserted
 *
 * @internal
 */
function findInsertPosition<T extends Document>(
  document: T,
  results: T[],
  sort?: SortSpec<T>[],
  skipIndex?: number
): number {
  if (!sort || sort.length === 0) {
    return results.length;
  }

  // Binary search for insertion point
  let low = 0;
  let high = results.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);

    // Skip the document being moved
    if (mid === skipIndex) {
      low = mid + 1;
      continue;
    }

    const comparison = compareDocuments(document, results[mid]!, sort);

    if (comparison < 0) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  // Adjust for skipped index
  if (skipIndex !== undefined && low > skipIndex) {
    return low - 1;
  }

  return low;
}

/**
 * Compares two documents according to the sort specification.
 *
 * Iterates through sort fields in priority order, returning on first
 * non-zero comparison. Uses {@link compareValues} for type-aware comparison.
 *
 * @param a - First document
 * @param b - Second document
 * @param sort - Sort specification with fields and directions
 * @returns Negative if a < b, positive if a > b, zero if equal
 *
 * @internal
 */
function compareDocuments<T extends Document>(a: T, b: T, sort: SortSpec<T>[]): number {
  for (const { field, direction } of sort) {
    const aValue = getNestedValue(a, field);
    const bValue = getNestedValue(b, field);
    const comparison = compareValues(aValue, bValue, direction);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

/**
 * Checks if any sort-relevant field changed between document versions.
 *
 * This optimization allows updates to non-sort fields to be applied in-place
 * without recalculating position.
 *
 * @param newDoc - The updated document
 * @param oldDoc - The previous document version
 * @param sort - Sort specification listing fields that affect order
 * @returns `true` if any sort field value changed
 *
 * @internal
 */
function hasSortFieldChanged<T extends Document>(
  newDoc: T,
  oldDoc: T,
  sort: SortSpec<T>[]
): boolean {
  for (const { field } of sort) {
    const newValue = getNestedValue(newDoc, field);
    const oldValue = getNestedValue(oldDoc, field);
    if (newValue !== oldValue) return true;
  }
  return false;
}

/**
 * Applies an {@link EventReduceAction} to a result array, producing updated results.
 *
 * This function immutably updates the result array based on the action type:
 * - `'no-change'` → Returns the same array reference
 * - `'re-execute'` → Returns `null` (caller should re-run the query)
 * - `'insert-at'` → Creates new array with document inserted, respects limit
 * - `'remove-at'` → Creates new array with document removed
 * - `'update-at'` → Creates new array with document replaced in place
 * - `'move'` → Creates new array with document relocated
 *
 * @typeParam T - The document type
 * @param results - The current result array
 * @param action - The action to apply (from {@link reduceEvent})
 * @param spec - The query specification (needed for limit enforcement)
 * @returns Updated result array, or `null` if full re-execution is required
 *
 * @example
 * ```typescript
 * const action = reduceEvent(changeEvent, results, querySpec);
 * const newResults = applyAction(results, action, querySpec);
 *
 * if (newResults === null) {
 *   // Fall back to full query execution
 *   newResults = await collection.find(querySpec).exec();
 * }
 * ```
 */
export function applyAction<T extends Document>(
  results: T[],
  action: EventReduceAction<T>,
  spec: QuerySpec<T>
): T[] | null {
  switch (action.type) {
    case 'no-change':
      return results;

    case 're-execute':
      return null; // Caller should re-execute query

    case 'insert-at': {
      const newResults = [...results];
      newResults.splice(action.index, 0, action.document);
      // Trim to limit
      if (spec.limit && newResults.length > spec.limit) {
        return newResults.slice(0, spec.limit);
      }
      return newResults;
    }

    case 'remove-at': {
      const newResults = [...results];
      newResults.splice(action.index, 1);
      return newResults;
    }

    case 'update-at': {
      const newResults = [...results];
      newResults[action.index] = action.document;
      return newResults;
    }

    case 'move': {
      const newResults = [...results];
      // Remove from old position
      newResults.splice(action.fromIndex, 1);
      // Insert at new position (adjust if needed)
      const adjustedIndex = action.toIndex > action.fromIndex ? action.toIndex - 1 : action.toIndex;
      newResults.splice(adjustedIndex, 0, action.document);
      return newResults;
    }

    default:
      return null;
  }
}
