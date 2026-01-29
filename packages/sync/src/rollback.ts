/**
 * Rollback management for reverting failed optimistic updates.
 *
 * When sync fails, optimistic updates need to be reverted to maintain
 * data consistency. The RollbackManager handles this by restoring
 * documents to their previous states.
 *
 * ## Rollback Operations by Change Type
 *
 * | Original Operation | Rollback Action |
 * |--------------------|-----------------|
 * | Insert | Delete the document |
 * | Update | Restore previous version |
 * | Delete | Restore the document |
 *
 * ## Rollback Order
 *
 * Updates are rolled back in reverse chronological order (newest first)
 * to maintain consistency when multiple changes affect the same document.
 *
 * @module sync/rollback
 *
 * @see {@link RollbackManager} for the main rollback class
 * @see {@link OptimisticUpdateManager} for managing pending changes
 */

import type { Collection, Document } from '@pocket/core';
import type { OptimisticUpdate, OptimisticUpdateManager } from './optimistic.js';

/**
 * Result of a rollback operation.
 *
 * Contains lists of successfully rolled back updates, failed rollbacks,
 * and any errors encountered during the process.
 */
export interface RollbackResult {
  /** IDs of updates that were successfully rolled back */
  rolledBack: string[];
  /** IDs of updates that could not be rolled back */
  failed: string[];
  /** Errors encountered during rollback (one per failed update) */
  errors: Error[];
}

/**
 * Manages rollback of optimistic updates when sync fails.
 *
 * The RollbackManager works with the {@link OptimisticUpdateManager} to
 * revert local changes that couldn't be synced to the server. This maintains
 * consistency between local state and server state.
 *
 * @example Rolling back a failed sync
 * ```typescript
 * const rollbackManager = createRollbackManager(
 *   optimisticManager,
 *   (name) => database.collection(name)
 * );
 *
 * // Rollback a specific update
 * const success = await rollbackManager.rollback(updateId);
 *
 * // Rollback all failed updates (exceeded retry limit)
 * const result = await rollbackManager.rollbackFailed();
 * console.log(`Rolled back ${result.rolledBack.length} updates`);
 * ```
 *
 * @example Rolling back changes for a document
 * ```typescript
 * // User wants to discard local changes
 * const result = await rollbackManager.rollbackDocument('todos', 'todo-123');
 * if (result.failed.length > 0) {
 *   console.error('Some changes could not be reverted');
 * }
 * ```
 *
 * @example Emergency rollback of all pending changes
 * ```typescript
 * // Rollback everything (e.g., user logs out)
 * const result = await rollbackManager.rollbackAll();
 * console.log(`Reverted ${result.rolledBack.length} local changes`);
 * ```
 *
 * @see {@link RollbackResult} for the result structure
 * @see {@link OptimisticUpdateManager} for managing pending changes
 */
export class RollbackManager {
  private readonly optimisticManager: OptimisticUpdateManager;
  private readonly getCollection: <T extends Document>(name: string) => Collection<T>;

  constructor(
    optimisticManager: OptimisticUpdateManager,
    getCollection: <T extends Document>(name: string) => Collection<T>
  ) {
    this.optimisticManager = optimisticManager;
    this.getCollection = getCollection;
  }

  /**
   * Rollback a specific update
   */
  async rollback(updateId: string): Promise<boolean> {
    const update = this.optimisticManager.get(updateId);
    if (!update) return false;

    try {
      const collection = this.getCollection<Document>(update.collection);

      switch (update.change.operation) {
        case 'insert':
          // Rollback insert = delete
          await collection.hardDelete(update.change.documentId);
          break;

        case 'update':
          // Rollback update = restore previous state
          if (update.previousDocument) {
            await collection.applyRemoteChange({
              ...update.change,
              document: update.previousDocument,
              operation: 'update',
            });
          }
          break;

        case 'delete':
          // Rollback delete = restore document
          if (update.previousDocument) {
            await collection.applyRemoteChange({
              ...update.change,
              document: update.previousDocument,
              operation: 'insert',
            });
          }
          break;
      }

      this.optimisticManager.markSynced(updateId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rollback all pending updates for a document
   */
  async rollbackDocument(collection: string, documentId: string): Promise<RollbackResult> {
    const updates = this.optimisticManager.getForDocument(collection, documentId);
    return this.rollbackUpdates(updates);
  }

  /**
   * Rollback all pending updates for a collection
   */
  async rollbackCollection(collection: string): Promise<RollbackResult> {
    const updates = this.optimisticManager.getForCollection(collection);
    return this.rollbackUpdates(updates);
  }

  /**
   * Rollback all pending updates
   */
  async rollbackAll(): Promise<RollbackResult> {
    const updates = this.optimisticManager.getAll();
    return this.rollbackUpdates(updates);
  }

  /**
   * Rollback failed updates only
   */
  async rollbackFailed(maxAttempts = 5): Promise<RollbackResult> {
    const updates = this.optimisticManager.getFailedUpdates(maxAttempts);
    return this.rollbackUpdates(updates);
  }

  /**
   * Rollback a list of updates (in reverse order)
   */
  private async rollbackUpdates(updates: OptimisticUpdate[]): Promise<RollbackResult> {
    const result: RollbackResult = {
      rolledBack: [],
      failed: [],
      errors: [],
    };

    // Sort by creation time descending (newest first)
    const sorted = [...updates].sort((a, b) => b.createdAt - a.createdAt);

    for (const update of sorted) {
      try {
        const success = await this.rollback(update.id);
        if (success) {
          result.rolledBack.push(update.id);
        } else {
          result.failed.push(update.id);
        }
      } catch (error) {
        result.failed.push(update.id);
        result.errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    return result;
  }
}

/**
 * Create a rollback manager
 */
export function createRollbackManager(
  optimisticManager: OptimisticUpdateManager,
  getCollection: <T extends Document>(name: string) => Collection<T>
): RollbackManager {
  return new RollbackManager(optimisticManager, getCollection);
}
