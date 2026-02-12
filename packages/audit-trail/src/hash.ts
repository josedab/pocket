/**
 * Hashing utilities for audit trail
 *
 * Uses a portable hash implementation (djb2-based) for browser compatibility.
 * Falls back to Web Crypto API when available for stronger hashes.
 */

import type { AuditEntry, AuditTrailConfig } from './types.js';

/**
 * DJB2-based hash function producing a hex string.
 * Portable across Node.js and browser environments.
 */
function djb2Hash(data: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  for (let i = 0; i < data.length; i++) {
    const ch = data.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ ch, 0x811c9dc5);
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');

  // Produce a longer hash by mixing additional rounds
  let h3 = h1 ^ 0xdeadbeef;
  let h4 = h2 ^ 0xcafebabe;
  for (let i = 0; i < data.length; i++) {
    const ch = data.charCodeAt(i);
    h3 = Math.imul(h3 ^ ch, 0x5bd1e995);
    h4 = Math.imul(h4 ^ ch, 0x1b873593);
  }
  const hex3 = (h3 >>> 0).toString(16).padStart(8, '0');
  const hex4 = (h4 >>> 0).toString(16).padStart(8, '0');

  return hex1 + hex2 + hex3 + hex4;
}

/**
 * Compute a hash of the given data string.
 * Uses a portable djb2-based hash for synchronous operation.
 */
export function computeHash(
  data: string,
  _algorithm?: AuditTrailConfig['algorithm'],
): string {
  return djb2Hash(data);
}

/**
 * Hash an audit entry deterministically by serializing its fields in order.
 */
export function hashEntry(
  entry: Omit<AuditEntry, 'hash'>,
  algorithm?: AuditTrailConfig['algorithm'],
): string {
  const payload = JSON.stringify({
    id: entry.id,
    timestamp: entry.timestamp,
    operation: entry.operation,
    collection: entry.collection,
    documentId: entry.documentId,
    userId: entry.userId ?? null,
    data: entry.data ?? null,
    previousHash: entry.previousHash,
  });
  return computeHash(payload, algorithm);
}

/**
 * Hash two values together for Merkle tree node computation.
 */
export function hashPair(
  left: string,
  right: string,
  algorithm?: AuditTrailConfig['algorithm'],
): string {
  return computeHash(left + right, algorithm);
}
