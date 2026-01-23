import {
  BehaviorSubject,
  Observable,
  shareReplay,
  Subject,
  type Subscription,
  takeUntil,
} from 'rxjs';
import type { ChangeEvent, Document } from '../types/document.js';
import type { QuerySpec } from '../types/query.js';
import { applyAction, reduceEvent } from './event-reduce.js';

/**
 * Configuration options for live queries.
 *
 * @see {@link LiveQuery}
 * @see {@link QueryBuilder.live}
 */
export interface LiveQueryOptions {
  /**
   * Debounce rapid changes by waiting this many milliseconds.
   * Useful for high-frequency updates like typing.
   * @default 0 (no debounce)
   */
  debounceMs?: number;

  /**
   * Enable EventReduce optimization to update results incrementally
   * instead of re-executing the full query on every change.
   * @default true
   */
  useEventReduce?: boolean;

  /**
   * Provide initial data to avoid the first query execution.
   * Useful for SSR hydration or cached results.
   */
  initialData?: unknown[];
}

/**
 * Current state of a live query.
 *
 * @typeParam T - The document type
 */
export interface LiveQueryState<T extends Document> {
  /** Current query results */
  data: T[];
  /** Whether a query is currently executing */
  isLoading: boolean;
  /** Last error encountered, or null if successful */
  error: Error | null;
  /** Timestamp of the last successful update */
  lastUpdated: number;
}

/**
 * Reactive query that automatically updates when underlying data changes.
 *
 * LiveQuery provides real-time query results by:
 * 1. Executing the initial query
 * 2. Subscribing to collection changes
 * 3. Using EventReduce to efficiently update results
 *
 * For most use cases, prefer using {@link QueryBuilder.live} which
 * handles lifecycle automatically.
 *
 * @typeParam T - The document type
 *
 * @example Manual lifecycle control
 * ```typescript
 * const liveQuery = collection.createLiveQuery(
 *   { filter: { active: true } },
 *   { debounceMs: 100 }
 * );
 *
 * await liveQuery.start();
 *
 * liveQuery.stateObservable().subscribe(state => {
 *   if (state.isLoading) {
 *     console.log('Loading...');
 *   } else if (state.error) {
 *     console.error('Error:', state.error);
 *   } else {
 *     console.log('Results:', state.data);
 *   }
 * });
 *
 * // Later: cleanup
 * liveQuery.destroy();
 * ```
 *
 * @example Simple data subscription
 * ```typescript
 * const liveQuery = collection.createLiveQuery({ filter: {} });
 *
 * // observable() auto-starts the query
 * liveQuery.observable().subscribe(documents => {
 *   console.log('Documents:', documents.length);
 * });
 * ```
 *
 * @see {@link QueryBuilder.live} for easier usage
 * @see {@link LiveQueryOptions} for configuration
 */
export class LiveQuery<T extends Document> {
  private readonly spec: QuerySpec<T>;
  private readonly executor: () => Promise<T[]>;
  private readonly changes$: Observable<ChangeEvent<T>>;
  private readonly options: LiveQueryOptions;

  private readonly state$ = new BehaviorSubject<LiveQueryState<T>>({
    data: [],
    isLoading: true,
    error: null,
    lastUpdated: 0,
  });

  private readonly destroy$ = new Subject<void>();
  private subscription: Subscription | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges: ChangeEvent<T>[] = [];
  private isExecuting = false;

  constructor(
    spec: QuerySpec<T>,
    executor: () => Promise<T[]>,
    changes$: Observable<ChangeEvent<T>>,
    options: LiveQueryOptions = {}
  ) {
    this.spec = spec;
    this.executor = executor;
    this.changes$ = changes$;
    this.options = {
      useEventReduce: true,
      debounceMs: 0,
      ...options,
    };

    // Set initial data if provided
    if (options.initialData) {
      this.state$.next({
        data: options.initialData as T[],
        isLoading: false,
        error: null,
        lastUpdated: Date.now(),
      });
    }
  }

  /**
   * Start the live query and begin listening for changes.
   *
   * Executes the initial query (unless initialData was provided)
   * and subscribes to collection changes.
   *
   * @example
   * ```typescript
   * const liveQuery = collection.createLiveQuery({ filter: {} });
   * await liveQuery.start();
   * // Now liveQuery.data contains current results
   * ```
   */
  async start(): Promise<void> {
    if (this.subscription) return;

    // Execute initial query
    if (!this.options.initialData) {
      await this.execute();
    }

    // Subscribe to changes
    this.subscription = this.changes$
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => this.handleChange(event));
  }

  /**
   * Stop listening for changes without destroying the query.
   *
   * The query can be restarted with {@link start}.
   */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  /**
   * Permanently destroy the live query and release resources.
   *
   * After calling destroy(), the query cannot be restarted.
   * Always call this when done with a manually-managed LiveQuery.
   */
  destroy(): void {
    this.stop();
    this.destroy$.next();
    this.destroy$.complete();
    this.state$.complete();
  }

  /**
   * Get the current state snapshot.
   *
   * For reactive updates, use {@link stateObservable} instead.
   */
  get state(): LiveQueryState<T> {
    return this.state$.getValue();
  }

  /**
   * Get the current query results.
   *
   * Shorthand for `state.data`.
   */
  get data(): T[] {
    return this.state.data;
  }

  /**
   * Check if a query is currently executing.
   *
   * Shorthand for `state.isLoading`.
   */
  get isLoading(): boolean {
    return this.state.isLoading;
  }

  /**
   * Get the last error, or null if the last query succeeded.
   *
   * Shorthand for `state.error`.
   */
  get error(): Error | null {
    return this.state.error;
  }

  /**
   * Get an observable of full state changes.
   *
   * Emits {@link LiveQueryState} objects containing data, loading,
   * and error information.
   *
   * @returns Observable of state objects
   *
   * @example
   * ```typescript
   * liveQuery.stateObservable().subscribe(state => {
   *   if (state.isLoading) showSpinner();
   *   else if (state.error) showError(state.error);
   *   else renderData(state.data);
   * });
   * ```
   */
  stateObservable(): Observable<LiveQueryState<T>> {
    return this.state$.asObservable().pipe(takeUntil(this.destroy$), shareReplay(1));
  }

  /**
   * Get an observable that emits only the data array.
   *
   * Automatically starts the query on first subscription.
   * Use this for simple cases where loading/error state isn't needed.
   *
   * @returns Observable of document arrays
   *
   * @example
   * ```typescript
   * liveQuery.observable().subscribe(documents => {
   *   console.log('Got', documents.length, 'documents');
   * });
   * ```
   */
  observable(): Observable<T[]> {
    // Auto-start when subscribed
    this.start().catch((error: unknown) => {
      this.state$.next({
        ...this.state,
        isLoading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    });

    return new Observable<T[]>((subscriber) => {
      const sub = this.state$.pipe(takeUntil(this.destroy$)).subscribe((state) => {
        subscriber.next(state.data);
      });

      return () => sub.unsubscribe();
    });
  }

  /**
   * Force re-execution of the query.
   *
   * Useful when you know the data should be refreshed but changes
   * might not have triggered automatically (e.g., after reconnecting).
   *
   * @example
   * ```typescript
   * // After reconnecting to network
   * await liveQuery.refresh();
   * ```
   */
  async refresh(): Promise<void> {
    await this.execute();
  }

  /**
   * Execute the query
   */
  private async execute(): Promise<void> {
    if (this.isExecuting) return;

    this.isExecuting = true;
    this.state$.next({
      ...this.state,
      isLoading: true,
    });

    try {
      const data = await this.executor();
      this.state$.next({
        data,
        isLoading: false,
        error: null,
        lastUpdated: Date.now(),
      });
    } catch (error) {
      this.state$.next({
        ...this.state,
        isLoading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Handle a change event
   */
  private handleChange(event: ChangeEvent<T>): void {
    if (this.options.debounceMs && this.options.debounceMs > 0) {
      this.pendingChanges.push(event);
      this.scheduleUpdate();
    } else {
      this.applyChange(event);
    }
  }

  /**
   * Schedule a debounced update
   */
  private scheduleUpdate(): void {
    if (this.debounceTimer) return;

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.processPendingChanges();
    }, this.options.debounceMs);
  }

  /**
   * Process all pending changes
   */
  private processPendingChanges(): void {
    const changes = this.pendingChanges;
    this.pendingChanges = [];

    if (changes.length === 0) return;

    // For multiple changes, it's often more efficient to re-execute
    if (changes.length > 5) {
      void this.execute();
      return;
    }

    // Apply changes one by one
    for (const change of changes) {
      this.applyChange(change);
    }
  }

  /**
   * Apply a single change using EventReduce
   */
  private applyChange(event: ChangeEvent<T>): void {
    if (!this.options.useEventReduce) {
      void this.execute();
      return;
    }

    const currentData = this.state.data;
    const action = reduceEvent(event, currentData, this.spec);

    if (action.type === 're-execute') {
      void this.execute();
      return;
    }

    const newData = applyAction(currentData, action, this.spec);

    if (newData === null) {
      // Action requires re-execution
      void this.execute();
      return;
    }

    if (newData !== currentData) {
      this.state$.next({
        data: newData,
        isLoading: false,
        error: null,
        lastUpdated: Date.now(),
      });
    }
  }
}

/**
 * Factory function to create a LiveQuery instance.
 *
 * For most use cases, prefer {@link Collection.createLiveQuery} or
 * {@link QueryBuilder.live} instead.
 *
 * @typeParam T - The document type
 * @param spec - Query specification
 * @param executor - Function that executes the query
 * @param changes$ - Observable of collection changes
 * @param options - Live query options
 * @returns A new LiveQuery instance
 *
 * @internal
 */
export function createLiveQuery<T extends Document>(
  spec: QuerySpec<T>,
  executor: () => Promise<T[]>,
  changes$: Observable<ChangeEvent<T>>,
  options?: LiveQueryOptions
): LiveQuery<T> {
  return new LiveQuery(spec, executor, changes$, options);
}
