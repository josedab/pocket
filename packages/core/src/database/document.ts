import type { Document, DocumentUpdate, NewDocument, VectorClock } from '../types/document.js';
import { generateId, generateRevision, parseRevision } from '../types/document.js';

/**
 * Prepare a new document for insertion into a collection.
 *
 * This function:
 * - Generates an `_id` if not provided
 * - Sets initial `_rev` (revision) to "1-<hash>"
 * - Sets `_updatedAt` timestamp
 * - Initializes vector clock if `nodeId` is provided (for sync)
 *
 * @typeParam T - The document type
 * @param doc - The new document data (without system fields)
 * @param nodeId - Optional node ID for vector clock initialization
 * @returns The complete document ready for storage
 *
 * @example
 * ```typescript
 * const prepared = prepareNewDocument({ name: 'Alice' }, 'node-1');
 * // Result:
 * // {
 * //   name: 'Alice',
 * //   _id: '550e8400-e29b-41d4-a716-446655440000',
 * //   _rev: '1-abc123',
 * //   _updatedAt: 1699123456789,
 * //   _vclock: { 'node-1': 1 }
 * // }
 * ```
 *
 * @see {@link Collection.insert}
 */
export function prepareNewDocument<T extends Document>(doc: NewDocument<T>, nodeId?: string): T {
  const now = Date.now();
  const id = doc._id ?? generateId();

  const prepared = {
    ...doc,
    _id: id,
    _rev: generateRevision(1),
    _updatedAt: now,
  } as T;

  // Initialize vector clock if nodeId provided
  if (nodeId) {
    (prepared as Document)._vclock = { [nodeId]: 1 };
  }

  return prepared;
}

/**
 * Prepare an updated version of an existing document.
 *
 * This function:
 * - Merges changes into the existing document
 * - Increments the revision sequence number
 * - Updates the `_updatedAt` timestamp
 * - Increments the vector clock entry for this node (if provided)
 *
 * The `_id` is preserved from the existing document regardless of what's
 * in `changes`.
 *
 * @typeParam T - The document type
 * @param existing - The current document state
 * @param changes - Fields to update
 * @param nodeId - Optional node ID for vector clock update
 * @returns The updated document ready for storage
 *
 * @example
 * ```typescript
 * const existing = { _id: '1', name: 'Alice', _rev: '1-abc', _updatedAt: 1000 };
 * const updated = prepareDocumentUpdate(existing, { name: 'Alice Smith' }, 'node-1');
 * // Result:
 * // {
 * //   _id: '1',
 * //   name: 'Alice Smith',
 * //   _rev: '2-xyz',
 * //   _updatedAt: 1699123456789,
 * //   _vclock: { 'node-1': 2 }
 * // }
 * ```
 *
 * @see {@link Collection.update}
 */
export function prepareDocumentUpdate<T extends Document>(
  existing: T,
  changes: DocumentUpdate<T>,
  nodeId?: string
): T {
  const now = Date.now();
  const { sequence } = parseRevision(existing._rev ?? '0-');

  const updated = {
    ...existing,
    ...changes,
    _id: existing._id,
    _rev: generateRevision(sequence + 1),
    _updatedAt: now,
  } as T;

  // Update vector clock
  if (nodeId && existing._vclock) {
    const vclock = { ...existing._vclock };
    vclock[nodeId] = (vclock[nodeId] ?? 0) + 1;
    (updated as Document)._vclock = vclock;
  }

  return updated;
}

/**
 * Prepare a soft-deleted version of a document.
 *
 * Soft deletion marks a document as deleted (`_deleted: true`) without
 * removing it from storage. This allows the deletion to sync to other
 * clients before eventual hard deletion during compaction.
 *
 * The soft-deleted document retains only:
 * - `_id`: Document identifier
 * - `_rev`: Incremented revision
 * - `_updatedAt`: Deletion timestamp
 * - `_deleted`: Set to `true`
 * - `_vclock`: Updated vector clock (if provided)
 *
 * All other fields are stripped to minimize storage.
 *
 * @typeParam T - The document type
 * @param existing - The document to soft-delete
 * @param nodeId - Optional node ID for vector clock update
 * @returns A tombstone document ready for storage
 *
 * @example
 * ```typescript
 * const existing = { _id: '1', name: 'Alice', _rev: '2-abc', ... };
 * const deleted = prepareSoftDelete(existing, 'node-1');
 * // Result:
 * // {
 * //   _id: '1',
 * //   _rev: '3-xyz',
 * //   _updatedAt: 1699123456789,
 * //   _deleted: true,
 * //   _vclock: { 'node-1': 3 }
 * // }
 * ```
 *
 * @see {@link Collection.delete}
 */
export function prepareSoftDelete<T extends Document>(existing: T, nodeId?: string): T {
  const now = Date.now();
  const { sequence } = parseRevision(existing._rev ?? '0-');

  const deleted = {
    _id: existing._id,
    _rev: generateRevision(sequence + 1),
    _updatedAt: now,
    _deleted: true,
  } as T;

  // Update vector clock
  if (nodeId && existing._vclock) {
    const vclock = { ...existing._vclock };
    vclock[nodeId] = (vclock[nodeId] ?? 0) + 1;
    deleted._vclock = vclock;
  }

  return deleted;
}

/**
 * Merge two vector clocks by taking the maximum value for each node.
 *
 * Vector clocks are merged when resolving conflicts or synchronizing
 * document versions. The merged clock represents a state that has
 * "seen" all events from both input clocks.
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns Merged vector clock with max value for each node
 *
 * @example
 * ```typescript
 * const a = { 'node-1': 3, 'node-2': 1 };
 * const b = { 'node-1': 2, 'node-3': 2 };
 * const merged = mergeVectorClocks(a, b);
 * // Result: { 'node-1': 3, 'node-2': 1, 'node-3': 2 }
 * ```
 */
export function mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock {
  const merged: VectorClock = { ...a };

  for (const [nodeId, timestamp] of Object.entries(b)) {
    merged[nodeId] = Math.max(merged[nodeId] ?? 0, timestamp);
  }

  return merged;
}

/**
 * Compare two vector clocks to determine causal ordering.
 *
 * Vector clocks enable detecting the causal relationship between
 * events in a distributed system:
 *
 * - **a < b**: `a` happened before `b` (all entries in `a` <= `b`, at least one <)
 * - **a > b**: `a` happened after `b` (all entries in `a` >= `b`, at least one >)
 * - **concurrent**: Neither happened before the other (conflict!)
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns -1 if a < b, 1 if a > b, 0 if concurrent
 *
 * @example
 * ```typescript
 * const a = { 'node-1': 2, 'node-2': 1 };
 * const b = { 'node-1': 3, 'node-2': 1 };
 *
 * compareVectorClocks(a, b);  // -1 (a happened before b)
 * compareVectorClocks(b, a);  // 1 (b happened after a)
 *
 * const c = { 'node-1': 2, 'node-2': 2 };
 * compareVectorClocks(a, c);  // 0 (concurrent - conflict!)
 * ```
 *
 * @see {@link areConcurrent}
 * @see {@link happenedBefore}
 */
export function compareVectorClocks(a: VectorClock, b: VectorClock): -1 | 0 | 1 {
  let aGreater = false;
  let bGreater = false;

  const allNodes = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const nodeId of allNodes) {
    const aVal = a[nodeId] ?? 0;
    const bVal = b[nodeId] ?? 0;

    if (aVal > bVal) aGreater = true;
    if (bVal > aVal) bGreater = true;
  }

  if (aGreater && !bGreater) return 1;
  if (bGreater && !aGreater) return -1;
  return 0; // Concurrent
}

/**
 * Check if document `a` causally happened before document `b`.
 *
 * Uses vector clocks if available, falls back to timestamp comparison
 * if vector clocks are not present.
 *
 * @typeParam T - The document type
 * @param a - First document
 * @param b - Second document
 * @returns `true` if `a` happened before `b`
 *
 * @example
 * ```typescript
 * if (happenedBefore(localDoc, remoteDoc)) {
 *   // Remote is newer, safe to overwrite local
 *   applyRemote(remoteDoc);
 * }
 * ```
 *
 * @see {@link compareVectorClocks}
 */
export function happenedBefore<T extends Document>(a: T, b: T): boolean {
  if (!a._vclock || !b._vclock) {
    // Fall back to timestamp comparison
    return (a._updatedAt ?? 0) < (b._updatedAt ?? 0);
  }
  return compareVectorClocks(a._vclock, b._vclock) === -1;
}

/**
 * Check if two documents are concurrent (represent a conflict).
 *
 * Concurrent documents have diverged from a common ancestor and
 * neither has "seen" the other's changes. This indicates a conflict
 * that needs resolution.
 *
 * Uses vector clocks if available. Without vector clocks, falls back
 * to checking if revisions have the same sequence number but different
 * hashes (indicating concurrent edits).
 *
 * @typeParam T - The document type
 * @param a - First document
 * @param b - Second document
 * @returns `true` if the documents are concurrent (conflict)
 *
 * @example
 * ```typescript
 * if (areConcurrent(localDoc, remoteDoc)) {
 *   // Conflict! Need to resolve
 *   const resolved = conflictResolver.resolve(localDoc, remoteDoc);
 *   await collection.update(resolved);
 * }
 * ```
 *
 * @see {@link compareVectorClocks}
 */
export function areConcurrent<T extends Document>(a: T, b: T): boolean {
  if (!a._vclock || !b._vclock) {
    // Without vector clocks, compare revisions
    const aSeq = parseRevision(a._rev ?? '0-').sequence;
    const bSeq = parseRevision(b._rev ?? '0-').sequence;
    return aSeq === bSeq && a._rev !== b._rev;
  }
  return compareVectorClocks(a._vclock, b._vclock) === 0;
}

/**
 * Create a deep clone of a document.
 *
 * Uses the native `structuredClone` API for efficient deep copying
 * that handles nested objects, arrays, and special types like Date.
 *
 * @typeParam T - The document type
 * @param doc - The document to clone
 * @returns A new document with the same content
 *
 * @example
 * ```typescript
 * const original = { _id: '1', data: { nested: true } };
 * const cloned = cloneDocument(original);
 *
 * cloned.data.nested = false;
 * console.log(original.data.nested); // still true
 * ```
 */
export function cloneDocument<T extends Document>(doc: T): T {
  return structuredClone(doc);
}

/**
 * Strip internal/system fields from a document for content comparison.
 *
 * Removes fields that are managed by Pocket:
 * - `_rev`: Revision string
 * - `_updatedAt`: Update timestamp
 * - `_vclock`: Vector clock
 *
 * Note: `_id` and `_deleted` are preserved as they are semantic.
 *
 * @typeParam T - The document type
 * @param doc - The document to strip
 * @returns Document without internal metadata fields
 *
 * @example
 * ```typescript
 * const doc = { _id: '1', name: 'Alice', _rev: '2-abc', _updatedAt: 1234 };
 * const stripped = stripInternalFields(doc);
 * // Result: { _id: '1', name: 'Alice' }
 * ```
 */
export function stripInternalFields<T extends Document>(
  doc: T
): Omit<T, '_rev' | '_updatedAt' | '_vclock'> {
  const { _rev, _updatedAt, _vclock, ...rest } = doc;
  return rest;
}

/**
 * Check if two documents have equivalent content (ignoring metadata).
 *
 * Compares documents after stripping internal fields (`_rev`, `_updatedAt`,
 * `_vclock`). Useful for determining if a sync update actually changed
 * the document's semantic content.
 *
 * @typeParam T - The document type
 * @param a - First document
 * @param b - Second document
 * @returns `true` if documents have the same content
 *
 * @example
 * ```typescript
 * const doc1 = { _id: '1', name: 'Alice', _rev: '1-abc' };
 * const doc2 = { _id: '1', name: 'Alice', _rev: '2-xyz' };
 *
 * documentsEqual(doc1, doc2); // true (same content, different revision)
 *
 * const doc3 = { _id: '1', name: 'Alice Smith', _rev: '1-abc' };
 * documentsEqual(doc1, doc3); // false (different name)
 * ```
 */
export function documentsEqual<T extends Document>(a: T, b: T): boolean {
  const aStripped = stripInternalFields(a);
  const bStripped = stripInternalFields(b);
  return JSON.stringify(aStripped) === JSON.stringify(bStripped);
}
