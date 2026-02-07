/**
 * Advanced filtered search engine with multiple filtering strategies.
 *
 * Supports pre-filtering, post-filtering, and hybrid filtering with
 * automatic strategy selection based on filter selectivity. Includes
 * metadata indexing for fast filtering and composite filter operations.
 *
 * @module filtered-search
 *
 * @example Basic filtered search
 * ```typescript
 * const search = createFilteredSearch(store);
 *
 * search.indexMetadata('category', 'string');
 * search.indexMetadata('year', 'number');
 *
 * const results = await search.search(queryVector, {
 *   filter: and(
 *     eq('category', 'tech'),
 *     gte('year', 2023),
 *   ),
 *   limit: 10,
 *   strategy: 'hybrid',
 * });
 * ```
 */

import type { Vector, VectorSearchResult } from './types.js';
import { distanceToScore } from './distance.js';
import type { VectorStore } from './vector-store.js';

// ─── Filter Types ────────────────────────────────────────────────────────────

/**
 * Comparison operators for filter conditions.
 */
export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin';

/**
 * Logical operators for combining filters.
 */
export type LogicalOperator = 'and' | 'or' | 'not';

/**
 * A single comparison filter condition.
 */
export interface ComparisonFilter {
  type: 'comparison';
  field: string;
  operator: FilterOperator;
  value: unknown;
}

/**
 * A logical filter combining multiple conditions.
 */
export interface LogicalFilter {
  type: 'logical';
  operator: LogicalOperator;
  filters: FilterExpression[];
}

/**
 * A filter expression (comparison or logical).
 */
export type FilterExpression = ComparisonFilter | LogicalFilter;

/**
 * Filtering strategy for vector search.
 */
export type FilterStrategy = 'pre' | 'post' | 'hybrid';

/**
 * Configuration for filtered search.
 */
export interface FilteredSearchConfig {
  /**
   * Filtering strategy.
   * - 'pre': Filter before vector search (best for selective filters)
   * - 'post': Vector search then filter (best for broad filters)
   * - 'hybrid': Auto-select based on filter selectivity
   * @default 'hybrid'
   */
  strategy?: FilterStrategy;

  /**
   * Maximum number of results.
   * @default 10
   */
  limit?: number;

  /**
   * Minimum similarity score threshold (0-1).
   * @default 0
   */
  minScore?: number;

  /**
   * Include vector embeddings in results.
   * @default false
   */
  includeVectors?: boolean;

  /**
   * Scoring boost/penalty multipliers based on metadata fields.
   * Keys are field names, values are { match, boost } pairs.
   */
  scoreModifiers?: ScoreModifier[];
}

/**
 * Score modifier that boosts or penalizes results based on metadata.
 */
export interface ScoreModifier {
  /** Metadata field to check */
  field: string;

  /** Value to match for the boost */
  value: unknown;

  /**
   * Score multiplier (>1 for boost, <1 for penalty).
   * @example 1.5 boosts score by 50%, 0.8 penalizes by 20%
   */
  boost: number;
}

/**
 * Metadata field type for indexing.
 */
export type MetadataFieldType = 'string' | 'number' | 'boolean';

// ─── Filter Builder Functions ────────────────────────────────────────────────

/**
 * Create an equality filter.
 *
 * @example
 * ```typescript
 * const filter = eq('category', 'tech');
 * ```
 */
export function eq(field: string, value: unknown): ComparisonFilter {
  return { type: 'comparison', field, operator: 'eq', value };
}

/**
 * Create a not-equal filter.
 */
export function neq(field: string, value: unknown): ComparisonFilter {
  return { type: 'comparison', field, operator: 'neq', value };
}

/**
 * Create a greater-than filter.
 */
export function gt(field: string, value: number): ComparisonFilter {
  return { type: 'comparison', field, operator: 'gt', value };
}

/**
 * Create a greater-than-or-equal filter.
 */
export function gte(field: string, value: number): ComparisonFilter {
  return { type: 'comparison', field, operator: 'gte', value };
}

/**
 * Create a less-than filter.
 */
export function lt(field: string, value: number): ComparisonFilter {
  return { type: 'comparison', field, operator: 'lt', value };
}

/**
 * Create a less-than-or-equal filter.
 */
export function lte(field: string, value: number): ComparisonFilter {
  return { type: 'comparison', field, operator: 'lte', value };
}

/**
 * Create an "in" filter (value in array).
 */
export function inFilter(field: string, values: unknown[]): ComparisonFilter {
  return { type: 'comparison', field, operator: 'in', value: values };
}

/**
 * Create a "not in" filter.
 */
export function ninFilter(field: string, values: unknown[]): ComparisonFilter {
  return { type: 'comparison', field, operator: 'nin', value: values };
}

/**
 * Combine filters with AND logic.
 *
 * @example
 * ```typescript
 * const filter = and(eq('category', 'tech'), gte('year', 2023));
 * ```
 */
export function and(...filters: FilterExpression[]): LogicalFilter {
  return { type: 'logical', operator: 'and', filters };
}

/**
 * Combine filters with OR logic.
 */
export function or(...filters: FilterExpression[]): LogicalFilter {
  return { type: 'logical', operator: 'or', filters };
}

/**
 * Negate a filter.
 */
export function not(filter: FilterExpression): LogicalFilter {
  return { type: 'logical', operator: 'not', filters: [filter] };
}

// ─── Metadata Index ──────────────────────────────────────────────────────────

/**
 * Index for fast metadata filtering.
 */
class MetadataIndex {
  private indexes = new Map<string, Map<unknown, Set<string>>>();
  private fieldTypes = new Map<string, MetadataFieldType>();

  /**
   * Register a metadata field for indexing.
   */
  addField(field: string, type: MetadataFieldType): void {
    this.fieldTypes.set(field, type);
    if (!this.indexes.has(field)) {
      this.indexes.set(field, new Map());
    }
  }

  /**
   * Index a document's metadata.
   */
  index(id: string, metadata: Record<string, unknown>): void {
    for (const [field, valueMap] of this.indexes) {
      const value = metadata[field];
      if (value === undefined) continue;

      if (!valueMap.has(value)) {
        valueMap.set(value, new Set());
      }
      valueMap.get(value)!.add(id);
    }
  }

  /**
   * Remove a document from the index.
   */
  remove(id: string): void {
    for (const valueMap of this.indexes.values()) {
      for (const ids of valueMap.values()) {
        ids.delete(id);
      }
    }
  }

  /**
   * Get IDs matching an equality condition using the index.
   * Returns undefined if the field is not indexed.
   */
  getMatching(field: string, value: unknown): Set<string> | undefined {
    const valueMap = this.indexes.get(field);
    if (!valueMap) return undefined;
    return valueMap.get(value);
  }

  /**
   * Check if a field is indexed.
   */
  hasField(field: string): boolean {
    return this.indexes.has(field);
  }

  /**
   * Get the estimated selectivity of a filter (0-1, lower = more selective).
   */
  estimateSelectivity(filter: FilterExpression, totalCount: number): number {
    if (totalCount === 0) return 1;

    if (filter.type === 'comparison') {
      if (filter.operator === 'eq') {
        const matching = this.getMatching(filter.field, filter.value);
        if (matching) {
          return matching.size / totalCount;
        }
      }
      // Default estimate for non-indexed or non-eq filters
      return 0.5;
    }

    // Logical filters
    if (filter.operator === 'and') {
      let selectivity = 1;
      for (const sub of filter.filters) {
        selectivity *= this.estimateSelectivity(sub, totalCount);
      }
      return selectivity;
    }

    if (filter.operator === 'or') {
      let selectivity = 0;
      for (const sub of filter.filters) {
        selectivity += this.estimateSelectivity(sub, totalCount);
      }
      return Math.min(1, selectivity);
    }

    if (filter.operator === 'not') {
      const sub = filter.filters[0];
      return sub ? 1 - this.estimateSelectivity(sub, totalCount) : 1;
    }

    return 0.5;
  }

  /**
   * Clear the index.
   */
  clear(): void {
    for (const valueMap of this.indexes.values()) {
      valueMap.clear();
    }
  }
}

// ─── Filtered Search Engine ──────────────────────────────────────────────────

/**
 * Advanced filtered search engine that combines metadata filtering
 * with vector similarity search.
 *
 * @example
 * ```typescript
 * const search = createFilteredSearch(store);
 *
 * // Index metadata fields for fast filtering
 * search.indexMetadata('category', 'string');
 *
 * // Build index from existing entries
 * search.rebuildMetadataIndex();
 *
 * // Search with composite filter
 * const results = await search.search(queryVector, {
 *   filter: and(
 *     eq('category', 'tech'),
 *     gte('year', 2023),
 *   ),
 *   limit: 10,
 * });
 * ```
 */
export class FilteredSearch {
  private readonly store: VectorStore;
  private readonly metadataIndex = new MetadataIndex();

  constructor(store: VectorStore) {
    this.store = store;
  }

  /**
   * Register a metadata field for fast indexing.
   *
   * @param field - Metadata field name
   * @param type - Field value type
   */
  indexMetadata(field: string, type: MetadataFieldType): void {
    this.metadataIndex.addField(field, type);
  }

  /**
   * Rebuild the metadata index from current store entries.
   */
  rebuildMetadataIndex(): void {
    this.metadataIndex.clear();
    for (const entry of this.store.getAll()) {
      if (entry.metadata) {
        this.metadataIndex.index(entry.id, entry.metadata);
      }
    }
  }

  /**
   * Perform filtered vector search.
   *
   * @param query - Query vector
   * @param config - Search configuration with filter
   * @param filter - Filter expression to apply
   * @returns Filtered search results sorted by score
   *
   * @example
   * ```typescript
   * const results = await search.search(queryVector, {
   *   limit: 10,
   *   strategy: 'hybrid',
   * }, eq('category', 'tech'));
   * ```
   */
  async search(
    query: Vector,
    config: FilteredSearchConfig = {},
    filter?: FilterExpression
  ): Promise<VectorSearchResult[]> {
    const limit = config.limit ?? 10;
    const minScore = config.minScore ?? 0;
    const strategy = config.strategy ?? 'hybrid';

    // Choose strategy
    const effectiveStrategy = filter ? this.chooseStrategy(strategy, filter) : 'post';

    let results: VectorSearchResult[];

    if (effectiveStrategy === 'pre' && filter) {
      results = await this.preFilterSearch(query, filter, limit, minScore);
    } else if (effectiveStrategy === 'post') {
      results = await this.postFilterSearch(query, filter, limit, minScore);
    } else {
      results = await this.hybridSearch(query, filter!, limit, minScore);
    }

    // Apply score modifiers
    if (config.scoreModifiers && config.scoreModifiers.length > 0) {
      results = this.applyScoreModifiers(results, config.scoreModifiers);
    }

    // Strip vectors if not requested
    if (!config.includeVectors) {
      results = results.map((r) => {
        const { vector: _v, ...rest } = r;
        return rest;
      });
    }

    return results.slice(0, limit);
  }

  /**
   * Evaluate a filter expression against metadata.
   *
   * @param metadata - The metadata record to evaluate against
   * @param filter - The filter expression
   * @returns Whether the metadata matches the filter
   */
  evaluateFilter(metadata: Record<string, unknown>, filter: FilterExpression): boolean {
    if (filter.type === 'comparison') {
      return this.evaluateComparison(metadata, filter);
    }
    return this.evaluateLogical(metadata, filter);
  }

  /**
   * Release resources.
   */
  destroy(): void {
    this.metadataIndex.clear();
  }

  /**
   * Choose the effective strategy based on selectivity.
   */
  private chooseStrategy(requested: FilterStrategy, filter: FilterExpression): FilterStrategy {
    if (requested !== 'hybrid') return requested;

    const selectivity = this.metadataIndex.estimateSelectivity(filter, this.store.count);

    // Pre-filter when filter is very selective (eliminates most candidates)
    if (selectivity < 0.1) return 'pre';
    // Post-filter when filter is broad
    if (selectivity > 0.5) return 'post';
    // Hybrid for medium selectivity
    return 'pre';
  }

  /**
   * Pre-filtering: filter entries first, then search within filtered set.
   */
  private async preFilterSearch(
    query: Vector,
    filter: FilterExpression,
    limit: number,
    minScore: number
  ): Promise<VectorSearchResult[]> {
    const entries = this.store.getAll();
    const filtered = entries.filter((entry) => {
      if (!entry.metadata) return false;
      return this.evaluateFilter(entry.metadata, filter);
    });

    // Compute distances for filtered entries
    const results: VectorSearchResult[] = [];
    const metric = this.getMetric();

    for (const entry of filtered) {
      const distance = this.computeDistance(query, entry.vector);
      const score = distanceToScore(distance, metric);

      if (score >= minScore) {
        results.push({
          id: entry.id,
          score,
          distance,
          vector: entry.vector,
          metadata: entry.metadata,
          text: entry.text,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Post-filtering: vector search first, then filter results.
   */
  private async postFilterSearch(
    query: Vector,
    filter: FilterExpression | undefined,
    limit: number,
    minScore: number
  ): Promise<VectorSearchResult[]> {
    // Search with extra results to account for filtering
    const overFetch = filter ? limit * 5 : limit;
    const searchResults = await this.store.search({
      vector: query,
      limit: overFetch,
      minScore,
      includeVectors: true,
      includeMetadata: true,
    });

    if (!filter) return searchResults.slice(0, limit);

    return searchResults
      .filter((result) => {
        if (!result.metadata) return false;
        return this.evaluateFilter(result.metadata, filter);
      })
      .slice(0, limit);
  }

  /**
   * Hybrid filtering: combines pre and post strategies.
   */
  private async hybridSearch(
    query: Vector,
    filter: FilterExpression,
    limit: number,
    minScore: number
  ): Promise<VectorSearchResult[]> {
    // For hybrid, use pre-filter approach with indexed fields
    return this.preFilterSearch(query, filter, limit, minScore);
  }

  /**
   * Evaluate a comparison filter.
   */
  private evaluateComparison(metadata: Record<string, unknown>, filter: ComparisonFilter): boolean {
    const fieldValue = metadata[filter.field];

    switch (filter.operator) {
      case 'eq':
        return fieldValue === filter.value;
      case 'neq':
        return fieldValue !== filter.value;
      case 'gt':
        return typeof fieldValue === 'number' && fieldValue > (filter.value as number);
      case 'gte':
        return typeof fieldValue === 'number' && fieldValue >= (filter.value as number);
      case 'lt':
        return typeof fieldValue === 'number' && fieldValue < (filter.value as number);
      case 'lte':
        return typeof fieldValue === 'number' && fieldValue <= (filter.value as number);
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(fieldValue);
      case 'nin':
        return Array.isArray(filter.value) && !filter.value.includes(fieldValue);
      default:
        return false;
    }
  }

  /**
   * Evaluate a logical filter.
   */
  private evaluateLogical(metadata: Record<string, unknown>, filter: LogicalFilter): boolean {
    switch (filter.operator) {
      case 'and':
        return filter.filters.every((f) => this.evaluateFilter(metadata, f));
      case 'or':
        return filter.filters.some((f) => this.evaluateFilter(metadata, f));
      case 'not': {
        const sub = filter.filters[0];
        return sub ? !this.evaluateFilter(metadata, sub) : true;
      }
      default:
        return false;
    }
  }

  /**
   * Apply score modifiers to results.
   */
  private applyScoreModifiers(
    results: VectorSearchResult[],
    modifiers: ScoreModifier[]
  ): VectorSearchResult[] {
    return results
      .map((result) => {
        let score = result.score;

        for (const modifier of modifiers) {
          if (result.metadata && result.metadata[modifier.field] === modifier.value) {
            score *= modifier.boost;
          }
        }

        return { ...result, score: Math.min(1, score) };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Get the distance metric from the store.
   */
  private getMetric(): 'cosine' | 'euclidean' | 'dotProduct' {
    // Access metric from store's exported data
    const data = this.store.export();
    return data.metric;
  }

  /**
   * Compute distance between two vectors using the store's metric.
   */
  private computeDistance(a: Vector, b: Vector): number {
    const metric = this.getMetric();
    let sum = 0;

    if (metric === 'cosine') {
      let dotProd = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < a.length; i++) {
        const av = a[i]!;
        const bv = b[i]!;
        dotProd += av * bv;
        normA += av * av;
        normB += bv * bv;
      }
      const mag = Math.sqrt(normA) * Math.sqrt(normB);
      return mag === 0 ? 1 : 1 - dotProd / mag;
    }

    if (metric === 'euclidean') {
      for (let i = 0; i < a.length; i++) {
        const diff = a[i]! - b[i]!;
        sum += diff * diff;
      }
      return Math.sqrt(sum);
    }

    // dotProduct - negate for distance
    for (let i = 0; i < a.length; i++) {
      sum += a[i]! * b[i]!;
    }
    return -sum;
  }
}

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Create a filtered search engine for a vector store.
 *
 * @param store - The vector store to search
 * @returns A new FilteredSearch instance
 *
 * @example
 * ```typescript
 * const search = createFilteredSearch(store);
 * search.indexMetadata('category', 'string');
 * search.rebuildMetadataIndex();
 *
 * const results = await search.search(queryVector, {
 *   limit: 10,
 * }, eq('category', 'tech'));
 * ```
 */
export function createFilteredSearch(store: VectorStore): FilteredSearch {
  return new FilteredSearch(store);
}
