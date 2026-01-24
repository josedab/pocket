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
 * Configuration for creating a VectorCollection.
 *
 * @example Basic configuration
 * ```typescript
 * const config: VectorCollectionConfig = {
 *   embeddingFunction: createOpenAIEmbedding({ apiKey }),
 *   textFields: ['title', 'content'],
 *   autoIndex: true,
 * };
 * ```
 *
 * @example With custom text extractor
 * ```typescript
 * const config: VectorCollectionConfig = {
 *   embeddingFunction: createOllamaEmbedding(),
 *   textFields: [],  // Not used when textExtractor is provided
 *   textExtractor: (doc) => `${doc.title}: ${doc.description}`,
 * };
 * ```
 */
export interface VectorCollectionConfig {
  /** Embedding function for converting text to vectors */
  embeddingFunction: EmbeddingFunction;

  /**
   * Document fields to extract and concatenate for embedding.
   * Order matters - fields are joined with spaces.
   */
  textFields: string[];

  /**
   * Custom function to extract text from documents.
   * Overrides textFields if provided.
   */
  textExtractor?: (doc: Document) => string;

  /**
   * Automatically index documents when they're inserted/updated.
   * @default true
   */
  autoIndex?: boolean;

  /**
   * Index type for nearest neighbor search.
   * - 'flat': Exact search (better for <10K documents)
   * - 'hnsw': Approximate search (better for >10K documents)
   * @default 'flat'
   */
  indexType?: 'flat' | 'hnsw';
}

/**
 * Current state of the vector index.
 *
 * @example
 * ```typescript
 * vectorCollection.state().subscribe((state) => {
 *   if (state.isIndexing) {
 *     console.log('Indexing in progress...');
 *   } else {
 *     console.log(`${state.indexedCount} documents indexed`);
 *   }
 * });
 * ```
 */
export interface VectorIndexState {
  /** Number of documents currently indexed */
  indexedCount: number;

  /** Number of documents waiting to be indexed */
  pendingCount: number;

  /** Unix timestamp of last index update, or null if never updated */
  lastUpdateAt: number | null;

  /** Whether a bulk indexing operation is in progress */
  isIndexing: boolean;
}

/**
 * Adds vector search capabilities to a Pocket Collection.
 *
 * VectorCollection wraps a standard Collection and maintains a parallel
 * vector index for semantic search. Documents are automatically embedded
 * when inserted/updated (if autoIndex is enabled).
 *
 * @typeParam T - The document type
 *
 * @example Basic setup
 * ```typescript
 * const notes = db.collection<Note>('notes');
 *
 * const vectorNotes = createVectorCollection(notes, {
 *   embeddingFunction: createOpenAIEmbedding({ apiKey }),
 *   textFields: ['title', 'content'],
 * });
 *
 * // Index existing documents
 * await vectorNotes.indexAll();
 *
 * // Search by meaning
 * const results = await vectorNotes.search('machine learning concepts');
 * for (const result of results) {
 *   console.log(`${result.document?.title}: ${result.score}`);
 * }
 * ```
 *
 * @example Finding similar documents
 * ```typescript
 * // Find notes similar to a specific one
 * const similar = await vectorNotes.findSimilar('note-123', {
 *   limit: 5,
 *   minScore: 0.7,
 * });
 * ```
 *
 * @example With local embeddings (Ollama)
 * ```typescript
 * const vectorNotes = createVectorCollection(notes, {
 *   embeddingFunction: createOllamaEmbedding({ model: 'nomic-embed-text' }),
 *   textFields: ['content'],
 *   indexType: 'hnsw',  // Use HNSW for large collections
 * });
 * ```
 *
 * @see {@link createVectorCollection} for factory function
 * @see {@link VectorCollectionConfig} for configuration options
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
   * Index a single document for vector search.
   *
   * Extracts text from the document, generates an embedding,
   * and adds it to the vector index.
   *
   * @param doc - The document to index
   *
   * @example
   * ```typescript
   * const note = await notes.insert({ title: 'AI', content: '...' });
   * await vectorNotes.indexDocument(note);
   * ```
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
   * Remove a document from the vector index.
   *
   * Call this when a document is deleted to keep the index in sync.
   * If autoIndex is enabled, this happens automatically.
   *
   * @param id - The document ID to remove
   */
  removeDocument(id: string): void {
    this.vectorStore.delete(id);
    this.indexedIds.delete(id);
    this.updateState();
  }

  /**
   * Index all existing documents in the collection.
   *
   * This is typically called once when setting up vector search
   * on an existing collection. New documents are indexed automatically
   * if autoIndex is enabled.
   *
   * @returns Object with counts of indexed and failed documents
   *
   * @example
   * ```typescript
   * console.log('Indexing all documents...');
   * const result = await vectorNotes.indexAll();
   * console.log(`Indexed: ${result.indexed}, Failed: ${result.failed}`);
   * ```
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
   * Reindex all documents by clearing and rebuilding the index.
   *
   * Use this after changing the embedding function or textFields.
   *
   * @returns Object with counts of indexed and failed documents
   *
   * @example
   * ```typescript
   * // After updating embedding config
   * const result = await vectorNotes.reindexAll();
   * console.log(`Reindexed ${result.indexed} documents`);
   * ```
   */
  async reindexAll(): Promise<{ indexed: number; failed: number }> {
    this.vectorStore.clear();
    this.indexedIds.clear();
    return this.indexAll();
  }

  /**
   * Perform semantic search to find documents by meaning.
   *
   * Embeds the query text and finds the most similar documents
   * in the vector index, then retrieves the full documents.
   *
   * @param query - Natural language search query
   * @param options - Search options (limit, minScore, filter, etc.)
   * @returns Array of search results with associated documents
   *
   * @example Basic search
   * ```typescript
   * const results = await vectorNotes.search('machine learning');
   *
   * for (const result of results) {
   *   console.log(`${result.document?.title} (${result.score.toFixed(3)})`);
   * }
   * ```
   *
   * @example With options
   * ```typescript
   * const results = await vectorNotes.search('project deadlines', {
   *   limit: 5,
   *   minScore: 0.7,
   * });
   * ```
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
   * Find documents similar to a given document.
   *
   * Useful for "related items" or "more like this" features.
   *
   * @param docOrId - Document or document ID to find similar items for
   * @param options - Search options (limit, minScore, filter, etc.)
   * @returns Array of similar documents (excluding the source document)
   *
   * @example Find similar by ID
   * ```typescript
   * const similar = await vectorNotes.findSimilar('note-123', {
   *   limit: 5,
   * });
   *
   * console.log('Related notes:');
   * for (const result of similar) {
   *   console.log(`- ${result.document?.title}`);
   * }
   * ```
   *
   * @example Find similar to a new document
   * ```typescript
   * const newNote = { _id: 'temp', title: 'AI Research', content: '...' };
   * const similar = await vectorNotes.findSimilar(newNote);
   * ```
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
   * Search using a pre-computed vector embedding.
   *
   * Use this when you have already generated an embedding
   * and want to avoid re-embedding the same text.
   *
   * @param vector - Pre-computed query vector
   * @param options - Search options
   * @returns Array of search results with documents
   *
   * @example
   * ```typescript
   * // Reuse a previously computed embedding
   * const queryVector = await vectorNotes.embed('machine learning');
   * const results = await vectorNotes.searchByVector(queryVector);
   * ```
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
   * Generate an embedding vector for text.
   *
   * Useful for caching embeddings or debugging.
   *
   * @param text - Text to embed
   * @returns The embedding vector
   *
   * @example
   * ```typescript
   * const vector = await vectorNotes.embed('Hello world');
   * console.log(`Dimensions: ${vector.length}`);
   * ```
   */
  async embed(text: string): Promise<Vector> {
    return this.config.embeddingFunction.embed(text);
  }

  /**
   * Get the underlying VectorStore for advanced operations.
   *
   * @returns The VectorStore instance
   */
  getVectorStore(): VectorStore {
    return this.vectorStore;
  }

  /**
   * Get the underlying Pocket Collection.
   *
   * @returns The wrapped Collection instance
   */
  getCollection(): Collection<T> {
    return this.collection;
  }

  /**
   * Subscribe to index state changes.
   *
   * @returns Observable of index state updates
   *
   * @example
   * ```typescript
   * vectorNotes.state().subscribe((state) => {
   *   updateUI({
   *     indexed: state.indexedCount,
   *     isIndexing: state.isIndexing,
   *   });
   * });
   * ```
   */
  state(): Observable<VectorIndexState> {
    return this.state$.asObservable();
  }

  /**
   * Get current index state snapshot.
   *
   * @returns Current VectorIndexState
   */
  getState(): VectorIndexState {
    return this.state$.getValue();
  }

  /**
   * Check if a document has been indexed.
   *
   * @param id - Document ID to check
   * @returns `true` if the document is in the index
   */
  isIndexed(id: string): boolean {
    return this.indexedIds.has(id);
  }

  /**
   * Get the number of indexed documents.
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
   * Release resources and stop auto-indexing.
   *
   * Call this when you're done with the VectorCollection
   * to prevent memory leaks.
   *
   * @example
   * ```typescript
   * // When unmounting or closing
   * vectorNotes.dispose();
   * ```
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
 * Create a VectorCollection wrapper for semantic search.
 *
 * @typeParam T - The document type
 * @param collection - Pocket Collection to wrap
 * @param config - Vector collection configuration
 * @returns A new VectorCollection instance
 *
 * @example
 * ```typescript
 * const vectorNotes = createVectorCollection(
 *   db.collection<Note>('notes'),
 *   {
 *     embeddingFunction: createOpenAIEmbedding({ apiKey }),
 *     textFields: ['title', 'content'],
 *   }
 * );
 *
 * await vectorNotes.indexAll();
 * ```
 *
 * @see {@link VectorCollection}
 * @see {@link VectorCollectionConfig}
 */
export function createVectorCollection<T extends Document>(
  collection: Collection<T>,
  config: VectorCollectionConfig
): VectorCollection<T> {
  return new VectorCollection(collection, config);
}

/**
 * Helper to create a document with a pre-computed embedding.
 *
 * @typeParam T - The document type
 * @param doc - Document without vector field
 * @param vector - Pre-computed embedding vector
 * @returns Document with _vector field attached
 *
 * @example
 * ```typescript
 * const vector = await embeddingFn.embed('Note content...');
 * const note = withVector({
 *   _id: 'note-1',
 *   title: 'My Note',
 *   content: 'Note content...',
 * }, vector);
 *
 * await collection.insert(note);
 * ```
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
