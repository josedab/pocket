import type { Document } from '@pocket/core';

/**
 * Vector embedding type
 */
export type Vector = number[];

/**
 * Distance metric for similarity calculations
 */
export type DistanceMetric = 'cosine' | 'euclidean' | 'dotProduct';

/**
 * Embedding model provider
 */
export type EmbeddingProvider = 'openai' | 'cohere' | 'huggingface' | 'ollama' | 'custom';

/**
 * Embedding function interface
 */
export interface EmbeddingFunction {
  /** Embed a single text */
  embed(text: string): Promise<Vector>;
  /** Embed multiple texts in batch */
  embedBatch?(texts: string[]): Promise<Vector[]>;
  /** Get embedding dimensions */
  dimensions: number;
  /** Model name/identifier */
  modelName: string;
}

/**
 * Vector store configuration
 */
export interface VectorStoreConfig {
  /** Storage name/identifier */
  name: string;
  /** Embedding dimensions */
  dimensions: number;
  /** Distance metric */
  metric?: DistanceMetric;
  /** Embedding function for auto-embedding */
  embeddingFunction?: EmbeddingFunction;
  /** Index type */
  indexType?: 'flat' | 'hnsw' | 'ivf';
  /** HNSW parameters */
  hnswParams?: HNSWParams;
  /** Cache embeddings in memory */
  cacheEmbeddings?: boolean;
  /** Max cache size (number of vectors) */
  maxCacheSize?: number;
}

/**
 * HNSW index parameters
 */
export interface HNSWParams {
  /** Number of neighbors to explore during construction */
  efConstruction?: number;
  /** Number of neighbors to explore during search */
  efSearch?: number;
  /** Number of links per node */
  m?: number;
  /** Max number of links per node in layer 0 */
  m0?: number;
}

/**
 * Vector entry in the store
 */
export interface VectorEntry {
  /** Unique identifier */
  id: string;
  /** Vector embedding */
  vector: Vector;
  /** Associated metadata */
  metadata?: Record<string, unknown>;
  /** Original text (if embedding was auto-generated) */
  text?: string;
  /** Timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt?: number;
}

/**
 * Vector document - document with embedded vector
 */
export interface VectorDocument extends Document {
  /** Vector embedding field */
  _vector?: Vector;
  /** Source text for embedding */
  _vectorSource?: string;
}

/**
 * Search options for vector queries
 */
export interface VectorSearchOptions {
  /** Maximum number of results */
  limit?: number;
  /** Minimum similarity score (0-1 for cosine) */
  minScore?: number;
  /** Metadata filter */
  filter?: Record<string, unknown>;
  /** Include vectors in results */
  includeVectors?: boolean;
  /** Include metadata in results */
  includeMetadata?: boolean;
  /** Search by text (auto-embed) */
  text?: string;
  /** Search by vector */
  vector?: Vector;
}

/**
 * Search result
 */
export interface VectorSearchResult {
  /** Entry ID */
  id: string;
  /** Similarity score */
  score: number;
  /** Vector (if requested) */
  vector?: Vector;
  /** Metadata */
  metadata?: Record<string, unknown>;
  /** Original text */
  text?: string;
  /** Distance (metric-specific) */
  distance: number;
}

/**
 * Batch upsert result
 */
export interface UpsertResult {
  /** Successfully inserted/updated IDs */
  succeeded: string[];
  /** Failed IDs with errors */
  failed: { id: string; error: string }[];
}

/**
 * Vector store statistics
 */
export interface VectorStoreStats {
  /** Total number of vectors */
  vectorCount: number;
  /** Dimensions */
  dimensions: number;
  /** Index type */
  indexType: string;
  /** Memory usage (approximate bytes) */
  memoryUsage: number;
  /** Cache hit rate (if caching enabled) */
  cacheHitRate?: number;
}

/**
 * Vector index interface
 */
export interface VectorIndex {
  /** Index name */
  name: string;
  /** Add vectors to the index */
  add(id: string, vector: Vector): void;
  /** Remove vector from index */
  remove(id: string): void;
  /** Search for nearest neighbors */
  search(query: Vector, k: number): { id: string; distance: number }[];
  /** Rebuild index */
  rebuild(): void;
  /** Get index stats */
  stats(): { count: number; memoryBytes: number };
}

/**
 * Embedding cache entry
 */
export interface CacheEntry {
  vector: Vector;
  text: string;
  timestamp: number;
}

/**
 * Vector operation type
 */
export type VectorOperation = 'add' | 'update' | 'delete';

/**
 * Vector change event
 */
export interface VectorChangeEvent {
  operation: VectorOperation;
  id: string;
  vector?: Vector;
  metadata?: Record<string, unknown>;
  timestamp: number;
}
