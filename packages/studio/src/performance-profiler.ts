import type { Database, Document } from '@pocket/core';
import type { PerformanceProfile, QueryResult } from './types.js';

/**
 * Aggregate operation statistics.
 */
export interface OperationStats {
  /** Total number of read operations recorded */
  reads: number;
  /** Total number of write operations recorded */
  writes: number;
  /** Average read operation duration in milliseconds */
  avgReadMs: number;
  /** Average write operation duration in milliseconds */
  avgWriteMs: number;
}

/**
 * Performance Profiler for measuring and recording database operation timing.
 *
 * The profiler captures timing data for queries, inserts, updates, and deletes.
 * Use it to identify slow queries, measure overall throughput, and optimize
 * database access patterns.
 *
 * @example
 * ```typescript
 * const profiler = createPerformanceProfiler(db);
 *
 * profiler.startProfiling();
 *
 * // ... perform database operations ...
 *
 * const profiles = profiler.stopProfiling();
 * console.log(`Recorded ${profiles.length} operations`);
 *
 * const slowQueries = profiler.getSlowQueries(50);
 * for (const q of slowQueries) {
 *   console.log(`Slow: ${q.operation} on ${q.collection} took ${q.durationMs}ms`);
 * }
 * ```
 *
 * @see {@link createPerformanceProfiler} for the factory function
 */
export class PerformanceProfiler {
  private readonly db: Database;
  private profiles: PerformanceProfile[] = [];
  private isProfiling = false;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Start capturing performance profiles.
   *
   * Clears any previously recorded profiles and begins a new
   * profiling session.
   */
  startProfiling(): void {
    this.profiles = [];
    this.isProfiling = true;
  }

  /**
   * Stop profiling and return all captured profiles.
   *
   * @returns Array of performance profiles recorded during the session
   */
  stopProfiling(): PerformanceProfile[] {
    this.isProfiling = false;
    return [...this.profiles];
  }

  /**
   * Whether profiling is currently active.
   */
  get isActive(): boolean {
    return this.isProfiling;
  }

  /**
   * Record a performance profile entry.
   *
   * This can be called externally when an operation is performed
   * and the profiler is active, or internally by profileQuery.
   *
   * @param profile - The profile entry to record
   */
  record(profile: PerformanceProfile): void {
    if (this.isProfiling) {
      this.profiles.push(profile);
    }
  }

  /**
   * Execute a query and profile its performance.
   *
   * Runs the query against the specified collection and returns
   * both the query result and a performance profile entry.
   *
   * @param collection - The collection name to query
   * @param filter - The filter to apply
   * @returns Object containing the query result and performance profile
   */
  async profileQuery(
    collection: string,
    filter: Record<string, unknown>
  ): Promise<{ result: QueryResult; profile: PerformanceProfile }> {
    const coll = this.db.collection(collection);
    const startTime = performance.now();

    const totalCount = await coll.count(filter as Partial<Document> | undefined);
    const documents = await coll.find(filter as Partial<Document>).exec();

    const durationMs = performance.now() - startTime;

    const result: QueryResult = {
      documents,
      totalCount,
      executionTimeMs: durationMs,
    };

    const profile: PerformanceProfile = {
      operation: 'query',
      collection,
      durationMs,
      documentCount: documents.length,
      timestamp: Date.now(),
    };

    // Record if profiling is active
    this.record(profile);

    return { result, profile };
  }

  /**
   * Get all recorded profiles that exceed a duration threshold.
   *
   * @param thresholdMs - Minimum duration in milliseconds to be considered slow.
   *   Defaults to 100ms.
   * @returns Array of profiles exceeding the threshold, sorted by duration descending
   */
  getSlowQueries(thresholdMs = 100): PerformanceProfile[] {
    return this.profiles
      .filter((p) => p.durationMs >= thresholdMs)
      .sort((a, b) => b.durationMs - a.durationMs);
  }

  /**
   * Get aggregate operation statistics from recorded profiles.
   *
   * @returns Statistics including read/write counts and average durations
   */
  getOperationStats(): OperationStats {
    const readOps = this.profiles.filter(
      (p) => p.operation === 'query' || p.operation === 'get'
    );
    const writeOps = this.profiles.filter(
      (p) =>
        p.operation === 'insert' ||
        p.operation === 'update' ||
        p.operation === 'delete'
    );

    const avgReadMs =
      readOps.length > 0
        ? readOps.reduce((sum, p) => sum + p.durationMs, 0) / readOps.length
        : 0;

    const avgWriteMs =
      writeOps.length > 0
        ? writeOps.reduce((sum, p) => sum + p.durationMs, 0) / writeOps.length
        : 0;

    return {
      reads: readOps.length,
      writes: writeOps.length,
      avgReadMs,
      avgWriteMs,
    };
  }

  /**
   * Get all recorded profiles.
   *
   * @returns Array of all performance profiles
   */
  getAllProfiles(): PerformanceProfile[] {
    return [...this.profiles];
  }

  /**
   * Clear all recorded profiles without stopping profiling.
   */
  clearProfiles(): void {
    this.profiles = [];
  }
}

/**
 * Create a new PerformanceProfiler instance.
 *
 * @param db - The Pocket Database instance to profile
 * @returns A new PerformanceProfiler
 *
 * @example
 * ```typescript
 * import { createPerformanceProfiler } from '@pocket/studio';
 *
 * const profiler = createPerformanceProfiler(db);
 * profiler.startProfiling();
 *
 * // Run operations...
 *
 * const profiles = profiler.stopProfiling();
 * const stats = profiler.getOperationStats();
 * console.log(`Reads: ${stats.reads}, Writes: ${stats.writes}`);
 * ```
 */
export function createPerformanceProfiler(db: Database): PerformanceProfiler {
  return new PerformanceProfiler(db);
}
