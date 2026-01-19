import { compareValues, getNestedValue, matchesFilter } from '../query/operators.js';
import type { ChangeEvent, Document } from '../types/document.js';
import type { QuerySpec, SortSpec } from '../types/query.js';

/**
 * EventReduce algorithm for efficient live query updates
 *
 * Instead of re-executing the entire query on every change,
 * this algorithm determines the minimal update needed based
 * on the change event and current results.
 */
export type EventReduceAction<T extends Document> =
  | { type: 'no-change' }
  | { type: 're-execute' }
  | { type: 'insert-at'; index: number; document: T }
  | { type: 'remove-at'; index: number }
  | { type: 'update-at'; index: number; document: T }
  | { type: 'move'; fromIndex: number; toIndex: number; document: T };

/**
 * Determine the action to apply to a result set based on a change event
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
 * Handle insert operation
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
 * Handle update operation
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
 * Handle delete operation
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
 * Find the position to insert a document while maintaining sort order
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
 * Compare two documents using sort specification
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
 * Check if any sort field changed between old and new document
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
 * Apply an action to a result set
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
