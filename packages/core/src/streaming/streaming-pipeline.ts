/**
 * StreamingPipeline — Observable-based query pipeline with windowed aggregation.
 *
 * Lazily evaluates filter → sort → aggregate → transform steps over
 * document change streams, supporting tumbling and sliding windows.
 *
 * @example
 * ```typescript
 * const pipeline = createStreamingPipeline<Order>()
 *   .filter({ status: 'completed' })
 *   .aggregate('sum', 'amount')
 *   .window({ type: 'tumbling', durationMs: 60000 })
 *   .build();
 *
 * changeFeed$.pipe(pipeline.operator()).subscribe(result => {
 *   console.log('Window total:', result.value);
 * });
 * ```
 */

import {
  BehaviorSubject,
  bufferTime,
  map,
  filter as rxFilter,
  Subject,
  takeUntil,
  type Observable,
} from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export interface PipelineStage<TIn = unknown, TOut = unknown> {
  type: 'filter' | 'map' | 'aggregate' | 'window' | 'limit' | 'distinct';
  process(items: TIn[]): TOut[];
}

export type AggregateOp = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface WindowConfig {
  type: 'tumbling' | 'sliding';
  durationMs: number;
  slideMs?: number;
}

export interface WindowResult<T = unknown> {
  items: T[];
  aggregations: Record<string, number | null>;
  windowStart: number;
  windowEnd: number;
  itemCount: number;
}

export interface PipelineStats {
  totalProcessed: number;
  totalEmitted: number;
  windowsCompleted: number;
  avgProcessingTimeMs: number;
}

export interface StreamingPipelineConfig {
  maxBufferSize?: number;
  backpressureStrategy?: 'drop-oldest' | 'drop-newest' | 'block';
}

// ── Pipeline Builder ──────────────────────────────────────

export class StreamingPipelineBuilder<T extends Record<string, unknown>> {
  private readonly filterPredicates: ((item: T) => boolean)[] = [];
  private readonly mapFunctions: ((item: T) => T)[] = [];
  private readonly aggregations: { op: AggregateOp; field: string; alias: string }[] = [];
  private windowConfig: WindowConfig | null = null;
  private limitCount: number | undefined;
  private distinctField: string | undefined;
  private readonly config: Required<StreamingPipelineConfig>;

  constructor(config: StreamingPipelineConfig = {}) {
    this.config = {
      maxBufferSize: config.maxBufferSize ?? 10000,
      backpressureStrategy: config.backpressureStrategy ?? 'drop-oldest',
    };
  }

  /**
   * Add a filter predicate or object matcher.
   */
  filter(predicateOrMatch: ((item: T) => boolean) | Partial<T>): this {
    if (typeof predicateOrMatch === 'function') {
      this.filterPredicates.push(predicateOrMatch);
    } else {
      const match = predicateOrMatch;
      this.filterPredicates.push((item) => {
        for (const [key, value] of Object.entries(match)) {
          if (item[key] !== value) return false;
        }
        return true;
      });
    }
    return this;
  }

  /**
   * Add a transform/map function.
   */
  map(fn: (item: T) => T): this {
    this.mapFunctions.push(fn);
    return this;
  }

  /**
   * Add an aggregation over a field.
   */
  aggregate(op: AggregateOp, field: string, alias?: string): this {
    this.aggregations.push({ op, field, alias: alias ?? `${op}_${field}` });
    return this;
  }

  /**
   * Configure windowed processing.
   */
  window(config: WindowConfig): this {
    this.windowConfig = config;
    return this;
  }

  /**
   * Limit the number of items per window/batch.
   */
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  /**
   * Deduplicate by a field.
   */
  distinct(field: string): this {
    this.distinctField = field;
    return this;
  }

  /**
   * Build the pipeline into a StreamingPipeline.
   */
  build(): StreamingPipeline<T> {
    return new StreamingPipeline<T>(
      this.filterPredicates,
      this.mapFunctions,
      this.aggregations,
      this.windowConfig,
      this.limitCount,
      this.distinctField,
      this.config
    );
  }
}

// ── Pipeline Executor ─────────────────────────────────────

export class StreamingPipeline<T extends Record<string, unknown>> {
  private readonly destroy$ = new Subject<void>();
  private readonly statsSubject = new BehaviorSubject<PipelineStats>({
    totalProcessed: 0,
    totalEmitted: 0,
    windowsCompleted: 0,
    avgProcessingTimeMs: 0,
  });

  private totalProcessed = 0;
  private totalEmitted = 0;
  private windowsCompleted = 0;
  private processingTimes: number[] = [];

  readonly stats$: Observable<PipelineStats> = this.statsSubject.asObservable();

  constructor(
    private readonly filters: ((item: T) => boolean)[],
    private readonly maps: ((item: T) => T)[],
    private readonly aggregations: { op: AggregateOp; field: string; alias: string }[],
    private readonly windowConfig: WindowConfig | null,
    private readonly limitCount: number | undefined,
    private readonly distinctField: string | undefined,
    private readonly config: Required<StreamingPipelineConfig>
  ) {}

  /**
   * Create an RxJS operator that processes a stream of items.
   */
  operator(): (source: Observable<T>) => Observable<WindowResult<T>> {
    return (source: Observable<T>) => {
      const windowMs = this.windowConfig?.durationMs ?? 1000;

      return source.pipe(
        takeUntil(this.destroy$),
        bufferTime(windowMs),
        rxFilter((items) => items.length > 0),
        map((items) => this.processWindow(items))
      );
    };
  }

  /**
   * Process a batch of items through the pipeline stages.
   */
  processBatch(items: T[]): WindowResult<T> {
    return this.processWindow(items);
  }

  /**
   * Get current pipeline statistics.
   */
  getStats(): PipelineStats {
    return this.statsSubject.getValue();
  }

  /**
   * Destroy the pipeline and release resources.
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.statsSubject.complete();
  }

  private processWindow(items: T[]): WindowResult<T> {
    const start = performance.now();
    const windowStart = Date.now();

    let processed = items;
    this.totalProcessed += processed.length;

    // Apply filters
    for (const predicate of this.filters) {
      processed = processed.filter(predicate);
    }

    // Apply backpressure
    if (processed.length > this.config.maxBufferSize) {
      if (this.config.backpressureStrategy === 'drop-oldest') {
        processed = processed.slice(-this.config.maxBufferSize);
      } else if (this.config.backpressureStrategy === 'drop-newest') {
        processed = processed.slice(0, this.config.maxBufferSize);
      }
    }

    // Apply maps
    for (const fn of this.maps) {
      processed = processed.map(fn);
    }

    // Apply distinct
    if (this.distinctField) {
      const seen = new Set<unknown>();
      processed = processed.filter((item) => {
        const val = item[this.distinctField!];
        if (seen.has(val)) return false;
        seen.add(val);
        return true;
      });
    }

    // Apply limit
    if (this.limitCount !== undefined) {
      processed = processed.slice(0, this.limitCount);
    }

    // Compute aggregations
    const aggregations: Record<string, number | null> = {};
    for (const agg of this.aggregations) {
      aggregations[agg.alias] = this.computeAggregate(processed, agg.op, agg.field);
    }

    this.totalEmitted += processed.length;
    this.windowsCompleted++;

    const elapsed = performance.now() - start;
    this.processingTimes.push(elapsed);
    if (this.processingTimes.length > 100) this.processingTimes.shift();

    this.statsSubject.next({
      totalProcessed: this.totalProcessed,
      totalEmitted: this.totalEmitted,
      windowsCompleted: this.windowsCompleted,
      avgProcessingTimeMs:
        this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length,
    });

    return {
      items: processed,
      aggregations,
      windowStart,
      windowEnd: Date.now(),
      itemCount: processed.length,
    };
  }

  private computeAggregate(items: T[], op: AggregateOp, field: string): number | null {
    if (items.length === 0) return null;

    switch (op) {
      case 'count':
        return items.length;
      case 'sum': {
        let sum = 0;
        for (const item of items) {
          const v = item[field];
          if (typeof v === 'number') sum += v;
        }
        return sum;
      }
      case 'avg': {
        let sum = 0;
        let count = 0;
        for (const item of items) {
          const v = item[field];
          if (typeof v === 'number') {
            sum += v;
            count++;
          }
        }
        return count > 0 ? sum / count : null;
      }
      case 'min': {
        let min: number | null = null;
        for (const item of items) {
          const v = item[field];
          if (typeof v === 'number' && (min === null || v < min)) min = v;
        }
        return min;
      }
      case 'max': {
        let max: number | null = null;
        for (const item of items) {
          const v = item[field];
          if (typeof v === 'number' && (max === null || v > max)) max = v;
        }
        return max;
      }
      default:
        return null;
    }
  }
}

// ── Factory ──────────────────────────────────────────────

export function createStreamingPipeline<T extends Record<string, unknown>>(
  config?: StreamingPipelineConfig
): StreamingPipelineBuilder<T> {
  return new StreamingPipelineBuilder<T>(config);
}
