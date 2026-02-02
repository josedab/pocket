/**
 * Index advisor — analyzes query patterns and recommends indexes.
 *
 * Tracks which fields are used in filters and sorts, counts their frequency,
 * and produces ranked index suggestions to improve query performance.
 */

export interface QueryPattern {
  collection: string;
  filterFields: string[];
  sortFields: string[];
  timestamp: number;
}

export interface IndexSuggestion {
  /** Target collection */
  collection: string;
  /** Recommended index fields */
  fields: string[];
  /** Estimated query frequency that would benefit */
  queryCount: number;
  /** Impact score 0-1 based on frequency and field usage */
  impact: number;
  /** Human-readable reason */
  reason: string;
}

export interface IndexAdvisorConfig {
  /** Maximum number of patterns to retain (default: 1000) */
  maxPatterns?: number;
  /** Minimum query count before suggesting an index (default: 3) */
  minQueryCount?: number;
  /** Maximum number of suggestions to return (default: 10) */
  maxSuggestions?: number;
}

/**
 * Collects query patterns and produces index recommendations.
 */
export class IndexAdvisor {
  private readonly patterns: QueryPattern[] = [];
  private readonly config: Required<IndexAdvisorConfig>;

  constructor(config: IndexAdvisorConfig = {}) {
    this.config = {
      maxPatterns: config.maxPatterns ?? 1000,
      minQueryCount: config.minQueryCount ?? 3,
      maxSuggestions: config.maxSuggestions ?? 10,
    };
  }

  /**
   * Record a query pattern for analysis.
   */
  recordQuery(collection: string, filterFields: string[], sortFields: string[]): void {
    if (this.patterns.length >= this.config.maxPatterns) {
      this.patterns.shift();
    }
    this.patterns.push({
      collection,
      filterFields,
      sortFields,
      timestamp: Date.now(),
    });
  }

  /**
   * Analyze recorded patterns and return index suggestions.
   */
  suggest(existingIndexes?: Map<string, string[][]>): IndexSuggestion[] {
    const fieldCombinations = new Map<string, { count: number; fields: string[]; collection: string }>();

    for (const pattern of this.patterns) {
      const allFields = [...new Set([...pattern.filterFields, ...pattern.sortFields])];
      if (allFields.length === 0) continue;

      const key = `${pattern.collection}:${allFields.sort().join(',')}`;
      const existing = fieldCombinations.get(key);
      if (existing) {
        existing.count++;
      } else {
        fieldCombinations.set(key, {
          count: 1,
          fields: allFields,
          collection: pattern.collection,
        });
      }
    }

    const suggestions: IndexSuggestion[] = [];

    for (const [, combo] of fieldCombinations) {
      if (combo.count < this.config.minQueryCount) continue;

      // Skip if an existing index already covers these fields
      if (existingIndexes) {
        const collectionIndexes = existingIndexes.get(combo.collection) ?? [];
        const covered = collectionIndexes.some((indexFields) =>
          combo.fields.every((f, i) => indexFields[i] === f),
        );
        if (covered) continue;
      }

      const impact = Math.min(1, combo.count / (this.config.maxPatterns * 0.1));

      suggestions.push({
        collection: combo.collection,
        fields: combo.fields,
        queryCount: combo.count,
        impact,
        reason: `${combo.count} queries filter/sort on [${combo.fields.join(', ')}]`,
      });
    }

    return suggestions
      .sort((a, b) => b.impact - a.impact)
      .slice(0, this.config.maxSuggestions);
  }

  /**
   * Get the number of recorded patterns.
   */
  getPatternCount(): number {
    return this.patterns.length;
  }

  /**
   * Clear all recorded patterns.
   */
  clear(): void {
    this.patterns.length = 0;
  }
}

/**
 * Create a new IndexAdvisor instance.
 */
export function createIndexAdvisor(config?: IndexAdvisorConfig): IndexAdvisor {
  return new IndexAdvisor(config);
}
