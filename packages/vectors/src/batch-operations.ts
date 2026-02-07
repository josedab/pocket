/**
 * Optimized batch vector operations with progress tracking.
 *
 * Provides memory-efficient batch insert, search, delete, and update
 * operations with configurable chunk sizes, retry logic, and RxJS
 * observable progress reporting.
 *
 * @module batch-operations
 *
 * @example Batch insert with progress
 * ```typescript
 * const processor = createBatchProcessor(store);
 *
 * processor.progress().subscribe((p) => {
 *   console.log(`${p.operation}: ${p.completed}/${p.total} (${p.percent}%)`);
 * });
 *
 * const result = await processor.insertBatch(items, { chunkSize: 100 });
 * console.log(`Succeeded: ${result.succeeded}, Failed: ${result.failed}`);
 * ```
 *
 * @example Batch search
 * ```typescript
 * const results = await processor.searchBatch(queries, {
 *   limit: 10,
 *   concurrency: 4,
 * });
 * ```
 */

import { Subject, type Observable } from 'rxjs';
import type { Vector, VectorSearchOptions, VectorSearchResult } from './types.js';
import type { VectorStore } from './vector-store.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Configuration for batch operations.
 */
export interface BatchConfig {
  /**
   * Number of items to process per chunk.
   * @default 100
   */
  chunkSize?: number;

  /**
   * Number of parallel operations for search.
   * @default 4
   */
  concurrency?: number;

  /**
   * Number of retry attempts for failed operations.
   * @default 2
   */
  retries?: number;

  /**
   * Delay in milliseconds between retries.
   * @default 100
   */
  retryDelay?: number;
}

/**
 * Item to insert in a batch operation.
 */
export interface BatchInsertItem {
  /** Unique identifier */
  id: string;

  /** Vector embedding (provide this or text) */
  vector?: Vector;

  /** Text to embed (provide this or vector) */
  text?: string;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Progress event emitted during batch operations.
 */
export interface BatchProgress {
  /** The operation being performed */
  operation: 'insert' | 'search' | 'delete' | 'update';

  /** Total number of items to process */
  total: number;

  /** Number of items completed so far */
  completed: number;

  /** Number of items that failed */
  failed: number;

  /** Completion percentage (0-100) */
  percent: number;
}

/**
 * Result of a batch insert or update operation.
 */
export interface BatchOperationResult {
  /** Number of items that succeeded */
  succeeded: number;

  /** Number of items that failed */
  failed: number;

  /** Error details for failed items */
  errors: { id: string; error: string }[];

  /** Total elapsed time in milliseconds */
  elapsedMs: number;
}

/**
 * Result of a batch search operation.
 */
export interface BatchSearchResult {
  /** Results for each query, in order */
  results: VectorSearchResult[][];

  /** Total elapsed time in milliseconds */
  elapsedMs: number;
}

// ─── Batch Processor ─────────────────────────────────────────────────────────

/**
 * Batch processor for efficient bulk vector operations.
 *
 * Processes items in configurable chunks with progress tracking via RxJS
 * observables and retry logic for failed operations.
 *
 * @example
 * ```typescript
 * const processor = createBatchProcessor(store);
 *
 * processor.progress().subscribe((p) => {
 *   console.log(`Progress: ${p.percent}%`);
 * });
 *
 * await processor.insertBatch(items, { chunkSize: 50 });
 * processor.destroy();
 * ```
 */
export class BatchProcessor {
  private readonly store: VectorStore;
  private readonly progress$ = new Subject<BatchProgress>();

  constructor(store: VectorStore) {
    this.store = store;
  }

  /**
   * Subscribe to batch operation progress events.
   *
   * @returns Observable of progress events
   */
  progress(): Observable<BatchProgress> {
    return this.progress$.asObservable();
  }

  /**
   * Insert multiple items in batches.
   *
   * @param items - Items to insert
   * @param config - Batch configuration
   * @returns Aggregate result of the operation
   *
   * @example
   * ```typescript
   * const result = await processor.insertBatch([
   *   { id: 'doc-1', text: 'Hello world' },
   *   { id: 'doc-2', vector: [0.1, 0.2, ...] },
   * ], { chunkSize: 50 });
   * ```
   */
  async insertBatch(
    items: BatchInsertItem[],
    config: BatchConfig = {}
  ): Promise<BatchOperationResult> {
    const chunkSize = config.chunkSize ?? 100;
    const retries = config.retries ?? 2;
    const retryDelay = config.retryDelay ?? 100;
    const startTime = Date.now();

    const errors: { id: string; error: string }[] = [];
    let succeeded = 0;
    let failed = 0;

    const chunks = this.createChunks(items, chunkSize);

    for (const chunk of chunks) {
      const result = await this.executeWithRetry(
        () =>
          this.store.upsertBatch(
            chunk.map((item) => ({
              id: item.id,
              vector: item.vector,
              text: item.text,
              metadata: item.metadata,
            }))
          ),
        retries,
        retryDelay
      );

      succeeded += result.succeeded.length;
      failed += result.failed.length;
      errors.push(...result.failed);

      this.emitProgress('insert', items.length, succeeded + failed, failed);
    }

    return {
      succeeded,
      failed,
      errors,
      elapsedMs: Date.now() - startTime,
    };
  }

  /**
   * Search with multiple queries in parallel.
   *
   * @param queries - Array of search options (each with text or vector)
   * @param config - Batch configuration
   * @returns Results for each query
   *
   * @example
   * ```typescript
   * const { results } = await processor.searchBatch([
   *   { text: 'query 1', limit: 5 },
   *   { text: 'query 2', limit: 5 },
   * ], { concurrency: 4 });
   * ```
   */
  async searchBatch(
    queries: VectorSearchOptions[],
    config: BatchConfig = {}
  ): Promise<BatchSearchResult> {
    const concurrency = config.concurrency ?? 4;
    const startTime = Date.now();
    const results: VectorSearchResult[][] = new Array(queries.length);
    let completed = 0;

    // Process queries with limited concurrency
    const chunks = this.createChunks(
      queries.map((q, i) => ({ query: q, index: i })),
      concurrency
    );

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(async ({ query, index }) => {
          try {
            const result = await this.store.search(query);
            return { index, result };
          } catch {
            return { index, result: [] as VectorSearchResult[] };
          }
        })
      );

      for (const { index, result } of chunkResults) {
        results[index] = result;
        completed++;
      }

      this.emitProgress('search', queries.length, completed, 0);
    }

    return {
      results,
      elapsedMs: Date.now() - startTime,
    };
  }

  /**
   * Delete multiple entries by ID in batches.
   *
   * @param ids - IDs to delete
   * @param config - Batch configuration
   * @returns Result of the operation
   *
   * @example
   * ```typescript
   * const result = await processor.deleteBatch(['id-1', 'id-2', 'id-3']);
   * ```
   */
  async deleteBatch(ids: string[], config: BatchConfig = {}): Promise<BatchOperationResult> {
    const chunkSize = config.chunkSize ?? 100;
    const startTime = Date.now();

    let succeeded = 0;
    let failed = 0;
    const errors: { id: string; error: string }[] = [];

    const chunks = this.createChunks(ids, chunkSize);

    for (const chunk of chunks) {
      for (const id of chunk) {
        try {
          const deleted = this.store.delete(id);
          if (deleted) {
            succeeded++;
          } else {
            failed++;
            errors.push({ id, error: 'Entry not found' });
          }
        } catch (err) {
          failed++;
          errors.push({ id, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      this.emitProgress('delete', ids.length, succeeded + failed, failed);
    }

    return {
      succeeded,
      failed,
      errors,
      elapsedMs: Date.now() - startTime,
    };
  }

  /**
   * Update metadata for multiple entries in batches.
   *
   * @param updates - Array of ID and metadata pairs
   * @param config - Batch configuration
   * @returns Result of the operation
   *
   * @example
   * ```typescript
   * const result = await processor.updateBatch([
   *   { id: 'doc-1', metadata: { reviewed: true } },
   *   { id: 'doc-2', metadata: { category: 'tech' } },
   * ]);
   * ```
   */
  async updateBatch(
    updates: { id: string; metadata: Record<string, unknown> }[],
    config: BatchConfig = {}
  ): Promise<BatchOperationResult> {
    const chunkSize = config.chunkSize ?? 100;
    const retries = config.retries ?? 2;
    const retryDelay = config.retryDelay ?? 100;
    const startTime = Date.now();

    let succeeded = 0;
    let failed = 0;
    const errors: { id: string; error: string }[] = [];

    const chunks = this.createChunks(updates, chunkSize);

    for (const chunk of chunks) {
      for (const update of chunk) {
        const success = await this.executeWithRetry(async () => {
          const entry = this.store.get(update.id);
          if (!entry) {
            throw new Error(`Entry not found: ${update.id}`);
          }
          await this.store.upsert(update.id, entry.vector, {
            ...entry.metadata,
            ...update.metadata,
          });
          return true;
        }, retries, retryDelay);

        if (success) {
          succeeded++;
        } else {
          failed++;
          errors.push({ id: update.id, error: 'Update failed after retries' });
        }
      }

      this.emitProgress('update', updates.length, succeeded + failed, failed);
    }

    return {
      succeeded,
      failed,
      errors,
      elapsedMs: Date.now() - startTime,
    };
  }

  /**
   * Release resources and complete observables.
   */
  destroy(): void {
    this.progress$.complete();
  }

  /**
   * Split an array into chunks.
   */
  private createChunks<T>(items: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Execute an operation with retry logic.
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    retries: number,
    delayMs: number
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < retries) {
          await this.delay(delayMs * (attempt + 1));
        }
      }
    }

    throw lastError;
  }

  /**
   * Emit a progress event.
   */
  private emitProgress(
    operation: BatchProgress['operation'],
    total: number,
    completed: number,
    failed: number
  ): void {
    this.progress$.next({
      operation,
      total,
      completed,
      failed,
      percent: total > 0 ? Math.round((completed / total) * 100) : 100,
    });
  }

  /**
   * Async delay helper.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Create a batch processor for a vector store.
 *
 * @param store - The vector store to operate on
 * @returns A new BatchProcessor instance
 *
 * @example
 * ```typescript
 * const processor = createBatchProcessor(store);
 * const result = await processor.insertBatch(items);
 * processor.destroy();
 * ```
 */
export function createBatchProcessor(store: VectorStore): BatchProcessor {
  return new BatchProcessor(store);
}
