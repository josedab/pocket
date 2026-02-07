/**
 * Immutable Audit Chain for @pocket/sync-blockchain.
 *
 * Provides an append-only log of all operations in the sync system.
 * Each block is cryptographically linked to the previous one, enabling
 * tamper detection and compliance-ready audit trails.
 *
 * ## Chain Structure
 *
 * ```
 * [Genesis Block] ← [Block 1] ← [Block 2] ← [Block 3] ← ...
 *   hash: "000..."   prev: "000..."  prev: "abc..."  prev: "def..."
 * ```
 *
 * @example
 * ```typescript
 * const chain = createAuditChain();
 * await chain.append({
 *   operation: 'document:create',
 *   collection: 'todos',
 *   documentId: 'todo-1',
 *   actor: 'did:pocket:alice',
 * });
 *
 * const valid = await chain.verify();
 * const entries = chain.query({ collection: 'todos' });
 * ```
 *
 * @module @pocket/sync-blockchain/audit-chain
 */

import { BehaviorSubject, Subject } from 'rxjs';

import type {
  AuditEntry,
  AuditOperation,
  AuditQuery,
  Block,
  BlockBody,
  BlockHeader,
} from './types.js';

/** Generate a unique identifier. */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Compute SHA-256 hash of a string and return as hex.
 */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The hash used for the genesis block's previousHash. */
const GENESIS_PREVIOUS_HASH = '0'.repeat(64);

/** Maximum entries per block before auto-sealing. */
const MAX_ENTRIES_PER_BLOCK = 100;

/**
 * Immutable audit chain.
 *
 * Maintains an append-only chain of blocks, each containing audit
 * entries and linked to the previous block by its hash.
 *
 * @example
 * ```typescript
 * const chain = createAuditChain();
 *
 * // Append entries
 * await chain.append({
 *   operation: 'document:create',
 *   collection: 'todos',
 *   documentId: 'todo-1',
 *   actor: 'did:pocket:alice',
 * });
 *
 * // Seal current block
 * await chain.sealBlock('did:pocket:alice');
 *
 * // Verify chain integrity
 * const valid = await chain.verify();
 *
 * // Query audit trail
 * const entries = chain.query({ collection: 'todos', limit: 10 });
 * ```
 */
export class AuditChain {
  private readonly chain: Block[] = [];
  private pendingEntries: AuditEntry[] = [];
  private readonly destroy$ = new Subject<void>();

  /** Observable block count. */
  readonly blockCount$ = new BehaviorSubject<number>(0);

  /** Observable total entry count across all blocks. */
  readonly entryCount$ = new BehaviorSubject<number>(0);

  /**
   * Append an audit entry to the pending entries.
   * Entries are collected until a block is sealed.
   *
   * @param entry - Partial entry (id and timestamp are auto-generated).
   */
  async append(entry: {
    operation: AuditOperation;
    collection: string;
    documentId?: string;
    contentCid?: string;
    actor: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditEntry> {
    const auditEntry: AuditEntry = {
      id: generateId(),
      operation: entry.operation,
      collection: entry.collection,
      documentId: entry.documentId ?? null,
      contentCid: entry.contentCid ?? null,
      actor: entry.actor,
      timestamp: Date.now(),
      metadata: entry.metadata ?? {},
    };

    this.pendingEntries.push(auditEntry);
    this.updateEntryCount();

    // Auto-seal if we hit the max entries per block
    if (this.pendingEntries.length >= MAX_ENTRIES_PER_BLOCK) {
      await this.sealBlock(entry.actor);
    }

    return auditEntry;
  }

  /**
   * Seal the current pending entries into a new block.
   *
   * @param creator - DID of the block creator.
   * @returns The sealed block, or `null` if there are no pending entries.
   */
  async sealBlock(creator: string): Promise<Block | null> {
    if (this.pendingEntries.length === 0) {
      return null;
    }

    const entries = [...this.pendingEntries];
    this.pendingEntries = [];

    const previousHash =
      this.chain.length > 0
        ? this.chain[this.chain.length - 1]!.hash
        : GENESIS_PREVIOUS_HASH;

    const body: BlockBody = { entries };
    const dataHash = await sha256(JSON.stringify(entries));

    const header: BlockHeader = {
      index: this.chain.length,
      previousHash,
      timestamp: Date.now(),
      dataHash,
      creator,
    };

    const blockHash = await sha256(JSON.stringify(header) + JSON.stringify(body));

    const block: Block = {
      header,
      body,
      hash: blockHash,
    };

    this.chain.push(block);
    this.blockCount$.next(this.chain.length);
    this.updateEntryCount();

    return block;
  }

  /**
   * Verify the integrity of the entire chain.
   * Checks that each block's hash is correct and links to the previous block.
   *
   * @returns `true` if the chain is valid, `false` if tampered.
   */
  async verify(): Promise<boolean> {
    for (let i = 0; i < this.chain.length; i++) {
      const block = this.chain[i]!;

      // Verify block hash
      const expectedHash = await sha256(
        JSON.stringify(block.header) + JSON.stringify(block.body),
      );
      if (block.hash !== expectedHash) {
        return false;
      }

      // Verify data hash
      const expectedDataHash = await sha256(JSON.stringify(block.body.entries));
      if (block.header.dataHash !== expectedDataHash) {
        return false;
      }

      // Verify chain link
      if (i === 0) {
        if (block.header.previousHash !== GENESIS_PREVIOUS_HASH) {
          return false;
        }
      } else {
        const previousBlock = this.chain[i - 1]!;
        if (block.header.previousHash !== previousBlock.hash) {
          return false;
        }
      }

      // Verify block index
      if (block.header.index !== i) {
        return false;
      }
    }

    return true;
  }

  /**
   * Query audit entries by filter criteria.
   */
  query(filter: AuditQuery): AuditEntry[] {
    const allEntries = this.getAllEntries();
    let results = allEntries;

    if (filter.startTime !== undefined) {
      results = results.filter((e) => e.timestamp >= filter.startTime!);
    }
    if (filter.endTime !== undefined) {
      results = results.filter((e) => e.timestamp <= filter.endTime!);
    }
    if (filter.actor !== undefined) {
      results = results.filter((e) => e.actor === filter.actor);
    }
    if (filter.collection !== undefined) {
      results = results.filter((e) => e.collection === filter.collection);
    }
    if (filter.operation !== undefined) {
      results = results.filter((e) => e.operation === filter.operation);
    }
    if (filter.limit !== undefined) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Export the complete audit trail as a JSON-serializable object.
   * Suitable for compliance reporting and external auditing.
   */
  export(): { blocks: Block[]; pendingEntries: AuditEntry[]; verified: boolean } {
    return {
      blocks: [...this.chain],
      pendingEntries: [...this.pendingEntries],
      verified: false, // Must call verify() separately
    };
  }

  /**
   * Get a block by its index.
   */
  getBlock(index: number): Block | null {
    return this.chain[index] ?? null;
  }

  /**
   * Get the latest sealed block.
   */
  getLatestBlock(): Block | null {
    return this.chain.length > 0 ? this.chain[this.chain.length - 1]! : null;
  }

  /**
   * Get the total number of sealed blocks.
   */
  getBlockCount(): number {
    return this.chain.length;
  }

  /**
   * Get all entries across all sealed blocks and pending entries.
   */
  getAllEntries(): AuditEntry[] {
    const entries: AuditEntry[] = [];
    for (const block of this.chain) {
      entries.push(...block.body.entries);
    }
    entries.push(...this.pendingEntries);
    return entries;
  }

  /**
   * Get the number of pending (un-sealed) entries.
   */
  getPendingCount(): number {
    return this.pendingEntries.length;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.blockCount$.complete();
    this.entryCount$.complete();
  }

  private updateEntryCount(): void {
    let count = this.pendingEntries.length;
    for (const block of this.chain) {
      count += block.body.entries.length;
    }
    this.entryCount$.next(count);
  }
}

/**
 * Create a new AuditChain instance.
 *
 * @example
 * ```typescript
 * const chain = createAuditChain();
 *
 * await chain.append({
 *   operation: 'document:create',
 *   collection: 'todos',
 *   documentId: 'todo-1',
 *   actor: 'did:pocket:alice',
 * });
 *
 * await chain.sealBlock('did:pocket:alice');
 * console.log(await chain.verify()); // true
 * ```
 */
export function createAuditChain(): AuditChain {
  return new AuditChain();
}
