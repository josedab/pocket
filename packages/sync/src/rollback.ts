import type { Collection, Document } from '@pocket/core';
import type { OptimisticUpdate, OptimisticUpdateManager } from './optimistic.js';

/**
 * Rollback result
 */
export interface RollbackResult {
  /** IDs of rolled back updates */
  rolledBack: string[];
  /** IDs that failed to rollback */
  failed: string[];
  /** Errors encountered */
  errors: Error[];
}

/**
 * Rollback manager for reverting optimistic updates
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
