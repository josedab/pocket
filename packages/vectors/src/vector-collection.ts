import type { Collection, Document } from '@pocket/core';
import { BehaviorSubject, type Observable, type Subscription } from 'rxjs';
import type {
  EmbeddingFunction,
  Vector,
  VectorDocument,
  VectorSearchOptions,
  VectorSearchResult,
} from './types.js';
import { createVectorStore, type VectorStore } from './vector-store.js';

/**
 * Vector collection configuration
 */
export interface VectorCollectionConfig {
  /** Embedding function for auto-embedding */
  embeddingFunction: EmbeddingFunction;
  /** Fields to embed (will be concatenated) */
  textFields: string[];
  /** Custom text extractor function */
  textExtractor?: (doc: Document) => string;
  /** Auto-index new documents */
  autoIndex?: boolean;
  /** Index type */
  indexType?: 'flat' | 'hnsw';
}

/**
 * Vector indexing state
 */
export interface VectorIndexState {
  /** Total indexed documents */
  indexedCount: number;
  /** Pending documents */
  pendingCount: number;
  /** Last index update time */
  lastUpdateAt: number | null;
  /** Is currently indexing */
  isIndexing: boolean;
}

/**
 * Wraps a Pocket collection with vector search capabilities
 */
export class VectorCollection<T extends Document = Document> {
  private readonly collection: Collection<T>;
  private readonly vectorStore: VectorStore;
  private readonly config: Required<Omit<VectorCollectionConfig, 'textExtractor'>> &
    Pick<VectorCollectionConfig, 'textExtractor'>;

  private readonly state$ = new BehaviorSubject<VectorIndexState>({
    indexedCount: 0,
    pendingCount: 0,
    lastUpdateAt: null,
    isIndexing: false,
  });

  private readonly indexedIds = new Set<string>();
  private changeSubscription: Subscription | null = null;
  private isDisposed = false;

  constructor(collection: Collection<T>, config: VectorCollectionConfig) {
    this.collection = collection;
    this.config = {
      embeddingFunction: config.embeddingFunction,
      textFields: config.textFields,
      textExtractor: config.textExtractor,
      autoIndex: config.autoIndex ?? true,
      indexType: config.indexType ?? 'flat',
    };

    // Create vector store
    this.vectorStore = createVectorStore({
      name: `${collection.name}_vectors`,
      dimensions: config.embeddingFunction.dimensions,
      embeddingFunction: config.embeddingFunction,
      indexType: this.config.indexType,
    });

    // Subscribe to collection changes if auto-index is enabled
    if (this.config.autoIndex) {
      this.startAutoIndexing();
    }
  }

  /**
   * Start auto-indexing
   */
  private startAutoIndexing(): void {
    this.changeSubscription = this.collection.changes().subscribe((event) => {
      if (this.isDisposed) return;

      void (async () => {
        try {
          switch (event.operation) {
            case 'insert':
            case 'update':
              if (event.document) {
                await this.indexDocument(event.document);
              }
              break;
            case 'delete':
              if (event.previousDocument) {
                this.removeDocument(event.previousDocument._id);
              } else {
                this.removeDocument(event.documentId);
              }
              break;
          }
        } catch (error) {
          console.error('Auto-indexing error:', error);
        }
      })();
    });
  }

  /**
   * Extract text from a document
   */
  private extractText(doc: Document): string {
    if (this.config.textExtractor) {
      return this.config.textExtractor(doc);
    }

    // Default: concatenate specified fields
    const parts: string[] = [];
    for (const field of this.config.textFields) {
      const value = (doc as unknown as Record<string, unknown>)[field];
      if (typeof value === 'string') {
        parts.push(value);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        parts.push(String(value));
      } else if (Array.isArray(value)) {
        parts.push(value.filter((v) => typeof v === 'string').join(' '));
      }
      // Skip objects and other complex types
    }

    return parts.join(' ');
  }

  /**
   * Index a single document
   */
  async indexDocument(doc: T): Promise<void> {
    const text = this.extractText(doc);
    if (!text.trim()) {
      return; // Skip empty text
    }

    await this.vectorStore.upsert(doc._id, text, {
      _rev: doc._rev,
      _updatedAt: doc._updatedAt,
    });

    this.indexedIds.add(doc._id);
    this.updateState();
  }

  /**
   * Remove a document from the vector index
   */
  removeDocument(id: string): void {
    this.vectorStore.delete(id);
    this.indexedIds.delete(id);
    this.updateState();
  }

  /**
   * Index all existing documents
   */
  async indexAll(): Promise<{ indexed: number; failed: number }> {
    this.updateState({ isIndexing: true });

    try {
      const documents = await this.collection.getAll();
      let indexed = 0;
      let failed = 0;

      // Batch embed for efficiency
      const itemsToIndex: {
        id: string;
        text: string;
        metadata: Record<string, unknown>;
      }[] = [];

      for (const doc of documents) {
        const text = this.extractText(doc);
        if (text.trim()) {
          itemsToIndex.push({
            id: doc._id,
            text,
            metadata: {
              _rev: doc._rev,
              _updatedAt: doc._updatedAt,
            },
          });
        }
      }

      // Process in batches of 100
      const batchSize = 100;
      for (let i = 0; i < itemsToIndex.length; i += batchSize) {
        const batch = itemsToIndex.slice(i, i + batchSize);
        const result = await this.vectorStore.upsertBatch(batch);

        indexed += result.succeeded.length;
        failed += result.failed.length;

        for (const id of result.succeeded) {
          this.indexedIds.add(id);
        }

        this.updateState();
      }

      return { indexed, failed };
    } finally {
      this.updateState({ isIndexing: false });
    }
  }

  /**
   * Reindex all documents (clear and rebuild)
   */
  async reindexAll(): Promise<{ indexed: number; failed: number }> {
    this.vectorStore.clear();
    this.indexedIds.clear();
    return this.indexAll();
  }

  /**
   * Semantic search
   */
  async search(
    query: string,
    options: Omit<VectorSearchOptions, 'text' | 'vector'> = {}
  ): Promise<(VectorSearchResult & { document?: T })[]> {
    const results = await this.vectorStore.search({
      ...options,
      text: query,
    });

    // Fetch associated documents
    const enrichedResults: (VectorSearchResult & { document?: T })[] = [];

    for (const result of results) {
      const doc = await this.collection.get(result.id);
      enrichedResults.push({
        ...result,
        document: doc ?? undefined,
      });
    }

    return enrichedResults;
  }

  /**
   * Find documents similar to a given document
   */
  async findSimilar(
    docOrId: T | string,
    options: Omit<VectorSearchOptions, 'text' | 'vector'> = {}
  ): Promise<(VectorSearchResult & { document?: T })[]> {
    let id: string;

    if (typeof docOrId === 'string') {
      id = docOrId;
    } else {
      id = docOrId._id;

      // Ensure document is indexed
      if (!this.indexedIds.has(id)) {
        await this.indexDocument(docOrId);
      }
    }

    const results = await this.vectorStore.findSimilar(id, options);

    // Fetch associated documents
    const enrichedResults: (VectorSearchResult & { document?: T })[] = [];

    for (const result of results) {
      const doc = await this.collection.get(result.id);
      enrichedResults.push({
        ...result,
        document: doc ?? undefined,
      });
    }

    return enrichedResults;
  }

  /**
   * Search by vector directly
   */
  async searchByVector(
    vector: Vector,
    options: Omit<VectorSearchOptions, 'text' | 'vector'> = {}
  ): Promise<(VectorSearchResult & { document?: T })[]> {
    const results = await this.vectorStore.search({
      ...options,
      vector,
    });

    // Fetch associated documents
    const enrichedResults: (VectorSearchResult & { document?: T })[] = [];

    for (const result of results) {
      const doc = await this.collection.get(result.id);
      enrichedResults.push({
        ...result,
        document: doc ?? undefined,
      });
    }

    return enrichedResults;
  }

  /**
   * Get the embedding for a text
   */
  async embed(text: string): Promise<Vector> {
    return this.config.embeddingFunction.embed(text);
  }

  /**
   * Get the underlying vector store
   */
  getVectorStore(): VectorStore {
    return this.vectorStore;
  }

  /**
   * Get the underlying collection
   */
  getCollection(): Collection<T> {
    return this.collection;
  }

  /**
   * Get index state observable
   */
  state(): Observable<VectorIndexState> {
    return this.state$.asObservable();
  }

  /**
   * Get current state
   */
  getState(): VectorIndexState {
    return this.state$.getValue();
  }

  /**
   * Check if a document is indexed
   */
  isIndexed(id: string): boolean {
    return this.indexedIds.has(id);
  }

  /**
   * Get indexed document count
   */
  get indexedCount(): number {
    return this.indexedIds.size;
  }

  /**
   * Update state
   */
  private updateState(partial: Partial<VectorIndexState> = {}): void {
    this.state$.next({
      ...this.state$.getValue(),
      indexedCount: this.indexedIds.size,
      lastUpdateAt: Date.now(),
      ...partial,
    });
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.isDisposed = true;

    if (this.changeSubscription) {
      this.changeSubscription.unsubscribe();
      this.changeSubscription = null;
    }

    this.vectorStore.dispose();
    this.state$.complete();
  }
}

/**
 * Create a vector-enabled collection wrapper
 */
export function createVectorCollection<T extends Document>(
  collection: Collection<T>,
  config: VectorCollectionConfig
): VectorCollection<T> {
  return new VectorCollection(collection, config);
}

/**
 * Helper to create a document with pre-computed embedding
 */
export function withVector<T extends Document>(
  doc: Omit<T, '_vector'>,
  vector: Vector
): VectorDocument & T {
  return {
    ...doc,
    _vector: vector,
  } as VectorDocument & T;
}
