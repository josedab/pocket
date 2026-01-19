/**
 * Vector clock for distributed causality tracking
 */
export interface VectorClock {
  /** Map of node ID to logical timestamp */
  [nodeId: string]: number;
}

/**
 * Base document interface that all stored documents must extend
 */
export interface Document {
  /** Unique document identifier */
  _id: string;
  /** Revision string for conflict detection */
  _rev?: string;
  /** Soft delete marker */
  _deleted?: boolean;
  /** Last update timestamp (Unix ms) */
  _updatedAt?: number;
  /** Vector clock for sync */
  _vclock?: VectorClock;
}

/**
 * Document with all metadata fields required (after storage)
 */
export interface StoredDocument extends Document {
  _id: string;
  _rev: string;
  _updatedAt: number;
}

/**
 * Input type for creating new documents (without _id)
 */
export type NewDocument<T extends Document> = Omit<T, '_id' | '_rev' | '_updatedAt' | '_vclock'> & {
  _id?: string;
};

/**
 * Input type for updating documents
 */
export type DocumentUpdate<T extends Document> = Partial<
  Omit<T, '_id' | '_rev' | '_updatedAt' | '_vclock'>
>;

/**
 * Change event types
 */
export type ChangeOperation = 'insert' | 'update' | 'delete';

/**
 * Change event emitted when documents are modified
 */
export interface ChangeEvent<T extends Document> {
  /** Type of operation */
  operation: ChangeOperation;
  /** Document ID that changed */
  documentId: string;
  /** Current document state (null if deleted) */
  document: T | null;
  /** Previous document state */
  previousDocument?: T;
  /** Whether this change came from sync */
  isFromSync: boolean;
  /** Timestamp of the change */
  timestamp: number;
  /** Sequence number for ordering */
  sequence: number;
}

/**
 * Batch of changes for bulk operations
 */
export interface ChangeBatch<T extends Document> {
  changes: ChangeEvent<T>[];
  checkpoint: string;
}

/**
 * Document conflict when sync detects divergent changes
 */
export interface DocumentConflict<T extends Document> {
  /** Document ID with conflict */
  documentId: string;
  /** Local version of the document */
  localDocument: T;
  /** Remote version of the document */
  remoteDocument: T;
  /** Common ancestor if known */
  baseDocument?: T;
  /** Conflict detected at */
  timestamp: number;
}

/**
 * Generate a new document ID
 */
export function generateId(): string {
  // Use crypto.randomUUID if available, fallback to timestamp + random
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${randomPart}`;
}

/**
 * Generate a revision string
 */
export function generateRevision(sequence: number, docHash?: string): string {
  const hash = docHash ?? Math.random().toString(36).substring(2, 10);
  return `${sequence}-${hash}`;
}

/**
 * Parse revision to get sequence number
 */
export function parseRevision(rev: string): { sequence: number; hash: string } {
  const [seqStr, hash] = rev.split('-');
  return {
    sequence: parseInt(seqStr ?? '0', 10),
    hash: hash ?? '',
  };
}

/**
 * Compare two revisions
 * Returns positive if a > b, negative if a < b, 0 if equal
 */
export function compareRevisions(a: string, b: string): number {
  const parsedA = parseRevision(a);
  const parsedB = parseRevision(b);

  if (parsedA.sequence !== parsedB.sequence) {
    return parsedA.sequence - parsedB.sequence;
  }

  return parsedA.hash.localeCompare(parsedB.hash);
}
