import type { Document } from '@pocket/core';

/**
 * Vector embedding type - an array of floating point numbers.
 *
 * @example
 * ```typescript
 * const vector: Vector = [0.1, 0.5, 0.3, ...]; // 384 or 1536 dimensions typical
 * ```
 */
export type Vector = number[];

/**
 * Distance metric for similarity calculations.
 *
 * - `'cosine'`: Cosine similarity (most common, default)
 * - `'euclidean'`: Euclidean (L2) distance
 * - `'dotProduct'`: Dot product similarity
 *
 * @example
 * ```typescript
 * const store = createVectorStore({
 *   name: 'embeddings',
 *   dimensions: 1536,
 *   metric: 'cosine',  // Best for normalized vectors
 * });
 * ```
 */
export type DistanceMetric = 'cosine' | 'euclidean' | 'dotProduct';

/**
 * Supported embedding model providers.
 *
 * - `'openai'`: OpenAI embeddings API
 * - `'cohere'`: Cohere embeddings API
 * - `'huggingface'`: HuggingFace Inference API
 * - `'ollama'`: Local Ollama embeddings
 * - `'custom'`: Custom embedding function
 */
export type EmbeddingProvider = 'openai' | 'cohere' | 'huggingface' | 'ollama' | 'custom';

/**
 * Interface for embedding functions that convert text to vectors.
 *
 * Use factory functions like {@link createOpenAIEmbedding} or
 * {@link createOllamaEmbedding} to create implementations.
 *
 * @example Using OpenAI
 * ```typescript
 * const embedding = createOpenAIEmbedding({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'text-embedding-3-small',
 * });
 *
 * const vector = await embedding.embed('Hello world');
 * console.log(`Dimensions: ${vector.length}`);  // 1536
 * ```
 *
 * @example Custom embedding function
 * ```typescript
 * const embedding: EmbeddingFunction = {
 *   embed: async (text) => myEmbedAPI.embed(text),
 *   embedBatch: async (texts) => myEmbedAPI.embedBatch(texts),
 *   dimensions: 768,
 *   modelName: 'my-model',
 * };
 * ```
 */
export interface EmbeddingFunction {
  /**
   * Embed a single text string.
   *
   * @param text - Text to embed
   * @returns Promise resolving to the embedding vector
   */
  embed(text: string): Promise<Vector>;

  /**
   * Embed multiple texts in a single batch call.
   * More efficient than calling embed() multiple times.
   *
   * @param texts - Array of texts to embed
   * @returns Promise resolving to array of embedding vectors
   */
  embedBatch?(texts: string[]): Promise<Vector[]>;

  /** The dimensionality of the embedding vectors */
  dimensions: number;

  /** The model name/identifier */
  modelName: string;
}

/**
 * Configuration for creating a VectorStore.
 *
 * @example Basic configuration
 * ```typescript
 * const config: VectorStoreConfig = {
 *   name: 'document-embeddings',
 *   dimensions: 1536,
 *   embeddingFunction: createOpenAIEmbedding({ apiKey }),
 * };
 * ```
 *
 * @example Advanced configuration with HNSW index
 * ```typescript
 * const config: VectorStoreConfig = {
 *   name: 'large-collection',
 *   dimensions: 768,
 *   metric: 'cosine',
 *   indexType: 'hnsw',
 *   hnswParams: { efConstruction: 200, efSearch: 100, m: 16 },
 *   cacheEmbeddings: true,
 *   maxCacheSize: 5000,
 * };
 * ```
 *
 * @see {@link VectorStore}
 * @see {@link createVectorStore}
 */
export interface VectorStoreConfig {
  /** Unique name/identifier for the store */
  name: string;

  /** Number of dimensions in the embedding vectors */
  dimensions: number;

  /**
   * Distance metric for similarity calculations.
   * @default 'cosine'
   */
  metric?: DistanceMetric;

  /** Embedding function for automatic text-to-vector conversion */
  embeddingFunction?: EmbeddingFunction;

  /**
   * Index type for nearest neighbor search.
   * - 'flat': Exact search (slower for large datasets)
   * - 'hnsw': Approximate search (faster for large datasets)
   * @default 'flat'
   */
  indexType?: 'flat' | 'hnsw' | 'ivf';

  /** HNSW index parameters (only used when indexType='hnsw') */
  hnswParams?: HNSWParams;

  /**
   * Cache text embeddings in memory to avoid re-computing.
   * @default true
   */
  cacheEmbeddings?: boolean;

  /**
   * Maximum number of vectors to cache.
   * @default 10000
   */
  maxCacheSize?: number;
}

/**
 * Parameters for HNSW (Hierarchical Navigable Small World) index.
 *
 * HNSW provides fast approximate nearest neighbor search for large datasets.
 * Higher values improve accuracy but increase memory usage and build time.
 *
 * @example Tuned for accuracy
 * ```typescript
 * const params: HNSWParams = {
 *   efConstruction: 200,  // Better graph quality
 *   efSearch: 100,        // More thorough search
 *   m: 32,                // More connections
 * };
 * ```
 *
 * @example Tuned for speed
 * ```typescript
 * const params: HNSWParams = {
 *   efConstruction: 100,
 *   efSearch: 50,
 *   m: 16,
 * };
 * ```
 */
export interface HNSWParams {
  /**
   * Number of neighbors to explore during index construction.
   * Higher values build a better graph but take longer.
   * @default 128
   */
  efConstruction?: number;

  /**
   * Number of neighbors to explore during search.
   * Higher values improve recall but slow down queries.
   * @default 64
   */
  efSearch?: number;

  /**
   * Number of bi-directional links per node.
   * Higher values improve recall but use more memory.
   * @default 16
   */
  m?: number;

  /**
   * Max links per node in the bottom layer.
   * @default 2 * m
   */
  m0?: number;
}

/**
 * An entry stored in the vector store.
 *
 * Contains the vector embedding along with metadata and
 * optional source text.
 */
export interface VectorEntry {
  /** Unique identifier */
  id: string;

  /** The vector embedding */
  vector: Vector;

  /** Optional metadata associated with this entry */
  metadata?: Record<string, unknown>;

  /** Original text (if embedding was auto-generated) */
  text?: string;

  /** Unix timestamp when entry was created */
  createdAt: number;

  /** Unix timestamp when entry was last updated */
  updatedAt?: number;
}

/**
 * A document with an embedded vector field.
 *
 * Extends the base Document type with vector storage.
 *
 * @example
 * ```typescript
 * interface Note extends VectorDocument {
 *   title: string;
 *   content: string;
 * }
 *
 * const note: Note = {
 *   _id: 'note-1',
 *   title: 'Meeting Notes',
 *   content: 'Discussion about...',
 *   _vector: [...],  // Pre-computed embedding
 * };
 * ```
 */
export interface VectorDocument extends Document {
  /** Pre-computed vector embedding */
  _vector?: Vector;

  /** Source text used to generate the embedding */
  _vectorSource?: string;
}

/**
 * Options for vector similarity search.
 *
 * @example Text search
 * ```typescript
 * const results = await store.search({
 *   text: 'machine learning concepts',
 *   limit: 10,
 *   minScore: 0.7,
 * });
 * ```
 *
 * @example Vector search with filter
 * ```typescript
 * const results = await store.search({
 *   vector: queryVector,
 *   limit: 5,
 *   filter: { category: 'technical' },
 *   includeMetadata: true,
 * });
 * ```
 */
export interface VectorSearchOptions {
  /**
   * Maximum number of results to return.
   * @default 10
   */
  limit?: number;

  /**
   * Minimum similarity score threshold (0-1 for cosine).
   * Results below this score are filtered out.
   * @default 0
   */
  minScore?: number;

  /** Metadata filter - only return entries matching all key-value pairs */
  filter?: Record<string, unknown>;

  /**
   * Include vector embeddings in results.
   * @default false
   */
  includeVectors?: boolean;

  /**
   * Include metadata in results.
   * @default true
   */
  includeMetadata?: boolean;

  /** Search query text (auto-embedded using the configured function) */
  text?: string;

  /** Search query vector (use instead of text for pre-computed embeddings) */
  vector?: Vector;
}

/**
 * Result from a vector similarity search.
 *
 * @example
 * ```typescript
 * const results = await store.search({ text: 'query' });
 *
 * for (const result of results) {
 *   console.log(`ID: ${result.id}`);
 *   console.log(`Score: ${result.score.toFixed(3)}`);
 *   console.log(`Text: ${result.text}`);
 * }
 * ```
 */
export interface VectorSearchResult {
  /** The entry's unique identifier */
  id: string;

  /** Similarity score (0-1, higher is more similar) */
  score: number;

  /** The vector embedding (if includeVectors was true) */
  vector?: Vector;

  /** Entry metadata (if includeMetadata was true) */
  metadata?: Record<string, unknown>;

  /** Original text content */
  text?: string;

  /** Raw distance value (metric-specific, lower is more similar) */
  distance: number;
}

/**
 * Result from a batch upsert operation.
 *
 * @example
 * ```typescript
 * const result = await store.upsertBatch(items);
 *
 * console.log(`Succeeded: ${result.succeeded.length}`);
 * for (const failure of result.failed) {
 *   console.error(`Failed ${failure.id}: ${failure.error}`);
 * }
 * ```
 */
export interface UpsertResult {
  /** IDs of entries that were successfully inserted/updated */
  succeeded: string[];

  /** Entries that failed with their error messages */
  failed: { id: string; error: string }[];
}

/**
 * Statistics about a VectorStore.
 *
 * @example
 * ```typescript
 * const stats = store.getStats();
 * console.log(`Vectors: ${stats.vectorCount}`);
 * console.log(`Memory: ${(stats.memoryUsage / 1024 / 1024).toFixed(2)} MB`);
 * ```
 */
export interface VectorStoreStats {
  /** Total number of vectors stored */
  vectorCount: number;

  /** Vector dimensionality */
  dimensions: number;

  /** The index type being used (flat, hnsw, etc.) */
  indexType: string;

  /** Approximate memory usage in bytes */
  memoryUsage: number;

  /** Embedding cache hit rate (0-1), if caching is enabled */
  cacheHitRate?: number;
}

/**
 * Interface for vector index implementations.
 *
 * Implementations handle the actual nearest neighbor search algorithm
 * (flat/brute-force, HNSW, etc.).
 *
 * @internal
 */
export interface VectorIndex {
  /** Index name */
  name: string;

  /** Add a vector to the index */
  add(id: string, vector: Vector): void;

  /** Remove a vector from the index */
  remove(id: string): void;

  /** Search for k nearest neighbors */
  search(query: Vector, k: number): { id: string; distance: number }[];

  /** Rebuild the index (useful after many updates) */
  rebuild(): void;

  /** Get index statistics */
  stats(): { count: number; memoryBytes: number };
}

/**
 * Entry in the embedding cache.
 *
 * @internal
 */
export interface CacheEntry {
  /** Cached vector embedding */
  vector: Vector;

  /** Original text that was embedded */
  text: string;

  /** When the entry was cached */
  timestamp: number;
}

/**
 * Types of operations on vectors.
 */
export type VectorOperation = 'add' | 'update' | 'delete';

/**
 * Event emitted when vectors change in the store.
 *
 * Subscribe to these events via {@link VectorStore.changes}.
 *
 * @example
 * ```typescript
 * store.changes().subscribe((event) => {
 *   console.log(`${event.operation}: ${event.id}`);
 * });
 * ```
 */
export interface VectorChangeEvent {
  /** The type of operation */
  operation: VectorOperation;

  /** The affected entry's ID */
  id: string;

  /** The vector (for add/update operations) */
  vector?: Vector;

  /** Associated metadata */
  metadata?: Record<string, unknown>;

  /** When the event occurred */
  timestamp: number;
}
