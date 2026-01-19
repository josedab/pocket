import {
  BehaviorSubject,
  Observable,
  Subject,
  type Subscription,
  distinctUntilChanged,
  shareReplay,
  takeUntil,
} from 'rxjs';

/**
 * Observable value wrapper with current value access
 */
export class ObservableValue<T> {
  private readonly subject: BehaviorSubject<T>;
  private readonly destroy$ = new Subject<void>();

  constructor(initialValue: T) {
    this.subject = new BehaviorSubject<T>(initialValue);
  }

  /**
   * Get current value
   */
  get value(): T {
    return this.subject.getValue();
  }

  /**
   * Set new value
   */
  set value(newValue: T) {
    this.subject.next(newValue);
  }

  /**
   * Update value
   */
  next(value: T): void {
    this.subject.next(value);
  }

  /**
   * Get observable stream
   */
  asObservable(): Observable<T> {
    return this.subject.asObservable().pipe(takeUntil(this.destroy$), shareReplay(1));
  }

  /**
   * Subscribe to value changes
   */
  subscribe(observer: (value: T) => void): Subscription {
    return this.subject.pipe(takeUntil(this.destroy$)).subscribe(observer);
  }

  /**
   * Subscribe with distinct values only
   */
  subscribeDistinct(
    observer: (value: T) => void,
    comparator?: (a: T, b: T) => boolean
  ): Subscription {
    return this.subject
      .pipe(takeUntil(this.destroy$), distinctUntilChanged(comparator))
      .subscribe(observer);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.subject.complete();
  }
}

/**
 * Observable state with loading and error tracking
 */
export interface AsyncState<T> {
  data: T;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Observable async value with loading/error states
 */
export class ObservableAsync<T> {
  private readonly subject: BehaviorSubject<AsyncState<T>>;
  private readonly destroy$ = new Subject<void>();

  constructor(initialData: T) {
    this.subject = new BehaviorSubject<AsyncState<T>>({
      data: initialData,
      isLoading: false,
      error: null,
    });
  }

  /**
   * Get current state
   */
  get state(): AsyncState<T> {
    return this.subject.getValue();
  }

  /**
   * Get current data
   */
  get data(): T {
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
   * Set loading state
   */
  setLoading(isLoading: boolean): void {
    this.subject.next({
      ...this.state,
      isLoading,
    });
  }

  /**
   * Set data
   */
  setData(data: T): void {
    this.subject.next({
      data,
      isLoading: false,
      error: null,
    });
  }

  /**
   * Set error
   */
  setError(error: Error): void {
    this.subject.next({
      ...this.state,
      isLoading: false,
      error,
    });
  }

  /**
   * Get observable stream of state
   */
  asObservable(): Observable<AsyncState<T>> {
    return this.subject.asObservable().pipe(takeUntil(this.destroy$), shareReplay(1));
  }

  /**
   * Subscribe to state changes
   */
  subscribe(observer: (state: AsyncState<T>) => void): Subscription {
    return this.subject.pipe(takeUntil(this.destroy$)).subscribe(observer);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.subject.complete();
  }
}

/**
 * Create a deferred promise
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Debounce helper for observables
 */
export function debounce<T>(fn: (value: T) => void, delay: number): (value: T) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (value: T) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(value);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Throttle helper for observables
 */
export function throttle<T>(fn: (value: T) => void, delay: number): (value: T) => void {
  let lastTime = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastValue: T | undefined;

  return (value: T) => {
    const now = Date.now();
    lastValue = value;

    if (now - lastTime >= delay) {
      lastTime = now;
      fn(value);
    } else if (!timeoutId) {
      timeoutId = setTimeout(
        () => {
          lastTime = Date.now();
          if (lastValue !== undefined) {
            fn(lastValue);
          }
          timeoutId = null;
        },
        delay - (now - lastTime)
      );
    }
  };
}
