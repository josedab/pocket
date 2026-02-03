/**
 * QueryPlayground - Interactive query builder and profiler for Pocket Studio.
 *
 * Provides a programmatic interface for building, executing, profiling,
 * and replaying queries against a Pocket database.
 */

import type { Database, Document } from '@pocket/core';
import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';
import type { StudioEvent } from './types.js';

export interface QueryHistoryEntry {
  id: string;
  collection: string;
  filter: Record<string, unknown>;
  sort?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  skip?: number;
  executedAt: number;
  durationMs: number;
  resultCount: number;
  error?: string;
  explain?: QueryExplainResult;
}

export interface QueryExplainResult {
  strategy: 'full-scan' | 'index-scan' | 'key-lookup';
  indexUsed?: string;
  documentsScanned: number;
  documentsReturned: number;
  estimatedCostMs: number;
  suggestions: string[];
}

export interface SavedQuery {
  id: string;
  name: string;
  description?: string;
  collection: string;
  filter: Record<string, unknown>;
  sort?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
}

export interface QueryPlaygroundConfig {
  /** Maximum history entries to retain */
  maxHistory?: number;
  /** Enable query explain/profiling */
  enableExplain?: boolean;
  /** Timeout for query execution in ms */
  queryTimeoutMs?: number;
}

export class QueryPlayground {
  private readonly db: Database;
  private readonly config: Required<QueryPlaygroundConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly events$ = new Subject<StudioEvent>();
  private readonly history$ = new BehaviorSubject<QueryHistoryEntry[]>([]);
  private readonly savedQueries$ = new BehaviorSubject<SavedQuery[]>([]);

  constructor(db: Database, config: QueryPlaygroundConfig = {}) {
    this.db = db;
    this.config = {
      maxHistory: config.maxHistory ?? 100,
      enableExplain: config.enableExplain ?? true,
      queryTimeoutMs: config.queryTimeoutMs ?? 30_000,
    };
  }

  /**
   * Execute a query and record it in history.
   */
  async executeQuery(options: {
    collection: string;
    filter?: Record<string, unknown>;
    sort?: Record<string, 'asc' | 'desc'>;
    limit?: number;
    skip?: number;
  }): Promise<{ results: unknown[]; entry: QueryHistoryEntry }> {
    const startTime = Date.now();
    const entryId = `qh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      const collection = this.db.collection(options.collection);
      let queryBuilder = collection.find(options.filter as Partial<Document> | undefined);

      if (options.sort) {
        for (const [field, direction] of Object.entries(options.sort)) {
          queryBuilder = queryBuilder.sort(field as keyof Document & string, direction);
        }
      }

      if (options.limit !== undefined && options.limit > 0) {
        queryBuilder = queryBuilder.limit(options.limit + (options.skip ?? 0));
      }

      let results: unknown[] = await queryBuilder.exec();

      // Apply skip manually since the query builder may not support it
      if (options.skip && options.skip > 0) {
        results = results.slice(options.skip);
      }

      const durationMs = Date.now() - startTime;

      let explain: QueryExplainResult | undefined;
      if (this.config.enableExplain) {
        explain = this.explainQuery(options, results.length, durationMs);
      }

      const entry: QueryHistoryEntry = {
        id: entryId,
        collection: options.collection,
        filter: options.filter ?? {},
        sort: options.sort,
        limit: options.limit,
        skip: options.skip,
        executedAt: Date.now(),
        durationMs,
        resultCount: results.length,
        explain,
      };

      this.addToHistory(entry);

      this.events$.next({
        type: 'query-playground:executed',
        collection: options.collection,
        durationMs,
        resultCount: results.length,
      });

      return { results, entry };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const entry: QueryHistoryEntry = {
        id: entryId,
        collection: options.collection,
        filter: options.filter ?? {},
        sort: options.sort,
        limit: options.limit,
        skip: options.skip,
        executedAt: Date.now(),
        durationMs,
        resultCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };

      this.addToHistory(entry);
      throw error;
    }
  }

  /**
   * Replay a query from history.
   */
  async replayQuery(historyEntryId: string): Promise<{ results: unknown[]; entry: QueryHistoryEntry }> {
    const history = this.history$.getValue();
    const original = history.find((e) => e.id === historyEntryId);
    if (!original) {
      throw new Error(`History entry not found: ${historyEntryId}`);
    }

    return this.executeQuery({
      collection: original.collection,
      filter: original.filter,
      sort: original.sort,
      limit: original.limit,
      skip: original.skip,
    });
  }

  /**
   * Save a query for later use.
   */
  saveQuery(query: Omit<SavedQuery, 'id' | 'createdAt' | 'updatedAt'>): SavedQuery {
    const saved: SavedQuery = {
      ...query,
      id: `sq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const queries = [...this.savedQueries$.getValue(), saved];
    this.savedQueries$.next(queries);

    this.events$.next({
      type: 'query-playground:saved',
      collection: query.collection,
      queryId: saved.id,
      name: saved.name,
    });

    return saved;
  }

  /**
   * Delete a saved query.
   */
  deleteSavedQuery(queryId: string): boolean {
    const queries = this.savedQueries$.getValue();
    const filtered = queries.filter((q) => q.id !== queryId);
    if (filtered.length === queries.length) return false;
    this.savedQueries$.next(filtered);
    return true;
  }

  /**
   * Get query history as an observable.
   */
  getHistory(): Observable<QueryHistoryEntry[]> {
    return this.history$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get saved queries as an observable.
   */
  getSavedQueries(): Observable<SavedQuery[]> {
    return this.savedQueries$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get studio events from the playground.
   */
  getEvents(): Observable<StudioEvent> {
    return this.events$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Clear all history.
   */
  clearHistory(): void {
    this.history$.next([]);
  }

  /**
   * Get slow queries from history.
   */
  getSlowQueries(thresholdMs = 100): QueryHistoryEntry[] {
    return this.history$.getValue().filter((e) => e.durationMs > thresholdMs);
  }

  /**
   * Get aggregate query statistics.
   */
  getStats(): {
    totalQueries: number;
    avgDurationMs: number;
    slowQueries: number;
    errorRate: number;
    topCollections: { collection: string; count: number }[];
  } {
    const history = this.history$.getValue();
    const total = history.length;
    if (total === 0) {
      return { totalQueries: 0, avgDurationMs: 0, slowQueries: 0, errorRate: 0, topCollections: [] };
    }

    const avgDuration = history.reduce((sum, e) => sum + e.durationMs, 0) / total;
    const slow = history.filter((e) => e.durationMs > 100).length;
    const errors = history.filter((e) => e.error).length;

    const collectionCounts = new Map<string, number>();
    for (const entry of history) {
      collectionCounts.set(entry.collection, (collectionCounts.get(entry.collection) ?? 0) + 1);
    }

    const topCollections = Array.from(collectionCounts.entries())
      .map(([collection, count]) => ({ collection, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalQueries: total,
      avgDurationMs: Math.round(avgDuration * 100) / 100,
      slowQueries: slow,
      errorRate: errors / total,
      topCollections,
    };
  }

  /**
   * Destroy the playground and complete all streams.
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.events$.complete();
    this.history$.complete();
    this.savedQueries$.complete();
  }

  private addToHistory(entry: QueryHistoryEntry): void {
    const history = this.history$.getValue();
    const updated = [entry, ...history].slice(0, this.config.maxHistory);
    this.history$.next(updated);
  }

  private explainQuery(
    options: { collection: string; filter?: Record<string, unknown>; sort?: Record<string, string> },
    resultCount: number,
    durationMs: number
  ): QueryExplainResult {
    const suggestions: string[] = [];
    const hasFilter = options.filter && Object.keys(options.filter).length > 0;
    const hasSort = options.sort && Object.keys(options.sort).length > 0;

    let strategy: QueryExplainResult['strategy'] = 'full-scan';

    if (!hasFilter && !hasSort) {
      strategy = 'full-scan';
      suggestions.push('Consider adding filters to reduce scan scope');
    } else if (hasFilter) {
      strategy = 'full-scan'; // Without index info, assume scan
      const filterKeys = Object.keys(options.filter!);
      for (const key of filterKeys) {
        suggestions.push(`Consider creating an index on "${options.collection}.${key}" for faster queries`);
      }
    }

    if (durationMs > 100) {
      suggestions.push('Query took >100ms - consider adding indexes or reducing result set');
    }

    if (resultCount > 1000) {
      suggestions.push('Large result set - consider using pagination with limit/skip');
    }

    return {
      strategy,
      documentsScanned: resultCount,
      documentsReturned: resultCount,
      estimatedCostMs: durationMs,
      suggestions,
    };
  }
}

/**
 * Create a new QueryPlayground instance.
 *
 * @param db - The Pocket Database instance
 * @param config - Optional playground configuration
 * @returns A new QueryPlayground
 *
 * @example
 * ```typescript
 * import { createQueryPlayground } from '@pocket/studio';
 *
 * const playground = createQueryPlayground(db, { maxHistory: 50 });
 * const { results } = await playground.executeQuery({
 *   collection: 'users',
 *   filter: { role: 'admin' },
 * });
 * ```
 */
export function createQueryPlayground(db: Database, config?: QueryPlaygroundConfig): QueryPlayground {
  return new QueryPlayground(db, config);
}
