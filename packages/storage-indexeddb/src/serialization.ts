import type { Document } from '@pocket/core';

/**
 * Serialize a document for storage in IndexedDB
 * IndexedDB supports most types natively, but we need special handling for some
 */
export function serializeDocument<T extends Document>(doc: T): T {
  // Deep clone to avoid mutating original
  const serialized = structuredClone(doc);

  // Convert any special types that IndexedDB might not handle
  return processForStorage(serialized) as T;
}

/**
 * Deserialize a document from IndexedDB storage
 */
export function deserializeDocument<T extends Document>(stored: T): T {
  // Deep clone to avoid issues with frozen objects from IndexedDB
  const doc = structuredClone(stored);

  // Convert any types back to their original form
  return processFromStorage(doc) as T;
}

/**
 * Process a value for storage
 */
function processForStorage(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle Date - IndexedDB supports Date natively, but keep for consistency
  if (value instanceof Date) {
    return value;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(processForStorage);
  }

  // Handle objects
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = processForStorage(val);
    }
    return result;
  }

  // Primitive values pass through
  return value;
}

/**
 * Process a value from storage
 */
function processFromStorage(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // Date should already be Date from IndexedDB
  if (value instanceof Date) {
    return value;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(processFromStorage);
  }

  // Handle objects
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = processFromStorage(val);
    }
    return result;
  }

  return value;
}

/**
 * Create a key range for IndexedDB queries
 */
export function createKeyRange(condition: Record<string, unknown>): IDBKeyRange | undefined {
  const ops = condition as {
    $eq?: unknown;
    $gt?: unknown;
    $gte?: unknown;
    $lt?: unknown;
    $lte?: unknown;
  };

  // Exact match
  if ('$eq' in ops) {
    return IDBKeyRange.only(ops.$eq);
  }

  // Range queries
  const hasLower = '$gt' in ops || '$gte' in ops;
  const hasUpper = '$lt' in ops || '$lte' in ops;

  if (hasLower && hasUpper) {
    const lower = '$gt' in ops ? ops.$gt : ops.$gte;
    const upper = '$lt' in ops ? ops.$lt : ops.$lte;
    const lowerOpen = '$gt' in ops;
    const upperOpen = '$lt' in ops;
    return IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen);
  }

  if (hasLower) {
    const lower = '$gt' in ops ? ops.$gt : ops.$gte;
    const lowerOpen = '$gt' in ops;
    return IDBKeyRange.lowerBound(lower, lowerOpen);
  }

  if (hasUpper) {
    const upper = '$lt' in ops ? ops.$lt : ops.$lte;
    const upperOpen = '$lt' in ops;
    return IDBKeyRange.upperBound(upper, upperOpen);
  }

  return undefined;
}
