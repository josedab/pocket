/**
 * QueryExplainer - Human-readable query explanation and cost estimation.
 *
 * Takes a structured Pocket query and produces a detailed explanation
 * including what the query does, estimated cost, and optimization suggestions.
 *
 * @module query-explainer
 */

import type { LLMAdapter, Message } from './types.js';
import type { CollectionSchema, GeneratedQuery } from './smart-query.js';
import type { IndexRecommendation } from './index-advisor.js';

/** Explanation detail level */
export type ExplanationLevel = 'brief' | 'detailed' | 'technical';

/** Configuration for the query explainer */
export interface QueryExplainerConfig {
  /** Optional LLM adapter for AI-enhanced explanations */
  readonly adapter?: LLMAdapter;
  /** Collection schemas for context */
  readonly schemas: CollectionSchema[];
  /** Default explanation level */
  readonly defaultLevel?: ExplanationLevel;
}

/** Cost estimate for a query */
export interface QueryCostEstimate {
  /** Estimated documents scanned */
  readonly docsScanned: number;
  /** Estimated result set size */
  readonly resultSize: number;
  /** Whether an index would be used */
  readonly usesIndex: boolean;
  /** Index name if applicable */
  readonly indexName?: string;
  /** Estimated execution time category */
  readonly timeCategory: 'instant' | 'fast' | 'moderate' | 'slow';
  /** Cost score 0-100 (lower is better) */
  readonly costScore: number;
}

/** Optimization suggestion */
export interface OptimizationSuggestion {
  readonly type: 'add-index' | 'add-limit' | 'narrow-filter' | 'use-projection' | 'reorder-sort';
  readonly description: string;
  readonly impact: 'low' | 'medium' | 'high';
  readonly example?: string;
}

/** Full query explanation result */
export interface QueryExplanation {
  /** Human-readable summary of what the query does */
  readonly summary: string;
  /** Step-by-step breakdown */
  readonly steps: string[];
  /** Cost estimate */
  readonly cost: QueryCostEstimate;
  /** Optimization suggestions */
  readonly suggestions: OptimizationSuggestion[];
  /** Index recommendations */
  readonly indexRecommendations: IndexRecommendation[];
  /** The original query */
  readonly query: QueryInput;
  /** Explanation level used */
  readonly level: ExplanationLevel;
}

/** Input query to explain */
export interface QueryInput {
  readonly collection: string;
  readonly filter?: Record<string, unknown>;
  readonly sort?: Record<string, 'asc' | 'desc'>;
  readonly limit?: number;
  readonly skip?: number;
  readonly projection?: Record<string, 0 | 1>;
}

/**
 * Explains Pocket queries in human-readable form with cost estimates.
 *
 * @example
 * ```typescript
 * import { createQueryExplainer } from '@pocket/ai';
 *
 * const explainer = createQueryExplainer({
 *   schemas: [{ name: 'todos', fields: [...] }],
 * });
 *
 * const explanation = explainer.explain({
 *   collection: 'todos',
 *   filter: { completed: false, priority: { $gte: 3 } },
 *   sort: { createdAt: 'desc' },
 *   limit: 10,
 * });
 *
 * console.log(explanation.summary);
 * // "Find the 10 most recent incomplete todos with priority 3 or higher"
 *
 * console.log(explanation.cost.timeCategory);
 * // "fast"
 * ```
 */
export class QueryExplainer {
  private readonly config: QueryExplainerConfig;
  private readonly schemaMap: Map<string, CollectionSchema>;

  constructor(config: QueryExplainerConfig) {
    this.config = config;
    this.schemaMap = new Map(config.schemas.map((s) => [s.name, s]));
  }

  /** Explain a structured query */
  explain(query: QueryInput, level?: ExplanationLevel): QueryExplanation {
    const effectiveLevel = level ?? this.config.defaultLevel ?? 'detailed';
    const schema = this.schemaMap.get(query.collection);
    const steps = this.buildSteps(query, schema);
    const cost = this.estimateCost(query, schema);
    const suggestions = this.generateSuggestions(query, cost, schema);
    const indexRecs = this.generateIndexRecommendations(query, schema);

    return {
      summary: this.buildSummary(query, schema, effectiveLevel),
      steps,
      cost,
      suggestions,
      indexRecommendations: indexRecs,
      query,
      level: effectiveLevel,
    };
  }

  /** Explain a GeneratedQuery from the SmartQueryEngine */
  explainGenerated(generated: GeneratedQuery, level?: ExplanationLevel): QueryExplanation {
    return this.explain(
      {
        collection: generated.collection,
        filter: generated.filter,
        sort: generated.sort,
        limit: generated.limit,
        skip: generated.skip,
      },
      level,
    );
  }

  /** Get AI-enhanced explanation using LLM (if adapter provided) */
  async explainWithAI(query: QueryInput): Promise<QueryExplanation> {
    const baseExplanation = this.explain(query, 'technical');

    if (!this.config.adapter) return baseExplanation;

    const messages: Message[] = [
      {
        role: 'system',
        content:
          'You are a database query expert. Explain the following database query in clear, non-technical language. Be concise.',
      },
      {
        role: 'user',
        content: `Explain this query:\nCollection: ${query.collection}\nFilter: ${JSON.stringify(query.filter)}\nSort: ${JSON.stringify(query.sort)}\nLimit: ${query.limit}`,
      },
    ];

    const response = await this.config.adapter.complete(messages);
    return {
      ...baseExplanation,
      summary: response.content,
    };
  }

  // ── Private ──────────────────────────────────────────────────────────

  private buildSummary(
    query: QueryInput,
    _schema: CollectionSchema | undefined,
    level: ExplanationLevel,
  ): string {
    const parts: string[] = [];

    // Action
    if (query.limit === 1) {
      parts.push('Find one document');
    } else if (query.limit) {
      parts.push(`Find up to ${query.limit} documents`);
    } else {
      parts.push('Find all documents');
    }

    parts.push(`from "${query.collection}"`);

    // Filter description
    if (query.filter && Object.keys(query.filter).length > 0) {
      const filterDesc = this.describeFilter(query.filter, level);
      parts.push(`where ${filterDesc}`);
    }

    // Sort description
    if (query.sort) {
      const sortEntries = Object.entries(query.sort);
      if (sortEntries.length > 0) {
        const sortDesc = sortEntries
          .map(([field, dir]) => `${field} ${dir === 'asc' ? 'ascending' : 'descending'}`)
          .join(', ');
        parts.push(`sorted by ${sortDesc}`);
      }
    }

    // Skip
    if (query.skip) {
      parts.push(`(skipping first ${query.skip})`);
    }

    return parts.join(' ');
  }

  private describeFilter(filter: Record<string, unknown>, level: ExplanationLevel): string {
    const conditions: string[] = [];

    for (const [key, value] of Object.entries(filter)) {
      if (key === '$and' && Array.isArray(value)) {
        const subConditions = value.map((v: Record<string, unknown>) => this.describeFilter(v, level));
        conditions.push(subConditions.join(' AND '));
      } else if (key === '$or' && Array.isArray(value)) {
        const subConditions = value.map((v: Record<string, unknown>) => this.describeFilter(v, level));
        conditions.push(`(${subConditions.join(' OR ')})`);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const [op, opVal] of Object.entries(value as Record<string, unknown>)) {
          conditions.push(this.describeOperator(key, op, opVal));
        }
      } else {
        conditions.push(`${key} equals ${JSON.stringify(value)}`);
      }
    }

    return conditions.join(' and ') || 'no conditions';
  }

  private describeOperator(field: string, op: string, value: unknown): string {
    const val = JSON.stringify(value);
    switch (op) {
      case '$eq': return `${field} equals ${val}`;
      case '$ne': return `${field} is not ${val}`;
      case '$gt': return `${field} is greater than ${val}`;
      case '$gte': return `${field} is at least ${val}`;
      case '$lt': return `${field} is less than ${val}`;
      case '$lte': return `${field} is at most ${val}`;
      case '$in': return `${field} is one of ${val}`;
      case '$nin': return `${field} is not in ${val}`;
      case '$regex': return `${field} matches pattern ${val}`;
      case '$startsWith': return `${field} starts with ${val}`;
      case '$endsWith': return `${field} ends with ${val}`;
      case '$contains': return `${field} contains ${val}`;
      case '$exists': return value ? `${field} exists` : `${field} does not exist`;
      default: return `${field} ${op} ${val}`;
    }
  }

  private buildSteps(query: QueryInput, _schema: CollectionSchema | undefined): string[] {
    const steps: string[] = [];
    steps.push(`1. Open collection "${query.collection}"`);

    if (query.filter && Object.keys(query.filter).length > 0) {
      const filterFields = this.extractFilterFields(query.filter);
      steps.push(`2. Apply filter on fields: ${filterFields.join(', ')}`);
    } else {
      steps.push('2. No filter applied (full collection scan)');
    }

    if (query.sort) {
      steps.push(`3. Sort results by ${Object.keys(query.sort).join(', ')}`);
    } else {
      steps.push('3. No sorting (natural order)');
    }

    if (query.skip) steps.push(`4. Skip first ${query.skip} results`);
    if (query.limit) steps.push(`${query.skip ? '5' : '4'}. Limit to ${query.limit} results`);
    if (query.projection) {
      const projFields = Object.entries(query.projection)
        .filter(([, v]) => v === 1)
        .map(([k]) => k);
      steps.push(`${steps.length + 1}. Project fields: ${projFields.join(', ')}`);
    }

    return steps;
  }

  private estimateCost(
    query: QueryInput,
    schema: CollectionSchema | undefined,
  ): QueryCostEstimate {
    const fieldCount = schema?.fields.length ?? 10;
    const filterFields = query.filter ? this.extractFilterFields(query.filter) : [];
    const hasFilter = filterFields.length > 0;
    const hasSort = !!query.sort;
    const hasLimit = !!query.limit;

    // Heuristic cost estimation
    let costScore = 50; // baseline

    if (!hasFilter) costScore += 30; // full scan
    else costScore -= filterFields.length * 5; // each filter helps

    if (hasSort && !hasFilter) costScore += 15; // sort without filter is expensive
    if (hasLimit) costScore -= 10; // limit reduces work

    costScore = Math.max(0, Math.min(100, costScore));

    const timeCategory: QueryCostEstimate['timeCategory'] =
      costScore <= 20 ? 'instant' :
      costScore <= 40 ? 'fast' :
      costScore <= 70 ? 'moderate' : 'slow';

    return {
      docsScanned: hasFilter ? Math.ceil(fieldCount * 10) : fieldCount * 100,
      resultSize: query.limit ?? (hasFilter ? fieldCount * 5 : fieldCount * 100),
      usesIndex: hasFilter && filterFields.length === 1,
      timeCategory,
      costScore,
    };
  }

  private generateSuggestions(
    query: QueryInput,
    cost: QueryCostEstimate,
    _schema?: CollectionSchema,
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    if (!query.limit) {
      suggestions.push({
        type: 'add-limit',
        description: 'Add a limit to avoid fetching the entire collection',
        impact: 'high',
        example: `{ ...query, limit: 100 }`,
      });
    }

    if (!cost.usesIndex && query.filter && Object.keys(query.filter).length > 0) {
      suggestions.push({
        type: 'add-index',
        description: `Consider adding an index on the filtered fields for faster queries`,
        impact: 'high',
      });
    }

    if (query.sort && !query.filter) {
      suggestions.push({
        type: 'narrow-filter',
        description: 'Add a filter to reduce the dataset before sorting',
        impact: 'medium',
      });
    }

    if (!query.projection) {
      suggestions.push({
        type: 'use-projection',
        description: 'Use a projection to fetch only needed fields, reducing data transfer',
        impact: 'low',
      });
    }

    return suggestions;
  }

  private generateIndexRecommendations(
    query: QueryInput,
    _schema?: CollectionSchema,
  ): IndexRecommendation[] {
    if (!query.filter) return [];

    const filterFields = this.extractFilterFields(query.filter);
    if (filterFields.length === 0) return [];

    const recs: IndexRecommendation[] = [];

    if (filterFields.length === 1) {
      recs.push({
        collection: query.collection,
        fields: filterFields,
        type: 'single',
        reason: `Single-field index would speed up filter on "${filterFields[0]}"`,
        impact: 0.7,
        affectedQueries: 1,
      });
    } else if (filterFields.length > 1) {
      recs.push({
        collection: query.collection,
        fields: filterFields,
        type: 'compound',
        reason: `Compound index on ${filterFields.join(', ')} would cover this multi-field filter`,
        impact: 0.85,
        affectedQueries: 1,
      });
    }

    if (query.sort) {
      const sortFields = Object.keys(query.sort);
      const combinedFields = [...new Set([...filterFields, ...sortFields])];
      if (combinedFields.length > filterFields.length) {
        recs.push({
          collection: query.collection,
          fields: combinedFields,
          type: 'compound',
          reason: `Covering index for both filter and sort eliminates in-memory sorting`,
          impact: 0.9,
          affectedQueries: 1,
        });
      }
    }

    return recs;
  }

  private extractFilterFields(filter: Record<string, unknown>): string[] {
    const fields: string[] = [];
    for (const key of Object.keys(filter)) {
      if (key === '$and' || key === '$or') continue;
      fields.push(key);
    }
    return fields;
  }
}

/** Factory function to create a QueryExplainer */
export function createQueryExplainer(config: QueryExplainerConfig): QueryExplainer {
  return new QueryExplainer(config);
}
