/**
 * QuerySuggestionEngine - Smart query suggestions based on schema analysis.
 *
 * Provides intelligent autocomplete suggestions for queries by analyzing
 * collection schemas, field types, and operator compatibility. Learns from
 * usage patterns to rank suggestions by frequency.
 */

import { BehaviorSubject, type Observable } from 'rxjs';
import type { SchemaField } from './smart-query.js';

/**
 * Field definition for a collection used by the suggestion engine.
 */
export type FieldDefinition = SchemaField;

/**
 * Schema map: collection name → field definitions.
 */
export type SchemaMap = Record<string, FieldDefinition[]>;

/**
 * A suggested field-level query completion.
 */
export interface FieldSuggestion {
  /** Suggested query text or field path */
  text: string;
  /** Brief description of what it does */
  description: string;
  /** Relevance score 0-1 */
  relevance: number;
  /** The collection this suggestion applies to */
  collection?: string;
  /** Suggested operator (e.g., $eq, $contains, $gt) */
  operator?: string;
}

/**
 * A suggested filter for a collection.
 */
export interface FilterSuggestion {
  /** Field name to filter on */
  field: string;
  /** Compatible operators for this field */
  operators: string[];
  /** Field type */
  type: SchemaField['type'];
  /** Human-readable description */
  description: string;
  /** Relevance score 0-1 based on usage frequency */
  relevance: number;
}

/**
 * A suggested sort field for a collection.
 */
export interface SortSuggestion {
  /** Field name to sort by */
  field: string;
  /** Recommended direction */
  direction: 'asc' | 'desc';
  /** Human-readable description */
  description: string;
  /** Relevance score 0-1 */
  relevance: number;
}

/** Operators compatible with each field type. */
const OPERATORS_BY_TYPE: Record<SchemaField['type'], string[]> = {
  string: ['$eq', '$ne', '$contains', '$startsWith', '$endsWith', '$regex', '$in', '$nin'],
  number: ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin'],
  boolean: ['$eq', '$ne'],
  date: ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'],
  array: ['$contains', '$in', '$nin', '$exists'],
  object: ['$exists'],
};

/** Default sort direction by field type. */
const DEFAULT_SORT_DIRECTION: Record<SchemaField['type'], 'asc' | 'desc'> = {
  string: 'asc',
  number: 'desc',
  boolean: 'desc',
  date: 'desc',
  array: 'desc',
  object: 'asc',
};

/** Tracked query entry for frequency analysis. */
interface QueryRecord {
  collection: string;
  fields: string[];
  timestamp: number;
}

/**
 * Smart query suggestion engine.
 *
 * Analyzes collection schemas and usage patterns to provide
 * intelligent query completions, filter suggestions, and sort recommendations.
 *
 * @example
 * ```typescript
 * const engine = createQuerySuggestionEngine({
 *   todos: [
 *     { name: 'title', type: 'string' },
 *     { name: 'priority', type: 'number' },
 *     { name: 'completed', type: 'boolean' },
 *   ],
 * });
 *
 * const suggestions = engine.suggest('pri');
 * // [{ text: 'priority', operator: '$gt', ... }]
 * ```
 */
export class QuerySuggestionEngine {
  private readonly schemas: SchemaMap;
  private readonly queryHistory: QueryRecord[] = [];
  private readonly fieldFrequency = new Map<string, number>();
  private readonly suggestions$ = new BehaviorSubject<FieldSuggestion[]>([]);

  constructor(schemas: SchemaMap) {
    this.schemas = schemas;
  }

  /**
   * Observable of the latest suggestions for real-time updates.
   */
  get suggestionsObservable(): Observable<FieldSuggestion[]> {
    return this.suggestions$.asObservable();
  }

  /**
   * Suggest query completions based on a partial input.
   *
   * Matches against field names across all collections and ranks
   * by usage frequency and type-appropriate operators.
   *
   * @param partial - Partial query text to complete
   * @returns Ranked array of query suggestions
   */
  suggest(partial: string): FieldSuggestion[] {
    const lower = partial.toLowerCase().trim();
    const suggestions: FieldSuggestion[] = [];

    for (const [collection, fields] of Object.entries(this.schemas)) {
      for (const field of fields) {
        if (!lower || field.name.toLowerCase().includes(lower)) {
          const operators = OPERATORS_BY_TYPE[field.type] ?? ['$eq'];
          const primaryOperator = operators[0]!;
          const freqKey = `${collection}.${field.name}`;
          const frequency = this.fieldFrequency.get(freqKey) ?? 0;
          const baseRelevance = lower
            ? field.name.toLowerCase().startsWith(lower)
              ? 0.9
              : 0.6
            : 0.5;
          const relevance = Math.min(1, baseRelevance + frequency * 0.05);

          suggestions.push({
            text: field.name,
            description: field.description ?? `Filter by ${field.name} (${field.type})`,
            relevance,
            collection,
            operator: primaryOperator,
          });
        }
      }
    }

    const sorted = suggestions.sort((a, b) => b.relevance - a.relevance);
    this.suggestions$.next(sorted);
    return sorted;
  }

  /**
   * Suggest relevant filters for a collection.
   *
   * Returns all filterable fields with their compatible operators,
   * ranked by usage frequency.
   *
   * @param collection - Collection name
   * @returns Array of filter suggestions
   */
  suggestFilters(collection: string): FilterSuggestion[] {
    const fields = this.schemas[collection];
    if (!fields) return [];

    return fields
      .map((field) => {
        const freqKey = `${collection}.${field.name}`;
        const frequency = this.fieldFrequency.get(freqKey) ?? 0;
        const relevance = Math.min(1, 0.5 + frequency * 0.1);

        return {
          field: field.name,
          operators: OPERATORS_BY_TYPE[field.type] ?? ['$eq'],
          type: field.type,
          description: field.description ?? `Filter by ${field.name}`,
          relevance,
        };
      })
      .sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Suggest sort fields for a collection.
   *
   * Returns sortable fields with recommended directions based on type
   * (e.g., dates default to descending, strings to ascending).
   *
   * @param collection - Collection name
   * @returns Array of sort suggestions
   */
  suggestSorts(collection: string): SortSuggestion[] {
    const fields = this.schemas[collection];
    if (!fields) return [];

    return fields
      .filter((f) => f.type !== 'object' && f.type !== 'array')
      .map((field) => {
        const freqKey = `${collection}.${field.name}`;
        const frequency = this.fieldFrequency.get(freqKey) ?? 0;
        const relevance = Math.min(1, 0.5 + frequency * 0.1);

        return {
          field: field.name,
          direction: DEFAULT_SORT_DIRECTION[field.type] ?? 'asc',
          description: field.description ?? `Sort by ${field.name}`,
          relevance,
        };
      })
      .sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Record a query to learn usage patterns.
   *
   * Increments frequency counters for the fields used in the query,
   * improving future suggestion rankings.
   *
   * @param collection - Collection that was queried
   * @param query - The filter object used
   */
  recordQuery(collection: string, query: Record<string, unknown>): void {
    const fields = this.extractFields(query);

    this.queryHistory.push({
      collection,
      fields,
      timestamp: Date.now(),
    });

    for (const field of fields) {
      const key = `${collection}.${field}`;
      this.fieldFrequency.set(key, (this.fieldFrequency.get(key) ?? 0) + 1);
    }
  }

  /**
   * Get the number of recorded queries.
   */
  getQueryCount(): number {
    return this.queryHistory.length;
  }

  /**
   * Get field frequency data for a collection.
   */
  getFieldFrequency(collection: string): Map<string, number> {
    const result = new Map<string, number>();
    for (const [key, count] of this.fieldFrequency) {
      if (key.startsWith(`${collection}.`)) {
        const field = key.slice(collection.length + 1);
        result.set(field, count);
      }
    }
    return result;
  }

  /** Extract top-level field names from a filter object. */
  private extractFields(query: Record<string, unknown>): string[] {
    const fields: string[] = [];
    for (const key of Object.keys(query)) {
      if (!key.startsWith('$')) {
        fields.push(key);
      }
    }
    return fields;
  }

  /** Release resources held by this engine */
  destroy(): void {
    this.suggestions$.complete();
  }
}

/**
 * Create a QuerySuggestionEngine instance.
 *
 * @param schemas - Map of collection names to field definitions
 * @returns A configured QuerySuggestionEngine
 */
export function createQuerySuggestionEngine(schemas: SchemaMap = {}): QuerySuggestionEngine {
  return new QuerySuggestionEngine(schemas);
}
