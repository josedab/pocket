/**
 * Query Profiler — tracks query execution metrics for DevTools display.
 *
 * Records timing, hit counts, and slow query detection for every
 * query executed through the database, providing insights for
 * performance optimization.
 */

import { Subject } from 'rxjs';

/** A single profiled query execution. */
export interface ProfiledQuery {
  readonly id: string;
  readonly collection: string;
  readonly filter?: Record<string, unknown>;
  readonly sort?: Record<string, unknown>;
  readonly durationMs: number;
  readonly resultCount: number;
  readonly scannedCount: number;
  readonly timestamp: number;
  readonly isSlow: boolean;
  readonly usedIndex: boolean;
  readonly source?: string;
}

/** Aggregated query statistics. */
export interface QueryStats {
  readonly totalQueries: number;
  readonly avgDurationMs: number;
  readonly slowQueries: number;
  readonly topCollections: readonly {
    collection: string;
    count: number;
    avgMs: number;
  }[];
  readonly recentQueries: readonly ProfiledQuery[];
}

/** Configuration for the query profiler. */
export interface QueryProfilerConfig {
  /** Duration threshold (ms) for marking a query as slow. Defaults to 100. */
  readonly slowThresholdMs?: number;
  /** Maximum number of recent queries to retain. Defaults to 200. */
  readonly maxHistory?: number;
  /** Whether profiling is enabled. Defaults to true. */
  readonly enabled?: boolean;
}

export class QueryProfiler {
  private readonly history: ProfiledQuery[] = [];
  private readonly config: Required<QueryProfilerConfig>;
  private readonly queries$ = new Subject<ProfiledQuery>();
  private queryCounter = 0;

  constructor(config: QueryProfilerConfig = {}) {
    this.config = {
      slowThresholdMs: config.slowThresholdMs ?? 100,
      maxHistory: config.maxHistory ?? 200,
      enabled: config.enabled ?? true,
    };
  }

  /** Record a query execution. */
  record(entry: Omit<ProfiledQuery, 'id' | 'isSlow'>): void {
    if (!this.config.enabled) return;

    const profiled: ProfiledQuery = {
      ...entry,
      id: `q-${++this.queryCounter}`,
      isSlow: entry.durationMs > this.config.slowThresholdMs,
    };

    this.history.push(profiled);
    if (this.history.length > this.config.maxHistory) {
      this.history.shift();
    }

    this.queries$.next(profiled);
  }

  /** Get aggregated statistics. */
  getStats(): QueryStats {
    const total = this.history.length;
    const totalMs = this.history.reduce((s, q) => s + q.durationMs, 0);

    // Group by collection
    const collMap = new Map<string, { count: number; totalMs: number }>();
    for (const q of this.history) {
      const entry = collMap.get(q.collection) ?? { count: 0, totalMs: 0 };
      entry.count++;
      entry.totalMs += q.durationMs;
      collMap.set(q.collection, entry);
    }

    const topCollections = Array.from(collMap.entries())
      .map(([collection, data]) => ({
        collection,
        count: data.count,
        avgMs: data.count > 0 ? data.totalMs / data.count : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalQueries: total,
      avgDurationMs: total > 0 ? totalMs / total : 0,
      slowQueries: this.history.filter((q) => q.isSlow).length,
      topCollections,
      recentQueries: this.history.slice(-20),
    };
  }

  /** Get all slow queries. */
  getSlowQueries(): readonly ProfiledQuery[] {
    return this.history.filter((q) => q.isSlow);
  }

  /** Observable of profiled queries. */
  get queries() {
    return this.queries$.asObservable();
  }

  /** Clear all history. */
  clear(): void {
    this.history.length = 0;
  }

  /** Shut down. */
  destroy(): void {
    this.queries$.complete();
  }
}

export function createQueryProfiler(config?: QueryProfilerConfig): QueryProfiler {
  return new QueryProfiler(config);
}
