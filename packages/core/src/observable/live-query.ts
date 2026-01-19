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
 * Live query options
 */
export interface LiveQueryOptions {
  /** Debounce changes (ms) */
  debounceMs?: number;
  /** Use EventReduce optimization */
  useEventReduce?: boolean;
  /** Initial data (skip first query) */
  initialData?: unknown[];
}

/**
 * Live query state
 */
export interface LiveQueryState<T extends Document> {
  data: T[];
  isLoading: boolean;
  error: Error | null;
  lastUpdated: number;
}

/**
 * Live query - reactive query that updates automatically
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
   * Start the live query
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
   * Stop the live query
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
   * Destroy the live query
   */
  destroy(): void {
    this.stop();
    this.destroy$.next();
    this.destroy$.complete();
    this.state$.complete();
  }

  /**
   * Get current state
   */
  get state(): LiveQueryState<T> {
    return this.state$.getValue();
  }

  /**
   * Get current data
   */
  get data(): T[] {
    return this.state.data;
  }

  /**
   * Get loading state
   */
  get isLoading(): boolean {
    return this.state.isLoading;
  }

  /**
   * Get error
   */
  get error(): Error | null {
    return this.state.error;
  }

  /**
   * Observable of state changes
   */
  stateObservable(): Observable<LiveQueryState<T>> {
    return this.state$.asObservable().pipe(takeUntil(this.destroy$), shareReplay(1));
  }

  /**
   * Observable of data changes only
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
   * Force re-execute the query
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
 * Create a live query
 */
export function createLiveQuery<T extends Document>(
  spec: QuerySpec<T>,
  executor: () => Promise<T[]>,
  changes$: Observable<ChangeEvent<T>>,
  options?: LiveQueryOptions
): LiveQuery<T> {
  return new LiveQuery(spec, executor, changes$, options);
}
