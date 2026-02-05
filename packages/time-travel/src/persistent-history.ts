/**
 * Persistent History - Persistence layer for history tracking across sessions
 *
 * @module persistent-history
 *
 * @example
 * ```typescript
 * import { createPersistentHistory, MemoryHistoryStorage } from '@pocket/time-travel';
 *
 * const history = createPersistentHistory({
 *   storage: new MemoryHistoryStorage(),
 *   namespace: 'my-app',
 *   maxEntries: 10000,
 * });
 *
 * // Record a change
 * await history.record({
 *   operation: 'insert',
 *   collection: 'todos',
 *   documentId: 'todo-1',
 *   before: null,
 *   after: { title: 'Buy groceries' },
 * });
 *
 * // Query history
 * const entries = await history.getEntries({ collection: 'todos' });
 *
 * // Create a snapshot
 * const snapshot = await history.createSnapshot('before-migration');
 *
 * // Persist and restore
 * await history.save();
 * await history.load();
 * ```
 */

/**
 * Storage adapter interface for persisting history data
 */
export interface HistoryStorageAdapter {
  /** Save data to storage */
  save(key: string, data: string): Promise<void>;
  /** Load data from storage */
  load(key: string): Promise<string | null>;
  /** Delete data from storage */
  delete(key: string): Promise<void>;
  /** List keys matching a prefix */
  list(prefix: string): Promise<string[]>;
}

/**
 * Configuration for persistent history
 */
export interface PersistentHistoryConfig {
  /** Storage adapter for persistence */
  storage: HistoryStorageAdapter;
  /** Namespace for storage keys */
  namespace?: string;
  /** Maximum number of entries to retain (default: 10000) */
  maxEntries?: number;
  /** Compact when entry count exceeds this threshold (default: 5000) */
  compactionThreshhold?: number;
  /** Auto-save interval in milliseconds (default: 5000) */
  autoSaveIntervalMs?: number;
}

/**
 * A single persisted history entry
 */
export interface PersistentHistoryEntry {
  /** Unique entry ID */
  id: string;
  /** Timestamp of the entry */
  timestamp: number;
  /** Type of operation */
  operation: 'insert' | 'update' | 'delete';
  /** Collection the operation targets */
  collection: string;
  /** ID of the affected document */
  documentId: string;
  /** Document state before the operation (null for insert) */
  before: Record<string, unknown> | null;
  /** Document state after the operation (null for delete) */
  after: Record<string, unknown> | null;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A snapshot of history at a point in time
 */
export interface HistorySnapshot {
  /** Unique snapshot ID */
  id: string;
  /** Timestamp when snapshot was created */
  timestamp: number;
  /** Optional label for the snapshot */
  label?: string;
  /** Number of entries at the time of snapshot */
  entries: number;
  /** Collections present in the history */
  collections: string[];
}

/**
 * Filter options for querying history entries
 */
export interface HistoryFilter {
  /** Filter by collection name */
  collection?: string;
  /** Filter by document ID */
  documentId?: string;
  /** Filter by operation type */
  operation?: 'insert' | 'update' | 'delete';
  /** Filter entries after this timestamp */
  startTime?: number;
  /** Filter entries before this timestamp */
  endTime?: number;
  /** Maximum number of entries to return */
  limit?: number;
  /** Number of entries to skip */
  offset?: number;
}

/**
 * Generates a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * In-memory storage adapter for testing and ephemeral usage
 *
 * @example
 * ```typescript
 * const storage = new MemoryHistoryStorage();
 * await storage.save('key', JSON.stringify({ data: 'value' }));
 * const data = await storage.load('key');
 * ```
 */
export class MemoryHistoryStorage implements HistoryStorageAdapter {
  private readonly store = new Map<string, string>();

  async save(key: string, data: string): Promise<void> {
    this.store.set(key, data);
  }

  async load(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return keys;
  }
}

/**
 * Persistent history tracker with storage adapter support
 *
 * Provides durable history tracking across sessions with automatic
 * persistence, compaction, and snapshot management.
 *
 * @example
 * ```typescript
 * const history = new PersistentHistory({
 *   storage: new MemoryHistoryStorage(),
 *   maxEntries: 5000,
 *   compactionThreshhold: 3000,
 * });
 *
 * await history.load();
 *
 * const entry = await history.record({
 *   operation: 'update',
 *   collection: 'users',
 *   documentId: 'user-1',
 *   before: { name: 'Alice' },
 *   after: { name: 'Alice B.' },
 * });
 *
 * history.destroy();
 * ```
 */
export class PersistentHistory {
  private readonly storage: HistoryStorageAdapter;
  private readonly namespace: string;
  private readonly maxEntries: number;
  private readonly compactionThreshhold: number;
  private readonly autoSaveIntervalMs: number;

  private entries: PersistentHistoryEntry[] = [];
  private snapshots: HistorySnapshot[] = [];
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor(config: PersistentHistoryConfig) {
    this.storage = config.storage;
    this.namespace = config.namespace ?? 'pocket';
    this.maxEntries = config.maxEntries ?? 10000;
    this.compactionThreshhold = config.compactionThreshhold ?? 5000;
    this.autoSaveIntervalMs = config.autoSaveIntervalMs ?? 5000;

    this.startAutoSave();
  }

  /**
   * Record a history entry
   */
  async record(
    entry: Omit<PersistentHistoryEntry, 'id' | 'timestamp'>
  ): Promise<PersistentHistoryEntry> {
    const fullEntry: PersistentHistoryEntry = {
      ...entry,
      id: generateId(),
      timestamp: Date.now(),
    };

    this.entries.push(fullEntry);
    this.dirty = true;

    // Auto-compact if threshold exceeded
    if (this.entries.length > this.compactionThreshhold) {
      await this.compact();
    }

    return fullEntry;
  }

  /**
   * Query history entries with optional filtering
   */
  async getEntries(filter?: HistoryFilter): Promise<PersistentHistoryEntry[]> {
    let result = [...this.entries];

    if (filter?.collection) {
      result = result.filter((e) => e.collection === filter.collection);
    }

    if (filter?.documentId) {
      result = result.filter((e) => e.documentId === filter.documentId);
    }

    if (filter?.operation) {
      result = result.filter((e) => e.operation === filter.operation);
    }

    if (filter?.startTime) {
      result = result.filter((e) => e.timestamp >= filter.startTime!);
    }

    if (filter?.endTime) {
      result = result.filter((e) => e.timestamp <= filter.endTime!);
    }

    if (filter?.offset) {
      result = result.slice(filter.offset);
    }

    if (filter?.limit) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  /**
   * Get a single entry by ID
   */
  async getEntry(id: string): Promise<PersistentHistoryEntry | null> {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  /**
   * Create a named snapshot of the current history state
   */
  async createSnapshot(label?: string): Promise<HistorySnapshot> {
    const collections = [...new Set(this.entries.map((e) => e.collection))];

    const snapshot: HistorySnapshot = {
      id: generateId(),
      timestamp: Date.now(),
      label,
      entries: this.entries.length,
      collections,
    };

    this.snapshots.push(snapshot);
    this.dirty = true;

    return snapshot;
  }

  /**
   * Get all snapshots
   */
  async getSnapshots(): Promise<HistorySnapshot[]> {
    return [...this.snapshots];
  }

  /**
   * Restore entries up to a snapshot point for replay
   */
  async restoreToSnapshot(snapshotId: string): Promise<PersistentHistoryEntry[]> {
    const snapshot = this.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    // Return entries up to the snapshot timestamp
    return this.entries.filter((e) => e.timestamp <= snapshot.timestamp);
  }

  /**
   * Compact history by removing old entries beyond maxEntries
   *
   * @returns Number of entries removed
   */
  async compact(): Promise<number> {
    if (this.entries.length <= this.maxEntries) {
      return 0;
    }

    const removeCount = this.entries.length - this.maxEntries;
    this.entries.splice(0, removeCount);
    this.dirty = true;

    return removeCount;
  }

  /**
   * Persist current state to storage adapter
   */
  async save(): Promise<void> {
    const entriesKey = this.storageKey('entries');
    const snapshotsKey = this.storageKey('snapshots');

    await this.storage.save(entriesKey, JSON.stringify(this.entries));
    await this.storage.save(snapshotsKey, JSON.stringify(this.snapshots));

    this.dirty = false;
  }

  /**
   * Load state from storage adapter
   */
  async load(): Promise<void> {
    const entriesKey = this.storageKey('entries');
    const snapshotsKey = this.storageKey('snapshots');

    const entriesData = await this.storage.load(entriesKey);
    if (entriesData) {
      this.entries = JSON.parse(entriesData) as PersistentHistoryEntry[];
    }

    const snapshotsData = await this.storage.load(snapshotsKey);
    if (snapshotsData) {
      this.snapshots = JSON.parse(snapshotsData) as HistorySnapshot[];
    }
  }

  /**
   * Stop auto-save and clean up resources
   */
  destroy(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Build a namespaced storage key
   */
  private storageKey(suffix: string): string {
    return `${this.namespace}:history:${suffix}`;
  }

  /**
   * Start the auto-save interval
   */
  private startAutoSave(): void {
    this.autoSaveTimer = setInterval(() => {
      if (this.dirty) {
        void this.save();
      }
    }, this.autoSaveIntervalMs);
  }
}

/**
 * Create a persistent history instance
 *
 * @example
 * ```typescript
 * const history = createPersistentHistory({
 *   storage: new MemoryHistoryStorage(),
 *   namespace: 'my-app',
 * });
 * ```
 */
export function createPersistentHistory(config: PersistentHistoryConfig): PersistentHistory {
  return new PersistentHistory(config);
}
