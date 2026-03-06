/**
 * @pocket/computed — Reactive computed collection engine.
 *
 * Maintains derived collections that automatically update when source
 * collections change. Supports incremental recomputation, caching,
 * and cross-collection operations.
 *
 * @module @pocket/computed
 */

import {
  BehaviorSubject,
  type Observable,
  Subject,
  type Subscription,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  shareReplay,
  takeUntil,
} from 'rxjs';
import type {
  ComputeContext,
  ComputedCollectionConfig,
  ComputedCollectionState,
  ComputedEvent,
  SourceCollection,
} from './types.js';

// ── Computed Collection ───────────────────────────────────

export class ComputedCollection<T extends Record<string, unknown> = Record<string, unknown>> {
  private readonly config: Required<ComputedCollectionConfig<T>>;
  private readonly state$$: BehaviorSubject<ComputedCollectionState>;
  private readonly output$$: BehaviorSubject<T[]>;
  private readonly events$$ = new Subject<ComputedEvent>();
  private readonly destroy$ = new Subject<void>();
  private subscription: Subscription | null = null;
  private recomputeCount = 0;

  readonly events$ = this.events$$.asObservable();

  constructor(config: ComputedCollectionConfig<T>) {
    this.config = {
      name: config.name,
      sources: config.sources,
      compute: config.compute,
      incremental: config.incremental ?? true,
      debounceMs: config.debounceMs ?? 0,
      cacheEnabled: config.cacheEnabled ?? true,
      equals: config.equals ?? defaultEquals,
    };

    this.state$$ = new BehaviorSubject<ComputedCollectionState>({
      name: this.config.name,
      status: 'idle',
      documentCount: 0,
      lastComputedAt: null,
      computeTimeMs: 0,
      recomputeCount: 0,
    });

    this.output$$ = new BehaviorSubject<T[]>([]);
  }

  get name(): string {
    return this.config.name;
  }

  /** Observable of current computed documents */
  get documents$(): Observable<T[]> {
    return this.output$$.pipe(
      distinctUntilChanged((a, b) => this.config.equals(a, b)),
      shareReplay(1),
    );
  }

  /** Observable of collection state */
  get state$(): Observable<ComputedCollectionState> {
    return this.state$$.asObservable();
  }

  /** Get current computed documents synchronously */
  getAll(): T[] {
    return this.output$$.getValue();
  }

  /** Get current state */
  getState(): ComputedCollectionState {
    return this.state$$.getValue();
  }

  /**
   * Bind to source collections and start reactive computation.
   */
  bind(sources: Map<string, SourceCollection>): void {
    this.unbind();

    const sourceObservables: Observable<Record<string, unknown>[]>[] = [];
    const sourceNames: string[] = [];

    for (const sourceName of this.config.sources) {
      const source = sources.get(sourceName);
      if (!source) {
        throw new Error(`Source collection "${sourceName}" not found for computed collection "${this.config.name}"`);
      }
      sourceObservables.push(source.documents$);
      sourceNames.push(sourceName);
    }

    let combined$ = combineLatest(sourceObservables).pipe(
      map((arrays) => {
        const result: Record<string, Record<string, unknown>[]> = {};
        for (let i = 0; i < sourceNames.length; i++) {
          result[sourceNames[i]!] = arrays[i]!;
        }
        return result;
      }),
      takeUntil(this.destroy$),
    );

    if (this.config.debounceMs > 0) {
      combined$ = combined$.pipe(debounceTime(this.config.debounceMs));
    }

    let isFirst = true;
    this.subscription = combined$.subscribe({
      next: (sourcesData) => {
        this.recompute(sourcesData, isFirst);
        isFirst = false;
      },
      error: (err) => {
        this.handleError(err);
      },
    });
  }

  /** Force a recomputation */
  invalidate(reason = 'manual'): void {
    this.updateState({ status: 'stale' });
    this.events$$.next({ type: 'invalidated', name: this.config.name, reason });
  }

  /** Unbind from sources */
  unbind(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  /** Dispose of this computed collection */
  dispose(): void {
    this.unbind();
    this.destroy$.next();
    this.destroy$.complete();
    this.events$$.next({ type: 'disposed', name: this.config.name });
    this.events$$.complete();
    this.state$$.complete();
    this.output$$.complete();
  }

  private recompute(sourcesData: Record<string, Record<string, unknown>[]>, isInitial: boolean): void {
    this.updateState({ status: 'computing' });

    const start = performance.now();
    try {
      const context: ComputeContext = {
        previousOutput: isInitial ? undefined : (this.output$$.getValue() as Record<string, unknown>[]),
        isInitial,
      };

      const result = this.config.compute(sourcesData, context);
      const timeMs = performance.now() - start;

      this.recomputeCount++;
      this.output$$.next(result);
      this.updateState({
        status: 'idle',
        documentCount: result.length,
        lastComputedAt: Date.now(),
        computeTimeMs: timeMs,
        recomputeCount: this.recomputeCount,
      });

      this.events$$.next({
        type: 'computed',
        name: this.config.name,
        documentCount: result.length,
        timeMs,
      });
    } catch (err) {
      this.handleError(err);
    }
  }

  private handleError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.updateState({ status: 'error', errorMessage: message });
    this.events$$.next({ type: 'error', name: this.config.name, error: message });
  }

  private updateState(patch: Partial<ComputedCollectionState>): void {
    this.state$$.next({ ...this.state$$.getValue(), ...patch });
  }
}

function defaultEquals<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Factory ───────────────────────────────────────────────

export function createComputedCollection<T extends Record<string, unknown> = Record<string, unknown>>(
  config: ComputedCollectionConfig<T>,
): ComputedCollection<T> {
  return new ComputedCollection<T>(config);
}
