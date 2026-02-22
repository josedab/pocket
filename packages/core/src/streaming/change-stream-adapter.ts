/**
 * ChangeStreamAdapter — Connects StreamingPipeline to a collection's change feed.
 *
 * @example
 * ```typescript
 * const pipeline = createStreamingPipeline<Order>()
 *   .filter({ status: 'completed' })
 *   .aggregate('sum', 'amount', 'revenue')
 *   .window({ type: 'tumbling', durationMs: 5000 })
 *   .build();
 *
 * const adapter = createChangeStreamAdapter(pipeline);
 * const sub = adapter.connect(collection.changeFeed.changes());
 *
 * adapter.results$.subscribe(result => {
 *   console.log('Window revenue:', result.aggregations.revenue);
 * });
 * ```
 */

import { Subject, takeUntil, type Observable, type Subscription } from 'rxjs';
import type { ChangeEvent, Document } from '../types/document.js';
import type { StreamingPipeline, WindowResult } from './streaming-pipeline.js';

export interface ChangeStreamAdapterConfig {
  /** Only process insert and update events (ignore deletes). @default false */
  ignoreDeletes?: boolean;
  /** Buffer size for backpressure. @default 1000 */
  bufferSize?: number;
}

export class ChangeStreamAdapter<T extends Record<string, unknown>> {
  private readonly pipeline: StreamingPipeline<T>;
  private readonly config: Required<ChangeStreamAdapterConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly resultsSubject = new Subject<WindowResult<T>>();
  private subscription: Subscription | null = null;

  /** Observable of windowed pipeline results. */
  readonly results$: Observable<WindowResult<T>> = this.resultsSubject.asObservable();

  constructor(pipeline: StreamingPipeline<T>, config: ChangeStreamAdapterConfig = {}) {
    this.pipeline = pipeline;
    this.config = {
      ignoreDeletes: config.ignoreDeletes ?? false,
      bufferSize: config.bufferSize ?? 1000,
    };
  }

  /**
   * Connect to a change-feed observable and start processing.
   */
  connect(changeFeed: Observable<ChangeEvent<Document>>): Subscription {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }

    // Transform ChangeEvents into documents for the pipeline
    const documents$ = new Subject<T>();

    const feedSub = changeFeed.pipe(takeUntil(this.destroy$)).subscribe((event) => {
      if (this.config.ignoreDeletes && event.operation === 'delete') return;
      if (event.document) {
        documents$.next(event.document as unknown as T);
      }
    });

    // Pipe through the streaming pipeline
    const pipelineSub = documents$.pipe(this.pipeline.operator()).subscribe((result) => {
      this.resultsSubject.next(result);
    });

    this.subscription = {
      unsubscribe: () => {
        feedSub.unsubscribe();
        pipelineSub.unsubscribe();
        documents$.complete();
      },
      closed: false,
    } as Subscription;

    return this.subscription;
  }

  /**
   * Disconnect from the change feed.
   */
  disconnect(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  /**
   * Destroy the adapter and release resources.
   */
  destroy(): void {
    this.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
    this.resultsSubject.complete();
  }
}

export function createChangeStreamAdapter<T extends Record<string, unknown>>(
  pipeline: StreamingPipeline<T>,
  config?: ChangeStreamAdapterConfig
): ChangeStreamAdapter<T> {
  return new ChangeStreamAdapter(pipeline, config);
}
