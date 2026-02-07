/**
 * Audit store for tamper-evident operation logging with hash chaining
 */

import type {
  AnchoringResult,
  AuditEntry,
  AuditQuery,
  AuditTrailConfig,
  VerificationResult,
} from './types.js';
import { DEFAULT_AUDIT_CONFIG } from './types.js';
import { hashEntry } from './hash.js';
import { MerkleTree } from './merkle-tree.js';

let idCounter = 0;

function generateId(): string {
  idCounter++;
  return `audit-${Date.now()}-${idCounter}`;
}

/**
 * An append-only audit store with hash-chained entries and Merkle tree anchoring.
 */
export class AuditStore {
  private readonly config: AuditTrailConfig;
  private entries: AuditEntry[] = [];
  private anchors: AnchoringResult[] = [];
  private lastAnchoredIndex = -1;

  constructor(config?: Partial<AuditTrailConfig>) {
    this.config = { ...DEFAULT_AUDIT_CONFIG, ...config };
  }

  /**
   * Append a new audit entry, chaining its hash to the previous entry.
   */
  append(
    operation: AuditEntry['operation'],
    collection: string,
    documentId: string,
    data?: unknown,
    userId?: string,
  ): AuditEntry {
    const previousHash =
      this.entries.length > 0
        ? this.entries[this.entries.length - 1]!.hash
        : '0'.repeat(32);

    const partial = {
      id: generateId(),
      timestamp: Date.now(),
      operation,
      collection,
      documentId,
      userId,
      data,
      previousHash,
    };

    const hash = hashEntry(partial, this.config.algorithm);

    const entry: AuditEntry = { ...partial, hash };
    this.entries.push(entry);

    return entry;
  }

  /**
   * Query the audit log with optional filters.
   */
  query(query: AuditQuery): AuditEntry[] {
    let results = this.entries;

    if (query.collection) {
      results = results.filter((e) => e.collection === query.collection);
    }
    if (query.documentId) {
      results = results.filter((e) => e.documentId === query.documentId);
    }
    if (query.userId) {
      results = results.filter((e) => e.userId === query.userId);
    }
    if (query.startTime !== undefined) {
      results = results.filter((e) => e.timestamp >= query.startTime!);
    }
    if (query.endTime !== undefined) {
      results = results.filter((e) => e.timestamp <= query.endTime!);
    }
    if (query.limit !== undefined) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Get a specific entry by ID.
   */
  getEntry(id: string): AuditEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /**
   * Verify the hash integrity of a single entry.
   */
  verify(id: string): VerificationResult {
    const entry = this.getEntry(id);
    if (!entry) {
      return { valid: false, errors: [`Entry ${id} not found`] };
    }

    const errors: string[] = [];

    // Verify the entry's own hash
    const expectedHash = hashEntry(entry, this.config.algorithm);
    if (entry.hash !== expectedHash) {
      errors.push(`Hash mismatch: expected ${expectedHash}, got ${entry.hash}`);
    }

    // Verify chain link to previous entry
    const index = this.entries.indexOf(entry);
    if (index > 0) {
      const prev = this.entries[index - 1]!;
      if (entry.previousHash !== prev.hash) {
        errors.push(
          `Previous hash mismatch: expected ${prev.hash}, got ${entry.previousHash}`,
        );
      }
    } else if (index === 0) {
      const genesisHash = '0'.repeat(32);
      if (entry.previousHash !== genesisHash) {
        errors.push(`Genesis entry should have previous hash ${genesisHash}`);
      }
    }

    return { valid: errors.length === 0, entry, errors };
  }

  /**
   * Verify the hash chain integrity for a range of entries.
   */
  verifyChain(startId?: string, endId?: string): VerificationResult {
    if (this.entries.length === 0) {
      return { valid: true, errors: [] };
    }

    let startIdx = 0;
    let endIdx = this.entries.length - 1;

    if (startId) {
      startIdx = this.entries.findIndex((e) => e.id === startId);
      if (startIdx === -1) {
        return { valid: false, errors: [`Start entry ${startId} not found`] };
      }
    }

    if (endId) {
      endIdx = this.entries.findIndex((e) => e.id === endId);
      if (endIdx === -1) {
        return { valid: false, errors: [`End entry ${endId} not found`] };
      }
    }

    const errors: string[] = [];

    for (let i = startIdx; i <= endIdx; i++) {
      const entry = this.entries[i]!;

      // Verify own hash
      const expectedHash = hashEntry(entry, this.config.algorithm);
      if (entry.hash !== expectedHash) {
        errors.push(
          `Entry ${entry.id}: hash mismatch (expected ${expectedHash}, got ${entry.hash})`,
        );
      }

      // Verify chain link
      if (i > 0) {
        const prev = this.entries[i - 1]!;
        if (entry.previousHash !== prev.hash) {
          errors.push(
            `Entry ${entry.id}: previous hash mismatch (expected ${prev.hash})`,
          );
        }
      } else {
        const genesisHash = '0'.repeat(32);
        if (entry.previousHash !== genesisHash) {
          errors.push(
            `Entry ${entry.id}: genesis previous hash mismatch`,
          );
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Create a Merkle tree anchor from recent un-anchored entries.
   */
  anchor(): AnchoringResult {
    const start = this.lastAnchoredIndex + 1;
    const batch = this.entries.slice(start);

    if (batch.length === 0) {
      return {
        merkleRoot: '',
        timestamp: Date.now(),
        batchSize: 0,
      };
    }

    const tree = new MerkleTree(batch.map((e) => e.hash));
    const result: AnchoringResult = {
      merkleRoot: tree.getRoot(),
      timestamp: Date.now(),
      batchSize: batch.length,
    };

    this.anchors.push(result);
    this.lastAnchoredIndex = this.entries.length - 1;

    return result;
  }

  /**
   * Get the history of anchoring results.
   */
  getAnchorHistory(): AnchoringResult[] {
    return [...this.anchors];
  }

  /**
   * Get the total number of audit entries.
   */
  getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * Export audit log entries, optionally filtered by query.
   */
  exportAuditLog(query?: AuditQuery): AuditEntry[] {
    if (query) {
      return this.query(query);
    }
    return [...this.entries];
  }
}

/**
 * Factory function to create an AuditStore.
 */
export function createAuditStore(
  config?: Partial<AuditTrailConfig>,
): AuditStore {
  return new AuditStore(config);
}
