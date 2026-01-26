import {
  BehaviorSubject,
  type Observable,
  Subject,
  type Subscription,
  distinctUntilChanged,
  shareReplay,
  takeUntil,
} from 'rxjs';

/**
 * A reactive value wrapper that provides both synchronous access and observable streams.
 *
 * ObservableValue combines the convenience of a simple variable with the reactivity
 * of RxJS observables. You can read/write the value synchronously while also
 * subscribing to changes.
 *
 * @typeParam T - The type of value being wrapped
 *
 * @example Basic usage
 * ```typescript
 * const counter = new ObservableValue(0);
 *
 * // Synchronous access
 * console.log(counter.value); // 0
 * counter.value = 5;
 * console.log(counter.value); // 5
 *
 * // Reactive subscription
 * counter.subscribe(value => {
 *   console.log('Counter changed:', value);
 * });
 *
 * counter.next(10); // logs "Counter changed: 10"
 * ```
 *
 * @example With distinct values
 * ```typescript
 * const status = new ObservableValue('idle');
 *
 * // Only fires when value actually changes
 * status.subscribeDistinct(value => {
 *   console.log('Status:', value);
 * });
 *
 * status.next('idle');   // No log (same value)
 * status.next('loading'); // logs "Status: loading"
 * ```
 *
 * @example In a component
 * ```typescript
 * class TodoStore {
 *   readonly todos = new ObservableValue<Todo[]>([]);
 *
 *   addTodo(title: string) {
 *     this.todos.value = [...this.todos.value, { id: uuid(), title }];
 *   }
 *
 *   // Expose as read-only observable
 *   get todos$() {
 *     return this.todos.asObservable();
 *   }
 * }
 * ```
 *
 * @see {@link ObservableAsync} for values with loading/error states
 */
export class ObservableValue<T> {
  private readonly subject: BehaviorSubject<T>;
  private readonly destroy$ = new Subject<void>();

  constructor(initialValue: T) {
    this.subject = new BehaviorSubject<T>(initialValue);
  }

  /**
   * Get the current value synchronously.
   *
   * @returns The current value
   */
  get value(): T {
    return this.subject.getValue();
  }

  /**
   * Set a new value, notifying all subscribers.
   *
   * @param newValue - The new value to set
   */
  set value(newValue: T) {
    this.subject.next(newValue);
  }

  /**
   * Emit a new value to all subscribers.
   *
   * Equivalent to setting `value` property but follows RxJS naming conventions.
   *
   * @param value - The new value to emit
   */
  next(value: T): void {
    this.subject.next(value);
  }

  /**
   * Get an RxJS observable stream of value changes.
   *
   * The observable automatically completes when {@link destroy} is called.
   * New subscribers immediately receive the current value (replay of 1).
   *
   * @returns An observable that emits on every value change
   */
  asObservable(): Observable<T> {
    return this.subject.asObservable().pipe(takeUntil(this.destroy$), shareReplay(1));
  }

  /**
   * Subscribe to value changes with a callback function.
   *
   * The callback is invoked immediately with the current value,
   * then on every subsequent change.
   *
   * @param observer - Callback invoked on each value change
   * @returns Subscription that can be unsubscribed
   */
  subscribe(observer: (value: T) => void): Subscription {
    return this.subject.pipe(takeUntil(this.destroy$)).subscribe(observer);
  }

  /**
   * Subscribe to value changes, but only when the value actually changes.
   *
   * Uses RxJS `distinctUntilChanged` to filter out emissions where
   * the new value equals the previous value.
   *
   * @param observer - Callback invoked only when value differs from previous
   * @param comparator - Optional custom equality function (defaults to `===`)
   * @returns Subscription that can be unsubscribed
   *
   * @example
   * ```typescript
   * observable.subscribeDistinct(
   *   value => console.log(value),
   *   (a, b) => a.id === b.id // Custom comparison
   * );
   * ```
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
   * Release all resources and complete the observable.
   *
   * After calling destroy:
   * - All subscribers are unsubscribed
   * - The observable completes
   * - No further values can be emitted
   *
   * Always call this when done with the ObservableValue to prevent memory leaks.
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.subject.complete();
  }
}

/**
 * Represents the state of an asynchronous operation.
 *
 * This interface captures the three possible states of async data:
 * - **Loading**: `isLoading: true`, data may be stale or empty
 * - **Success**: `isLoading: false`, `error: null`, data is current
 * - **Error**: `isLoading: false`, `error` contains the failure, data may be stale
 *
 * @typeParam T - The type of data being tracked
 *
 * @see {@link ObservableAsync} for a reactive wrapper using this state
 */
export interface AsyncState<T> {
  /** The current data value (may be initial/stale during loading or after error) */
  data: T;
  /** Whether an async operation is currently in progress */
  isLoading: boolean;
  /** The last error encountered, or null if the last operation succeeded */
  error: Error | null;
}

/**
 * A reactive async value wrapper with built-in loading and error state tracking.
 *
 * ObservableAsync extends the concept of {@link ObservableValue} for asynchronous
 * operations. It tracks not just the data, but also loading state and errors,
 * which is essential for building responsive UIs.
 *
 * @typeParam T - The type of data being tracked
 *
 * @example Fetching data
 * ```typescript
 * const users = new ObservableAsync<User[]>([]);
 *
 * async function loadUsers() {
 *   users.setLoading(true);
 *   try {
 *     const data = await api.fetchUsers();
 *     users.setData(data);
 *   } catch (err) {
 *     users.setError(err instanceof Error ? err : new Error(String(err)));
 *   }
 * }
 * ```
 *
 * @example Subscribing to state
 * ```typescript
 * users.subscribe(state => {
 *   if (state.isLoading) {
 *     showSpinner();
 *   } else if (state.error) {
 *     showError(state.error.message);
 *   } else {
 *     renderUsers(state.data);
 *   }
 * });
 * ```
 *
 * @example With React (conceptual)
 * ```tsx
 * function UserList() {
 *   const [state, setState] = useState(users.state);
 *
 *   useEffect(() => {
 *     const sub = users.subscribe(setState);
 *     return () => sub.unsubscribe();
 *   }, []);
 *
 *   if (state.isLoading) return <Spinner />;
 *   if (state.error) return <Error message={state.error.message} />;
 *   return <List items={state.data} />;
 * }
 * ```
 *
 * @see {@link ObservableValue} for simple synchronous values
 * @see {@link AsyncState} for the state interface
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
   * Get the current complete state snapshot.
   *
   * @returns The current {@link AsyncState} with data, loading, and error
   */
  get state(): AsyncState<T> {
    return this.subject.getValue();
  }

  /**
   * Get the current data value.
   *
   * Note: This may return stale data during loading or after an error.
   * Check `isLoading` and `error` for complete state.
   *
   * @returns The current data value
   */
  get data(): T {
    return this.state.data;
  }

  /**
   * Check if an async operation is currently in progress.
   *
   * @returns `true` if loading, `false` otherwise
   */
  get isLoading(): boolean {
    return this.state.isLoading;
  }

  /**
   * Get the last error that occurred.
   *
   * @returns The error if the last operation failed, `null` if successful
   */
  get error(): Error | null {
    return this.state.error;
  }

  /**
   * Update the loading state while preserving data and error.
   *
   * Typically called at the start of an async operation.
   *
   * @param isLoading - Whether loading is in progress
   *
   * @example
   * ```typescript
   * async function reload() {
   *   state.setLoading(true);
   *   // ... fetch data
   * }
   * ```
   */
  setLoading(isLoading: boolean): void {
    this.subject.next({
      ...this.state,
      isLoading,
    });
  }

  /**
   * Set successful data, clearing loading and error states.
   *
   * Call this when an async operation completes successfully.
   *
   * @param data - The new data value
   *
   * @example
   * ```typescript
   * const result = await api.fetch();
   * state.setData(result);
   * ```
   */
  setData(data: T): void {
    this.subject.next({
      data,
      isLoading: false,
      error: null,
    });
  }

  /**
   * Set an error state, clearing the loading flag.
   *
   * Call this when an async operation fails. The previous data is preserved
   * to allow showing stale data alongside the error message.
   *
   * @param error - The error that occurred
   *
   * @example
   * ```typescript
   * try {
   *   const result = await api.fetch();
   *   state.setData(result);
   * } catch (err) {
   *   state.setError(err instanceof Error ? err : new Error(String(err)));
   * }
   * ```
   */
  setError(error: Error): void {
    this.subject.next({
      ...this.state,
      isLoading: false,
      error,
    });
  }

  /**
   * Get an RxJS observable stream of state changes.
   *
   * The observable automatically completes when {@link destroy} is called.
   * New subscribers immediately receive the current state (replay of 1).
   *
   * @returns An observable that emits the full {@link AsyncState} on every change
   */
  asObservable(): Observable<AsyncState<T>> {
    return this.subject.asObservable().pipe(takeUntil(this.destroy$), shareReplay(1));
  }

  /**
   * Subscribe to state changes with a callback function.
   *
   * The callback is invoked immediately with the current state,
   * then on every subsequent state change.
   *
   * @param observer - Callback invoked with the full state on each change
   * @returns Subscription that can be unsubscribed
   */
  subscribe(observer: (state: AsyncState<T>) => void): Subscription {
    return this.subject.pipe(takeUntil(this.destroy$)).subscribe(observer);
  }

  /**
   * Release all resources and complete the observable.
   *
   * After calling destroy:
   * - All subscribers are unsubscribed
   * - The observable completes
   * - No further state changes can be emitted
   *
   * Always call this when done with the ObservableAsync to prevent memory leaks.
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.subject.complete();
  }
}

/**
 * A promise with externally-accessible resolve and reject functions.
 *
 * Deferred provides a way to create a promise whose resolution can be
 * controlled from outside the promise executor. This is useful for
 * coordinating async operations or implementing request/response patterns.
 *
 * @typeParam T - The type of value the promise resolves to
 *
 * @see {@link createDeferred} to create a Deferred instance
 *
 * @example
 * ```typescript
 * const deferred = createDeferred<User>();
 *
 * // Somewhere else in the code
 * api.onUserLoaded(user => {
 *   deferred.resolve(user);
 * });
 *
 * api.onError(err => {
 *   deferred.reject(err);
 * });
 *
 * // Await the result
 * const user = await deferred.promise;
 * ```
 */
export interface Deferred<T> {
  /** The promise that will be resolved or rejected */
  promise: Promise<T>;
  /** Function to resolve the promise with a value */
  resolve: (value: T) => void;
  /** Function to reject the promise with an error */
  reject: (error: Error) => void;
}

/**
 * Creates a new deferred promise with external resolve/reject control.
 *
 * This is useful when you need to create a promise now but resolve it later
 * from a different context (e.g., event handlers, callbacks, or coordinating
 * multiple async operations).
 *
 * @typeParam T - The type of value the promise resolves to
 * @returns A {@link Deferred} object with promise, resolve, and reject
 *
 * @example Basic usage
 * ```typescript
 * const deferred = createDeferred<string>();
 *
 * setTimeout(() => {
 *   deferred.resolve('Hello after 1 second');
 * }, 1000);
 *
 * const message = await deferred.promise;
 * console.log(message); // "Hello after 1 second"
 * ```
 *
 * @example Request/response pattern
 * ```typescript
 * const pendingRequests = new Map<string, Deferred<Response>>();
 *
 * function sendRequest(id: string, data: unknown): Promise<Response> {
 *   const deferred = createDeferred<Response>();
 *   pendingRequests.set(id, deferred);
 *   socket.send({ id, data });
 *   return deferred.promise;
 * }
 *
 * socket.onMessage(msg => {
 *   const deferred = pendingRequests.get(msg.id);
 *   if (deferred) {
 *     deferred.resolve(msg.response);
 *     pendingRequests.delete(msg.id);
 *   }
 * });
 * ```
 */
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
 * Creates a debounced version of a callback function.
 *
 * Debouncing delays execution until a pause in calls. If the debounced
 * function is called multiple times within the delay period, only the
 * last call is executed (after the delay expires with no new calls).
 *
 * Use debounce when you want to wait for activity to stop before acting,
 * such as:
 * - Search-as-you-type (wait for user to stop typing)
 * - Window resize handlers (wait for resize to finish)
 * - Form validation (wait for user to stop editing a field)
 *
 * @typeParam T - The type of value passed to the callback
 * @param fn - The function to debounce
 * @param delay - Milliseconds to wait after the last call before executing
 * @returns A debounced version of the function
 *
 * @example Search input
 * ```typescript
 * const debouncedSearch = debounce((query: string) => {
 *   api.search(query);
 * }, 300);
 *
 * input.addEventListener('input', e => {
 *   debouncedSearch(e.target.value);
 * });
 * // Only searches 300ms after user stops typing
 * ```
 *
 * @example With live queries
 * ```typescript
 * const debouncedRefresh = debounce(() => {
 *   liveQuery.refresh();
 * }, 100);
 *
 * // Batch rapid changes into a single refresh
 * changes$.subscribe(() => debouncedRefresh());
 * ```
 *
 * @see {@link throttle} for rate-limiting that executes periodically
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
 * Creates a throttled version of a callback function.
 *
 * Throttling limits execution to at most once per delay period. The first
 * call executes immediately, then subsequent calls within the delay period
 * are queued. After the delay, the most recent queued call is executed.
 *
 * Use throttle when you want to rate-limit continuous activity, such as:
 * - Scroll event handlers (execute at most every N ms)
 * - Progress updates (don't flood the UI)
 * - API polling (limit request rate)
 *
 * @typeParam T - The type of value passed to the callback
 * @param fn - The function to throttle
 * @param delay - Minimum milliseconds between executions
 * @returns A throttled version of the function
 *
 * @example Scroll handler
 * ```typescript
 * const throttledScroll = throttle((scrollY: number) => {
 *   updateNavbarState(scrollY);
 * }, 100);
 *
 * window.addEventListener('scroll', () => {
 *   throttledScroll(window.scrollY);
 * });
 * // Updates at most every 100ms during scroll
 * ```
 *
 * @example Progress reporting
 * ```typescript
 * const throttledProgress = throttle((percent: number) => {
 *   progressBar.style.width = `${percent}%`;
 * }, 50);
 *
 * // Even with rapid updates, UI updates at most every 50ms
 * for (let i = 0; i <= 100; i++) {
 *   throttledProgress(i);
 * }
 * ```
 *
 * @see {@link debounce} for waiting until activity stops
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
    } else {
      timeoutId ??= setTimeout(
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
