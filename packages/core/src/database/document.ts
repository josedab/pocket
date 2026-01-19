import type { Document, DocumentUpdate, NewDocument, VectorClock } from '../types/document.js';
import { generateId, generateRevision, parseRevision } from '../types/document.js';

/**
 * Prepare a new document for insertion
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
 * Prepare a document update
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
 * Prepare a soft-deleted document
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
 * Merge two vector clocks
 */
export function mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock {
  const merged: VectorClock = { ...a };

  for (const [nodeId, timestamp] of Object.entries(b)) {
    merged[nodeId] = Math.max(merged[nodeId] ?? 0, timestamp);
  }

  return merged;
}

/**
 * Compare two vector clocks
 * Returns:
 *  -1 if a < b (a happened before b)
 *   1 if a > b (a happened after b)
 *   0 if concurrent (neither happened before the other)
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
 * Check if document a happened before document b
 */
export function happenedBefore<T extends Document>(a: T, b: T): boolean {
  if (!a._vclock || !b._vclock) {
    // Fall back to timestamp comparison
    return (a._updatedAt ?? 0) < (b._updatedAt ?? 0);
  }
  return compareVectorClocks(a._vclock, b._vclock) === -1;
}

/**
 * Check if two documents are concurrent (conflict)
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
 * Deep clone a document
 */
export function cloneDocument<T extends Document>(doc: T): T {
  return structuredClone(doc);
}

/**
 * Strip internal fields from document for comparison
 */
export function stripInternalFields<T extends Document>(
  doc: T
): Omit<T, '_rev' | '_updatedAt' | '_vclock'> {
  const { _rev, _updatedAt, _vclock, ...rest } = doc;
  return rest as Omit<T, '_rev' | '_updatedAt' | '_vclock'>;
}

/**
 * Check if two documents have the same content (ignoring metadata)
 */
export function documentsEqual<T extends Document>(a: T, b: T): boolean {
  const aStripped = stripInternalFields(a);
  const bStripped = stripInternalFields(b);
  return JSON.stringify(aStripped) === JSON.stringify(bStripped);
}
