/**
 * @pocket/query-advisor — Query performance advisor engine.
 *
 * Profiles queries, identifies patterns, suggests indexes, and generates
 * optimization recommendations.
 *
 * @module @pocket/query-advisor
 */

import { Subject, type Subscription, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import type {
  CollectionQueryStats,
  DiagnosticsReport,
  ExistingIndex,
  IndexSuggestion,
  QueryAdvisorConfig,
  QueryPattern,
  QueryPlanNode,
  QueryProfile,
  Recommendation,
} from './types.js';

// ── Query Advisor ─────────────────────────────────────────

let profileIdCounter = 0;
let recIdCounter = 0;

const DEFAULT_CONFIG: Required<QueryAdvisorConfig> = {
  slowQueryThresholdMs: 100,
  maxProfiles: 10_000,
  autoAnalyze: true,
  analysisIntervalMs: 60_000,
  minFrequencyForSuggestion: 3,
};

export type AdvisorEvent =
  | { type: 'slow_query'; profile: QueryProfile }
  | { type: 'analysis_complete'; report: DiagnosticsReport }
  | { type: 'recommendation'; recommendation: Recommendation };

/**
 * Analyzes query patterns, identifies slow queries, and provides
 * index creation and optimization recommendations.
 */
export class QueryAdvisor {
  private readonly config: Required<QueryAdvisorConfig>;
  private readonly profiles: QueryProfile[] = [];
  private readonly existingIndexes = new Map<string, ExistingIndex[]>();
  private readonly events$$ = new Subject<AdvisorEvent>();
  private readonly destroy$ = new Subject<void>();
  private lastReport: DiagnosticsReport | null = null;
  private analysisSub: Subscription | null = null;

  readonly events$ = this.events$$.asObservable();

  constructor(config?: QueryAdvisorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.autoAnalyze) {
      this.analysisSub = interval(this.config.analysisIntervalMs)
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => { this.analyze(); });
    }
  }

  /**
   * Record a query execution profile.
   * Call this after each query completes.
   */
  recordQuery(profile: Omit<QueryProfile, 'id' | 'timestamp'>): QueryProfile {
    const fullProfile: QueryProfile = {
      ...profile,
      id: `qp_${++profileIdCounter}`,
      timestamp: Date.now(),
    };

    this.profiles.push(fullProfile);

    // Enforce max profiles
    while (this.profiles.length > this.config.maxProfiles) {
      this.profiles.shift();
    }

    // Track index usage
    if (fullProfile.indexUsed) {
      const indexes = this.existingIndexes.get(fullProfile.collection) ?? [];
      const idx = indexes.find((i) => i.name === fullProfile.indexUsed);
      if (idx) {
        idx.usageCount++;
        idx.lastUsed = Date.now();
      }
    }

    // Emit slow query event
    if (fullProfile.executionTimeMs > this.config.slowQueryThresholdMs) {
      this.events$$.next({ type: 'slow_query', profile: fullProfile });
    }

    return fullProfile;
  }

  /** Register existing indexes for a collection */
  registerIndexes(collection: string, indexes: ExistingIndex[]): void {
    this.existingIndexes.set(collection, indexes);
  }

  /**
   * Analyze recorded queries and generate a diagnostics report.
   */
  analyze(): DiagnosticsReport {
    const patterns = this.identifyPatterns();
    const slowQueries = this.getSlowQueries();
    const indexSuggestions = this.suggestIndexes(patterns);
    const recommendations = this.generateRecommendations(patterns, slowQueries);
    const unusedIndexes = this.findUnusedIndexes();
    const collectionStats = this.computeCollectionStats();

    const report: DiagnosticsReport = {
      generatedAt: Date.now(),
      totalQueriesProfiled: this.profiles.length,
      slowQueries,
      patterns,
      indexSuggestions,
      recommendations,
      unusedIndexes,
      collectionStats,
    };

    this.lastReport = report;
    this.events$$.next({ type: 'analysis_complete', report });

    return report;
  }

  /** Get the most recent diagnostics report */
  getLastReport(): DiagnosticsReport | null {
    return this.lastReport;
  }

  /** Get slow queries above the threshold */
  getSlowQueries(): QueryProfile[] {
    return this.profiles
      .filter((p) => p.executionTimeMs > this.config.slowQueryThresholdMs)
      .sort((a, b) => b.executionTimeMs - a.executionTimeMs);
  }

  /**
   * Generate a query execution plan (estimated).
   */
  explainQuery(
    collection: string,
    filter: Record<string, unknown>,
    sort?: Record<string, 1 | -1>,
  ): QueryPlanNode {
    const indexes = this.existingIndexes.get(collection) ?? [];
    const filterFields = Object.keys(filter);
    const sortFields = sort ? Object.keys(sort) : [];

    // Check if any index covers the filter
    const matchingIndex = indexes.find((idx) =>
      filterFields.every((f) => idx.fields.includes(f)),
    );

    if (matchingIndex) {
      const plan: QueryPlanNode = {
        type: 'index_scan',
        collection,
        index: matchingIndex.name,
        fields: matchingIndex.fields,
        estimatedCost: 1,
      };

      if (sortFields.length > 0) {
        const indexCoversSort = sortFields.every((f) => matchingIndex.fields.includes(f));
        if (!indexCoversSort) {
          return {
            type: 'sort',
            fields: sortFields,
            estimatedCost: 3,
            children: [plan],
          };
        }
      }

      return plan;
    }

    // Full collection scan
    const scanPlan: QueryPlanNode = {
      type: 'collection_scan',
      collection,
      estimatedCost: 10,
    };

    const filterPlan: QueryPlanNode = {
      type: 'filter',
      fields: filterFields,
      estimatedCost: 5,
      children: [scanPlan],
    };

    if (sortFields.length > 0) {
      return {
        type: 'sort',
        fields: sortFields,
        estimatedCost: 8,
        children: [filterPlan],
      };
    }

    return filterPlan;
  }

  /** Clear all profiles */
  clearProfiles(): void {
    this.profiles.length = 0;
  }

  /** Destroy the advisor */
  destroy(): void {
    this.analysisSub?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
    this.events$$.complete();
  }

  // ── Analysis Internals ────────────────────────────────

  private identifyPatterns(): QueryPattern[] {
    const patternMap = new Map<string, QueryPattern>();

    for (const profile of this.profiles) {
      const key = `${profile.collection}:${Object.keys(profile.filter).sort().join(',')}:${
        profile.sort ? Object.keys(profile.sort).sort().join(',') : ''
      }`;

      const existing = patternMap.get(key);
      if (existing) {
        existing.frequency++;
        existing.totalExecutions++;
        existing.avgExecutionTimeMs =
          (existing.avgExecutionTimeMs * (existing.totalExecutions - 1) + profile.executionTimeMs) / existing.totalExecutions;
        existing.maxExecutionTimeMs = Math.max(existing.maxExecutionTimeMs, profile.executionTimeMs);
        existing.lastSeen = profile.timestamp;
      } else {
        patternMap.set(key, {
          collection: profile.collection,
          filterFields: Object.keys(profile.filter).sort(),
          sortFields: profile.sort ? Object.keys(profile.sort).sort() : [],
          frequency: 1,
          avgExecutionTimeMs: profile.executionTimeMs,
          maxExecutionTimeMs: profile.executionTimeMs,
          totalExecutions: 1,
          firstSeen: profile.timestamp,
          lastSeen: profile.timestamp,
        });
      }
    }

    return Array.from(patternMap.values())
      .sort((a, b) => b.frequency - a.frequency);
  }

  private suggestIndexes(patterns: QueryPattern[]): IndexSuggestion[] {
    const suggestions: IndexSuggestion[] = [];

    for (const pattern of patterns) {
      if (pattern.frequency < this.config.minFrequencyForSuggestion) continue;
      if (pattern.filterFields.length === 0) continue;

      // Check if an existing index already covers this pattern
      const indexes = this.existingIndexes.get(pattern.collection) ?? [];
      const covered = indexes.some((idx) =>
        pattern.filterFields.every((f) => idx.fields.includes(f)),
      );
      if (covered) continue;

      const fields = [...pattern.filterFields, ...pattern.sortFields.filter((f) => !pattern.filterFields.includes(f))];
      const type = fields.length > 1 ? 'compound' : 'single';

      const impact = pattern.avgExecutionTimeMs > this.config.slowQueryThresholdMs
        ? 'high'
        : pattern.frequency > 10
          ? 'medium'
          : 'low';

      suggestions.push({
        collection: pattern.collection,
        fields,
        type: type as 'single' | 'compound',
        reason: `Covers ${pattern.frequency} queries (avg ${pattern.avgExecutionTimeMs.toFixed(1)}ms)`,
        estimatedImpact: impact,
        affectedQueries: pattern.frequency,
        priority: impact === 'high' ? 1 : impact === 'medium' ? 2 : 3,
      });
    }

    return suggestions.sort((a, b) => a.priority - b.priority);
  }

  private generateRecommendations(
    patterns: QueryPattern[],
    slowQueries: QueryProfile[],
  ): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Recommend indexes for slow patterns
    for (const pattern of patterns) {
      if (pattern.avgExecutionTimeMs > this.config.slowQueryThresholdMs && pattern.frequency >= this.config.minFrequencyForSuggestion) {
        recommendations.push({
          id: `rec_${++recIdCounter}`,
          type: 'create_index',
          severity: 'critical',
          title: `Create index for slow ${pattern.collection} queries`,
          description: `${pattern.frequency} queries on "${pattern.collection}" average ${pattern.avgExecutionTimeMs.toFixed(1)}ms. Fields: ${pattern.filterFields.join(', ')}`,
          collection: pattern.collection,
          suggestedAction: `db.${pattern.collection}.createIndex({ ${pattern.filterFields.map((f) => `${f}: 1`).join(', ')} })`,
          estimatedImprovement: `~${Math.round(pattern.avgExecutionTimeMs * 0.8)}ms faster`,
          relatedQueries: [],
        });
      }
    }

    // Recommend limits for queries scanning many documents
    for (const query of slowQueries) {
      if (!query.limit && query.documentsScanned > 1000) {
        recommendations.push({
          id: `rec_${++recIdCounter}`,
          type: 'add_limit',
          severity: 'warning',
          title: `Add limit to ${query.collection} query`,
          description: `Query scanned ${query.documentsScanned} documents without a limit. Consider adding .limit() to reduce scan size.`,
          collection: query.collection,
          relatedQueries: [query.id],
        });
      }
    }

    // Recommend projections
    for (const query of slowQueries) {
      if (!query.fields || query.fields.length === 0) {
        recommendations.push({
          id: `rec_${++recIdCounter}`,
          type: 'use_projection',
          severity: 'info',
          title: `Use field projection for ${query.collection}`,
          description: 'Query returns all fields. Use projections to return only needed fields for better performance.',
          collection: query.collection,
          relatedQueries: [query.id],
        });
      }
    }

    return recommendations;
  }

  private findUnusedIndexes(): ExistingIndex[] {
    const unused: ExistingIndex[] = [];
    for (const indexes of this.existingIndexes.values()) {
      for (const idx of indexes) {
        if (idx.usageCount === 0) {
          unused.push(idx);
        }
      }
    }
    return unused;
  }

  private computeCollectionStats(): CollectionQueryStats[] {
    const statsMap = new Map<string, QueryProfile[]>();

    for (const profile of this.profiles) {
      if (!statsMap.has(profile.collection)) statsMap.set(profile.collection, []);
      statsMap.get(profile.collection)!.push(profile);
    }

    return Array.from(statsMap.entries()).map(([collection, profiles]) => {
      const times = profiles.map((p) => p.executionTimeMs).sort((a, b) => a - b);
      const avg = times.reduce((s, t) => s + t, 0) / times.length;
      const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
      const p99 = times[Math.floor(times.length * 0.99)] ?? 0;

      return {
        collection,
        totalQueries: profiles.length,
        avgExecutionTimeMs: avg,
        p95ExecutionTimeMs: p95,
        p99ExecutionTimeMs: p99,
        fullScans: profiles.filter((p) => !p.indexUsed).length,
        indexedQueries: profiles.filter((p) => !!p.indexUsed).length,
      };
    });
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create a query performance advisor */
export function createQueryAdvisor(config?: QueryAdvisorConfig): QueryAdvisor {
  return new QueryAdvisor(config);
}
