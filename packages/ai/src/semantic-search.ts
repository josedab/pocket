/**
 * Semantic Search Engine — enables natural language search over
 * Pocket collections using vector embeddings.
 *
 * Wraps embedding generation and vector similarity into a simple API
 * that can be used directly or as a building block for RAG pipelines.
 */

import type { EmbeddingProvider } from './types.js';

export interface SemanticSearchConfig {
  /** Embedding provider for vectorizing queries and documents */
  embeddings: EmbeddingProvider;
  /** Number of results to return (default: 10) */
  topK?: number;
  /** Minimum similarity threshold 0-1 (default: 0.3) */
  minScore?: number;
  /** Fields to extract text from documents (default: all string fields) */
  textFields?: string[];
}

export interface SemanticSearchResult {
  /** Original document */
  document: Record<string, unknown>;
  /** Cosine similarity score (0-1) */
  score: number;
  /** The matched text snippet */
  matchedText: string;
}

interface IndexedDocument {
  id: string;
  text: string;
  embedding: number[];
  document: Record<string, unknown>;
}

/**
 * In-process semantic search engine.
 *
 * Indexes documents by embedding their text fields and provides
 * similarity search using cosine distance.
 */
export class SemanticSearchEngine {
  private readonly config: Required<SemanticSearchConfig>;
  private readonly index = new Map<string, IndexedDocument>();

  constructor(config: SemanticSearchConfig) {
    this.config = {
      embeddings: config.embeddings,
      topK: config.topK ?? 10,
      minScore: config.minScore ?? 0.3,
      textFields: config.textFields ?? [],
    };
  }

  /**
   * Index a batch of documents for semantic search.
   */
  async indexDocuments(documents: Record<string, unknown>[]): Promise<number> {
    const texts = documents.map((doc) => this.extractText(doc));
    const embeddings = await this.config.embeddings.embed(texts);

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]!;
      const id = (doc._id as string) ?? String(i);
      this.index.set(id, {
        id,
        text: texts[i]!,
        embedding: embeddings[i]!,
        document: doc,
      });
    }

    return documents.length;
  }

  /**
   * Remove a document from the index.
   */
  removeDocument(id: string): boolean {
    return this.index.delete(id);
  }

  /**
   * Perform semantic search with a natural language query.
   */
  async search(query: string, topK?: number): Promise<SemanticSearchResult[]> {
    const k = topK ?? this.config.topK;
    const [queryEmbedding] = await this.config.embeddings.embed([query]);
    if (!queryEmbedding) return [];

    const scored: SemanticSearchResult[] = [];

    for (const indexed of this.index.values()) {
      const score = cosineSimilarity(queryEmbedding, indexed.embedding);
      if (score >= this.config.minScore) {
        scored.push({
          document: indexed.document,
          score,
          matchedText: indexed.text.slice(0, 200),
        });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /**
   * Get the number of indexed documents.
   */
  get size(): number {
    return this.index.size;
  }

  /**
   * Clear the entire index.
   */
  clear(): void {
    this.index.clear();
  }

  private extractText(doc: Record<string, unknown>): string {
    const fields = this.config.textFields.length > 0
      ? this.config.textFields
      : Object.keys(doc).filter((k) => typeof doc[k] === 'string' && !k.startsWith('_'));

    return fields
      .map((f) => doc[f])
      .filter((v): v is string => typeof v === 'string')
      .join(' ');
  }
}

/**
 * Smart Autocomplete — suggests field values and query completions
 * based on existing data patterns.
 */
export interface AutocompleteConfig {
  /** Maximum suggestions to return (default: 5) */
  maxSuggestions?: number;
}

export interface AutocompleteSuggestion {
  /** Suggested value */
  value: string;
  /** Confidence/frequency score (0-1) */
  confidence: number;
  /** Source field name */
  field: string;
}

/**
 * Analyzes collection data to provide field value autocomplete.
 */
export class SmartAutocomplete {
  private readonly maxSuggestions: number;
  private readonly fieldValues = new Map<string, Map<string, number>>();

  constructor(config: AutocompleteConfig = {}) {
    this.maxSuggestions = config.maxSuggestions ?? 5;
  }

  /**
   * Learn from a set of documents to build autocomplete data.
   */
  learnFromDocuments(documents: Record<string, unknown>[], fields?: string[]): void {
    for (const doc of documents) {
      const targetFields = fields ?? Object.keys(doc).filter((k) => !k.startsWith('_'));
      for (const field of targetFields) {
        const value = doc[field];
        if (typeof value !== 'string' || value.length === 0) continue;

        if (!this.fieldValues.has(field)) {
          this.fieldValues.set(field, new Map());
        }
        const counts = this.fieldValues.get(field)!;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
  }

  /**
   * Get autocomplete suggestions for a field with a partial input.
   */
  suggest(field: string, partial: string): AutocompleteSuggestion[] {
    const counts = this.fieldValues.get(field);
    if (!counts) return [];

    const lower = partial.toLowerCase();
    const matches: AutocompleteSuggestion[] = [];
    let maxCount = 0;

    for (const [, count] of counts) {
      if (count > maxCount) maxCount = count;
    }

    for (const [value, count] of counts) {
      if (value.toLowerCase().startsWith(lower) || value.toLowerCase().includes(lower)) {
        matches.push({
          value,
          confidence: maxCount > 0 ? count / maxCount : 0,
          field,
        });
      }
    }

    return matches
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.maxSuggestions);
  }

  /**
   * Get the most common values for a field.
   */
  topValues(field: string, limit?: number): AutocompleteSuggestion[] {
    const counts = this.fieldValues.get(field);
    if (!counts) return [];

    const n = limit ?? this.maxSuggestions;
    let maxCount = 0;
    for (const count of counts.values()) {
      if (count > maxCount) maxCount = count;
    }

    return Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        confidence: maxCount > 0 ? count / maxCount : 0,
        field,
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, n);
  }

  /**
   * Clear learned data for a field or all fields.
   */
  clear(field?: string): void {
    if (field) {
      this.fieldValues.delete(field);
    } else {
      this.fieldValues.clear();
    }
  }

  /**
   * Get the number of tracked fields.
   */
  get trackedFields(): number {
    return this.fieldValues.size;
  }
}

// ── Utilities ────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Create a SemanticSearchEngine.
 */
export function createSemanticSearch(config: SemanticSearchConfig): SemanticSearchEngine {
  return new SemanticSearchEngine(config);
}

/**
 * Create a SmartAutocomplete instance.
 */
export function createSmartAutocomplete(config?: AutocompleteConfig): SmartAutocomplete {
  return new SmartAutocomplete(config);
}
