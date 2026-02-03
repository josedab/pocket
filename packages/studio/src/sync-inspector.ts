import type { ConflictInfo, SyncHistoryEntry, SyncInspection } from './types.js';

/**
 * Interface for a sync engine that the SyncInspector can introspect.
 *
 * This is intentionally loose to avoid hard coupling to @pocket/sync.
 * Any object matching this shape (or a subset) can be inspected.
 */
export interface SyncEngineLike {
  getStatus?: () => { getValue?: () => string } | string;
  getStats?: () => {
    getValue?: () => {
      lastSyncAt: number | null;
      conflictCount: number;
      pushCount?: number;
      pullCount?: number;
    };
  };
  push?: () => Promise<void>;
  pull?: () => Promise<void>;
  forceSync?: () => Promise<void>;
}

/**
 * Sync Inspector for examining sync engine state.
 *
 * Provides read-only introspection of a Pocket sync engine including
 * status, pending changes, conflicts, checkpoints, and sync history.
 * Also supports manual push/pull triggers.
 *
 * The sync inspector accepts an optional sync engine reference.
 * If no sync engine is provided, all methods return sensible defaults
 * indicating that sync is not configured.
 *
 * @example
 * ```typescript
 * const inspector = createSyncInspector(syncEngine);
 *
 * const status = inspector.getStatus();
 * console.log(`Sync status: ${status.status}`);
 * console.log(`Pending changes: ${status.pendingChanges}`);
 *
 * // Force a push
 * await inspector.forcePush();
 * ```
 *
 * @see {@link createSyncInspector} for the factory function
 */
export class SyncInspector {
  private readonly syncEngine: SyncEngineLike | undefined;
  private readonly history: SyncHistoryEntry[] = [];
  private readonly conflicts: ConflictInfo[] = [];

  constructor(syncEngine?: SyncEngineLike) {
    this.syncEngine = syncEngine;
  }

  /**
   * Get the current sync status.
   *
   * Returns a snapshot of sync state including status, last sync time,
   * pending changes, conflict count, and connected peers.
   *
   * @returns The current sync inspection data
   */
  getStatus(): SyncInspection {
    if (!this.syncEngine) {
      return {
        status: 'not-configured',
        lastSyncAt: null,
        pendingChanges: 0,
        conflictCount: 0,
        connectedPeers: 0,
        checkpoint: null,
      };
    }

    let status = 'unknown';
    if (this.syncEngine.getStatus) {
      const statusResult = this.syncEngine.getStatus();
      if (typeof statusResult === 'string') {
        status = statusResult;
      } else if (statusResult && typeof statusResult.getValue === 'function') {
        status = statusResult.getValue();
      }
    }

    let lastSyncAt: number | null = null;
    let conflictCount = 0;

    if (this.syncEngine.getStats) {
      const statsResult = this.syncEngine.getStats();
      if (statsResult && typeof statsResult.getValue === 'function') {
        const stats = statsResult.getValue();
        lastSyncAt = stats.lastSyncAt;
        conflictCount = stats.conflictCount;
      }
    }

    return {
      status,
      lastSyncAt,
      pendingChanges: 0,
      conflictCount: conflictCount + this.conflicts.length,
      connectedPeers: status === 'idle' || status === 'syncing' ? 1 : 0,
      checkpoint: null,
    };
  }

  /**
   * Get the list of pending changes waiting to be pushed.
   *
   * @returns Array of change events pending sync
   */
  getPendingChanges(): unknown[] {
    // Without direct access to the optimistic update manager,
    // return what we can observe
    return [];
  }

  /**
   * Get the list of unresolved conflicts.
   *
   * @returns Array of conflict information
   */
  getConflicts(): ConflictInfo[] {
    return [...this.conflicts];
  }

  /**
   * Add a conflict entry (used by the studio system to track detected conflicts).
   *
   * @param conflict - The conflict to record
   */
  addConflict(conflict: ConflictInfo): void {
    this.conflicts.push(conflict);
  }

  /**
   * Clear a specific conflict by document ID.
   *
   * @param documentId - The document ID whose conflict to remove
   * @returns true if a conflict was removed, false otherwise
   */
  clearConflict(documentId: string): boolean {
    const index = this.conflicts.findIndex((c) => c.documentId === documentId);
    if (index >= 0) {
      this.conflicts.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get the current sync checkpoint.
   *
   * @returns The checkpoint data, or null if not available
   */
  getCheckpoint(): unknown {
    return null;
  }

  /**
   * Get the sync history log.
   *
   * @param limit - Maximum number of entries to return (default: 100)
   * @returns Array of sync history entries, most recent first
   */
  getSyncHistory(limit = 100): SyncHistoryEntry[] {
    return this.history.slice(0, limit);
  }

  /**
   * Record a sync history entry.
   *
   * @param entry - The history entry to record
   */
  recordHistory(entry: SyncHistoryEntry): void {
    this.history.unshift(entry);
    // Keep history bounded
    if (this.history.length > 1000) {
      this.history.length = 1000;
    }
  }

  /**
   * Force a push of pending changes to the server.
   *
   * @throws Error if no sync engine is configured
   */
  async forcePush(): Promise<void> {
    if (!this.syncEngine) {
      throw new Error('No sync engine configured. Cannot push.');
    }

    if (this.syncEngine.push) {
      const startTime = Date.now();
      try {
        await this.syncEngine.push();
        this.recordHistory({
          type: 'push',
          timestamp: Date.now(),
          changeCount: 0,
          success: true,
        });
      } catch (error) {
        this.recordHistory({
          type: 'push',
          timestamp: startTime,
          changeCount: 0,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } else if (this.syncEngine.forceSync) {
      await this.syncEngine.forceSync();
    } else {
      throw new Error('Sync engine does not support push operation.');
    }
  }

  /**
   * Force a pull of changes from the server.
   *
   * @throws Error if no sync engine is configured
   */
  async forcePull(): Promise<void> {
    if (!this.syncEngine) {
      throw new Error('No sync engine configured. Cannot pull.');
    }

    if (this.syncEngine.pull) {
      const startTime = Date.now();
      try {
        await this.syncEngine.pull();
        this.recordHistory({
          type: 'pull',
          timestamp: Date.now(),
          changeCount: 0,
          success: true,
        });
      } catch (error) {
        this.recordHistory({
          type: 'pull',
          timestamp: startTime,
          changeCount: 0,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } else if (this.syncEngine.forceSync) {
      await this.syncEngine.forceSync();
    } else {
      throw new Error('Sync engine does not support pull operation.');
    }
  }
}

/**
 * Create a new SyncInspector instance.
 *
 * @param syncEngine - Optional sync engine to inspect. If omitted,
 *   the inspector will report sync as not configured.
 * @returns A new SyncInspector
 *
 * @example
 * ```typescript
 * import { createSyncInspector } from '@pocket/studio';
 *
 * // With sync engine
 * const inspector = createSyncInspector(syncEngine);
 *
 * // Without sync engine (reports defaults)
 * const inspector = createSyncInspector();
 * ```
 */
export function createSyncInspector(syncEngine?: SyncEngineLike): SyncInspector {
  return new SyncInspector(syncEngine);
}
