/**
 * QueryOptimizer - Analyzes query plans and suggests optimizations.
 *
 * Provides static analysis of query plans to estimate complexity,
 * suggest indexes, and recommend query improvements.
 *
 * @module query-optimizer
 *
 * @example
 * ```typescript
 * import { QueryOptimizer } from '@pocket/query-builder';
 *
 * const optimizer = new QueryOptimizer();
 * const result = optimizer.analyze(queryPlan);
 *
 * console.log('Suggestions:', result.suggestions);
 * console.log('Improvement:', result.estimatedImprovement);
 * console.log('Indexes:', result.indexRecommendations);
 * ```
 *
 * @see {@link QueryPlan}
 * @see {@link QueryBuilder}
 */

import type {
  LogicalGroup,
  QueryPlan,
} from './types.js';

/**
 * An index suggestion recommending fields to index.
 *
 * @see {@link QueryOptimizer.suggestIndexes}
 */
export interface IndexSuggestion {
  /** The fields to include in the index */
  fields: string[];
  /** The type of index */
  type: 'single' | 'compound';
  /** The reason for the suggestion */
  reason: string;
}

/**
 * The result of query plan analysis with optimization suggestions.
 *
 * @see {@link QueryOptimizer.analyze}
 */
export interface OptimizationResult {
  /** List of optimization suggestions */
  suggestions: string[];
  /** Estimated improvement description */
  estimatedImprovement: string;
  /** Recommended indexes */
  indexRecommendations: IndexSuggestion[];
}

/**
 * Analyzes and optimizes query plans for Pocket databases.
 *
 * The `QueryOptimizer` performs static analysis of {@link QueryPlan} objects
 * to estimate their computational complexity, suggest indexes, and
 * recommend improvements.
 *
 * @example
 * ```typescript
 * const optimizer = new QueryOptimizer();
 *
 * const plan = createQueryBuilder('users')
 *   .where('email', 'eq', 'test@example.com')
 *   .orderBy('createdAt', 'desc')
 *   .build();
 *
 * const result = optimizer.analyze(plan);
 * console.log(result.suggestions);
 * // ['Consider adding an index on "email" for equality filtering',
 * //  'Consider adding an index on "createdAt" for sorting']
 * ```
 *
 * @see {@link QueryPlan}
 * @see {@link QueryBuilder}
 */
export class QueryOptimizer {
  /**
   * Analyzes a query plan and returns optimization suggestions.
   *
   * @param plan - The query plan to analyze
   * @returns The optimization result with suggestions and recommendations
   *
   * @example
   * ```typescript
   * const result = optimizer.analyze(plan);
   * for (const suggestion of result.suggestions) {
   *   console.log(suggestion);
   * }
   * ```
   */
  analyze(plan: QueryPlan): OptimizationResult {
    const suggestions: string[] = [];
    const indexRecommendations = this.suggestIndexes(plan);
    const complexity = this.estimateComplexity(plan);

    // Analyze pagination
    if (plan.pagination?.skip && plan.pagination.skip > 1000) {
      suggestions.push(
        'Large skip values degrade performance. Consider cursor-based pagination instead.'
      );
    }

    // Analyze filters
    if (plan.where) {
      const filterFields = this._extractFilterFields(plan.where);
      for (const field of filterFields) {
        suggestions.push(
          `Consider adding an index on "${field}" for filtering.`
        );
      }
    }

    // Analyze sorts
    if (plan.sort && plan.sort.length > 0) {
      for (const sortClause of plan.sort) {
        suggestions.push(
          `Consider adding an index on "${sortClause.field}" for sorting.`
        );
      }
    }

    // Analyze combined filter + sort
    if (plan.where && plan.sort && plan.sort.length > 0) {
      const filterFields = this._extractFilterFields(plan.where);
      const sortFields = plan.sort.map((s) => s.field);
      const combinedFields = [...new Set([...filterFields, ...sortFields])];
      if (combinedFields.length > 1) {
        suggestions.push(
          `Consider a compound index on [${combinedFields.map((f) => `"${f}"`).join(', ')}] for combined filter and sort.`
        );
      }
    }

    // Analyze select
    if (!plan.select && !plan.aggregates?.length) {
      suggestions.push(
        'Consider using select() to limit returned fields for better performance.'
      );
    }

    // Analyze missing limit
    if (!plan.pagination?.limit && !plan.aggregates?.length) {
      suggestions.push(
        'Consider adding a limit() to prevent returning excessive results.'
      );
    }

    let estimatedImprovement = 'none';
    if (indexRecommendations.length > 0) {
      estimatedImprovement =
        complexity === 'high'
          ? 'significant'
          : complexity === 'medium'
            ? 'moderate'
            : 'minor';
    }

    return {
      suggestions,
      estimatedImprovement,
      indexRecommendations,
    };
  }

  /**
   * Suggests indexes for a query plan.
   *
   * @param plan - The query plan to analyze
   * @returns An array of index suggestions
   *
   * @example
   * ```typescript
   * const indexes = optimizer.suggestIndexes(plan);
   * for (const idx of indexes) {
   *   console.log(`Create ${idx.type} index on [${idx.fields.join(', ')}]: ${idx.reason}`);
   * }
   * ```
   */
  suggestIndexes(plan: QueryPlan): IndexSuggestion[] {
    const suggestions: IndexSuggestion[] = [];

    // Suggest indexes for filter fields
    if (plan.where) {
      const filterFields = this._extractFilterFields(plan.where);
      if (filterFields.length === 1) {
        suggestions.push({
          fields: filterFields,
          type: 'single',
          reason: `Speeds up filtering on "${filterFields[0]}"`,
        });
      } else if (filterFields.length > 1) {
        suggestions.push({
          fields: filterFields,
          type: 'compound',
          reason: `Speeds up compound filtering on ${filterFields.map((f) => `"${f}"`).join(', ')}`,
        });
      }
    }

    // Suggest indexes for sort fields
    if (plan.sort && plan.sort.length > 0) {
      const sortFields = plan.sort.map((s) => s.field);
      const filterFields = plan.where
        ? this._extractFilterFields(plan.where)
        : [];

      // Only suggest if sort fields differ from filter fields
      const newSortFields = sortFields.filter(
        (f) => !filterFields.includes(f)
      );
      if (newSortFields.length > 0) {
        const combinedFields = [...filterFields, ...newSortFields];
        if (combinedFields.length > 1) {
          suggestions.push({
            fields: combinedFields,
            type: 'compound',
            reason: `Covers both filtering and sorting operations`,
          });
        } else {
          suggestions.push({
            fields: newSortFields,
            type: newSortFields.length === 1 ? 'single' : 'compound',
            reason: `Speeds up sorting on ${newSortFields.map((f) => `"${f}"`).join(', ')}`,
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Estimates the computational complexity of a query plan.
   *
   * @param plan - The query plan to analyze
   * @returns The estimated complexity level
   *
   * @example
   * ```typescript
   * const complexity = optimizer.estimateComplexity(plan);
   * if (complexity === 'high') {
   *   console.warn('This query may be slow. Consider optimizing.');
   * }
   * ```
   */
  estimateComplexity(plan: QueryPlan): 'low' | 'medium' | 'high' {
    let score = 0;

    // Filter complexity
    if (plan.where) {
      score += this._scoreGroup(plan.where);
    }

    // Sort adds complexity
    if (plan.sort && plan.sort.length > 0) {
      score += plan.sort.length;
    }

    // Aggregates add complexity
    if (plan.aggregates && plan.aggregates.length > 0) {
      score += plan.aggregates.length * 2;
    }

    // Large skip adds complexity
    if (plan.pagination?.skip && plan.pagination.skip > 100) {
      score += 2;
    }

    // No limit is potentially expensive
    if (!plan.pagination?.limit) {
      score += 1;
    }

    if (score <= 2) return 'low';
    if (score <= 5) return 'medium';
    return 'high';
  }

  /**
   * Extracts all field names from a logical group recursively.
   * @internal
   */
  private _extractFilterFields(group: LogicalGroup): string[] {
    const fields: string[] = [];
    for (const condition of group.conditions) {
      if ('field' in condition) {
        const fc = condition;
        if (!fields.includes(fc.field)) {
          fields.push(fc.field);
        }
      } else if ('conditions' in condition) {
        const nested = this._extractFilterFields(condition);
        for (const f of nested) {
          if (!fields.includes(f)) {
            fields.push(f);
          }
        }
      }
    }
    return fields;
  }

  /**
   * Scores a logical group for complexity estimation.
   * @internal
   */
  private _scoreGroup(group: LogicalGroup): number {
    let score = 0;
    for (const condition of group.conditions) {
      if ('field' in condition) {
        const fc = condition;
        // Complex operators add more score
        if (['regex', 'contains', 'startsWith', 'endsWith'].includes(fc.operator)) {
          score += 2;
        } else if (['in', 'nin', 'between'].includes(fc.operator)) {
          score += 1.5;
        } else {
          score += 1;
        }
      } else if ('conditions' in condition) {
        // Nested groups add extra complexity
        score += 1 + this._scoreGroup(condition);
      }
    }
    return score;
  }
}

/**
 * Creates a new {@link QueryOptimizer} instance.
 *
 * @returns A new QueryOptimizer
 *
 * @example
 * ```typescript
 * import { createQueryOptimizer } from '@pocket/query-builder';
 *
 * const optimizer = createQueryOptimizer();
 * const result = optimizer.analyze(plan);
 * ```
 */
export function createQueryOptimizer(): QueryOptimizer {
  return new QueryOptimizer();
}
