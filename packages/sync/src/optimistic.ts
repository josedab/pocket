import type { ChangeEvent, Document } from '@pocket/core';

/**
 * Pending optimistic update
 */
export interface OptimisticUpdate<T extends Document = Document> {
  /** Unique ID for this update */
  id: string;
  /** Collection name */
  collection: string;
  /** Original change event */
  change: ChangeEvent<T>;
  /** Previous document state (for rollback) */
  previousDocument: T | null;
  /** Timestamp when created */
  createdAt: number;
  /** Number of sync attempts */
  attempts: number;
  /** Last error if any */
  lastError?: Error;
}

/**
 * Optimistic updates manager
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
