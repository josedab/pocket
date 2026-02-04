/**
 * IndexAdvisor - Intelligent index recommendation engine.
 *
 * Analyzes query patterns and execution times to recommend database indexes
 * that would improve performance. Provides impact estimates based on
 * observed query costs.
 */

import type { SchemaField } from './smart-query.js';

/**
 * A structured query specification for analysis.
 */
export interface QuerySpec {
  /** Filter fields and their operators */
  filter: Record<string, unknown>;
  /** Sort specification */
  sort?: Record<string, 'asc' | 'desc'>;
  /** Result limit */
  limit?: number;
}

/**
 * Index recommendation from the advisor.
 */
export interface IndexRecommendation {
  /** Collection this index applies to */
  collection: string;
  /** Fields to include in the index */
  fields: string[];
  /** Index type */
  type: 'single' | 'compound' | 'partial';
  /** Reason for the recommendation */
  reason: string;
  /** Estimated impact score 0-1 (higher = more impactful) */
  impact: number;
  /** Number of queries that would benefit */
  affectedQueries: number;
}

/**
 * Performance improvement estimate for an index.
 */
export interface PerformanceEstimate {
  /** Estimated speedup factor (e.g., 2.0 = 2x faster) */
  estimatedSpeedup: number;
  /** Current average execution time in ms */
  currentAvgTimeMs: number;
  /** Estimated execution time after index in ms */
  estimatedTimeMs: number;
  /** Confidence in the estimate 0-1 */
  confidence: number;
}

/**
 * Schema information for the advisor.
 */
export type AdvisorSchemaMap = Record<string, SchemaField[]>;

/** Internal record of a query execution. */
interface QueryExecution {
  collection: string;
  filter: Record<string, unknown>;
  sort?: Record<string, 'asc' | 'desc'>;
  executionTimeMs: number;
  timestamp: number;
}

/**
 * Intelligent index recommendation engine.
 *
 * Tracks query patterns and execution times to recommend optimal
 * indexes for your collections. Provides impact estimates based
 * on real usage data.
 *
 * @example
 * ```typescript
 * const advisor = createIndexAdvisor({
 *   todos: [
 *     { name: 'title', type: 'string' },
 *     { name: 'completed', type: 'boolean' },
 *     { name: 'dueDate', type: 'date' },
 *   ],
 * });
 *
 * advisor.recordQueryExecution('todos', { completed: false }, 45);
 * advisor.recordQueryExecution('todos', { completed: false }, 52);
 *
 * const recommendations = advisor.analyzePatterns();
 * // [{ collection: 'todos', fields: ['completed'], impact: 0.8, ... }]
 * ```
 */
export class IndexAdvisor {
  private readonly executions: QueryExecution[] = [];

  // @ts-expect-error schemas reserved for future type-aware analysis
  constructor(private readonly schemas: AdvisorSchemaMap = {}) {}

  /**
   * Analyze a single query and recommend an index.
   *
   * Inspects the filter and sort fields to determine what index
   * would best serve this query pattern.
   *
   * @param collection - Collection being queried
   * @param query - The query specification
   * @returns Index recommendation for this query
   */
  analyzeQuery(collection: string, query: QuerySpec): IndexRecommendation {
    const filterFields = this.extractFilterFields(query.filter);
    const sortFields = query.sort ? Object.keys(query.sort) : [];
    const allFields = [...new Set([...filterFields, ...sortFields])];

    const matchingExecutions = this.executions.filter(
      (e) =>
        e.collection === collection &&
        this.extractFilterFields(e.filter).some((f) => filterFields.includes(f))
    );

    const type: IndexRecommendation['type'] =
      allFields.length > 1 ? 'compound' : 'single';

    const avgTime =
      matchingExecutions.length > 0
        ? matchingExecutions.reduce((sum, e) => sum + e.executionTimeMs, 0) /
          matchingExecutions.length
        : 0;

    // Impact based on field count, query frequency, and execution time
    const frequencyScore = Math.min(1, matchingExecutions.length / 10);
    const timeScore = Math.min(1, avgTime / 100);
    const impact = Math.min(1, (frequencyScore + timeScore) / 2 + (allFields.length > 1 ? 0.2 : 0));

    return {
      collection,
      fields: allFields.length > 0 ? allFields : filterFields,
      type,
      reason: this.buildReason(filterFields, sortFields, matchingExecutions.length),
      impact,
      affectedQueries: matchingExecutions.length,
    };
  }

  /**
   * Analyze all recorded query patterns and batch-recommend indexes.
   *
   * Groups queries by collection and filter fields, then recommends
   * indexes for the most common patterns.
   *
   * @returns Array of index recommendations sorted by impact
   */
  analyzePatterns(): IndexRecommendation[] {
    const patternMap = new Map<string, QueryExecution[]>();

    for (const exec of this.executions) {
      const fields = this.extractFilterFields(exec.filter).sort();
      const key = `${exec.collection}:${fields.join(',')}`;

      if (!patternMap.has(key)) {
        patternMap.set(key, []);
      }
      patternMap.get(key)!.push(exec);
    }

    const recommendations: IndexRecommendation[] = [];

    for (const [key, executions] of patternMap) {
      const [collection] = key.split(':') as [string, string];
      const fields = this.extractFilterFields(executions[0]!.filter);

      if (fields.length === 0) continue;

      const avgTime =
        executions.reduce((sum, e) => sum + e.executionTimeMs, 0) / executions.length;

      const frequencyScore = Math.min(1, executions.length / 10);
      const timeScore = Math.min(1, avgTime / 100);
      const impact = Math.min(1, (frequencyScore + timeScore) / 2);

      recommendations.push({
        collection,
        fields,
        type: fields.length > 1 ? 'compound' : 'single',
        reason: this.buildReason(fields, [], executions.length),
        impact,
        affectedQueries: executions.length,
      });
    }

    return recommendations.sort((a, b) => b.impact - a.impact);
  }

  /**
   * Estimate the performance improvement for a recommendation.
   *
   * Uses recorded execution times for the affected fields to estimate
   * how much faster queries would be with the recommended index.
   *
   * @param recommendation - The index recommendation to evaluate
   * @returns Performance improvement estimate
   */
  estimateImprovement(recommendation: IndexRecommendation): PerformanceEstimate {
    const matchingExecutions = this.executions.filter(
      (e) =>
        e.collection === recommendation.collection &&
        this.extractFilterFields(e.filter).some((f) => recommendation.fields.includes(f))
    );

    if (matchingExecutions.length === 0) {
      return {
        estimatedSpeedup: 1,
        currentAvgTimeMs: 0,
        estimatedTimeMs: 0,
        confidence: 0,
      };
    }

    const currentAvgTimeMs =
      matchingExecutions.reduce((sum, e) => sum + e.executionTimeMs, 0) /
      matchingExecutions.length;

    // Estimate: index lookups are ~O(log n) vs O(n) full scan
    // Use a heuristic: compound indexes help more for multi-field queries
    const fieldFactor = recommendation.fields.length > 1 ? 0.15 : 0.25;
    const estimatedTimeMs = Math.max(1, currentAvgTimeMs * fieldFactor);
    const estimatedSpeedup = currentAvgTimeMs / estimatedTimeMs;

    // Confidence based on sample size
    const confidence = Math.min(1, matchingExecutions.length / 20);

    return {
      estimatedSpeedup: Math.round(estimatedSpeedup * 100) / 100,
      currentAvgTimeMs: Math.round(currentAvgTimeMs * 100) / 100,
      estimatedTimeMs: Math.round(estimatedTimeMs * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  /**
   * Record a query execution for pattern analysis.
   *
   * @param collection - Collection that was queried
   * @param query - The filter object used
   * @param executionTimeMs - How long the query took in milliseconds
   */
  recordQueryExecution(
    collection: string,
    query: Record<string, unknown>,
    executionTimeMs: number
  ): void {
    this.executions.push({
      collection,
      filter: query,
      executionTimeMs,
      timestamp: Date.now(),
    });
  }

  /**
   * Get the top N most impactful index recommendations.
   *
   * @param limit - Maximum number of recommendations to return
   * @returns Sorted array of the most impactful recommendations
   */
  getTopRecommendations(limit: number): IndexRecommendation[] {
    return this.analyzePatterns().slice(0, limit);
  }

  /**
   * Get the number of recorded executions.
   */
  getExecutionCount(): number {
    return this.executions.length;
  }

  /** Extract top-level field names from a filter, skipping operators. */
  private extractFilterFields(filter: Record<string, unknown>): string[] {
    const fields: string[] = [];
    for (const key of Object.keys(filter)) {
      if (!key.startsWith('$')) {
        fields.push(key);
      }
    }
    return fields;
  }

  /** Build a human-readable reason string. */
  private buildReason(
    filterFields: string[],
    sortFields: string[],
    queryCount: number
  ): string {
    const parts: string[] = [];

    if (filterFields.length > 0) {
      parts.push(`Filtered by ${filterFields.join(', ')}`);
    }
    if (sortFields.length > 0) {
      parts.push(`sorted by ${sortFields.join(', ')}`);
    }
    if (queryCount > 0) {
      parts.push(`observed in ${queryCount} queries`);
    }

    return parts.join('; ') || 'General index recommendation';
  }
}

/**
 * Create an IndexAdvisor instance.
 *
 * @param schemas - Map of collection names to field definitions
 * @returns A configured IndexAdvisor
 */
export function createIndexAdvisor(schemas: AdvisorSchemaMap = {}): IndexAdvisor {
  return new IndexAdvisor(schemas);
}
