import type { Document } from '@pocket/core';

/**
 * Write-ahead log entry
 */
export interface WALEntry<T extends Document = Document> {
  /** Entry sequence number */
  sequence: number;
  /** Operation type */
  operation: 'put' | 'delete' | 'clear';
  /** Collection name */
  collection: string;
  /** Document (for put operations) */
  document?: T;
  /** Document ID (for delete operations) */
  documentId?: string;
  /** Timestamp */
  timestamp: number;
  /** Checksum for integrity */
  checksum: string;
}

/**
 * Write-ahead log for OPFS
 */
export class WriteAheadLog {
  private handle: FileSystemFileHandle | null = null;
  private writer: FileSystemWritableFileStream | null = null;
  private sequence = 0;
  private readonly maxSize: number;
  private currentSize = 0;

  constructor(maxSize = 10 * 1024 * 1024) {
    // 10MB default
    this.maxSize = maxSize;
  }

  /**
   * Initialize the WAL
   */
  async initialize(dirHandle: FileSystemDirectoryHandle): Promise<void> {
    this.handle = await dirHandle.getFileHandle('wal.log', { create: true });

    // Read existing entries to get sequence
    const file = await this.handle.getFile();
    this.currentSize = file.size;

    if (file.size > 0) {
      const text = await file.text();
      const lines = text.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as WALEntry;
          this.sequence = Math.max(this.sequence, entry.sequence);
        } catch {
          // Corrupted entry, stop reading
          break;
        }
      }
    }
  }

  /**
   * Append an entry to the WAL
   */
  async append(entry: Omit<WALEntry, 'sequence' | 'timestamp' | 'checksum'>): Promise<WALEntry> {
    if (!this.handle) {
      throw new Error('WAL not initialized');
    }

    const fullEntry: WALEntry = {
      ...entry,
      sequence: ++this.sequence,
      timestamp: Date.now(),
      checksum: this.calculateChecksum(entry),
    };

    const line = JSON.stringify(fullEntry) + '\n';
    const encoder = new TextEncoder();
    const data = encoder.encode(line);

    // Check if we need to compact
    if (this.currentSize + data.length > this.maxSize) {
      await this.compact();
    }

    // Write entry
    if (!this.writer) {
      this.writer = await this.handle.createWritable({ keepExistingData: true });
    }

    await this.writer.write({
      type: 'write',
      position: this.currentSize,
      data,
    });
    await this.writer.close();
    this.writer = null;

    this.currentSize += data.length;

    return fullEntry;
  }

  /**
   * Read all entries from the WAL
   */
  async readAll(): Promise<WALEntry[]> {
    if (!this.handle) {
      return [];
    }

    const file = await this.handle.getFile();
    const text = await file.text();
    const lines = text.trim().split('\n').filter(Boolean);
    const entries: WALEntry[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as WALEntry;
        if (this.verifyChecksum(entry)) {
          entries.push(entry);
        }
      } catch {
        // Skip corrupted entries
      }
    }

    return entries;
  }

  /**
   * Read entries since a sequence number
   */
  async readSince(sequence: number): Promise<WALEntry[]> {
    const entries = await this.readAll();
    return entries.filter((e) => e.sequence > sequence);
  }

  /**
   * Compact the WAL (remove old entries)
   */
  async compact(): Promise<void> {
    if (!this.handle) return;

    // For simplicity, just truncate the file
    // In production, you'd want to keep recent entries
    const writer = await this.handle.createWritable();
    await writer.truncate(0);
    await writer.close();
    this.currentSize = 0;
  }

  /**
   * Sync WAL to disk
   */
  async sync(): Promise<void> {
    if (this.writer) {
      await this.writer.close();
      this.writer = null;
    }
  }

  /**
   * Close the WAL
   */
  async close(): Promise<void> {
    if (this.writer) {
      await this.writer.close();
      this.writer = null;
    }
    this.handle = null;
  }

  /**
   * Get current sequence number
   */
  getSequence(): number {
    return this.sequence;
  }

  /**
   * Calculate checksum for an entry
   */
  private calculateChecksum(entry: Omit<WALEntry, 'sequence' | 'timestamp' | 'checksum'>): string {
    const data = JSON.stringify(entry);
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Verify entry checksum
   */
  private verifyChecksum(entry: WALEntry): boolean {
    const { sequence: _sequence, timestamp: _timestamp, checksum, ...rest } = entry;
    const calculated = this.calculateChecksum(rest);
    return calculated === checksum;
  }
}

/**
 * Create a WAL instance
 */
export function createWAL(maxSize?: number): WriteAheadLog {
  return new WriteAheadLog(maxSize);
}
