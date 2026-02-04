/**
 * SmartQueryEngine - Natural language to Pocket query translation.
 *
 * Converts human-readable queries like "show me overdue tasks assigned to alice"
 * into type-safe QueryBuilder chains using LLM inference.
 */

import type { LLMAdapter, Message } from './types.js';

export interface CollectionSchema {
  name: string;
  fields: SchemaField[];
  description?: string;
  sampleDocuments?: Record<string, unknown>[];
}

export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  description?: string;
  required?: boolean;
  enum?: string[];
}

export interface SmartQueryConfig {
  /** LLM adapter for query generation */
  adapter: LLMAdapter;
  /** Collection schemas for context */
  schemas: CollectionSchema[];
  /** Maximum retries for invalid query generation */
  maxRetries?: number;
  /** Temperature for LLM generation (lower = more deterministic) */
  temperature?: number;
  /** Enable query caching */
  cacheEnabled?: boolean;
  /** Maximum cache entries */
  maxCacheSize?: number;
}

export interface GeneratedQuery {
  /** The collection to query */
  collection: string;
  /** Filter object for the query */
  filter: Record<string, unknown>;
  /** Sort specification */
  sort?: Record<string, 'asc' | 'desc'>;
  /** Result limit */
  limit?: number;
  /** Fields to skip */
  skip?: number;
  /** Human-readable explanation of the query */
  explanation: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** The original natural language input */
  naturalLanguage: string;
}

export interface QuerySuggestion {
  /** Suggested natural language query */
  text: string;
  /** Brief description of what it does */
  description: string;
  /** Relevance score 0-1 */
  relevance: number;
}

const QUERY_SYSTEM_PROMPT = `You are a database query translator. You convert natural language queries into structured JSON query objects for a document database called Pocket.

RULES:
1. Output ONLY valid JSON, no markdown, no explanation
2. Use the exact field names from the schema
3. For date comparisons, use ISO 8601 strings
4. Supported filter operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $regex, $startsWith, $endsWith, $contains, $exists, $and, $or
5. Sort values must be "asc" or "desc"
6. Set confidence between 0 and 1 based on how well you understood the query
7. If the query is ambiguous, use reasonable defaults and note in explanation

OUTPUT FORMAT:
{
  "collection": "collectionName",
  "filter": { ... },
  "sort": { "field": "asc" | "desc" },
  "limit": number | null,
  "skip": number | null,
  "explanation": "Human-readable explanation",
  "confidence": 0.0-1.0
}`;

export class SmartQueryEngine {
  private readonly config: Required<SmartQueryConfig>;
  private readonly queryCache = new Map<string, GeneratedQuery>();
  private readonly schemaContext: string;

  constructor(config: SmartQueryConfig) {
    this.config = {
      adapter: config.adapter,
      schemas: config.schemas,
      maxRetries: config.maxRetries ?? 2,
      temperature: config.temperature ?? 0.1,
      cacheEnabled: config.cacheEnabled ?? true,
      maxCacheSize: config.maxCacheSize ?? 100,
    };
    this.schemaContext = this.buildSchemaContext();
  }

  /**
   * Convert natural language to a structured query.
   */
  async generateQuery(naturalLanguage: string): Promise<GeneratedQuery> {
    const cacheKey = naturalLanguage.toLowerCase().trim();

    if (this.config.cacheEnabled && this.queryCache.has(cacheKey)) {
      return this.queryCache.get(cacheKey)!;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const query = await this.attemptGeneration(
          naturalLanguage,
          attempt > 0 ? lastError?.message : undefined
        );

        if (this.config.cacheEnabled) {
          if (this.queryCache.size >= this.config.maxCacheSize) {
            const firstKey = this.queryCache.keys().next().value;
            if (firstKey !== undefined) {
              this.queryCache.delete(firstKey);
            }
          }
          this.queryCache.set(cacheKey, query);
        }

        return query;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw new Error(
      `Failed to generate query after ${this.config.maxRetries + 1} attempts: ${lastError?.message}`
    );
  }

  /**
   * Get query suggestions based on available schemas.
   */
  async suggestQueries(context?: string): Promise<QuerySuggestion[]> {
    const prompt = context
      ? `Given the user is working with: "${context}", suggest 5 useful queries they might want to run.`
      : `Based on the available collections, suggest 5 useful queries a user might want to run.`;

    const messages: Message[] = [
      {
        role: 'system',
        content: `You suggest database queries. Output a JSON array of objects with "text", "description", and "relevance" (0-1) fields. Output ONLY the JSON array.\n\nAvailable collections:\n${this.schemaContext}`,
      },
      { role: 'user', content: prompt },
    ];

    try {
      const response = await this.config.adapter.complete(messages, {
        temperature: 0.5,
        maxTokens: 1000,
      });

      const parsed = JSON.parse(response.content) as QuerySuggestion[];

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter(
          (s): s is QuerySuggestion =>
            typeof s.text === 'string' &&
            typeof s.description === 'string' &&
            typeof s.relevance === 'number'
        )
        .sort((a, b) => b.relevance - a.relevance);
    } catch {
      return [];
    }
  }

  /**
   * Validate a generated query against the schemas.
   */
  validateQuery(query: GeneratedQuery): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const schema = this.config.schemas.find((s) => s.name === query.collection);
    if (!schema) {
      errors.push(`Unknown collection: ${query.collection}`);
      return { valid: false, errors };
    }

    const fieldNames = new Set(schema.fields.map((f) => f.name));

    // Validate filter fields
    this.validateFilterFields(query.filter, fieldNames, errors, '');

    // Validate sort fields
    if (query.sort) {
      for (const field of Object.keys(query.sort)) {
        if (!fieldNames.has(field) && field !== '_id' && field !== '_updatedAt') {
          errors.push(`Unknown sort field: ${field}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Update the schema context (e.g., when collections change).
   */
  updateSchemas(schemas: CollectionSchema[]): void {
    (this.config as Record<string, unknown>).schemas = schemas;
    (this as unknown as Record<string, unknown>).schemaContext = this.buildSchemaContext();
    this.clearCache();
  }

  /**
   * Clear the query cache.
   */
  clearCache(): void {
    this.queryCache.clear();
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.queryCache.size,
      maxSize: this.config.maxCacheSize,
      hitRate: 0, // Simplified; a production version would track hits/misses
    };
  }

  private async attemptGeneration(
    naturalLanguage: string,
    previousError?: string
  ): Promise<GeneratedQuery> {
    const userPrompt = previousError
      ? `Previous attempt failed with: "${previousError}". Please try again.\n\nQuery: ${naturalLanguage}`
      : naturalLanguage;

    const messages: Message[] = [
      {
        role: 'system',
        content: `${QUERY_SYSTEM_PROMPT}\n\nAVAILABLE COLLECTIONS:\n${this.schemaContext}`,
      },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.config.adapter.complete(messages, {
      temperature: this.config.temperature,
      maxTokens: 500,
    });

    const content = response.content.trim();

    // Extract JSON from potential markdown code blocks
    const jsonMatch = /\{[\s\S]*\}/.exec(content);
    if (!jsonMatch) {
      throw new Error('No JSON object found in LLM response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    if (typeof parsed.collection !== 'string') {
      throw new Error('Missing or invalid "collection" field in response');
    }

    const query: GeneratedQuery = {
      collection: parsed.collection,
      filter: (parsed.filter as Record<string, unknown>) ?? {},
      sort: parsed.sort as Record<string, 'asc' | 'desc'> | undefined,
      limit: typeof parsed.limit === 'number' ? parsed.limit : undefined,
      skip: typeof parsed.skip === 'number' ? parsed.skip : undefined,
      explanation:
        typeof parsed.explanation === 'string' ? parsed.explanation : 'No explanation provided',
      confidence:
        typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      naturalLanguage,
    };

    // Validate the generated query
    const validation = this.validateQuery(query);
    if (!validation.valid) {
      throw new Error(`Invalid query: ${validation.errors.join(', ')}`);
    }

    return query;
  }

  private buildSchemaContext(): string {
    return this.config.schemas
      .map((schema) => {
        const fields = schema.fields
          .map((f) => {
            let desc = `  - ${f.name}: ${f.type}`;
            if (f.description) desc += ` (${f.description})`;
            if (f.required) desc += ' [required]';
            if (f.enum) desc += ` [enum: ${f.enum.join(', ')}]`;
            return desc;
          })
          .join('\n');

        let result = `Collection: ${schema.name}`;
        if (schema.description) result += ` - ${schema.description}`;
        result += `\nFields:\n${fields}`;
        return result;
      })
      .join('\n\n');
  }

  private validateFilterFields(
    filter: Record<string, unknown>,
    fieldNames: Set<string>,
    errors: string[],
    prefix: string
  ): void {
    for (const [key, value] of Object.entries(filter)) {
      // Skip logical operators
      if (key === '$and' || key === '$or' || key === '$not' || key === '$nor') {
        if (Array.isArray(value)) {
          for (const sub of value) {
            if (typeof sub === 'object' && sub !== null) {
              this.validateFilterFields(sub as Record<string, unknown>, fieldNames, errors, prefix);
            }
          }
        }
        continue;
      }

      // Skip internal fields
      if (key === '_id' || key === '_updatedAt' || key === '_rev' || key === '_deleted') {
        continue;
      }

      // Skip operator keys
      if (key.startsWith('$')) {
        continue;
      }

      const fullPath = prefix ? `${prefix}.${key}` : key;
      const rootField = key.split('.')[0]!;

      if (!fieldNames.has(rootField)) {
        errors.push(`Unknown filter field: ${fullPath}`);
      }
    }
  }
}

/**
 * Create a SmartQueryEngine instance.
 *
 * @param config - Engine configuration with LLM adapter and schemas
 * @returns A configured SmartQueryEngine
 */
export function createSmartQueryEngine(config: SmartQueryConfig): SmartQueryEngine {
  return new SmartQueryEngine(config);
}
