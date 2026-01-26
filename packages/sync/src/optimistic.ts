/**
 * Optimistic update management for local-first sync.
 *
 * Optimistic updates allow immediate UI feedback by applying changes locally
 * before server confirmation. This module tracks pending changes and enables
 * rollback if server sync fails.
 *
 * ## How It Works
 *
 * ```
 * User Action             Local State              Sync Queue
 *     │                      │                         │
 *     │ ─── Update ────────► │                         │
 *     │                      │ (immediate feedback)    │
 *     │                      │ ─── Add to queue ─────► │
 *     │                      │                         │ (pending)
 *     │                      │                         │
 *     │                      │ ◄─── Server confirms ── │
 *     │                      │      (mark synced)      │
 *     │                      │                         │
 *     │           OR         │                         │
 *     │                      │                         │
 *     │                      │ ◄─── Server rejects ─── │
 *     │                      │      (rollback)         │
 * ```
 *
 * @module sync/optimistic
 *
 * @see {@link OptimisticUpdateManager} for managing pending changes
 * @see {@link RollbackManager} for reverting failed changes
 */

import type { ChangeEvent, Document } from '@pocket/core';

/**
 * Represents a local change waiting to be synced with the server.
 *
 * Each optimistic update tracks:
 * - The change event (what was modified)
 * - The previous document state (for rollback)
 * - Sync attempt metadata (for retry logic)
 *
 * @typeParam T - The document type
 *
 * @see {@link OptimisticUpdateManager}
 */
export interface OptimisticUpdate<T extends Document = Document> {
  /** Unique identifier for this update (format: `{collection}_{docId}_{timestamp}`) */
  id: string;
  /** Name of the collection containing the document */
  collection: string;
  /** The change event representing the local modification */
  change: ChangeEvent<T>;
  /** Document state before the change, enabling rollback. Null for inserts. */
  previousDocument: T | null;
  /** Unix timestamp when the update was created */
  createdAt: number;
  /** Number of times sync has been attempted for this update */
  attempts: number;
  /** Error from the last failed sync attempt, if any */
  lastError?: Error;
}

/**
 * Manages pending optimistic updates for local-first synchronization.
 *
 * This manager:
 * - Tracks local changes before server confirmation
 * - Persists pending updates to localStorage (survives page refresh)
 * - Supports retry logic with attempt counting
 * - Enables rollback by storing previous document states
 *
 * @example Basic usage with SyncEngine
 * ```typescript
 * const manager = new OptimisticUpdateManager();
 *
 * // Local change occurs
 * const updateId = manager.add('todos', changeEvent, previousDoc);
 *
 * // After successful sync
 * manager.markSynced(updateId);
 *
 * // After failed sync
 * manager.markFailed(updateId, new Error('Network error'));
 *
 * // Get updates that need retry
 * const pending = manager.getPendingSync();
 * ```
 *
 * @example Checking pending changes
 * ```typescript
 * if (manager.hasPending) {
 *   console.log(`${manager.count} changes waiting to sync`);
 * }
 *
 * // Show warning before page unload
 * window.onbeforeunload = () => {
 *   if (manager.hasPending) {
 *     return 'You have unsaved changes';
 *   }
 * };
 * ```
 *
 * @see {@link OptimisticUpdate} for the update data structure
 * @see {@link RollbackManager} for reverting failed updates
 */
export class OptimisticUpdateManager {
  private readonly updates = new Map<string, OptimisticUpdate>();
  private readonly storageKey: string;

  constructor(storageKey = 'pocket_optimistic_updates') {
    this.storageKey = storageKey;
    this.loadUpdates();
  }

  /**
   * Add an optimistic update
   */
  add<T extends Document>(
    collection: string,
    change: ChangeEvent<T>,
    previousDocument: T | null
  ): string {
    const id = `${collection}_${change.documentId}_${Date.now()}`;

    const update: OptimisticUpdate<T> = {
      id,
      collection,
      change,
      previousDocument,
      createdAt: Date.now(),
      attempts: 0,
    };

    this.updates.set(id, update as OptimisticUpdate);
    this.saveUpdates();

    return id;
  }

  /**
   * Get an update by ID
   */
  get(id: string): OptimisticUpdate | undefined {
    return this.updates.get(id);
  }

  /**
   * Get all pending updates
   */
  getAll(): OptimisticUpdate[] {
    return Array.from(this.updates.values());
  }

  /**
   * Get updates for a specific collection
   */
  getForCollection(collection: string): OptimisticUpdate[] {
    return this.getAll().filter((u) => u.collection === collection);
  }

  /**
   * Get updates for a specific document
   */
  getForDocument(collection: string, documentId: string): OptimisticUpdate[] {
    return this.getAll().filter(
      (u) => u.collection === collection && u.change.documentId === documentId
    );
  }

  /**
   * Mark an update as synced (remove it)
   */
  markSynced(id: string): void {
    this.updates.delete(id);
    this.saveUpdates();
  }

  /**
   * Mark an update as failed
   */
  markFailed(id: string, error: Error): void {
    const update = this.updates.get(id);
    if (update) {
      update.attempts++;
      update.lastError = error;
      this.saveUpdates();
    }
  }

  /**
   * Get updates that need to be synced
   */
  getPendingSync(maxAttempts = 5): OptimisticUpdate[] {
    return this.getAll().filter((u) => u.attempts < maxAttempts);
  }

  /**
   * Get failed updates (exceeded max attempts)
   */
  getFailedUpdates(maxAttempts = 5): OptimisticUpdate[] {
    return this.getAll().filter((u) => u.attempts >= maxAttempts);
  }

  /**
   * Clear all updates
   */
  clear(): void {
    this.updates.clear();
    this.saveUpdates();
  }

  /**
   * Clear updates for a collection
   */
  clearForCollection(collection: string): void {
    for (const [id, update] of this.updates) {
      if (update.collection === collection) {
        this.updates.delete(id);
      }
    }
    this.saveUpdates();
  }

  /**
   * Get count of pending updates
   */
  get count(): number {
    return this.updates.size;
  }

  /**
   * Check if there are pending updates
   */
  get hasPending(): boolean {
    return this.updates.size > 0;
  }

  /**
   * Load updates from storage
   */
  private loadUpdates(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const updates = JSON.parse(stored) as OptimisticUpdate[];
        for (const update of updates) {
          this.updates.set(update.id, update);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Save updates to storage
   */
  private saveUpdates(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const updates = Array.from(this.updates.values());
      localStorage.setItem(this.storageKey, JSON.stringify(updates));
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Create an optimistic update manager
 */
export function createOptimisticUpdateManager(storageKey?: string): OptimisticUpdateManager {
  return new OptimisticUpdateManager(storageKey);
}
