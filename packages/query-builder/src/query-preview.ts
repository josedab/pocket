/**
 * Query Preview Engine for Pocket Query Builder
 *
 * Provides real-time query result previews as users build queries.
 * Supports sample data, execution plans, and performance estimates.
 *
 * @module query-preview
 *
 * @example
 * ```typescript
 * import { createQueryPreviewEngine } from '@pocket/query-builder';
 *
 * const engine = createQueryPreviewEngine(myDataProvider, {
 *   maxPreviewRows: 50,
 *   debounceMs: 300,
 * });
 *
 * const result = await engine.preview(plan);
 * console.log(result.data);
 * console.log(result.totalCount);
 *
 * engine.dispose();
 * ```
 *
 * @see {@link QueryPlan}
 * @see {@link ReactQueryBuilder}
 */

import { BehaviorSubject, type Observable, type Subscription, debounceTime } from 'rxjs';
import type { QueryPlan } from './types.js';

// ── Helpers ──────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────

/**
 * The result of a query preview execution.
 *
 * @example
 * ```typescript
 * const result: PreviewResult = {
 *   data: [{ name: 'Alice', age: 30 }],
 *   totalCount: 1,
 *   executionTimeMs: 12,
 *   queryPlan: plan,
 *   warnings: [],
 *   truncated: false,
 * };
 * ```
 *
 * @see {@link QueryPreviewEngine.preview}
 */
export interface PreviewResult {
  /** The preview rows */
  data: Record<string, unknown>[];
  /** Total matching document count */
  totalCount: number;
  /** Execution time in milliseconds */
  executionTimeMs: number;
  /** The query plan that produced this result */
  queryPlan: QueryPlan;
  /** Warnings generated during execution */
  warnings: string[];
  /** Whether the result was truncated to fit maxPreviewRows */
  truncated: boolean;
}

/**
 * Configuration for the query preview engine.
 *
 * @example
 * ```typescript
 * const config: PreviewConfig = {
 *   maxPreviewRows: 100,
 *   debounceMs: 250,
 *   showExecutionPlan: true,
 *   enablePerformanceEstimates: true,
 * };
 * ```
 *
 * @see {@link createQueryPreviewEngine}
 */
export interface PreviewConfig {
  /** Maximum rows to show in preview */
  maxPreviewRows?: number;
  /** Debounce delay for live updates (ms) */
  debounceMs?: number;
  /** Show execution plan info */
  showExecutionPlan?: boolean;
  /** Enable performance estimates */
  enablePerformanceEstimates?: boolean;
}

/**
 * A performance estimate for a query plan.
 *
 * @example
 * ```typescript
 * const estimate: PerformanceEstimate = {
 *   estimatedRows: 500,
 *   estimatedTimeMs: 45,
 *   indexesUsed: ['idx_users_status'],
 *   fullScanRequired: false,
 *   recommendations: [],
 * };
 * ```
 *
 * @see {@link QueryPreviewEngine.estimatePerformance}
 */
export interface PerformanceEstimate {
  /** Estimated number of rows to scan */
  estimatedRows: number;
  /** Estimated execution time in milliseconds */
  estimatedTimeMs: number;
  /** Indexes that would be used */
  indexesUsed: string[];
  /** Whether a full collection scan is required */
  fullScanRequired: boolean;
  /** Optimization recommendations */
  recommendations: string[];
}

/**
 * Provider interface for executing preview queries.
 *
 * Implement this interface to connect the preview engine
 * to a real or mock data source.
 *
 * @example
 * ```typescript
 * const provider: PreviewDataProvider = {
 *   async execute(plan) {
 *     const results = await db.query(plan);
 *     return { data: results.rows, totalCount: results.total };
 *   },
 *   async getCollectionStats(collection) {
 *     return { documentCount: 10000, avgDocSize: 256, indexes: ['_id'] };
 *   },
 * };
 * ```
 *
 * @see {@link QueryPreviewEngine}
 */
export interface PreviewDataProvider {
  /**
   * Executes a query plan and returns preview data.
   *
   * @param plan - The query plan to execute
   * @returns The result data and total count
   */
  execute(plan: QueryPlan): Promise<{ data: Record<string, unknown>[]; totalCount: number }>;

  /**
   * Returns statistics for a collection.
   *
   * @param collection - The collection name
   * @returns Collection statistics
   */
  getCollectionStats(collection: string): Promise<{
    documentCount: number;
    avgDocSize: number;
    indexes: string[];
  }>;
}

// ── QueryPreviewEngine ───────────────────────────────────

/**
 * Engine that provides real-time query result previews as users
 * build queries in the visual builder.
 *
 * Supports one-shot previews, live preview subscriptions with
 * debouncing, and performance estimates.
 *
 * @example
 * ```typescript
 * const engine = new QueryPreviewEngine(dataProvider, {
 *   maxPreviewRows: 50,
 *   debounceMs: 300,
 * });
 *
 * // One-shot preview
 * const result = await engine.preview(plan);
 *
 * // Live preview from an observable query plan stream
 * engine.startLivePreview(queryBuilder.state$.pipe(
 *   map((state) => state.generatedQuery),
 *   filter((plan): plan is QueryPlan => plan != null),
 * ));
 *
 * engine.result$.subscribe((result) => {
 *   console.log('Preview updated:', result.data.length, 'rows');
 * });
 *
 * engine.stopLivePreview();
 * engine.dispose();
 * ```
 *
 * @see {@link createQueryPreviewEngine}
 * @see {@link PreviewDataProvider}
 * @see {@link PreviewConfig}
 */
export class QueryPreviewEngine {
  private readonly resultSubject: BehaviorSubject<PreviewResult | null>;
  private readonly loadingSubject: BehaviorSubject<boolean>;
  private readonly dataProvider: PreviewDataProvider;
  private readonly config: Required<PreviewConfig>;
  private liveSubscription: Subscription | null = null;

  /**
   * Creates a new QueryPreviewEngine.
   *
   * @param dataProvider - The data provider for executing queries
   * @param config - Optional preview configuration
   */
  constructor(dataProvider: PreviewDataProvider, config?: PreviewConfig) {
    this.dataProvider = dataProvider;
    this.config = {
      maxPreviewRows: config?.maxPreviewRows ?? 50,
      debounceMs: config?.debounceMs ?? 300,
      showExecutionPlan: config?.showExecutionPlan ?? true,
      enablePerformanceEstimates: config?.enablePerformanceEstimates ?? false,
    };

    this.resultSubject = new BehaviorSubject<PreviewResult | null>(null);
    this.loadingSubject = new BehaviorSubject<boolean>(false);
  }

  /** Observable stream of preview results */
  get result$(): Observable<PreviewResult | null> {
    return this.resultSubject.asObservable();
  }

  /** Observable stream of loading state */
  get isLoading$(): Observable<boolean> {
    return this.loadingSubject.asObservable();
  }

  /**
   * Executes a one-shot preview for a query plan.
   *
   * @param plan - The query plan to preview
   * @returns The preview result
   *
   * @example
   * ```typescript
   * const result = await engine.preview(plan);
   * console.log(`Found ${result.totalCount} documents`);
   * console.log(`Showing ${result.data.length} rows`);
   * ```
   */
  async preview(plan: QueryPlan): Promise<PreviewResult> {
    this.loadingSubject.next(true);
    const startTime = Date.now();

    try {
      const previewPlan = this.applyPreviewLimits(plan);
      const response = await this.dataProvider.execute(previewPlan);

      const maxRows = this.config.maxPreviewRows;
      const truncated = response.data.length > maxRows;
      const data = truncated ? response.data.slice(0, maxRows) : response.data;

      const warnings: string[] = [];
      if (truncated) {
        warnings.push(`Results truncated to ${maxRows} rows.`);
      }

      const result: PreviewResult = {
        data,
        totalCount: response.totalCount,
        executionTimeMs: Date.now() - startTime,
        queryPlan: plan,
        warnings,
        truncated,
      };

      this.resultSubject.next(result);
      return result;
    } finally {
      this.loadingSubject.next(false);
    }
  }

  /**
   * Estimates performance characteristics of a query plan.
   *
   * @param plan - The query plan to analyze
   * @returns The performance estimate
   *
   * @example
   * ```typescript
   * const estimate = await engine.estimatePerformance(plan);
   * if (estimate.fullScanRequired) {
   *   console.warn('Full scan required — consider adding an index.');
   * }
   * ```
   */
  async estimatePerformance(plan: QueryPlan): Promise<PerformanceEstimate> {
    const stats = await this.dataProvider.getCollectionStats(plan.collection);
    const recommendations: string[] = [];
    const indexesUsed: string[] = [];
    let fullScanRequired = true;

    // Check if any filter fields have matching indexes
    if (plan.where) {
      for (const condition of plan.where.conditions) {
        if ('field' in condition) {
          const matchingIndex = stats.indexes.find(
            (idx) => idx === condition.field || idx.startsWith(`${condition.field}_`)
          );
          if (matchingIndex) {
            indexesUsed.push(matchingIndex);
            fullScanRequired = false;
          } else {
            recommendations.push(
              `Consider adding an index on "${condition.field}" to improve filter performance.`
            );
          }
        }
      }
    }

    if (fullScanRequired && stats.documentCount > 10000) {
      recommendations.push(
        'Query requires a full collection scan. Add indexes on filtered fields.'
      );
    }

    // Estimate row count
    const filterRatio = plan.where?.conditions.length
      ? Math.max(0.1, 1 / plan.where.conditions.length)
      : 1;
    const estimatedRows = Math.ceil(stats.documentCount * filterRatio);

    // Estimate time based on document count and whether indexes are used
    const scanFactor = fullScanRequired ? 1 : 0.1;
    const estimatedTimeMs = Math.ceil(
      (stats.documentCount * stats.avgDocSize * scanFactor) / 100000
    );

    return {
      estimatedRows,
      estimatedTimeMs,
      indexesUsed,
      fullScanRequired,
      recommendations,
    };
  }

  /**
   * Starts a live preview subscription on a query plan observable.
   *
   * Subscribes to plan changes and automatically re-runs the preview
   * with debouncing to avoid excessive queries during rapid edits.
   *
   * @param plan$ - An observable stream of query plans
   *
   * @example
   * ```typescript
   * engine.startLivePreview(planStream$);
   * engine.result$.subscribe((result) => {
   *   if (result) updateUI(result.data);
   * });
   * ```
   */
  startLivePreview(plan$: Observable<QueryPlan>): void {
    this.stopLivePreview();

    this.liveSubscription = plan$.pipe(debounceTime(this.config.debounceMs)).subscribe((plan) => {
      void this.preview(plan);
    });
  }

  /**
   * Stops the current live preview subscription.
   *
   * @example
   * ```typescript
   * engine.stopLivePreview();
   * ```
   */
  stopLivePreview(): void {
    if (this.liveSubscription) {
      this.liveSubscription.unsubscribe();
      this.liveSubscription = null;
    }
  }

  /**
   * Returns the last preview result, or null if no preview has been run.
   *
   * @returns The most recent preview result
   *
   * @example
   * ```typescript
   * const last = engine.getLastPreview();
   * if (last) {
   *   console.log(`Last preview had ${last.totalCount} results`);
   * }
   * ```
   */
  getLastPreview(): PreviewResult | null {
    return this.resultSubject.getValue();
  }

  /**
   * Cleans up all observables and subscriptions.
   *
   * @example
   * ```typescript
   * engine.dispose();
   * ```
   */
  dispose(): void {
    this.stopLivePreview();
    this.resultSubject.complete();
    this.loadingSubject.complete();
  }

  // ── Internals ────────────────────────────────────────

  /**
   * Applies preview row limits to a query plan.
   * @internal
   */
  private applyPreviewLimits(plan: QueryPlan): QueryPlan {
    const maxRows = this.config.maxPreviewRows;
    const currentLimit = plan.pagination?.limit;

    // Only apply limit if no limit is set or the existing limit exceeds maxPreviewRows
    if (currentLimit === undefined || currentLimit > maxRows) {
      return {
        ...plan,
        pagination: {
          ...plan.pagination,
          limit: maxRows + 1, // Fetch one extra to detect truncation
        },
      };
    }

    return plan;
  }
}

// ── Factory ──────────────────────────────────────────────

/**
 * Creates a new {@link QueryPreviewEngine} instance.
 *
 * @param dataProvider - The data provider for executing queries
 * @param config - Optional preview configuration
 * @returns A new QueryPreviewEngine
 *
 * @example
 * ```typescript
 * import { createQueryPreviewEngine } from '@pocket/query-builder';
 *
 * const engine = createQueryPreviewEngine(myDataProvider, {
 *   maxPreviewRows: 100,
 *   debounceMs: 250,
 * });
 *
 * const result = await engine.preview(plan);
 * console.log(result.data);
 * engine.dispose();
 * ```
 */
export function createQueryPreviewEngine(
  dataProvider: PreviewDataProvider,
  config?: PreviewConfig
): QueryPreviewEngine {
  return new QueryPreviewEngine(dataProvider, config);
}
