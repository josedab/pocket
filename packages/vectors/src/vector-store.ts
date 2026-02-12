import { PocketError } from '@pocket/core';
import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import { distanceToScore } from './distance.js';
import { createFlatIndex, FlatIndex } from './index-flat.js';
import { createHNSWIndex, HNSWIndex } from './index-hnsw.js';
import type {
  DistanceMetric,
  EmbeddingFunction,
  UpsertResult,
  Vector,
  VectorChangeEvent,
  VectorEntry,
  VectorSearchOptions,
  VectorSearchResult,
  VectorStoreConfig,
  VectorStoreStats,
} from './types.js';

/**
 * In-memory vector store with semantic search capabilities.
 *
 * VectorStore provides efficient storage and retrieval of vector embeddings
 * using various index types (flat, HNSW) and distance metrics.
 *
 * For most use cases, prefer using {@link VectorCollection} which provides
 * automatic document-to-vector integration.
 *
 * @example Basic usage
 * ```typescript
 * const store = createVectorStore({
 *   name: 'embeddings',
 *   dimensions: 1536,
 *   embeddingFunction: createOpenAIEmbedding({ apiKey }),
 * });
 *
 * // Add vectors (auto-embed text)
 * await store.upsert('doc-1', 'Hello world');
 * await store.upsert('doc-2', 'Machine learning concepts');
 *
 * // Search
 * const results = await store.search({ text: 'AI and ML' });
 * ```
 *
 * @example With pre-computed vectors
 * ```typescript
 * const store = createVectorStore({
 *   name: 'precomputed',
 *   dimensions: 384,
 *   metric: 'cosine',
 * });
 *
 * await store.upsert('vec-1', [0.1, 0.2, ...], { category: 'tech' });
 * ```
 *
 * @see {@link VectorCollection} for document integration
 * @see {@link createVectorStore} for factory function
 */
export class VectorStore {
  readonly name: string;
  readonly dimensions: number;

  private readonly metric: DistanceMetric;
  private readonly index: FlatIndex | HNSWIndex;
  private readonly entries = new Map<string, VectorEntry>();
  private readonly embeddingFn?: EmbeddingFunction;

  // Caching
  private readonly cacheEnabled: boolean;
  private readonly maxCacheSize: number;
  private readonly textCache = new Map<string, Vector>();
  private cacheHits = 0;
  private cacheMisses = 0;

  // Observables
  private readonly changes$ = new Subject<VectorChangeEvent>();
  private readonly stats$: BehaviorSubject<VectorStoreStats>;

  constructor(config: VectorStoreConfig) {
    this.name = config.name;
    this.dimensions = config.dimensions;
    this.metric = config.metric ?? 'cosine';
    this.embeddingFn = config.embeddingFunction;
    this.cacheEnabled = config.cacheEmbeddings ?? true;
    this.maxCacheSize = config.maxCacheSize ?? 10000;

    // Create index based on type
    const indexType = config.indexType ?? 'flat';
    if (indexType === 'hnsw') {
      this.index = createHNSWIndex(this.name, this.metric, config.hnswParams);
    } else {
      this.index = createFlatIndex(this.name, this.metric);
    }

    this.stats$ = new BehaviorSubject<VectorStoreStats>(this.computeStats());
  }

  /**
   * Add or update a vector entry.
   *
   * Accepts either a vector array or text (which will be auto-embedded
   * if an embedding function is configured).
   *
   * @param id - Unique identifier for the entry
   * @param vectorOrText - Vector array or text to embed
   * @param metadata - Optional metadata to associate with the entry
   * @throws Error if dimensions don't match or embedding fails
   *
   * @example With text (auto-embed)
   * ```typescript
   * await store.upsert('doc-1', 'Machine learning basics');
   * ```
   *
   * @example With vector
   * ```typescript
   * await store.upsert('doc-2', [0.1, 0.2, ...], { source: 'manual' });
   * ```
   */
  async upsert(
    id: string,
    vectorOrText: Vector | string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    let vector: Vector;
    let text: string | undefined;

    if (typeof vectorOrText === 'string') {
      // Auto-embed text
      if (!this.embeddingFn) {
        throw PocketError.fromCode('POCKET_V100', {
          message: 'Embedding function required for text input',
          operation: 'add',
        });
      }
      text = vectorOrText;
      vector = await this.getOrCreateEmbedding(text);
    } else {
      vector = vectorOrText;
    }

    // Validate dimensions
    if (vector.length !== this.dimensions) {
      throw PocketError.fromCode('POCKET_V102', {
        message: `Vector dimensions mismatch: expected ${this.dimensions}, got ${vector.length}`,
        expected: this.dimensions,
        actual: vector.length,
      });
    }

    const now = Date.now();
    const existing = this.entries.get(id);
    const operation = existing ? 'update' : 'add';

    const entry: VectorEntry = {
      id,
      vector,
      metadata,
      text,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.entries.set(id, entry);
    this.index.add(id, vector);

    this.emitChange(operation, id, vector, metadata);
    this.updateStats();
  }

  /**
   * Add or update multiple vector entries in batch.
   *
   * More efficient than calling upsert() multiple times as it
   * batches embedding API calls.
   *
   * @param items - Array of items to upsert
   * @returns Result with succeeded and failed IDs
   *
   * @example
   * ```typescript
   * const result = await store.upsertBatch([
   *   { id: 'doc-1', text: 'First document' },
   *   { id: 'doc-2', text: 'Second document' },
   *   { id: 'doc-3', vector: [...], metadata: { type: 'manual' } },
   * ]);
   *
   * console.log(`Succeeded: ${result.succeeded.length}`);
   * ```
   */
  async upsertBatch(
    items: {
      id: string;
      vector?: Vector;
      text?: string;
      metadata?: Record<string, unknown>;
    }[]
  ): Promise<UpsertResult> {
    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];

    // Batch embed texts if needed
    const textsToEmbed: { index: number; text: string }[] = [];
    const vectors: { index: number; vector: Vector }[] = [];

    items.forEach((item, index) => {
      if (item.vector) {
        vectors.push({ index, vector: item.vector });
      } else if (item.text && this.embeddingFn) {
        textsToEmbed.push({ index, text: item.text });
      }
    });

    // Batch embed texts
    if (textsToEmbed.length > 0 && this.embeddingFn) {
      try {
        const texts = textsToEmbed.map((t) => t.text);
        const embeddings = this.embeddingFn.embedBatch
          ? await this.embeddingFn.embedBatch(texts)
          : await Promise.all(texts.map((t) => this.embeddingFn!.embed(t)));

        textsToEmbed.forEach((t, i) => {
          const embedding = embeddings[i];
          if (embedding) {
            vectors.push({ index: t.index, vector: embedding });

            // Cache the embedding
            if (this.cacheEnabled) {
              this.addToCache(t.text, embedding);
            }
          }
        });
      } catch (error) {
        textsToEmbed.forEach((t) => {
          const item = items[t.index];
          if (item) {
            failed.push({
              id: item.id,
              error: error instanceof Error ? error.message : 'Embedding failed',
            });
          }
        });
      }
    }

    // Create a map of vectors by index
    const vectorMap = new Map(vectors.map((v) => [v.index, v.vector]));

    // Insert all items
    const now = Date.now();

    items.forEach((item, index) => {
      const vector = vectorMap.get(index);
      if (!vector) {
        if (!failed.some((f) => f.id === item.id)) {
          failed.push({ id: item.id, error: 'No vector or text provided' });
        }
        return;
      }

      if (vector.length !== this.dimensions) {
        failed.push({
          id: item.id,
          error: `Dimensions mismatch: expected ${this.dimensions}, got ${vector.length}`,
        });
        return;
      }

      try {
        const existing = this.entries.get(item.id);
        const entry: VectorEntry = {
          id: item.id,
          vector,
          metadata: item.metadata,
          text: item.text,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };

        this.entries.set(item.id, entry);
        this.index.add(item.id, vector);
        succeeded.push(item.id);

        this.emitChange(existing ? 'update' : 'add', item.id, vector, item.metadata);
      } catch (error) {
        failed.push({
          id: item.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    this.updateStats();

    return { succeeded, failed };
  }

  /**
   * Get a vector entry by ID.
   *
   * @param id - Entry ID
   * @returns The entry or undefined if not found
   */
  get(id: string): VectorEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Get multiple entries by ID.
   *
   * @param ids - Array of entry IDs
   * @returns Array of entries (undefined for missing IDs)
   */
  getMany(ids: string[]): (VectorEntry | undefined)[] {
    return ids.map((id) => this.entries.get(id));
  }

  /**
   * Delete a vector entry.
   *
   * @param id - Entry ID to delete
   * @returns `true` if entry existed and was deleted
   */
  delete(id: string): boolean {
    const existed = this.entries.has(id);
    if (existed) {
      this.entries.delete(id);
      this.index.remove(id);
      this.emitChange('delete', id);
      this.updateStats();
    }
    return existed;
  }

  /**
   * Delete multiple vector entries.
   *
   * @param ids - Array of entry IDs to delete
   * @returns Number of entries deleted
   */
  deleteBatch(ids: string[]): number {
    let deleted = 0;
    for (const id of ids) {
      if (this.entries.has(id)) {
        this.entries.delete(id);
        this.index.remove(id);
        this.emitChange('delete', id);
        deleted++;
      }
    }
    if (deleted > 0) {
      this.updateStats();
    }
    return deleted;
  }

  /**
   * Perform semantic similarity search.
   *
   * @param options - Search options (text, vector, limit, filter, etc.)
   * @returns Array of search results sorted by similarity
   * @throws Error if neither text nor vector is provided
   *
   * @example Text search
   * ```typescript
   * const results = await store.search({
   *   text: 'machine learning',
   *   limit: 10,
   *   minScore: 0.7,
   * });
   * ```
   *
   * @example Vector search with filter
   * ```typescript
   * const results = await store.search({
   *   vector: queryVector,
   *   filter: { category: 'tech' },
   *   includeMetadata: true,
   * });
   * ```
   */
  async search(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    let queryVector: Vector;

    if (options.text) {
      if (!this.embeddingFn) {
        throw PocketError.fromCode('POCKET_V100', {
          message: 'Embedding function required for text search',
          operation: 'search',
        });
      }
      queryVector = await this.getOrCreateEmbedding(options.text);
    } else if (options.vector) {
      queryVector = options.vector;
    } else {
      throw PocketError.fromCode('POCKET_V100', {
        message: 'Either text or vector must be provided',
        operation: 'search',
      });
    }

    // Validate dimensions
    if (queryVector.length !== this.dimensions) {
      throw PocketError.fromCode('POCKET_V102', {
        message: `Query vector dimensions mismatch: expected ${this.dimensions}, got ${queryVector.length}`,
        expected: this.dimensions,
        actual: queryVector.length,
      });
    }

    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0;

    // Build filter function if metadata filter provided
    let filterFn: ((id: string) => boolean) | undefined;
    if (options.filter) {
      filterFn = (id: string) => {
        const entry = this.entries.get(id);
        if (!entry?.metadata) return false;

        for (const [key, value] of Object.entries(options.filter!)) {
          if (entry.metadata[key] !== value) return false;
        }
        return true;
      };
    }

    // Perform search
    let results: { id: string; distance: number }[];

    if (filterFn && this.index instanceof FlatIndex) {
      results = this.index.searchWithFilter(queryVector, limit * 2, filterFn);
    } else {
      results = this.index.search(queryVector, limit * 2);
    }

    // Apply post-search filtering and scoring
    const searchResults: VectorSearchResult[] = [];

    for (const { id, distance } of results) {
      if (filterFn && !(this.index instanceof FlatIndex)) {
        if (!filterFn(id)) continue;
      }

      const score = distanceToScore(distance, this.metric);
      if (score < minScore) continue;

      const entry = this.entries.get(id);
      if (!entry) continue;

      const result: VectorSearchResult = {
        id,
        score,
        distance,
        text: entry.text,
      };

      if (options.includeVectors) {
        result.vector = entry.vector;
      }

      if (options.includeMetadata !== false) {
        result.metadata = entry.metadata;
      }

      searchResults.push(result);

      if (searchResults.length >= limit) break;
    }

    return searchResults;
  }

  /**
   * Find vectors similar to an existing entry.
   *
   * @param id - ID of the entry to find similar vectors to
   * @param options - Search options
   * @returns Array of similar entries (excluding the source)
   * @throws Error if the ID doesn't exist
   *
   * @example
   * ```typescript
   * const similar = await store.findSimilar('doc-123', { limit: 5 });
   * ```
   */
  async findSimilar(
    id: string,
    options: Omit<VectorSearchOptions, 'text' | 'vector'> = {}
  ): Promise<VectorSearchResult[]> {
    const entry = this.entries.get(id);
    if (!entry) {
      throw PocketError.fromCode('POCKET_D401', {
        message: `Vector not found: ${id}`,
        id,
      });
    }

    const results = await this.search({
      ...options,
      vector: entry.vector,
      limit: (options.limit ?? 10) + 1, // +1 to exclude self
    });

    // Filter out the query vector itself
    return results.filter((r) => r.id !== id);
  }

  /**
   * Get or create embedding with caching
   */
  private async getOrCreateEmbedding(text: string): Promise<Vector> {
    // Check cache
    if (this.cacheEnabled) {
      const cached = this.textCache.get(text);
      if (cached) {
        this.cacheHits++;
        return cached;
      }
      this.cacheMisses++;
    }

    // Generate embedding
    if (!this.embeddingFn) {
      throw PocketError.fromCode('POCKET_V100', {
        message: 'Embedding function not configured',
        operation: 'getOrCreateEmbedding',
      });
    }

    const vector = await this.embeddingFn.embed(text);

    // Add to cache
    if (this.cacheEnabled) {
      this.addToCache(text, vector);
    }

    return vector;
  }

  /**
   * Add to cache with LRU eviction
   */
  private addToCache(text: string, vector: Vector): void {
    // Simple FIFO eviction if cache is full
    if (this.textCache.size >= this.maxCacheSize) {
      const firstKey = this.textCache.keys().next().value;
      if (firstKey) {
        this.textCache.delete(firstKey);
      }
    }

    this.textCache.set(text, vector);
  }

  /**
   * Clear the embedding cache.
   *
   * Call this if you want to force re-embedding of text.
   */
  clearCache(): void {
    this.textCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Get all vector entries.
   *
   * @returns Array of all entries
   */
  getAll(): VectorEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get entry count
   */
  get count(): number {
    return this.entries.size;
  }

  /**
   * Check if entry exists
   */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * Clear all vectors from the store.
   */
  clear(): void {
    const ids = Array.from(this.entries.keys());
    this.entries.clear();
    this.index.clear();
    this.clearCache();

    for (const id of ids) {
      this.emitChange('delete', id);
    }

    this.updateStats();
  }

  /**
   * Subscribe to vector change events.
   *
   * @returns Observable of change events
   *
   * @example
   * ```typescript
   * store.changes().subscribe((event) => {
   *   console.log(`${event.operation}: ${event.id}`);
   * });
   * ```
   */
  changes(): Observable<VectorChangeEvent> {
    return this.changes$.asObservable();
  }

  /**
   * Subscribe to store statistics updates.
   *
   * @returns Observable of stats updates
   */
  stats(): Observable<VectorStoreStats> {
    return this.stats$.asObservable();
  }

  /**
   * Get current store statistics.
   *
   * @returns Current stats snapshot
   */
  getStats(): VectorStoreStats {
    return this.computeStats();
  }

  /**
   * Rebuild the vector index.
   *
   * Useful after many updates to optimize search performance.
   */
  rebuild(): void {
    this.index.rebuild();
  }

  /**
   * Export all store data for persistence or transfer.
   *
   * @returns Object containing store config and all entries
   *
   * @example
   * ```typescript
   * const data = store.export();
   * localStorage.setItem('vectors', JSON.stringify(data));
   * ```
   */
  export(): {
    name: string;
    dimensions: number;
    metric: DistanceMetric;
    entries: VectorEntry[];
  } {
    return {
      name: this.name,
      dimensions: this.dimensions,
      metric: this.metric,
      entries: Array.from(this.entries.values()),
    };
  }

  /**
   * Import vector entries from exported data.
   *
   * @param entries - Array of entries to import
   * @returns Result with succeeded and failed IDs
   *
   * @example
   * ```typescript
   * const data = JSON.parse(localStorage.getItem('vectors') || '{}');
   * const result = store.import(data.entries || []);
   * ```
   */
  import(entries: VectorEntry[]): UpsertResult {
    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const entry of entries) {
      try {
        if (entry.vector.length !== this.dimensions) {
          throw PocketError.fromCode('POCKET_V102', {
            message: `Dimensions mismatch: expected ${this.dimensions}`,
            expected: this.dimensions,
            actual: entry.vector.length,
          });
        }

        this.entries.set(entry.id, entry);
        this.index.add(entry.id, entry.vector);
        succeeded.push(entry.id);
      } catch (error) {
        failed.push({
          id: entry.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.updateStats();

    return { succeeded, failed };
  }

  /**
   * Emit change event
   */
  private emitChange(
    operation: 'add' | 'update' | 'delete',
    id: string,
    vector?: Vector,
    metadata?: Record<string, unknown>
  ): void {
    this.changes$.next({
      operation,
      id,
      vector,
      metadata,
      timestamp: Date.now(),
    });
  }

  /**
   * Compute statistics
   */
  private computeStats(): VectorStoreStats {
    const indexStats = this.index.stats();
    const cacheHitRate =
      this.cacheHits + this.cacheMisses > 0
        ? this.cacheHits / (this.cacheHits + this.cacheMisses)
        : 0;

    return {
      vectorCount: this.entries.size,
      dimensions: this.dimensions,
      indexType: this.index instanceof HNSWIndex ? 'hnsw' : 'flat',
      memoryUsage: indexStats.memoryBytes,
      cacheHitRate: this.cacheEnabled ? cacheHitRate : undefined,
    };
  }

  /**
   * Update stats observable
   */
  private updateStats(): void {
    this.stats$.next(this.computeStats());
  }

  /**
   * Release resources and complete observables.
   *
   * Call when done with the store to prevent memory leaks.
   */
  dispose(): void {
    this.changes$.complete();
    this.stats$.complete();
    this.entries.clear();
    this.textCache.clear();
  }
}

/**
 * Create a VectorStore instance.
 *
 * @param config - Store configuration
 * @returns A new VectorStore instance
 *
 * @example
 * ```typescript
 * const store = createVectorStore({
 *   name: 'my-vectors',
 *   dimensions: 1536,
 *   embeddingFunction: createOpenAIEmbedding({ apiKey }),
 *   indexType: 'hnsw',
 * });
 * ```
 *
 * @see {@link VectorStoreConfig}
 * @see {@link VectorStore}
 */
export function createVectorStore(config: VectorStoreConfig): VectorStore {
  return new VectorStore(config);
}
