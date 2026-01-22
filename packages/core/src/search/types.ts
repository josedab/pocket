import type { Document } from '../types/document.js';

/**
 * Search index configuration
 */
export interface SearchIndexConfig {
  /** Fields to index for full-text search */
  fields: string[];
  /** Field weights for relevance scoring */
  weights?: Record<string, number>;
  /** Language for stemming/tokenization */
  language?: string;
  /** Minimum word length to index */
  minWordLength?: number;
  /** Maximum word length to index */
  maxWordLength?: number;
  /** Custom stop words to exclude */
  stopWords?: string[];
  /** Whether to enable fuzzy matching */
  fuzzy?: boolean;
  /** Fuzzy match distance (1-3) */
  fuzzyDistance?: number;
}

/**
 * Search options
 */
export interface SearchOptions {
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Minimum score threshold (0-1) */
  minScore?: number;
  /** Fields to search (subset of indexed fields) */
  fields?: string[];
  /** Whether to highlight matches */
  highlight?: boolean;
  /** Highlight prefix */
  highlightPrefix?: string;
  /** Highlight suffix */
  highlightSuffix?: string;
  /** Enable fuzzy matching for this query */
  fuzzy?: boolean;
  /** Boost certain fields for this query */
  boosts?: Record<string, number>;
}

/**
 * Search result
 */
export interface SearchResult<T extends Document = Document> {
  /** The matched document */
  document: T;
  /** Relevance score (0-1) */
  score: number;
  /** Matched terms */
  matches: SearchMatch[];
  /** Highlighted snippets by field */
  highlights?: Record<string, string>;
}

/**
 * Individual match info
 */
export interface SearchMatch {
  /** Field where match occurred */
  field: string;
  /** Matched term */
  term: string;
  /** Position in original text */
  position: number;
  /** Match score contribution */
  score: number;
}

/**
 * Search results wrapper
 */
export interface SearchResults<T extends Document = Document> {
  /** Matched documents with scores */
  results: SearchResult<T>[];
  /** Total matches (before pagination) */
  total: number;
  /** Query execution time in ms */
  executionTimeMs: number;
  /** Terms that were searched */
  searchedTerms: string[];
}

/**
 * Token from tokenizer
 */
export interface Token {
  /** Original term */
  original: string;
  /** Normalized/stemmed term */
  normalized: string;
  /** Position in text */
  position: number;
  /** Field the token came from */
  field: string;
}

/**
 * Inverted index entry
 */
export interface IndexEntry {
  /** Document ID */
  documentId: string;
  /** Field name */
  field: string;
  /** Position in field */
  position: number;
  /** Term frequency in this document */
  termFrequency: number;
}

/**
 * Document frequency info
 */
export interface DocumentFrequency {
  /** Number of documents containing term */
  documentCount: number;
  /** Total occurrences across all documents */
  totalOccurrences: number;
}

/**
 * Search index statistics
 */
export interface SearchIndexStats {
  /** Total indexed documents */
  documentCount: number;
  /** Total unique terms */
  termCount: number;
  /** Average document length (in terms) */
  avgDocumentLength: number;
  /** Total tokens indexed */
  totalTokens: number;
  /** Index size estimate in bytes */
  sizeEstimate: number;
}
