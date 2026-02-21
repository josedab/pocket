/**
 * QueryCopilot - End-to-end natural language query interface for Pocket.
 *
 * Combines schema auto-extraction, SmartQueryEngine NL-to-query translation,
 * and direct query execution into a single high-level API. Supports both
 * one-shot queries and interactive conversational exploration.
 *
 * @example
 * ```typescript
 * import { createQueryCopilot } from '@pocket/ai';
 *
 * const copilot = createQueryCopilot({
 *   adapter: myLLMAdapter,
 *   collections: {
 *     todos: {
 *       fields: [
 *         { name: 'title', type: 'string' },
 *         { name: 'completed', type: 'boolean' },
 *         { name: 'dueDate', type: 'date' },
 *       ],
 *     },
 *   },
 * });
 *
 * // Ask in natural language, get typed results
 * const result = await copilot.ask('show me incomplete todos due this week');
 * console.log(result.query);       // Generated structured query
 * console.log(result.explanation);  // Human-readable explanation
 * console.log(result.confidence);   // 0-1 confidence score
 *
 * // Interactive suggestions
 * const suggestions = await copilot.suggest('I want to see...');
 * ```
 */

import type { LLMAdapter } from './types.js';
import {
  SmartQueryEngine,
  type CollectionSchema,
  type GeneratedQuery,
  type QuerySuggestion,
  type SchemaField,
} from './smart-query.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schema definition shorthand for a single collection */
export interface CopilotCollectionDef {
  /** Field definitions */
  fields: SchemaField[];
  /** Human-readable description of the collection */
  description?: string;
  /** Sample documents for improved LLM context */
  sampleDocuments?: Record<string, unknown>[];
}

/** Configuration for the QueryCopilot */
export interface QueryCopilotConfig {
  /** LLM adapter for query generation */
  adapter: LLMAdapter;
  /** Collection schemas keyed by collection name */
  collections: Record<string, CopilotCollectionDef>;
  /** Max retries for invalid query generation (default: 2) */
  maxRetries?: number;
  /** LLM temperature (default: 0.1) */
  temperature?: number;
  /** Enable query caching (default: true) */
  cacheEnabled?: boolean;
  /** Max cache entries (default: 200) */
  maxCacheSize?: number;
}

/** Result of a copilot `ask` call */
export interface CopilotResult {
  /** The generated structured query */
  query: GeneratedQuery;
  /** Whether the query passed schema validation */
  isValid: boolean;
  /** Validation errors (empty if valid) */
  validationErrors: string[];
  /** Human-readable explanation */
  explanation: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** The original natural language input */
  naturalLanguage: string;
  /** Time taken to generate the query in ms */
  generationTimeMs: number;
}

/** History entry for conversational copilot usage */
export interface CopilotHistoryEntry {
  /** The natural language question */
  question: string;
  /** The generated result */
  result: CopilotResult;
  /** Timestamp */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// QueryCopilot
// ---------------------------------------------------------------------------

/**
 * High-level natural language query copilot for Pocket databases.
 *
 * Wraps SmartQueryEngine with schema management, validation, history
 * tracking, and suggestion capabilities.
 *
 * @example
 * ```typescript
 * const copilot = new QueryCopilot({ adapter, collections: { todos: { fields: [...] } } });
 * const result = await copilot.ask('find incomplete todos');
 * ```
 */
export class QueryCopilot {
  private readonly engine: SmartQueryEngine;
  private readonly history: CopilotHistoryEntry[] = [];
  private readonly maxHistorySize: number;

  constructor(config: QueryCopilotConfig) {
    const schemas: CollectionSchema[] = Object.entries(config.collections).map(
      ([name, def]) => ({
        name,
        fields: def.fields,
        description: def.description,
        sampleDocuments: def.sampleDocuments,
      })
    );

    this.engine = new SmartQueryEngine({
      adapter: config.adapter,
      schemas,
      maxRetries: config.maxRetries ?? 2,
      temperature: config.temperature ?? 0.1,
      cacheEnabled: config.cacheEnabled ?? true,
      maxCacheSize: config.maxCacheSize ?? 200,
    });

    this.maxHistorySize = 50;
  }

  /**
   * Ask a natural language question and get a structured query result.
   *
   * @param question - Natural language query (e.g. "show me todos due tomorrow")
   * @returns CopilotResult with query, validation, and metadata
   *
   * @example
   * ```typescript
   * const result = await copilot.ask('incomplete tasks assigned to alice');
   * if (result.isValid && result.confidence > 0.7) {
   *   // Execute result.query against the database
   * }
   * ```
   */
  async ask(question: string): Promise<CopilotResult> {
    const startTime = Date.now();

    const query = await this.engine.generateQuery(question);
    const validation = this.engine.validateQuery(query);

    const result: CopilotResult = {
      query,
      isValid: validation.valid,
      validationErrors: validation.errors,
      explanation: query.explanation,
      confidence: query.confidence,
      naturalLanguage: question,
      generationTimeMs: Date.now() - startTime,
    };

    this.addToHistory(question, result);

    return result;
  }

  /**
   * Get query suggestions based on available schemas and optional context.
   *
   * @param context - Optional context hint (e.g. "I want to see...")
   * @returns Array of query suggestions sorted by relevance
   */
  async suggest(context?: string): Promise<QuerySuggestion[]> {
    return this.engine.suggestQueries(context);
  }

  /**
   * Validate a query object against the registered schemas.
   *
   * @param query - The query to validate
   */
  validate(query: GeneratedQuery): { valid: boolean; errors: string[] } {
    return this.engine.validateQuery(query);
  }

  /**
   * Get the conversation history.
   */
  getHistory(): CopilotHistoryEntry[] {
    return [...this.history];
  }

  /**
   * Clear conversation history and query cache.
   */
  clearHistory(): void {
    this.history.length = 0;
    this.engine.clearCache();
  }

  /**
   * Update collection schemas (e.g. when new collections are created).
   *
   * @param collections - Updated collection definitions
   */
  updateCollections(collections: Record<string, CopilotCollectionDef>): void {
    const schemas: CollectionSchema[] = Object.entries(collections).map(
      ([name, def]) => ({
        name,
        fields: def.fields,
        description: def.description,
        sampleDocuments: def.sampleDocuments,
      })
    );
    this.engine.updateSchemas(schemas);
  }

  /**
   * Get cache statistics from the underlying engine.
   */
  getCacheStats(): { size: number; maxSize: number; hitRate: number } {
    return this.engine.getCacheStats();
  }

  private addToHistory(question: string, result: CopilotResult): void {
    this.history.push({ question, result, timestamp: Date.now() });
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }
}

// ---------------------------------------------------------------------------
// React Hook Factory
// ---------------------------------------------------------------------------

/** State returned by the useNaturalQuery hook */
export interface UseNaturalQueryState {
  /** The latest copilot result */
  result: CopilotResult | null;
  /** Query suggestions */
  suggestions: QuerySuggestion[];
  /** Whether a query is being generated */
  isLoading: boolean;
  /** Error if any */
  error: Error | null;
  /** Conversation history */
  history: CopilotHistoryEntry[];
}

/** Return type of the useNaturalQuery hook */
export interface UseNaturalQueryReturn extends UseNaturalQueryState {
  /** Ask a natural language question */
  ask: (question: string) => Promise<CopilotResult | null>;
  /** Get query suggestions */
  loadSuggestions: (context?: string) => Promise<void>;
  /** Clear history and cache */
  clear: () => void;
}

/** Minimal React hooks interface for DI */
export interface ReactHooksForCopilot {
  useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]): T;
  useRef<T>(initial: T): { current: T };
}

/**
 * Factory to create the `useNaturalQuery` React hook.
 *
 * @param React - React hooks (useState, useCallback, useRef)
 * @returns A `useNaturalQuery` hook
 *
 * @example
 * ```typescript
 * import * as React from 'react';
 * import { createUseNaturalQueryHook, createQueryCopilot } from '@pocket/ai';
 *
 * const useNaturalQuery = createUseNaturalQueryHook(React);
 *
 * function SearchBar({ copilot }: { copilot: QueryCopilot }) {
 *   const { ask, result, isLoading, suggestions, loadSuggestions } = useNaturalQuery(copilot);
 *
 *   return (
 *     <div>
 *       <input
 *         onFocus={() => loadSuggestions()}
 *         onKeyDown={(e) => e.key === 'Enter' && ask(e.currentTarget.value)}
 *       />
 *       {isLoading && <span>Generating query...</span>}
 *       {result && <pre>{JSON.stringify(result.query, null, 2)}</pre>}
 *     </div>
 *   );
 * }
 * ```
 */
export function createUseNaturalQueryHook(React: ReactHooksForCopilot) {
  return function useNaturalQuery(copilot: QueryCopilot): UseNaturalQueryReturn {
    const [state, setState] = React.useState<UseNaturalQueryState>({
      result: null,
      suggestions: [],
      isLoading: false,
      error: null,
      history: [],
    });

    const copilotRef = React.useRef(copilot);
    copilotRef.current = copilot;

    const ask = React.useCallback(async (question: string): Promise<CopilotResult | null> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const result = await copilotRef.current.ask(question);
        setState((prev) => ({
          ...prev,
          result,
          isLoading: false,
          history: copilotRef.current.getHistory(),
        }));
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setState((prev) => ({ ...prev, isLoading: false, error }));
        return null;
      }
    }, []) as (question: string) => Promise<CopilotResult | null>;

    const loadSuggestions = React.useCallback(async (context?: string): Promise<void> => {
      try {
        const suggestions = await copilotRef.current.suggest(context);
        setState((prev) => ({ ...prev, suggestions }));
      } catch {
        // Suggestions are best-effort; swallow errors
      }
    }, []) as (context?: string) => Promise<void>;

    const clear = React.useCallback(() => {
      copilotRef.current.clearHistory();
      setState({
        result: null,
        suggestions: [],
        isLoading: false,
        error: null,
        history: [],
      });
    }, []) as () => void;

    return { ...state, ask, loadSuggestions, clear };
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a QueryCopilot instance.
 *
 * @param config - Copilot configuration with LLM adapter and collection schemas
 * @returns A new QueryCopilot instance
 *
 * @example
 * ```typescript
 * const copilot = createQueryCopilot({
 *   adapter: myAdapter,
 *   collections: {
 *     todos: {
 *       fields: [
 *         { name: 'title', type: 'string' },
 *         { name: 'completed', type: 'boolean' },
 *       ],
 *     },
 *   },
 * });
 * ```
 */
export function createQueryCopilot(config: QueryCopilotConfig): QueryCopilot {
  return new QueryCopilot(config);
}

/**
 * Create a QueryCopilot by auto-extracting schemas from a live database.
 *
 * Uses SchemaAnalyzer to sample documents and infer collection schemas,
 * then initializes the copilot with the extracted schemas.
 *
 * @example
 * ```typescript
 * import { createCopilotFromDatabase } from '@pocket/ai';
 *
 * const copilot = await createCopilotFromDatabase({
 *   adapter: myLLMAdapter,
 *   database: db,
 *   sampleSize: 50,
 * });
 *
 * const result = await copilot.ask('show me incomplete todos');
 * ```
 */
export interface CopilotFromDatabaseConfig {
  /** LLM adapter for query generation */
  adapter: LLMAdapter;
  /** Database to extract schemas from */
  database: import('./schema-analyzer.js').AnalyzableDatabase;
  /** Max documents to sample per collection (default: 100) */
  sampleSize?: number;
  /** LLM temperature (default: 0.1) */
  temperature?: number;
}

export async function createCopilotFromDatabase(
  config: CopilotFromDatabaseConfig,
): Promise<QueryCopilot> {
  const { SchemaAnalyzer } = await import('./schema-analyzer.js');
  const analyzer = new SchemaAnalyzer({ sampleSize: config.sampleSize ?? 100 });
  const analysis = await analyzer.analyzeDatabase(config.database);

  const collections: Record<string, CopilotCollectionDef> = {};
  for (const collAnalysis of analysis.collections) {
    collections[collAnalysis.name] = {
      fields: collAnalysis.schema.fields,
      description: collAnalysis.schema.description,
      sampleDocuments: collAnalysis.schema.sampleDocuments,
    };
  }

  return new QueryCopilot({
    adapter: config.adapter,
    collections,
    temperature: config.temperature ?? 0.1,
  });
}
