/**
 * Core types for blockchain audit trail
 */

/**
 * Audit entry representing a single audited operation
 */
export interface AuditEntry {
  /** Unique entry ID */
  id: string;
  /** Timestamp of the operation */
  timestamp: number;
  /** Type of operation */
  operation: 'insert' | 'update' | 'delete';
  /** Collection name */
  collection: string;
  /** Document ID */
  documentId: string;
  /** User who performed the operation */
  userId?: string;
  /** Operation data/payload */
  data?: unknown;
  /** Hash of the previous entry in the chain */
  previousHash: string;
  /** Hash of this entry */
  hash: string;
}

/**
 * Node in a Merkle tree
 */
export interface MerkleNode {
  /** Hash of this node */
  hash: string;
  /** Left child node */
  left?: MerkleNode;
  /** Right child node */
  right?: MerkleNode;
  /** Leaf data (only for leaf nodes) */
  data?: string;
}

/**
 * Proof of inclusion in a Merkle tree
 */
export interface MerkleProof {
  /** The leaf hash being proven */
  leaf: string;
  /** Path of sibling hashes from leaf to root */
  path: ProofStep[];
  /** Expected root hash */
  root: string;
}

/**
 * A single step in a Merkle proof path
 */
export interface ProofStep {
  /** Sibling hash at this level */
  hash: string;
  /** Direction of the sibling relative to the path */
  direction: 'left' | 'right';
}

/**
 * Configuration for the audit trail
 */
export interface AuditTrailConfig {
  /** Hash algorithm to use */
  algorithm: 'sha-256' | 'sha-384' | 'sha-512';
  /** Number of entries per anchoring batch */
  batchSize: number;
  /** Whether to enable periodic anchoring */
  enableAnchoring: boolean;
  /** Interval between anchoring operations (in ms) */
  anchoringInterval: number;
}

/**
 * Result of an anchoring operation
 */
export interface AnchoringResult {
  /** Merkle root hash of the anchored batch */
  merkleRoot: string;
  /** Timestamp of the anchoring */
  timestamp: number;
  /** Number of entries in the batch */
  batchSize: number;
  /** External anchor identifier */
  anchorId?: string;
}

/**
 * Result of a verification operation
 */
export interface VerificationResult {
  /** Whether verification passed */
  valid: boolean;
  /** The verified entry (if applicable) */
  entry?: AuditEntry;
  /** List of errors found during verification */
  errors: string[];
}

/**
 * Query parameters for filtering audit entries
 */
export interface AuditQuery {
  /** Filter by collection */
  collection?: string;
  /** Filter by document ID */
  documentId?: string;
  /** Filter by user ID */
  userId?: string;
  /** Filter entries after this timestamp */
  startTime?: number;
  /** Filter entries before this timestamp */
  endTime?: number;
  /** Maximum number of entries to return */
  limit?: number;
}

/**
 * Default audit trail configuration
 */
export const DEFAULT_AUDIT_CONFIG: AuditTrailConfig = {
  algorithm: 'sha-256',
  batchSize: 100,
  enableAnchoring: true,
  anchoringInterval: 60_000,
};
