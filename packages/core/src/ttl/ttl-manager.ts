/**
 * @pocket/core - TTL Manager
 *
 * Manages document expiration based on TTL (Time-To-Live) settings.
 *
 * @module @pocket/core/ttl
 */

import type { Document } from '../types/document.js';

/**
 * TTL configuration
 */
export interface TTLConfig {
  /** Field that contains the expiration timestamp */
  field: string;
  /** Cleanup interval in milliseconds (default: 60000 = 1 minute) */
  cleanupIntervalMs?: number;
  /** Whether to use soft delete instead of hard delete */
  softDelete?: boolean;
}

/**
 * TTL-enabled collection interface
 */
export interface TTLCollection<T extends Document = Document> {
  /** Collection name */
  name: string;
  /** Find documents matching a filter */
  find: (filter: Record<string, unknown>) => { exec: () => Promise<T[]> };
  /** Delete a document by ID */
  delete: (id: string) => Promise<void>;
  /** Get all documents */
  getAll: () => Promise<T[]>;
}

/**
 * TTL cleanup result
 */
export interface TTLCleanupResult {
  /** Number of documents deleted */
  deletedCount: number;
  /** Collection name */
  collection: string;
  /** Execution time in ms */
  executionTimeMs: number;
  /** Any errors encountered */
  errors: { id: string; error: Error }[];
}

/**
 * TTL Manager
 *
 * Manages automatic cleanup of expired documents based on TTL settings.
 *
 * @example
 * ```typescript
 * const ttlManager = new TTLManager();
 *
 * // Register collections with TTL
 * ttlManager.register('sessions', sessionsCollection, {
 *   field: 'expiresAt',
 *   cleanupIntervalMs: 60000
 * });
 *
 * // Start automatic cleanup
 * ttlManager.start();
 *
 * // Manual cleanup
 * const result = await ttlManager.cleanup('sessions');
 * console.log(`Cleaned up ${result.deletedCount} sessions`);
 *
 * // Stop cleanup when done
 * ttlManager.stop();
 * ```
 */
export class TTLManager {
  private collections = new Map<string, { collection: TTLCollection; config: TTLConfig }>();
  private cleanupIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private isRunning = false;

  /**
   * Register a collection for TTL management
   *
   * @param name - Collection name
   * @param collection - The collection instance
   * @param config - TTL configuration
   */
  register<T extends Document>(
    name: string,
    collection: TTLCollection<T>,
    config: TTLConfig
  ): void {
    this.collections.set(name, {
      collection: collection as TTLCollection,
      config: {
        cleanupIntervalMs: 60000,
        softDelete: false,
        ...config,
      },
    });

    // Start cleanup interval if manager is running
    if (this.isRunning) {
      this.startCollectionCleanup(name);
    }
  }

  /**
   * Unregister a collection from TTL management
   *
   * @param name - Collection name
   */
  unregister(name: string): void {
    const interval = this.cleanupIntervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.cleanupIntervals.delete(name);
    }
    this.collections.delete(name);
  }

  /**
   * Start automatic TTL cleanup for all registered collections
   *
   * @param intervalMs - Override cleanup interval for all collections (optional)
   */
  start(intervalMs?: number): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    for (const [name, { config }] of this.collections) {
      const interval = intervalMs ?? config.cleanupIntervalMs ?? 60000;
      this.startCollectionCleanup(name, interval);
    }
  }

  /**
   * Stop automatic TTL cleanup
   */
  stop(): void {
    this.isRunning = false;

    for (const interval of this.cleanupIntervals.values()) {
      clearInterval(interval);
    }
    this.cleanupIntervals.clear();
  }

  /**
   * Check if automatic cleanup is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get registered collection names
   */
  getCollections(): string[] {
    return Array.from(this.collections.keys());
  }

  /**
   * Manually trigger cleanup for a specific collection
   *
   * @param collectionName - Collection to clean up
   * @returns Cleanup result
   */
  async cleanup(collectionName: string): Promise<TTLCleanupResult> {
    const startTime = performance.now();
    const entry = this.collections.get(collectionName);

    if (!entry) {
      throw new Error(`Collection "${collectionName}" is not registered for TTL management`);
    }

    const { collection, config } = entry;
    const now = new Date();
    const errors: TTLCleanupResult['errors'] = [];
    let deletedCount = 0;

    try {
      // Find expired documents
      const expiredDocs = await collection
        .find({
          [config.field]: { $lte: now },
        })
        .exec();

      // Delete each expired document
      for (const doc of expiredDocs) {
        try {
          await collection.delete(doc._id);
          deletedCount++;
        } catch (error) {
          errors.push({
            id: doc._id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    } catch (error) {
      throw new Error(
        `TTL cleanup failed for ${collectionName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const endTime = performance.now();

    return {
      deletedCount,
      collection: collectionName,
      executionTimeMs: Math.round((endTime - startTime) * 100) / 100,
      errors,
    };
  }

  /**
   * Clean up all registered collections
   *
   * @returns Array of cleanup results
   */
  async cleanupAll(): Promise<TTLCleanupResult[]> {
    const results: TTLCleanupResult[] = [];

    for (const name of this.collections.keys()) {
      try {
        const result = await this.cleanup(name);
        results.push(result);
      } catch (error) {
        results.push({
          deletedCount: 0,
          collection: name,
          executionTimeMs: 0,
          errors: [
            {
              id: 'cleanup-error',
              error: error instanceof Error ? error : new Error(String(error)),
            },
          ],
        });
      }
    }

    return results;
  }

  /**
   * Get statistics for a collection
   *
   * @param collectionName - Collection name
   * @returns Statistics including expired count
   */
  async getStats(collectionName: string): Promise<{
    totalCount: number;
    expiredCount: number;
    nextExpirationAt: Date | null;
  }> {
    const entry = this.collections.get(collectionName);

    if (!entry) {
      throw new Error(`Collection "${collectionName}" is not registered for TTL management`);
    }

    const { collection, config } = entry;
    const now = new Date();

    // Get all documents
    const allDocs = await collection.getAll();
    const totalCount = allDocs.length;

    // Count expired
    const expiredCount = allDocs.filter((doc) => {
      const expiresAt = doc[config.field as keyof typeof doc];
      if (expiresAt instanceof Date) {
        return expiresAt <= now;
      }
      if (typeof expiresAt === 'string' || typeof expiresAt === 'number') {
        return new Date(expiresAt) <= now;
      }
      return false;
    }).length;

    // Find next expiration
    let nextExpirationAt: Date | null = null;
    for (const doc of allDocs) {
      const expiresAt = doc[config.field as keyof typeof doc];
      let expDate: Date | null = null;

      if (expiresAt instanceof Date) {
        expDate = expiresAt;
      } else if (typeof expiresAt === 'string' || typeof expiresAt === 'number') {
        expDate = new Date(expiresAt);
      }

      if (expDate && expDate > now) {
        if (!nextExpirationAt || expDate < nextExpirationAt) {
          nextExpirationAt = expDate;
        }
      }
    }

    return {
      totalCount,
      expiredCount,
      nextExpirationAt,
    };
  }

  /**
   * Start cleanup interval for a specific collection
   */
  private startCollectionCleanup(name: string, intervalMs?: number): void {
    const entry = this.collections.get(name);
    if (!entry) return;

    const interval = intervalMs ?? entry.config.cleanupIntervalMs ?? 60000;

    // Clear existing interval if any
    const existingInterval = this.cleanupIntervals.get(name);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Set up new interval
    const cleanupInterval = setInterval(() => {
      this.cleanup(name).catch((error: unknown) => {
        console.error(`TTL cleanup error for ${name}:`, error);
      });
    }, interval);

    this.cleanupIntervals.set(name, cleanupInterval);
  }
}

/**
 * Create a TTL manager instance
 *
 * @returns A new TTL manager
 *
 * @example
 * ```typescript
 * const ttl = createTTLManager();
 *
 * ttl.register('sessions', sessionsCollection, {
 *   field: 'expiresAt'
 * });
 *
 * ttl.start();
 * ```
 */
export function createTTLManager(): TTLManager {
  return new TTLManager();
}
