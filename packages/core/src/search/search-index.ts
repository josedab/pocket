import type { Document } from '../types/document.js';
import { DEFAULT_STOP_WORDS, generateFuzzyVariants, stem, tokenize } from './tokenizer.js';
import type {
  DocumentFrequency,
  IndexEntry,
  SearchIndexConfig,
  SearchIndexStats,
  SearchMatch,
  SearchOptions,
  SearchResult,
  SearchResults,
  Token,
} from './types.js';

/**
 * Default search index configuration
 */
const DEFAULT_CONFIG: Required<SearchIndexConfig> = {
  fields: [],
  weights: {},
  language: 'en',
  minWordLength: 2,
  maxWordLength: 50,
  stopWords: [],
  fuzzy: false,
  fuzzyDistance: 1,
};

/**
 * Full-text search index
 */
export class SearchIndex<T extends Document = Document> {
  private readonly config: Required<SearchIndexConfig>;
  private readonly stopWords: Set<string>;

  // Inverted index: term -> document entries
  private readonly index = new Map<string, IndexEntry[]>();

  // Document lengths for BM25
  private readonly documentLengths = new Map<string, number>();

  // Document frequency cache
  private readonly documentFrequencies = new Map<string, DocumentFrequency>();

  // Indexed documents
  private readonly documents = new Map<string, T>();

  // Statistics
  private totalDocuments = 0;
  private totalTokens = 0;
  private avgDocumentLength = 0;

  constructor(config: SearchIndexConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stopWords = new Set([...DEFAULT_STOP_WORDS, ...this.config.stopWords]);
  }

  /**
   * Add a document to the index
   */
  add(document: T): void {
    const docId = document._id;

    // Remove existing if present
    if (this.documents.has(docId)) {
      this.remove(docId);
    }

    this.documents.set(docId, document);

    // Tokenize all fields
    const tokens = this.tokenizeDocument(document);

    if (tokens.length === 0) return;

    // Update document length
    this.documentLengths.set(docId, tokens.length);
    this.totalTokens += tokens.length;
    this.totalDocuments++;
    this.updateAvgDocumentLength();

    // Build term frequency map
    const termFrequencies = new Map<string, Map<string, number>>();

    for (const token of tokens) {
      const key = `${token.normalized}:${token.field}`;
      if (!termFrequencies.has(key)) {
        termFrequencies.set(key, new Map());
      }
      const fieldFreqs = termFrequencies.get(key)!;
      fieldFreqs.set(token.field, (fieldFreqs.get(token.field) ?? 0) + 1);
    }

    // Add to inverted index
    for (const token of tokens) {
      const term = token.normalized;

      if (!this.index.has(term)) {
        this.index.set(term, []);
      }

      const key = `${term}:${token.field}`;
      const termFreq = termFrequencies.get(key)?.get(token.field) ?? 1;

      const entry: IndexEntry = {
        documentId: docId,
        field: token.field,
        position: token.position,
        termFrequency: termFreq,
      };

      this.index.get(term)!.push(entry);

      // Update document frequency
      this.updateDocumentFrequency(term, 1);
    }
  }

  /**
   * Add multiple documents
   */
  addMany(documents: T[]): void {
    for (const doc of documents) {
      this.add(doc);
    }
  }

  /**
   * Remove a document from the index
   */
  remove(documentId: string): boolean {
    if (!this.documents.has(documentId)) {
      return false;
    }

    // Remove from documents
    this.documents.delete(documentId);

    // Update statistics
    const docLength = this.documentLengths.get(documentId) ?? 0;
    this.totalTokens -= docLength;
    this.totalDocuments--;
    this.documentLengths.delete(documentId);
    this.updateAvgDocumentLength();

    // Remove from inverted index
    const termsToRemove: string[] = [];

    for (const [term, entries] of this.index) {
      const originalLength = entries.length;
      const filtered = entries.filter((e) => e.documentId !== documentId);

      if (filtered.length !== originalLength) {
        this.index.set(term, filtered);
        this.updateDocumentFrequency(term, -(originalLength - filtered.length));

        if (filtered.length === 0) {
          termsToRemove.push(term);
        }
      }
    }

    // Clean up empty terms
    for (const term of termsToRemove) {
      this.index.delete(term);
      this.documentFrequencies.delete(term);
    }

    return true;
  }

  /**
   * Update a document in the index
   */
  update(document: T): void {
    this.add(document);
  }

  /**
   * Search the index
   */
  search(query: string, options: SearchOptions = {}): SearchResults<T> {
    const startTime = performance.now();

    const {
      limit = 10,
      offset = 0,
      minScore = 0,
      fields = this.config.fields,
      highlight = false,
      highlightPrefix = '<mark>',
      highlightSuffix = '</mark>',
      fuzzy = this.config.fuzzy,
      boosts = {},
    } = options;

    // Tokenize query
    const queryTokens = tokenize(query, '', {
      stopWords: this.stopWords,
      minWordLength: this.config.minWordLength,
      maxWordLength: this.config.maxWordLength,
      stemming: true,
    });

    if (queryTokens.length === 0) {
      return {
        results: [],
        total: 0,
        executionTimeMs: performance.now() - startTime,
        searchedTerms: [],
      };
    }

    const searchedTerms = queryTokens.map((t) => t.normalized);

    // Expand terms with fuzzy variants if enabled
    let searchTerms = searchedTerms;
    if (fuzzy) {
      const expanded = new Set<string>();
      for (const term of searchedTerms) {
        const variants = generateFuzzyVariants(term, this.config.fuzzyDistance);
        for (const v of variants) {
          if (this.index.has(v)) {
            expanded.add(v);
          }
        }
      }
      searchTerms = [...expanded];
    }

    // Calculate scores for each document
    const scores = new Map<string, { score: number; matches: SearchMatch[] }>();

    for (const term of searchTerms) {
      const entries = this.index.get(term);
      if (!entries) continue;

      const idf = this.calculateIDF(term);

      for (const entry of entries) {
        // Skip if field not in search fields
        if (!fields.includes(entry.field)) continue;

        const docId = entry.documentId;
        const tf = this.calculateTF(entry.termFrequency, this.documentLengths.get(docId) ?? 1);

        // Apply field weight
        const fieldWeight = this.config.weights[entry.field] ?? 1;
        const boost = boosts[entry.field] ?? 1;

        // BM25 score component
        const termScore = tf * idf * fieldWeight * boost;

        if (!scores.has(docId)) {
          scores.set(docId, { score: 0, matches: [] });
        }

        const docScore = scores.get(docId)!;
        docScore.score += termScore;
        docScore.matches.push({
          field: entry.field,
          term,
          position: entry.position,
          score: termScore,
        });
      }
    }

    // Normalize scores and filter
    const maxScore = Math.max(...[...scores.values()].map((s) => s.score), 1);
    const results: SearchResult<T>[] = [];

    for (const [docId, { score, matches }] of scores) {
      const normalizedScore = score / maxScore;

      if (normalizedScore < minScore) continue;

      const document = this.documents.get(docId);
      if (!document) continue;

      const result: SearchResult<T> = {
        document,
        score: normalizedScore,
        matches,
      };

      if (highlight) {
        result.highlights = this.generateHighlights(
          document,
          matches,
          highlightPrefix,
          highlightSuffix
        );
      }

      results.push(result);
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    const total = results.length;
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      results: paginatedResults,
      total,
      executionTimeMs: performance.now() - startTime,
      searchedTerms,
    };
  }

  /**
   * Get suggestions for partial query
   */
  suggest(prefix: string, limit = 10): string[] {
    const normalizedPrefix = stem(prefix.toLowerCase());
    const suggestions: string[] = [];

    for (const term of this.index.keys()) {
      if (term.startsWith(normalizedPrefix)) {
        suggestions.push(term);
        if (suggestions.length >= limit) break;
      }
    }

    return suggestions;
  }

  /**
   * Get index statistics
   */
  getStats(): SearchIndexStats {
    let sizeEstimate = 0;

    // Estimate size of inverted index
    for (const [term, entries] of this.index) {
      sizeEstimate += term.length * 2; // Term string
      sizeEstimate += entries.length * 32; // Entry objects
    }

    // Add document storage estimate
    sizeEstimate += this.documents.size * 200; // Rough estimate per document

    return {
      documentCount: this.totalDocuments,
      termCount: this.index.size,
      avgDocumentLength: this.avgDocumentLength,
      totalTokens: this.totalTokens,
      sizeEstimate,
    };
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.index.clear();
    this.documents.clear();
    this.documentLengths.clear();
    this.documentFrequencies.clear();
    this.totalDocuments = 0;
    this.totalTokens = 0;
    this.avgDocumentLength = 0;
  }

  /**
   * Check if document is indexed
   */
  has(documentId: string): boolean {
    return this.documents.has(documentId);
  }

  /**
   * Get indexed document by ID
   */
  get(documentId: string): T | undefined {
    return this.documents.get(documentId);
  }

  /**
   * Tokenize a document
   */
  private tokenizeDocument(document: T): Token[] {
    const tokens: Token[] = [];

    for (const field of this.config.fields) {
      const value = this.getFieldValue(document, field);
      if (typeof value !== 'string') continue;

      const fieldTokens = tokenize(value, field, {
        stopWords: this.stopWords,
        minWordLength: this.config.minWordLength,
        maxWordLength: this.config.maxWordLength,
        stemming: true,
      });

      tokens.push(...fieldTokens);
    }

    return tokens;
  }

  /**
   * Get nested field value from document
   */
  private getFieldValue(doc: T, field: string): unknown {
    const parts = field.split('.');
    let value: unknown = doc;

    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = (value as Record<string, unknown>)[part];
    }

    return value;
  }

  /**
   * Calculate term frequency (TF) with BM25 normalization
   */
  private calculateTF(termFrequency: number, documentLength: number): number {
    const k1 = 1.2;
    const b = 0.75;
    const avgDl = this.avgDocumentLength || 1;

    return (
      (termFrequency * (k1 + 1)) / (termFrequency + k1 * (1 - b + b * (documentLength / avgDl)))
    );
  }

  /**
   * Calculate inverse document frequency (IDF)
   */
  private calculateIDF(term: string): number {
    const df = this.documentFrequencies.get(term)?.documentCount ?? 0;
    const N = this.totalDocuments || 1;

    return Math.log(1 + (N - df + 0.5) / (df + 0.5));
  }

  /**
   * Update document frequency
   */
  private updateDocumentFrequency(term: string, delta: number): void {
    const current = this.documentFrequencies.get(term) ?? {
      documentCount: 0,
      totalOccurrences: 0,
    };

    this.documentFrequencies.set(term, {
      documentCount: Math.max(0, current.documentCount + delta),
      totalOccurrences: Math.max(0, current.totalOccurrences + Math.abs(delta)),
    });
  }

  /**
   * Update average document length
   */
  private updateAvgDocumentLength(): void {
    this.avgDocumentLength = this.totalDocuments > 0 ? this.totalTokens / this.totalDocuments : 0;
  }

  /**
   * Generate highlighted snippets
   */
  private generateHighlights(
    document: T,
    matches: SearchMatch[],
    prefix: string,
    suffix: string
  ): Record<string, string> {
    const highlights: Record<string, string> = {};
    const matchesByField = new Map<string, Set<string>>();

    // Group matches by field
    for (const match of matches) {
      if (!matchesByField.has(match.field)) {
        matchesByField.set(match.field, new Set());
      }
      matchesByField.get(match.field)!.add(match.term);
    }

    // Generate highlights for each field
    for (const [field, terms] of matchesByField) {
      const value = this.getFieldValue(document, field);
      if (typeof value !== 'string') continue;

      let highlighted = value;
      const words = value.split(/(\s+)/);

      highlighted = words
        .map((word) => {
          const normalized = stem(word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
          if (terms.has(normalized)) {
            return `${prefix}${word}${suffix}`;
          }
          return word;
        })
        .join('');

      highlights[field] = highlighted;
    }

    return highlights;
  }
}

/**
 * Create a search index
 */
export function createSearchIndex<T extends Document>(config: SearchIndexConfig): SearchIndex<T> {
  return new SearchIndex<T>(config);
}
