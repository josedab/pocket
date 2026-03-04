/**
 * Streaming pipeline for large dataset export/import
 * with progress events and backpressure support.
 */
import { Subject, type Observable } from 'rxjs';

export interface PipelineProgress {
  phase: 'preparing' | 'processing' | 'finalizing' | 'complete' | 'error';
  processedItems: number;
  totalItems: number;
  percentage: number;
  bytesProcessed: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  currentCollection?: string;
}

export interface StreamingPipelineConfig {
  chunkSize?: number;
  highWaterMark?: number;
  onProgress?: (progress: PipelineProgress) => void;
}

/**
 * Streaming export/import pipeline with backpressure.
 */
export class StreamingPipeline {
  private readonly config: Required<Omit<StreamingPipelineConfig, 'onProgress'>> & {
    onProgress?: (p: PipelineProgress) => void;
  };
  private readonly progress$ = new Subject<PipelineProgress>();
  private aborted = false;

  constructor(config?: StreamingPipelineConfig) {
    this.config = {
      chunkSize: config?.chunkSize ?? 100,
      highWaterMark: config?.highWaterMark ?? 10000,
      onProgress: config?.onProgress,
    };
  }

  /** Get progress as observable */
  get progress(): Observable<PipelineProgress> {
    return this.progress$.asObservable();
  }

  /** Export documents as an async generator with backpressure */
  async *exportStream(
    documents: Record<string, unknown>[],
    serializer: (chunk: Record<string, unknown>[]) => string,
    collection?: string
  ): AsyncGenerator<string, void, undefined> {
    const startTime = Date.now();
    const total = documents.length;
    let processed = 0;
    let bytesProcessed = 0;

    this.emitProgress('preparing', processed, total, bytesProcessed, startTime, collection);

    for (let i = 0; i < total; i += this.config.chunkSize) {
      if (this.aborted) break;

      const chunk = documents.slice(i, i + this.config.chunkSize);
      const serialized = serializer(chunk);
      bytesProcessed += serialized.length;
      processed += chunk.length;

      this.emitProgress('processing', processed, total, bytesProcessed, startTime, collection);
      yield serialized;
    }

    this.emitProgress('complete', processed, total, bytesProcessed, startTime, collection);
  }

  /** Import from an async iterable of string chunks */
  async importStream(
    chunks: AsyncIterable<string>,
    deserializer: (chunk: string) => Record<string, unknown>[],
    collection?: string
  ): Promise<Record<string, unknown>[]> {
    const startTime = Date.now();
    const allDocs: Record<string, unknown>[] = [];
    let bytesProcessed = 0;

    this.emitProgress('preparing', 0, 0, 0, startTime, collection);

    for await (const chunk of chunks) {
      if (this.aborted) break;

      const docs = deserializer(chunk);
      allDocs.push(...docs);
      bytesProcessed += chunk.length;

      this.emitProgress('processing', allDocs.length, 0, bytesProcessed, startTime, collection);

      // Backpressure: yield control if too many items buffered
      if (allDocs.length > this.config.highWaterMark) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    this.emitProgress(
      'complete',
      allDocs.length,
      allDocs.length,
      bytesProcessed,
      startTime,
      collection
    );
    return allDocs;
  }

  /** Abort the pipeline */
  abort(): void {
    this.aborted = true;
  }

  /** Destroy the pipeline */
  destroy(): void {
    this.aborted = true;
    this.progress$.complete();
  }

  private emitProgress(
    phase: PipelineProgress['phase'],
    processed: number,
    total: number,
    bytes: number,
    startTime: number,
    collection?: string
  ): void {
    const elapsed = Date.now() - startTime;
    const rate = processed > 0 ? elapsed / processed : 0;
    const remaining = total > 0 ? Math.max(0, (total - processed) * rate) : null;

    const progress: PipelineProgress = {
      phase,
      processedItems: processed,
      totalItems: total,
      percentage: total > 0 ? Math.round((processed / total) * 100) : 0,
      bytesProcessed: bytes,
      elapsedMs: elapsed,
      estimatedRemainingMs: remaining,
      currentCollection: collection,
    };

    this.progress$.next(progress);
    this.config.onProgress?.(progress);
  }
}

export function createStreamingPipeline(config?: StreamingPipelineConfig): StreamingPipeline {
  return new StreamingPipeline(config);
}
