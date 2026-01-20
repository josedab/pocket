import type { ChangeEvent, Document } from '@pocket/core';

/**
 * Stored change entry
 */
export interface ChangeEntry<T extends Document = Document> {
  /** Unique ID */
  id: string;
  /** Sequence number */
  sequence: number;
  /** Collection name */
  collection: string;
  /** Change event */
  change: ChangeEvent<T>;
  /** Client that made the change */
  clientId: string;
  /** Server timestamp */
  serverTimestamp: number;
}

/**
 * Change log interface (backend agnostic)
 */
export interface ChangeLog {
  /** Append a change */
  append(entry: Omit<ChangeEntry, 'id' | 'sequence' | 'serverTimestamp'>): Promise<ChangeEntry>;

  /** Get changes since sequence */
  getSince(sequence: number, collection?: string, limit?: number): Promise<ChangeEntry[]>;

  /** Get changes for a collection */
  getForCollection(collection: string, since?: number, limit?: number): Promise<ChangeEntry[]>;

  /** Get a specific change */
  get(id: string): Promise<ChangeEntry | null>;

  /** Get current sequence number */
  getCurrentSequence(): Promise<number>;

  /** Compact old entries */
  compact(beforeSequence: number): Promise<number>;

  /** Clear all entries */
  clear(): Promise<void>;
}

/**
 * In-memory change log implementation
 */
export class MemoryChangeLog implements ChangeLog {
  private entries: ChangeEntry[] = [];
  private sequence = 0;

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

  async getSince(sequence: number, collection?: string, limit = 1000): Promise<ChangeEntry[]> {
    let results = this.entries.filter((e) => e.sequence > sequence);

    if (collection) {
      results = results.filter((e) => e.collection === collection);
    }

    return results.slice(0, limit);
  }

  async getForCollection(collection: string, since = 0, limit = 1000): Promise<ChangeEntry[]> {
    return this.entries
      .filter((e) => e.collection === collection && e.sequence > since)
      .slice(0, limit);
  }

  async get(id: string): Promise<ChangeEntry | null> {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  async getCurrentSequence(): Promise<number> {
    return this.sequence;
  }

  async compact(beforeSequence: number): Promise<number> {
    const originalLength = this.entries.length;
    this.entries = this.entries.filter((e) => e.sequence >= beforeSequence);
    return originalLength - this.entries.length;
  }

  async clear(): Promise<void> {
    this.entries = [];
    this.sequence = 0;
  }
}

/**
 * Create a memory change log
 */
export function createMemoryChangeLog(): MemoryChangeLog {
  return new MemoryChangeLog();
}
