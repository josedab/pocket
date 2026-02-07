/**
 * AI-Powered Query Builder — natural language query construction and
 * intelligent suggestions for Pocket Studio.
 *
 * Converts natural language queries to Pocket query format, provides
 * schema-aware auto-complete, explains queries in plain English,
 * tracks history with AI-generated labels, and estimates performance.
 *
 * @module @pocket/studio/ai-query-builder
 *
 * @example
 * ```typescript
 * import { createAIQueryBuilder } from '@pocket/studio';
 *
 * const builder = createAIQueryBuilder({ maxHistory: 50 });
 *
 * // Register collection schemas for context
 * builder.registerSchema('users', [
 *   { name: 'name', type: 'string' },
 *   { name: 'age', type: 'number' },
 *   { name: 'role', type: 'string' },
 * ]);
 *
 * // Parse a natural language query
 * const parsed = builder.parseNaturalLanguage('find users older than 30');
 * console.log(parsed.collection); // 'users'
 * console.log(parsed.filter);     // { age: { $gt: 30 } }
 *
 * // Get auto-complete suggestions
 * const suggestions = builder.getAutoComplete('users', 'na');
 * // [{ text: 'name', type: 'field', description: 'string field' }]
 * ```
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';
import type { StudioEvent } from './types.js';

// ── Types ────────────────────────────────────────────────────────────────

/** Schema field descriptor used by the AI query builder for context. */
export interface AIQueryFieldInfo {
  name: string;
  type: string;
  indexed?: boolean;
  description?: string;
}

/** Represents a parsed query derived from natural language input. */
export interface ParsedQuery {
  /** Unique identifier */
  id: string;
  /** Original natural language input */
  naturalLanguage: string;
  /** Target collection (inferred or explicit) */
  collection: string;
  /** Generated Pocket filter object */
  filter: Record<string, unknown>;
  /** Sort specification, if detected */
  sort?: Record<string, 'asc' | 'desc'>;
  /** Limit, if detected */
  limit?: number;
  /** Confidence score between 0 and 1 */
  confidence: number;
  /** Plain-English explanation of the generated query */
  explanation: string;
  /** Estimated performance characteristics */
  performanceEstimate: PerformanceEstimate;
  /** AI-generated label summarising the query intent */
  label: string;
  /** Timestamp when the query was parsed */
  parsedAt: number;
}

/** Performance estimate for a query before execution. */
export interface PerformanceEstimate {
  /** Estimated strategy the query engine would use */
  strategy: 'full-scan' | 'index-scan' | 'key-lookup';
  /** Whether an index covers the filter fields */
  indexCoverage: boolean;
  /** Estimated relative cost: low, medium, or high */
  estimatedCost: 'low' | 'medium' | 'high';
  /** Human-readable performance suggestions */
  suggestions: string[];
}

/** Auto-complete suggestion entry. */
export interface AutoCompleteSuggestion {
  /** The suggested text to insert */
  text: string;
  /** What kind of token this suggestion represents */
  type: 'field' | 'operator' | 'value';
  /** Human-readable description */
  description: string;
}

/** History entry for a previously parsed query. */
export interface AIQueryHistoryEntry {
  /** Unique identifier */
  id: string;
  /** AI-generated label */
  label: string;
  /** Target collection */
  collection: string;
  /** Original natural language input */
  naturalLanguage: string;
  /** Generated filter */
  filter: Record<string, unknown>;
  /** Timestamp */
  parsedAt: number;
}

/** Configuration for the AI query builder. */
export interface AIQueryBuilderConfig {
  /** Maximum history entries to retain (default: 100) */
  maxHistory?: number;
  /** Registered collection names to consider (default: []) */
  defaultCollection?: string;
}

// ── Operator map (NL token → Pocket operator) ───────────────────────────

const OPERATOR_PATTERNS: {
  pattern: RegExp;
  operator: string;
  extract: (match: RegExpMatchArray) => unknown;
}[] = [
  { pattern: /greater than\s+(\d+(?:\.\d+)?)/i, operator: '$gt', extract: (m) => Number(m[1]) },
  { pattern: /more than\s+(\d+(?:\.\d+)?)/i, operator: '$gt', extract: (m) => Number(m[1]) },
  { pattern: /older than\s+(\d+(?:\.\d+)?)/i, operator: '$gt', extract: (m) => Number(m[1]) },
  { pattern: /above\s+(\d+(?:\.\d+)?)/i, operator: '$gt', extract: (m) => Number(m[1]) },
  { pattern: /over\s+(\d+(?:\.\d+)?)/i, operator: '$gt', extract: (m) => Number(m[1]) },
  { pattern: /less than\s+(\d+(?:\.\d+)?)/i, operator: '$lt', extract: (m) => Number(m[1]) },
  { pattern: /fewer than\s+(\d+(?:\.\d+)?)/i, operator: '$lt', extract: (m) => Number(m[1]) },
  { pattern: /younger than\s+(\d+(?:\.\d+)?)/i, operator: '$lt', extract: (m) => Number(m[1]) },
  { pattern: /below\s+(\d+(?:\.\d+)?)/i, operator: '$lt', extract: (m) => Number(m[1]) },
  { pattern: /under\s+(\d+(?:\.\d+)?)/i, operator: '$lt', extract: (m) => Number(m[1]) },
  { pattern: /at least\s+(\d+(?:\.\d+)?)/i, operator: '$gte', extract: (m) => Number(m[1]) },
  { pattern: /at most\s+(\d+(?:\.\d+)?)/i, operator: '$lte', extract: (m) => Number(m[1]) },
  { pattern: /equals?\s+"([^"]+)"/i, operator: '$eq', extract: (m) => m[1] },
  { pattern: /equals?\s+(\S+)/i, operator: '$eq', extract: (m) => coerceValue(m[1]!) },
  { pattern: /is\s+"([^"]+)"/i, operator: '$eq', extract: (m) => m[1] },
  { pattern: /is\s+(\S+)/i, operator: '$eq', extract: (m) => coerceValue(m[1]!) },
  { pattern: /not\s+"([^"]+)"/i, operator: '$ne', extract: (m) => m[1] },
  { pattern: /not\s+(\S+)/i, operator: '$ne', extract: (m) => coerceValue(m[1]!) },
];

const SORT_PATTERNS: { pattern: RegExp; direction: 'asc' | 'desc' }[] = [
  { pattern: /sort(?:ed)?\s+by\s+(\w+)\s+desc(?:ending)?/i, direction: 'desc' },
  { pattern: /sort(?:ed)?\s+by\s+(\w+)\s+asc(?:ending)?/i, direction: 'asc' },
  { pattern: /sort(?:ed)?\s+by\s+(\w+)/i, direction: 'asc' },
  { pattern: /order(?:ed)?\s+by\s+(\w+)\s+desc(?:ending)?/i, direction: 'desc' },
  { pattern: /order(?:ed)?\s+by\s+(\w+)\s+asc(?:ending)?/i, direction: 'asc' },
  { pattern: /order(?:ed)?\s+by\s+(\w+)/i, direction: 'asc' },
];

const LIMIT_PATTERN = /(?:limit|top|first|take)\s+(\d+)/i;

const AVAILABLE_OPERATORS: AutoCompleteSuggestion[] = [
  { text: '$eq', type: 'operator', description: 'Equals' },
  { text: '$ne', type: 'operator', description: 'Not equals' },
  { text: '$gt', type: 'operator', description: 'Greater than' },
  { text: '$gte', type: 'operator', description: 'Greater than or equal' },
  { text: '$lt', type: 'operator', description: 'Less than' },
  { text: '$lte', type: 'operator', description: 'Less than or equal' },
  { text: '$in', type: 'operator', description: 'In array' },
  { text: '$nin', type: 'operator', description: 'Not in array' },
  { text: '$exists', type: 'operator', description: 'Field exists' },
  { text: '$regex', type: 'operator', description: 'Matches regex pattern' },
];

// ── Helpers ──────────────────────────────────────────────────────────────

function generateId(): string {
  return `aq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const num = Number(raw);
  if (!Number.isNaN(num) && raw.trim() !== '') return num;
  return raw;
}

// ── Class ────────────────────────────────────────────────────────────────

/**
 * AI-powered query builder that converts natural language to Pocket queries.
 *
 * Maintains a registry of collection schemas so that field references in
 * natural language can be resolved, auto-complete suggestions can be
 * generated, and performance can be estimated before execution.
 */
export class AIQueryBuilder {
  private readonly config: Required<AIQueryBuilderConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly events$ = new Subject<StudioEvent>();
  private readonly history$ = new BehaviorSubject<AIQueryHistoryEntry[]>([]);
  private readonly schemas = new Map<string, AIQueryFieldInfo[]>();

  constructor(config: AIQueryBuilderConfig = {}) {
    this.config = {
      maxHistory: config.maxHistory ?? 100,
      defaultCollection: config.defaultCollection ?? '',
    };
  }

  // ── Schema registration ──────────────────────────────────────────────

  /**
   * Register a collection schema for use during natural language parsing
   * and auto-complete.
   */
  registerSchema(collection: string, fields: AIQueryFieldInfo[]): void {
    this.schemas.set(collection, fields);
  }

  /**
   * Remove a previously registered schema.
   */
  unregisterSchema(collection: string): boolean {
    return this.schemas.delete(collection);
  }

  /**
   * Return all registered collection names.
   */
  getRegisteredCollections(): string[] {
    return Array.from(this.schemas.keys());
  }

  // ── Natural language parsing ─────────────────────────────────────────

  /**
   * Parse a natural language query string and convert it to a Pocket
   * query object with filter, sort, and limit.
   *
   * @param input - Natural language query (e.g. "find users older than 30")
   * @returns A ParsedQuery with the generated filter, explanation, and estimate
   */
  parseNaturalLanguage(input: string): ParsedQuery {
    const id = generateId();
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('Query input must not be empty');
    }

    const collection = this.detectCollection(trimmed);
    const fields = this.schemas.get(collection) ?? [];
    const filter = this.buildFilter(trimmed, fields);
    const sort = this.detectSort(trimmed, fields);
    const limit = this.detectLimit(trimmed);
    const confidence = this.estimateConfidence(trimmed, collection, filter, fields);
    const explanation = this.explainQuery(collection, filter, sort, limit);
    const performanceEstimate = this.estimatePerformance(collection, filter);
    const label = this.generateLabel(trimmed, collection, filter);

    const parsed: ParsedQuery = {
      id,
      naturalLanguage: trimmed,
      collection,
      filter,
      sort,
      limit,
      confidence,
      explanation,
      performanceEstimate,
      label,
      parsedAt: Date.now(),
    };

    this.addToHistory(parsed);

    this.events$.next({
      type: 'query-playground:executed',
      collection,
      durationMs: 0,
      resultCount: 0,
    });

    return parsed;
  }

  // ── Query explanation ────────────────────────────────────────────────

  /**
   * Return a plain-English explanation of a Pocket filter object.
   */
  explainFilter(collection: string, filter: Record<string, unknown>): string {
    return this.explainQuery(collection, filter, undefined, undefined);
  }

  // ── Auto-complete ────────────────────────────────────────────────────

  /**
   * Return auto-complete suggestions for a partial field name or operator
   * within the context of a given collection.
   */
  getAutoComplete(collection: string, partial: string): AutoCompleteSuggestion[] {
    const suggestions: AutoCompleteSuggestion[] = [];
    const lower = partial.toLowerCase();
    const fields = this.schemas.get(collection) ?? [];

    // Field suggestions
    for (const field of fields) {
      if (field.name.toLowerCase().startsWith(lower)) {
        suggestions.push({
          text: field.name,
          type: 'field',
          description: `${field.type} field${field.indexed ? ' (indexed)' : ''}`,
        });
      }
    }

    // Operator suggestions
    for (const op of AVAILABLE_OPERATORS) {
      if (op.text.toLowerCase().startsWith(lower)) {
        suggestions.push(op);
      }
    }

    return suggestions;
  }

  /**
   * Get query suggestions based on the current schema and past queries.
   */
  getQuerySuggestions(collection: string): string[] {
    const fields = this.schemas.get(collection);
    if (!fields || fields.length === 0) return [];

    const suggestions: string[] = [];

    for (const field of fields) {
      if (field.type === 'string') {
        suggestions.push(`Find ${collection} where ${field.name} is "value"`);
      } else if (field.type === 'number') {
        suggestions.push(`Find ${collection} where ${field.name} is greater than 0`);
      } else if (field.type === 'boolean') {
        suggestions.push(`Find ${collection} where ${field.name} is true`);
      }
    }

    // Suggest sorting by first field
    if (fields.length > 0) {
      suggestions.push(`Find all ${collection} sorted by ${fields[0]!.name} descending`);
    }

    return suggestions;
  }

  // ── Performance estimation ───────────────────────────────────────────

  /**
   * Estimate query performance before execution.
   */
  estimateQueryPerformance(
    collection: string,
    filter: Record<string, unknown>,
  ): PerformanceEstimate {
    return this.estimatePerformance(collection, filter);
  }

  // ── History ──────────────────────────────────────────────────────────

  /**
   * Get query history as an observable stream.
   */
  getHistory(): Observable<AIQueryHistoryEntry[]> {
    return this.history$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get query history as a snapshot array.
   */
  getHistorySnapshot(): AIQueryHistoryEntry[] {
    return this.history$.getValue();
  }

  /**
   * Clear all history entries.
   */
  clearHistory(): void {
    this.history$.next([]);
  }

  // ── Events ───────────────────────────────────────────────────────────

  /**
   * Get studio events from the AI query builder.
   */
  getEvents(): Observable<StudioEvent> {
    return this.events$.asObservable().pipe(takeUntil(this.destroy$));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Destroy the builder and complete all streams.
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.events$.complete();
    this.history$.complete();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private detectCollection(input: string): string {
    const lower = input.toLowerCase();

    for (const name of this.schemas.keys()) {
      // Match plural or singular form in the input
      if (lower.includes(name.toLowerCase())) {
        return name;
      }
    }

    // Try to extract from "from <collection>" or "in <collection>"
    const fromMatch = lower.match(/(?:from|in)\s+(\w+)/);
    if (fromMatch) {
      const candidate = fromMatch[1]!;
      for (const name of this.schemas.keys()) {
        if (name.toLowerCase() === candidate) return name;
      }
    }

    return this.config.defaultCollection || Array.from(this.schemas.keys())[0] || 'unknown';
  }

  private buildFilter(
    input: string,
    fields: AIQueryFieldInfo[],
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    for (const field of fields) {
      // Try each operator pattern with the field name as context
      for (const { pattern, operator, extract } of OPERATOR_PATTERNS) {
        // Build a regex that looks for "field <operator phrase>"
        const fieldPattern = new RegExp(
          `${this.escapeRegex(field.name)}\\s+(?:is\\s+)?${pattern.source}`,
          'i',
        );
        const match = input.match(fieldPattern);
        if (match) {
          // Shift match indices: the named groups start at index 1 of the
          // operator pattern, which is now later in the combined regex.
          // Re-run the operator pattern on the substring for clean extraction.
          const subMatch = input.slice(match.index!).match(pattern);
          if (subMatch) {
            const value = extract(subMatch);
            if (operator === '$eq') {
              filter[field.name] = value;
            } else {
              filter[field.name] = { [operator]: value };
            }
          }
          break; // first match wins for each field
        }
      }

      // Fallback: "where field value" pattern
      if (!(field.name in filter)) {
        const wherePattern = new RegExp(
          `(?:where|with)\\s+${this.escapeRegex(field.name)}\\s+(?:=\\s+)?(?:"([^"]+)"|([\\w.]+))`,
          'i',
        );
        const whereMatch = input.match(wherePattern);
        if (whereMatch) {
          const raw = whereMatch[1] ?? whereMatch[2]!;
          filter[field.name] = coerceValue(raw);
        }
      }
    }

    return filter;
  }

  private detectSort(
    input: string,
    fields: AIQueryFieldInfo[],
  ): Record<string, 'asc' | 'desc'> | undefined {
    for (const { pattern, direction } of SORT_PATTERNS) {
      const match = input.match(pattern);
      if (match) {
        const fieldName = match[1]!;
        const resolved = fields.find(
          (f) => f.name.toLowerCase() === fieldName.toLowerCase(),
        );
        if (resolved) {
          return { [resolved.name]: direction };
        }
        return { [fieldName]: direction };
      }
    }
    return undefined;
  }

  private detectLimit(input: string): number | undefined {
    const match = input.match(LIMIT_PATTERN);
    if (match) return Number(match[1]);
    return undefined;
  }

  private estimateConfidence(
    input: string,
    collection: string,
    filter: Record<string, unknown>,
    fields: AIQueryFieldInfo[],
  ): number {
    let confidence = 0.5;

    // Boost: collection was found in schemas
    if (this.schemas.has(collection)) confidence += 0.2;

    // Boost: filter fields match schema
    const filterKeys = Object.keys(filter);
    if (filterKeys.length > 0) {
      const matchedFields = filterKeys.filter((k) =>
        fields.some((f) => f.name === k),
      );
      confidence += 0.2 * (matchedFields.length / filterKeys.length);
    }

    // Penalty: very short input
    if (input.split(/\s+/).length < 3) confidence -= 0.1;

    return Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));
  }

  private explainQuery(
    collection: string,
    filter: Record<string, unknown>,
    sort?: Record<string, 'asc' | 'desc'>,
    limit?: number,
  ): string {
    const parts: string[] = [];
    parts.push(`Find documents in "${collection}"`);

    const filterKeys = Object.keys(filter);
    if (filterKeys.length > 0) {
      const conditions = filterKeys.map((key) => {
        const value = filter[key];
        if (typeof value === 'object' && value !== null) {
          const entries = Object.entries(value as Record<string, unknown>);
          return entries
            .map(([op, val]) => {
              const opName = this.operatorToEnglish(op);
              return `${key} ${opName} ${JSON.stringify(val)}`;
            })
            .join(' and ');
        }
        return `${key} equals ${JSON.stringify(value)}`;
      });
      parts.push(`where ${conditions.join(' and ')}`);
    }

    if (sort) {
      const sortParts = Object.entries(sort).map(
        ([field, dir]) => `${field} ${dir === 'desc' ? 'descending' : 'ascending'}`,
      );
      parts.push(`sorted by ${sortParts.join(', ')}`);
    }

    if (limit !== undefined) {
      parts.push(`limited to ${limit} results`);
    }

    return parts.join(', ') + '.';
  }

  private operatorToEnglish(op: string): string {
    const map: Record<string, string> = {
      $eq: 'equals',
      $ne: 'does not equal',
      $gt: 'is greater than',
      $gte: 'is greater than or equal to',
      $lt: 'is less than',
      $lte: 'is less than or equal to',
      $in: 'is in',
      $nin: 'is not in',
      $exists: 'exists',
      $regex: 'matches pattern',
    };
    return map[op] ?? op;
  }

  private estimatePerformance(
    collection: string,
    filter: Record<string, unknown>,
  ): PerformanceEstimate {
    const fields = this.schemas.get(collection) ?? [];
    const filterKeys = Object.keys(filter);
    const suggestions: string[] = [];

    if (filterKeys.length === 0) {
      return {
        strategy: 'full-scan',
        indexCoverage: false,
        estimatedCost: 'high',
        suggestions: ['Consider adding filters to reduce the number of documents scanned.'],
      };
    }

    // Check if any filter field is indexed
    const indexedFilterFields = filterKeys.filter((k) =>
      fields.some((f) => f.name === k && f.indexed),
    );

    const indexCoverage = indexedFilterFields.length > 0;

    if (!indexCoverage) {
      for (const key of filterKeys) {
        suggestions.push(
          `Consider creating an index on "${collection}.${key}" for faster queries.`,
        );
      }
    }

    let strategy: PerformanceEstimate['strategy'] = 'full-scan';
    let estimatedCost: PerformanceEstimate['estimatedCost'] = 'high';

    if (filterKeys.length === 1 && filterKeys[0] === '_id') {
      strategy = 'key-lookup';
      estimatedCost = 'low';
    } else if (indexCoverage) {
      strategy = 'index-scan';
      estimatedCost = indexedFilterFields.length === filterKeys.length ? 'low' : 'medium';
    } else {
      strategy = 'full-scan';
      estimatedCost = 'high';
    }

    return { strategy, indexCoverage, estimatedCost, suggestions };
  }

  private generateLabel(
    _input: string,
    collection: string,
    filter: Record<string, unknown>,
  ): string {
    const filterKeys = Object.keys(filter);
    if (filterKeys.length === 0) {
      return `All ${collection}`;
    }

    const parts = filterKeys.map((key) => {
      const value = filter[key];
      if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value as Record<string, unknown>);
        return entries.map(([op, val]) => `${key} ${op} ${val}`).join(', ');
      }
      return `${key}=${JSON.stringify(value)}`;
    });

    return `${collection}: ${parts.join(', ')}`;
  }

  private addToHistory(parsed: ParsedQuery): void {
    const entry: AIQueryHistoryEntry = {
      id: parsed.id,
      label: parsed.label,
      collection: parsed.collection,
      naturalLanguage: parsed.naturalLanguage,
      filter: parsed.filter,
      parsedAt: parsed.parsedAt,
    };

    const history = this.history$.getValue();
    const updated = [entry, ...history].slice(0, this.config.maxHistory);
    this.history$.next(updated);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

/**
 * Create a new AIQueryBuilder instance.
 *
 * @param config - Optional configuration
 * @returns A new AIQueryBuilder
 *
 * @example
 * ```typescript
 * import { createAIQueryBuilder } from '@pocket/studio';
 *
 * const builder = createAIQueryBuilder({ maxHistory: 50 });
 * builder.registerSchema('users', [
 *   { name: 'name', type: 'string' },
 *   { name: 'age', type: 'number' },
 * ]);
 *
 * const parsed = builder.parseNaturalLanguage('find users older than 25');
 * console.log(parsed.filter); // { age: { $gt: 25 } }
 * ```
 */
export function createAIQueryBuilder(config?: AIQueryBuilderConfig): AIQueryBuilder {
  return new AIQueryBuilder(config);
}
