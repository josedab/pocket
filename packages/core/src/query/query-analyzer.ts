/**
 * Query performance analyzer with index advisor.
 *
 * Records query execution profiles, detects slow queries, and suggests
 * indexes based on observed query patterns.
 */

import { Subject, type Observable } from 'rxjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryProfile {
  queryId: string;
  collection: string;
  filter: Record<string, unknown>;
  executionTimeMs: number;
  documentsScanned: number;
  documentsReturned: number;
  indexUsed: string | null;
  timestamp: number;
}

export interface SlowQuery {
  profile: QueryProfile;
  suggestion: string;
}

export interface AnalyzerIndexSuggestion {
  collection: string;
  fields: string[];
  reason: string;
  estimatedSpeedup: string;
}

export interface AnalyzerConfig {
  /** Execution time threshold for slow query detection (default: 100 ms) */
  slowQueryThresholdMs?: number;
  /** Maximum number of profiles to retain (default: 1000) */
  maxProfiles?: number;
  /** Sampling rate between 0 and 1 (default: 1 — record every query) */
  samplingRate?: number;
  /** @internal Custom random source for testing */
  _randomFn?: () => number;
}

export interface AnalyzerStats {
  totalProfiled: number;
  slowQueries: number;
  avgExecutionTimeMs: number;
  topCollections: Array<{ name: string; queryCount: number }>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractFilterFields(filter: Record<string, unknown>, prefix = ''): string[] {
  const fields: string[] = [];
  for (const key of Object.keys(filter)) {
    if (key.startsWith('$')) {
      // Logical operators like $and, $or contain arrays of sub-filters
      const value = filter[key];
      if (Array.isArray(value)) {
        for (const sub of value) {
          if (sub && typeof sub === 'object') {
            fields.push(...extractFilterFields(sub as Record<string, unknown>, prefix));
          }
        }
      }
      continue;
    }
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const value = filter[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      const hasOperators = Object.keys(nested).some((k) => k.startsWith('$'));
      if (hasOperators) {
        fields.push(fullPath);
      } else {
        fields.push(...extractFilterFields(nested, fullPath));
      }
    } else {
      fields.push(fullPath);
    }
  }
  return fields;
}

function buildSlowQuerySuggestion(profile: QueryProfile): string {
  const ratio =
    profile.documentsReturned > 0
      ? profile.documentsScanned / profile.documentsReturned
      : profile.documentsScanned;

  const fields = extractFilterFields(profile.filter);

  if (fields.length > 0 && ratio > 10) {
    return `Consider adding an index on [${fields.join(', ')}] in "${profile.collection}" — scanned ${profile.documentsScanned} documents to return ${profile.documentsReturned}.`;
  }
  if (fields.length > 0) {
    return `Query on "${profile.collection}" filtering by [${fields.join(', ')}] took ${profile.executionTimeMs}ms.`;
  }
  return `Query on "${profile.collection}" took ${profile.executionTimeMs}ms with no indexed filter fields.`;
}

// ---------------------------------------------------------------------------
// QueryAnalyzer
// ---------------------------------------------------------------------------

export class QueryAnalyzer {
  private readonly profiles: QueryProfile[] = [];
  private readonly config: Required<Omit<AnalyzerConfig, '_randomFn'>>;
  private readonly randomFn: () => number;
  private readonly slowQuerySubject = new Subject<SlowQuery>();

  /** Observable that emits when a new slow query is detected. */
  readonly slowQueries$: Observable<SlowQuery> = this.slowQuerySubject.asObservable();

  constructor(config: AnalyzerConfig = {}) {
    this.config = {
      slowQueryThresholdMs: config.slowQueryThresholdMs ?? 100,
      maxProfiles: config.maxProfiles ?? 1000,
      samplingRate: config.samplingRate ?? 1,
    };
    this.randomFn = config._randomFn ?? (() => Math.random());
  }

  /**
   * Record a query execution profile.
   *
   * Respects the configured sampling rate — when the rate is below 1, only a
   * fraction of profiles are stored.
   */
  profile(profile: QueryProfile): void {
    if (this.config.samplingRate < 1 && this.randomFn() >= this.config.samplingRate) {
      return;
    }

    if (this.profiles.length >= this.config.maxProfiles) {
      this.profiles.shift();
    }

    this.profiles.push(profile);

    if (profile.executionTimeMs > this.config.slowQueryThresholdMs) {
      const slow: SlowQuery = {
        profile,
        suggestion: buildSlowQuerySuggestion(profile),
      };
      this.slowQuerySubject.next(slow);
    }
  }

  /**
   * Return queries that exceeded the slow-query threshold, sorted by
   * execution time descending.
   */
  getSlowQueries(limit?: number): SlowQuery[] {
    const slow = this.profiles
      .filter((p) => p.executionTimeMs > this.config.slowQueryThresholdMs)
      .sort((a, b) => b.executionTimeMs - a.executionTimeMs)
      .map((p) => ({
        profile: p,
        suggestion: buildSlowQuerySuggestion(p),
      }));

    return limit !== undefined ? slow.slice(0, limit) : slow;
  }

  /**
   * Analyze recorded query patterns and suggest indexes.
   *
   * A field is suggested for indexing when it appears in more than 3 queries
   * and the average scan-to-return ratio for those queries is high.
   */
  suggestIndexes(): AnalyzerIndexSuggestion[] {
    const fieldStats = new Map<
      string,
      { collection: string; field: string; count: number; totalScanned: number; totalReturned: number }
    >();

    for (const p of this.profiles) {
      const fields = extractFilterFields(p.filter);
      for (const field of fields) {
        const key = `${p.collection}:${field}`;
        const existing = fieldStats.get(key);
        if (existing) {
          existing.count++;
          existing.totalScanned += p.documentsScanned;
          existing.totalReturned += p.documentsReturned;
        } else {
          fieldStats.set(key, {
            collection: p.collection,
            field,
            count: 1,
            totalScanned: p.documentsScanned,
            totalReturned: p.documentsReturned,
          });
        }
      }
    }

    const suggestions: AnalyzerIndexSuggestion[] = [];

    for (const stat of fieldStats.values()) {
      if (stat.count <= 3) continue;

      const avgScanned = stat.totalScanned / stat.count;
      const avgReturned = stat.totalReturned / stat.count || 1;
      const ratio = avgScanned / avgReturned;

      const estimatedSpeedup = ratio > 10 ? 'high' : ratio > 3 ? 'medium' : 'low';

      suggestions.push({
        collection: stat.collection,
        fields: [stat.field],
        reason: `Field "${stat.field}" used in ${stat.count} queries with avg scan ratio ${ratio.toFixed(1)}:1.`,
        estimatedSpeedup,
      });
    }

    return suggestions.sort((a, b) => {
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return (order[a.estimatedSpeedup] ?? 3) - (order[b.estimatedSpeedup] ?? 3);
    });
  }

  /**
   * Retrieve recorded profiles, optionally filtered by collection.
   */
  getProfiles(collection?: string, limit?: number): QueryProfile[] {
    let result = collection ? this.profiles.filter((p) => p.collection === collection) : [...this.profiles];
    if (limit !== undefined) {
      result = result.slice(0, limit);
    }
    return result;
  }

  /**
   * Return aggregate statistics about profiled queries.
   */
  getStats(): AnalyzerStats {
    const total = this.profiles.length;
    const slow = this.profiles.filter((p) => p.executionTimeMs > this.config.slowQueryThresholdMs).length;
    const avg = total > 0 ? this.profiles.reduce((sum, p) => sum + p.executionTimeMs, 0) / total : 0;

    const collectionCounts = new Map<string, number>();
    for (const p of this.profiles) {
      collectionCounts.set(p.collection, (collectionCounts.get(p.collection) ?? 0) + 1);
    }

    const topCollections = [...collectionCounts.entries()]
      .map(([name, queryCount]) => ({ name, queryCount }))
      .sort((a, b) => b.queryCount - a.queryCount);

    return {
      totalProfiled: total,
      slowQueries: slow,
      avgExecutionTimeMs: Math.round(avg * 100) / 100,
      topCollections,
    };
  }

  /**
   * Return the most frequently queried fields for a collection.
   */
  getTopFields(collection: string): Array<{ field: string; queryCount: number }> {
    const fieldCounts = new Map<string, number>();
    for (const p of this.profiles) {
      if (p.collection !== collection) continue;
      const fields = extractFilterFields(p.filter);
      for (const field of fields) {
        fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
      }
    }

    return [...fieldCounts.entries()]
      .map(([field, queryCount]) => ({ field, queryCount }))
      .sort((a, b) => b.queryCount - a.queryCount);
  }

  /**
   * Clear all recorded profiles.
   */
  clear(): void {
    this.profiles.length = 0;
  }

  /** Release resources */
  destroy(): void {
    this.slowQuerySubject.complete();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new {@link QueryAnalyzer} instance.
 */
export function createQueryAnalyzer(config?: AnalyzerConfig): QueryAnalyzer {
  return new QueryAnalyzer(config);
}
