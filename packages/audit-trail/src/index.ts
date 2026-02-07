/**
 * @pocket/audit-trail - Blockchain audit trail for Pocket
 *
 * @example
 * ```typescript
 * import { createAuditStore, createMerkleTree } from '@pocket/audit-trail';
 *
 * // Create an audit store
 * const store = createAuditStore({ algorithm: 'sha-256', batchSize: 50 });
 *
 * // Append audit entries
 * store.append('insert', 'todos', 'todo-1', { title: 'Buy groceries' }, 'user-1');
 * store.append('update', 'todos', 'todo-1', { title: 'Buy groceries', done: true }, 'user-1');
 *
 * // Verify chain integrity
 * const result = store.verifyChain();
 * console.log(result.valid); // true
 *
 * // Anchor entries into a Merkle tree
 * const anchor = store.anchor();
 * console.log(anchor.merkleRoot); // hex hash string
 *
 * // Query audit log
 * const entries = store.query({ collection: 'todos', userId: 'user-1' });
 *
 * // Use Merkle tree directly
 * const tree = createMerkleTree(['hash1', 'hash2', 'hash3']);
 * const proof = tree.generateProof(0);
 * console.log(tree.verifyProof(proof)); // true
 * ```
 */

// Types
export type {
  AnchoringResult,
  AuditEntry,
  AuditQuery,
  AuditTrailConfig,
  MerkleNode,
  MerkleProof,
  ProofStep,
  VerificationResult,
} from './types.js';

export { DEFAULT_AUDIT_CONFIG } from './types.js';

// Hash utilities
export { computeHash, hashEntry, hashPair } from './hash.js';

// Merkle Tree
export { MerkleTree, createMerkleTree } from './merkle-tree.js';

// Audit Store
export { AuditStore, createAuditStore } from './audit-store.js';
