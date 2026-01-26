import type { ChangeEvent, Document } from '@pocket/core';

/**
 * A persisted change entry in the sync log.
 *
 * Each change pushed to the server is stored as a ChangeEntry
 * with a monotonically increasing sequence number. Clients use
 * the sequence number to request changes since their last sync.
 *
 * @typeParam T - The document type (defaults to generic Document)
 *
 * @see {@link ChangeLog} for the storage interface
 */
export interface ChangeEntry<T extends Document = Document> {
  /**
   * Unique identifier for this entry.
   * Format: `{collection}_{sequence}`
   */
  id: string;

  /**
   * Global sequence number for ordering.
   * Strictly monotonically increasing across all collections.
   */
  sequence: number;

  /**
   * Name of the collection this change belongs to.
   */
  collection: string;

  /**
   * The actual change event (insert, update, or delete).
   */
  change: ChangeEvent<T>;

  /**
   * ID of the client that pushed this change.
   * Used for excluding the originator when broadcasting.
   */
  clientId: string;

  /**
   * Unix timestamp when the server received this change.
   */
  serverTimestamp: number;
}

/**
 * Interface for persisting sync changes on the server.
 *
 * The ChangeLog stores all changes pushed by clients, enabling:
 * - Pull requests: Clients can fetch changes since their last checkpoint
 * - Catch-up sync: New/reconnecting clients can sync historical changes
 * - Audit trail: Record of all modifications
 *
 * Implement this interface to use a custom storage backend (e.g., PostgreSQL,
 * Redis, DynamoDB). The default implementation uses in-memory storage which
 * loses data on server restart.
 *
 * @example Custom PostgreSQL implementation
 * ```typescript
 * class PostgresChangeLog implements ChangeLog {
 *   constructor(private pool: Pool) {}
 *
 *   async append(entry) {
 *     const result = await this.pool.query(
 *       'INSERT INTO change_log (collection, change, client_id) VALUES ($1, $2, $3) RETURNING *',
 *       [entry.collection, entry.change, entry.clientId]
 *     );
 *     return this.mapRow(result.rows[0]);
 *   }
 *
 *   // ... implement other methods
 * }
 * ```
 *
 * @see {@link MemoryChangeLog} for the in-memory reference implementation
 */
export interface ChangeLog {
  /**
   * Append a new change to the log.
   *
   * The implementation should:
   * - Assign a unique ID
   * - Assign the next sequence number
   * - Set the server timestamp
   *
   * @param entry - The change to append (without auto-generated fields)
   * @returns The complete entry with all fields populated
   */
  append(entry: Omit<ChangeEntry, 'id' | 'sequence' | 'serverTimestamp'>): Promise<ChangeEntry>;

  /**
   * Get all changes after a given sequence number.
   *
   * @param sequence - Return changes with sequence > this value
   * @param collection - Optional collection filter
   * @param limit - Maximum number of entries to return
   * @returns Array of change entries ordered by sequence
   */
  getSince(sequence: number, collection?: string, limit?: number): Promise<ChangeEntry[]>;

  /**
   * Get changes for a specific collection since a sequence number.
   *
   * More efficient than getSince with collection filter when the
   * storage backend can use a composite index.
   *
   * @param collection - The collection name
   * @param since - Return changes with sequence > this value
   * @param limit - Maximum entries to return
   * @returns Array of change entries
   */
  getForCollection(collection: string, since?: number, limit?: number): Promise<ChangeEntry[]>;

  /**
   * Get a specific change entry by ID.
   *
   * @param id - The entry ID
   * @returns The entry if found, null otherwise
   */
  get(id: string): Promise<ChangeEntry | null>;

  /**
   * Get the current (highest) sequence number.
   *
   * @returns The highest sequence number, or 0 if empty
   */
  getCurrentSequence(): Promise<number>;

  /**
   * Delete old entries to reclaim storage.
   *
   * Remove entries with sequence < beforeSequence. Call periodically
   * to prevent unbounded growth. Be careful not to compact entries
   * that clients might still need.
   *
   * @param beforeSequence - Delete entries with sequence < this value
   * @returns Number of entries deleted
   */
  compact(beforeSequence: number): Promise<number>;

  /**
   * Delete all entries.
   *
   * Resets the log to empty state.
   */
  clear(): Promise<void>;
}

/**
 * In-memory implementation of the ChangeLog interface.
 *
 * Stores all changes in an array in memory. Suitable for:
 * - Development and testing
 * - Small deployments where persistence isn't critical
 * - Prototyping before implementing a database-backed log
 *
 * **Warning**: All data is lost when the server restarts. For production,
 * implement a persistent ChangeLog backed by a database.
 *
 * @example
 * ```typescript
 * const changeLog = new MemoryChangeLog();
 *
 * // Append a change
 * const entry = await changeLog.append({
 *   collection: 'todos',
 *   change: { operation: 'insert', documentId: '1', ... },
 *   clientId: 'client-123'
 * });
 *
 * // Fetch recent changes
 * const changes = await changeLog.getSince(0, 'todos', 100);
 * ```
 *
 * @see {@link ChangeLog} for the interface definition
 */
export class MemoryChangeLog implements ChangeLog {
  /** Array of all stored entries, ordered by sequence */
  private entries: ChangeEntry[] = [];

  /** Current sequence counter, incremented with each append */
  private sequence = 0;

  /**
   * Append a change to the in-memory log.
   *
   * @param entry - Change entry without auto-generated fields
   * @returns Complete entry with id, sequence, and serverTimestamp
   */
  async append(
    entry: Omit<ChangeEntry, 'id' | 'sequence' | 'serverTimestamp'>
  ): Promise<ChangeEntry> {
    const fullEntry: ChangeEntry = {
      ...entry,
      id: `${entry.collection}_${++this.sequence}`,
      sequence: this.sequence,
      serverTimestamp: Date.now(),
    };

    this.entries.push(fullEntry);
    return fullEntry;
  }

  /**
   * Get changes since a sequence number.
   *
   * @param sequence - Return entries with sequence > this value
   * @param collection - Optional filter by collection name
   * @param limit - Maximum entries to return (default: 1000)
   * @returns Array of matching entries
   */
  async getSince(sequence: number, collection?: string, limit = 1000): Promise<ChangeEntry[]> {
    let results = this.entries.filter((e) => e.sequence > sequence);

    if (collection) {
      results = results.filter((e) => e.collection === collection);
    }

    return results.slice(0, limit);
  }

  /**
   * Get changes for a specific collection.
   *
   * @param collection - The collection name
   * @param since - Return entries with sequence > this value (default: 0)
   * @param limit - Maximum entries to return (default: 1000)
   * @returns Array of matching entries
   */
  async getForCollection(collection: string, since = 0, limit = 1000): Promise<ChangeEntry[]> {
    return this.entries
      .filter((e) => e.collection === collection && e.sequence > since)
      .slice(0, limit);
  }

  /**
   * Get a specific entry by ID.
   *
   * @param id - The entry ID to look up
   * @returns The entry if found, null otherwise
   */
  async get(id: string): Promise<ChangeEntry | null> {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  /**
   * Get the current highest sequence number.
   *
   * @returns The current sequence value
   */
  async getCurrentSequence(): Promise<number> {
    return this.sequence;
  }

  /**
   * Remove old entries from the log.
   *
   * @param beforeSequence - Remove entries with sequence < this value
   * @returns Number of entries removed
   */
  async compact(beforeSequence: number): Promise<number> {
    const originalLength = this.entries.length;
    this.entries = this.entries.filter((e) => e.sequence >= beforeSequence);
    return originalLength - this.entries.length;
  }

  /**
   * Clear all entries and reset the sequence counter.
   */
  async clear(): Promise<void> {
    this.entries = [];
    this.sequence = 0;
  }
}

/**
 * Create a new in-memory change log.
 *
 * @returns A new MemoryChangeLog instance
 *
 * @example
 * ```typescript
 * import { createServer, createMemoryChangeLog } from '@pocket/server';
 *
 * const server = createServer({
 *   port: 8080,
 *   changeLog: createMemoryChangeLog()
 * });
 * ```
 *
 * @see {@link MemoryChangeLog}
 */
export function createMemoryChangeLog(): MemoryChangeLog {
  return new MemoryChangeLog();
}
