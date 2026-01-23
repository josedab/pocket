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
 * In-memory vector store with semantic search capabilities
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
  private readonly stats$ = new BehaviorSubject<VectorStoreStats>(this.computeStats());

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
  }

  /**
   * Add or update a vector
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
        throw new Error('Embedding function required for text input');
      }
      text = vectorOrText;
      vector = await this.getOrCreateEmbedding(text);
    } else {
      vector = vectorOrText;
    }

    // Validate dimensions
    if (vector.length !== this.dimensions) {
      throw new Error(
        `Vector dimensions mismatch: expected ${this.dimensions}, got ${vector.length}`
      );
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
   * Batch upsert vectors
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
   * Get a vector entry by ID
   */
  get(id: string): VectorEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Get multiple entries
   */
  getMany(ids: string[]): (VectorEntry | undefined)[] {
    return ids.map((id) => this.entries.get(id));
  }

  /**
   * Delete a vector
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
   * Delete multiple vectors
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
   * Semantic search
   */
  async search(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    let queryVector: Vector;

    if (options.text) {
      if (!this.embeddingFn) {
        throw new Error('Embedding function required for text search');
      }
      queryVector = await this.getOrCreateEmbedding(options.text);
    } else if (options.vector) {
      queryVector = options.vector;
    } else {
      throw new Error('Either text or vector must be provided');
    }

    // Validate dimensions
    if (queryVector.length !== this.dimensions) {
      throw new Error(
        `Query vector dimensions mismatch: expected ${this.dimensions}, got ${queryVector.length}`
      );
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
   * Find similar vectors to a given ID
   */
  async findSimilar(
    id: string,
    options: Omit<VectorSearchOptions, 'text' | 'vector'> = {}
  ): Promise<VectorSearchResult[]> {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(`Vector not found: ${id}`);
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
      throw new Error('Embedding function not configured');
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
   * Clear embedding cache
   */
  clearCache(): void {
    this.textCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Get all entries
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
   * Clear all vectors
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
   * Subscribe to changes
   */
  changes(): Observable<VectorChangeEvent> {
    return this.changes$.asObservable();
  }

  /**
   * Get stats observable
   */
  stats(): Observable<VectorStoreStats> {
    return this.stats$.asObservable();
  }

  /**
   * Get current stats
   */
  getStats(): VectorStoreStats {
    return this.computeStats();
  }

  /**
   * Rebuild the index
   */
  rebuild(): void {
    this.index.rebuild();
  }

  /**
   * Export all data
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
   * Import data
   */
  import(entries: VectorEntry[]): UpsertResult {
    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const entry of entries) {
      try {
        if (entry.vector.length !== this.dimensions) {
          throw new Error(`Dimensions mismatch: expected ${this.dimensions}`);
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
   * Dispose resources
   */
  dispose(): void {
    this.changes$.complete();
    this.stats$.complete();
    this.entries.clear();
    this.textCache.clear();
  }
}

/**
 * Create a vector store
 */
export function createVectorStore(config: VectorStoreConfig): VectorStore {
  return new VectorStore(config);
}
