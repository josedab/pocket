/**
 * LocalQueryInference - Pattern-based NL-to-query translator that works
 * without an LLM. Uses schema-aware heuristics and keyword patterns to
 * generate structured queries from natural language input.
 *
 * This provides instant, offline query generation as a fallback or
 * complement to the LLM-powered SmartQueryEngine.
 *
 * @example
 * ```typescript
 * const inference = new LocalQueryInference({
 *   schemas: [{ name: 'todos', fields: [
 *     { name: 'title', type: 'string' },
 *     { name: 'completed', type: 'boolean' },
 *     { name: 'priority', type: 'number' },
 *   ]}],
 * });
 *
 * const result = inference.parse('find incomplete todos with high priority');
 * // { collection: 'todos', filter: { completed: false, priority: { $gte: 7 } }, ... }
 * ```
 */

import type { CollectionSchema, GeneratedQuery, SchemaField } from './smart-query.js';

export interface LocalQueryInferenceConfig {
  /** Collection schemas for context */
  schemas: CollectionSchema[];
  /** Custom keyword mappings */
  customKeywords?: Record<string, PatternRule>;
}

export interface PatternRule {
  /** Field this pattern targets */
  field: string;
  /** The filter to apply */
  filter: Record<string, unknown>;
  /** How much this rule contributes to confidence */
  confidence: number;
}

interface ParsedIntent {
  collection: string | null;
  filters: Record<string, unknown>;
  sort: Record<string, 'asc' | 'desc'>;
  limit: number | undefined;
  confidence: number;
  matchedPatterns: string[];
}

// Temporal keywords mapped to relative date offsets (ms from now)
const TEMPORAL_KEYWORDS: Record<string, { operator: string; offsetMs: number }> = {
  today: { operator: '$gte', offsetMs: 0 },
  yesterday: { operator: '$gte', offsetMs: -86400000 },
  tomorrow: { operator: '$lte', offsetMs: 86400000 },
  'this week': { operator: '$gte', offsetMs: -604800000 },
  'last week': { operator: '$gte', offsetMs: -1209600000 },
  'this month': { operator: '$gte', offsetMs: -2592000000 },
  'last month': { operator: '$gte', offsetMs: -5184000000 },
  overdue: { operator: '$lt', offsetMs: 0 },
};

const BOOLEAN_TRUE_WORDS = new Set([
  'completed',
  'done',
  'finished',
  'active',
  'enabled',
  'published',
  'verified',
  'approved',
]);
const BOOLEAN_FALSE_WORDS = new Set([
  'incomplete',
  'pending',
  'unfinished',
  'disabled',
  'unpublished',
  'unverified',
  'unapproved',
  'not completed',
  'not done',
  'not finished',
]);

const SORT_KEYWORDS: Record<string, 'asc' | 'desc'> = {
  newest: 'desc',
  latest: 'desc',
  recent: 'desc',
  last: 'desc',
  oldest: 'asc',
  earliest: 'asc',
  first: 'asc',
  highest: 'desc',
  most: 'desc',
  top: 'desc',
  lowest: 'asc',
  least: 'asc',
  bottom: 'asc',
};

const LIMIT_PATTERNS = [
  /\btop\s+(\d+)\b/i,
  /\bfirst\s+(\d+)\b/i,
  /\blast\s+(\d+)\b/i,
  /\b(\d+)\s+(?:results?|items?|records?|docs?|documents?)\b/i,
  /\blimit\s+(\d+)\b/i,
];

/**
 * Pattern-based local query inference engine.
 * No LLM required — works entirely offline using heuristic matching.
 */
export class LocalQueryInference {
  private readonly schemas: Map<string, CollectionSchema>;
  private readonly fieldIndex: Map<string, { schema: string; field: SchemaField }[]>;
  private readonly customKeywords: Record<string, PatternRule>;

  constructor(config: LocalQueryInferenceConfig) {
    this.schemas = new Map(config.schemas.map((s) => [s.name.toLowerCase(), s]));
    this.customKeywords = config.customKeywords ?? {};
    this.fieldIndex = new Map();

    // Build inverted index: fieldName → [{ schema, field }]
    for (const schema of config.schemas) {
      for (const field of schema.fields) {
        const key = field.name.toLowerCase();
        const existing = this.fieldIndex.get(key) ?? [];
        existing.push({ schema: schema.name, field });
        this.fieldIndex.set(key, existing);
      }
    }
  }

  /**
   * Parse a natural language query into a structured query.
   */
  parse(input: string): GeneratedQuery {
    const normalized = input.toLowerCase().trim();
    const intent = this.extractIntent(normalized);

    const collection = intent.collection ?? this.inferCollection(normalized);
    if (!collection) {
      return {
        collection: '',
        filter: {},
        explanation: 'Could not determine which collection to query',
        confidence: 0,
        naturalLanguage: input,
      };
    }

    return {
      collection,
      filter: intent.filters,
      sort: Object.keys(intent.sort).length > 0 ? intent.sort : undefined,
      limit: intent.limit,
      explanation: this.buildExplanation(collection, intent),
      confidence: Math.min(intent.confidence, 1),
      naturalLanguage: input,
    };
  }

  /**
   * Update schemas (e.g., when collections change).
   */
  updateSchemas(schemas: CollectionSchema[]): void {
    this.schemas.clear();
    this.fieldIndex.clear();
    for (const schema of schemas) {
      this.schemas.set(schema.name.toLowerCase(), schema);
      for (const field of schema.fields) {
        const key = field.name.toLowerCase();
        const existing = this.fieldIndex.get(key) ?? [];
        existing.push({ schema: schema.name, field });
        this.fieldIndex.set(key, existing);
      }
    }
  }

  private extractIntent(input: string): ParsedIntent {
    const intent: ParsedIntent = {
      collection: null,
      filters: {},
      sort: {},
      limit: undefined,
      confidence: 0.3, // base confidence for any parsed result
      matchedPatterns: [],
    };

    this.extractCollection(input, intent);
    this.extractBooleanFilters(input, intent);
    this.extractTemporalFilters(input, intent);
    this.extractComparisonFilters(input, intent);
    this.extractStringFilters(input, intent);
    this.extractEnumFilters(input, intent);
    this.extractSortOrder(input, intent);
    this.extractLimit(input, intent);
    this.applyCustomKeywords(input, intent);

    return intent;
  }

  private extractCollection(input: string, intent: ParsedIntent): void {
    // Direct collection name match
    for (const [name] of this.schemas) {
      if (input.includes(name)) {
        intent.collection = name;
        intent.confidence += 0.2;
        intent.matchedPatterns.push(`collection:${name}`);
        return;
      }
      // Try singular form
      const singular = name.endsWith('s') ? name.slice(0, -1) : null;
      if (singular && input.includes(singular)) {
        intent.collection = name;
        intent.confidence += 0.15;
        intent.matchedPatterns.push(`collection:${name}(singular)`);
        return;
      }
    }
  }

  private extractBooleanFilters(input: string, intent: ParsedIntent): void {
    const schema = this.getTargetSchema(intent);
    if (!schema) return;

    const booleanFields = schema.fields.filter((f) => f.type === 'boolean');

    for (const field of booleanFields) {
      const fieldName = field.name.toLowerCase();
      // Derive the stem (e.g., "completed" → "complet", "active" → "activ")
      const stem = fieldName.replace(/(ed|ing|e|s)$/, '');

      // Check false-words first (more specific: "incomplete", "not done")
      let matched = false;
      for (const falseWord of BOOLEAN_FALSE_WORDS) {
        if (!input.includes(falseWord)) continue;
        const falseWordStem = falseWord.replace(/^(not |un|in)/, '').replace(/(ed|ing|e|s)$/, '');
        if (
          falseWordStem === stem ||
          falseWord.includes(fieldName) ||
          fieldName.includes(falseWord.replace(/^(not |un|in)/, ''))
        ) {
          intent.filters[field.name] = false;
          intent.confidence += 0.2;
          intent.matchedPatterns.push(`boolean:${field.name}=false`);
          matched = true;
          break;
        }
      }

      if (matched) continue;

      for (const trueWord of BOOLEAN_TRUE_WORDS) {
        if (!input.includes(trueWord)) continue;
        const trueWordStem = trueWord.replace(/(ed|ing|e|s)$/, '');
        if (trueWordStem === stem || trueWord.includes(fieldName) || fieldName.includes(trueWord)) {
          intent.filters[field.name] = true;
          intent.confidence += 0.2;
          intent.matchedPatterns.push(`boolean:${field.name}=true`);
          break;
        }
      }
    }
  }

  private extractTemporalFilters(input: string, intent: ParsedIntent): void {
    const schema = this.getTargetSchema(intent);
    if (!schema) return;

    const dateFields = schema.fields.filter((f) => f.type === 'date');
    if (dateFields.length === 0) return;

    const targetField = dateFields[0]!.name;

    for (const [keyword, spec] of Object.entries(TEMPORAL_KEYWORDS)) {
      if (input.includes(keyword)) {
        const date = new Date(Date.now() + spec.offsetMs);
        if (keyword === 'today') {
          date.setHours(0, 0, 0, 0);
        }
        intent.filters[targetField] = { [spec.operator]: date.toISOString() };
        intent.confidence += 0.15;
        intent.matchedPatterns.push(`temporal:${keyword}`);
        break;
      }
    }
  }

  private extractComparisonFilters(input: string, intent: ParsedIntent): void {
    const schema = this.getTargetSchema(intent);
    if (!schema) return;

    const numberFields = schema.fields.filter((f) => f.type === 'number');

    // Pattern: "field > N", "field greater than N", "field at least N"
    const comparisons: { pattern: RegExp; operator: string }[] = [
      { pattern: /(\w+)\s*(?:>|greater than|more than|above|over)\s*(\d+)/i, operator: '$gt' },
      { pattern: /(\w+)\s*(?:>=|at least|minimum)\s*(\d+)/i, operator: '$gte' },
      { pattern: /(\w+)\s*(?:<|less than|under|below)\s*(\d+)/i, operator: '$lt' },
      { pattern: /(\w+)\s*(?:<=|at most|maximum)\s*(\d+)/i, operator: '$lte' },
      { pattern: /(\w+)\s*(?:=|equals?|is)\s*(\d+)/i, operator: '$eq' },
    ];

    for (const { pattern, operator } of comparisons) {
      const match = input.match(pattern);
      if (match) {
        const fieldNameInput = match[1]!.toLowerCase();
        const value = parseInt(match[2]!, 10);
        const field = numberFields.find((f) => f.name.toLowerCase() === fieldNameInput);
        if (field) {
          intent.filters[field.name] = operator === '$eq' ? value : { [operator]: value };
          intent.confidence += 0.2;
          intent.matchedPatterns.push(`comparison:${field.name}${operator}${value}`);
        }
      }
    }

    // "high priority" / "low priority" heuristic for fields named priority/rating/score
    const priorityField = numberFields.find((f) => /priority|rating|score|rank/i.test(f.name));
    if (priorityField) {
      if (/\bhigh\b/i.test(input)) {
        intent.filters[priorityField.name] = { $gte: 7 };
        intent.confidence += 0.1;
        intent.matchedPatterns.push(`heuristic:high-${priorityField.name}`);
      } else if (/\blow\b/i.test(input)) {
        intent.filters[priorityField.name] = { $lte: 3 };
        intent.confidence += 0.1;
        intent.matchedPatterns.push(`heuristic:low-${priorityField.name}`);
      }
    }
  }

  private extractStringFilters(input: string, intent: ParsedIntent): void {
    const schema = this.getTargetSchema(intent);
    if (!schema) return;

    // Pattern: "by <value>" for author/assignee/owner fields
    const authorMatch = /\bby\s+(\w+)/i.exec(input);
    if (authorMatch) {
      const value = authorMatch[1]!;
      const authorField = schema.fields.find(
        (f) => f.type === 'string' && /author|assignee|owner|creator|user/i.test(f.name)
      );
      if (authorField) {
        intent.filters[authorField.name] = value;
        intent.confidence += 0.15;
        intent.matchedPatterns.push(`string:${authorField.name}=${value}`);
      }
    }

    // Pattern: "containing/with <text>" for title/name/description
    const containsMatch = /(?:containing|with|about|titled?)\s+["']?([^"']+?)["']?$/i.exec(input);
    if (containsMatch) {
      const value = containsMatch[1]!.trim();
      const textField = schema.fields.find(
        (f) => f.type === 'string' && /title|name|description|content|text|subject/i.test(f.name)
      );
      if (textField) {
        intent.filters[textField.name] = { $contains: value };
        intent.confidence += 0.15;
        intent.matchedPatterns.push(`string:${textField.name}~=${value}`);
      }
    }
  }

  private extractEnumFilters(input: string, intent: ParsedIntent): void {
    const schema = this.getTargetSchema(intent);
    if (!schema) return;

    const enumFields = schema.fields.filter((f) => f.enum && f.enum.length > 0);
    for (const field of enumFields) {
      for (const enumValue of field.enum!) {
        if (input.includes(enumValue.toLowerCase())) {
          intent.filters[field.name] = enumValue;
          intent.confidence += 0.2;
          intent.matchedPatterns.push(`enum:${field.name}=${enumValue}`);
          break;
        }
      }
    }
  }

  private extractSortOrder(input: string, intent: ParsedIntent): void {
    const schema = this.getTargetSchema(intent);
    if (!schema) return;

    for (const [keyword, direction] of Object.entries(SORT_KEYWORDS)) {
      if (input.includes(keyword)) {
        // Find the most relevant field to sort by
        const dateField = schema.fields.find((f) => f.type === 'date');
        const numberField = schema.fields.find((f) => f.type === 'number');

        if (/newest|latest|recent|oldest|earliest/.test(keyword) && dateField) {
          intent.sort[dateField.name] = direction;
        } else if (numberField) {
          intent.sort[numberField.name] = direction;
        } else if (dateField) {
          intent.sort[dateField.name] = direction;
        }

        intent.confidence += 0.1;
        intent.matchedPatterns.push(`sort:${keyword}`);
        break;
      }
    }

    // Explicit "sort by <field>" or "order by <field>"
    const sortMatch = /(?:sort|order)\s+by\s+(\w+)\s*(asc|desc)?/i.exec(input);
    if (sortMatch) {
      const fieldName = sortMatch[1]!.toLowerCase();
      const direction = (sortMatch[2]?.toLowerCase() as 'asc' | 'desc') ?? 'asc';
      const field = schema.fields.find((f) => f.name.toLowerCase() === fieldName);
      if (field) {
        intent.sort[field.name] = direction;
        intent.confidence += 0.15;
        intent.matchedPatterns.push(`sort:explicit:${field.name}:${direction}`);
      }
    }
  }

  private extractLimit(input: string, intent: ParsedIntent): void {
    for (const pattern of LIMIT_PATTERNS) {
      const match = input.match(pattern);
      if (match) {
        intent.limit = parseInt(match[1]!, 10);
        intent.confidence += 0.1;
        intent.matchedPatterns.push(`limit:${intent.limit}`);
        return;
      }
    }
  }

  private applyCustomKeywords(input: string, intent: ParsedIntent): void {
    for (const [keyword, rule] of Object.entries(this.customKeywords)) {
      if (input.includes(keyword.toLowerCase())) {
        intent.filters[rule.field] = rule.filter;
        intent.confidence += rule.confidence;
        intent.matchedPatterns.push(`custom:${keyword}`);
      }
    }
  }

  private inferCollection(input: string): string | null {
    // Try to find the best matching collection by field references
    const scores = new Map<string, number>();

    for (const [fieldName, entries] of this.fieldIndex) {
      if (input.includes(fieldName)) {
        for (const entry of entries) {
          scores.set(entry.schema, (scores.get(entry.schema) ?? 0) + 1);
        }
      }
    }

    let best: string | null = null;
    let bestScore = 0;
    for (const [name, score] of scores) {
      if (score > bestScore) {
        best = name;
        bestScore = score;
      }
    }

    // Default to first schema if only one exists
    if (!best && this.schemas.size === 1) {
      best = this.schemas.keys().next().value ?? null;
    }

    return best;
  }

  private getTargetSchema(intent: ParsedIntent): CollectionSchema | null {
    if (intent.collection) {
      return this.schemas.get(intent.collection.toLowerCase()) ?? null;
    }
    if (this.schemas.size === 1) {
      return this.schemas.values().next().value ?? null;
    }
    return null;
  }

  private buildExplanation(collection: string, intent: ParsedIntent): string {
    const parts: string[] = [`Query collection "${collection}"`];

    const filterCount = Object.keys(intent.filters).length;
    if (filterCount > 0) {
      parts.push(`with ${filterCount} filter(s)`);
    }
    if (Object.keys(intent.sort).length > 0) {
      const sortDesc = Object.entries(intent.sort)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
      parts.push(`sorted by ${sortDesc}`);
    }
    if (intent.limit) {
      parts.push(`limited to ${intent.limit} results`);
    }
    if (intent.matchedPatterns.length > 0) {
      parts.push(`(matched: ${intent.matchedPatterns.join(', ')})`);
    }

    return parts.join(' ');
  }
}

/**
 * Create a local query inference engine.
 */
export function createLocalQueryInference(config: LocalQueryInferenceConfig): LocalQueryInference {
  return new LocalQueryInference(config);
}
