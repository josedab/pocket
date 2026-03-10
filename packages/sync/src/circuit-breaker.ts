/**
 * Circuit Breaker — Prevents cascading failures by temporarily halting
 * operations when a failure threshold is exceeded.
 *
 * States:
 * - CLOSED: Normal operation. Failures counted. Opens when threshold hit.
 * - OPEN: All calls rejected immediately. Transitions to half-open after timeout.
 * - HALF_OPEN: Allows a single trial call. Success → closed, failure → open.
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({
 *   failureThreshold: 5,
 *   resetTimeoutMs: 30000,
 *   name: 'sync-push',
 * });
 *
 * try {
 *   await breaker.execute(() => pushChanges());
 * } catch (err) {
 *   if (err instanceof CircuitOpenError) {
 *     // Circuit is open — back off
 *   }
 * }
 * ```
 */

import { Subject, type Observable } from 'rxjs';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit. @default 5 */
  failureThreshold?: number;
  /** Time in ms to wait before transitioning from open → half-open. @default 30000 */
  resetTimeoutMs?: number;
  /** Optional name for logging/metrics. */
  name?: string;
}

export interface CircuitBreakerEvent {
  type: 'state-change' | 'failure' | 'success' | 'rejected';
  state: CircuitState;
  name: string;
  timestamp: number;
  error?: string;
}

/** Error thrown when the circuit is open and calls are rejected. */
export class CircuitOpenError extends Error {
  readonly circuitName: string;
  readonly retryAfterMs: number;

  constructor(name: string, retryAfterMs: number) {
    super(`Circuit breaker "${name}" is open. Retry after ${retryAfterMs}ms.`);
    this.name = 'CircuitOpenError';
    this.circuitName = name;
    this.retryAfterMs = retryAfterMs;
  }
}

export class CircuitBreaker {
  private readonly config: Required<CircuitBreakerConfig>;
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly events$ = new Subject<CircuitBreakerEvent>();

  constructor(config: CircuitBreakerConfig = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeoutMs: config.resetTimeoutMs ?? 30000,
      name: config.name ?? 'default',
    };
  }

  /** Current circuit state */
  getState(): CircuitState {
    this.checkHalfOpen();
    return this.state;
  }

  /** Observable of circuit breaker events */
  get events(): Observable<CircuitBreakerEvent> {
    return this.events$.asObservable();
  }

  /**
   * Execute a function through the circuit breaker.
   * @throws CircuitOpenError if the circuit is open
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkHalfOpen();

    if (this.state === 'open') {
      const retryAfter = this.config.resetTimeoutMs - (Date.now() - this.lastFailureTime);
      this.emit('rejected');
      throw new CircuitOpenError(this.config.name, Math.max(retryAfter, 0));
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /** Manually reset the circuit to closed state */
  reset(): void {
    this.failureCount = 0;
    this.transition('closed');
  }

  /** Clean up resources */
  destroy(): void {
    this.events$.complete();
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === 'half-open') {
      this.transition('closed');
    }
    this.emit('success');
  }

  private onFailure(error: unknown): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.emit('failure', error instanceof Error ? error.message : String(error));

    if (this.state === 'half-open') {
      this.transition('open');
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.transition('open');
    }
  }

  private checkHalfOpen(): void {
    if (this.state === 'open' && Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
      this.transition('half-open');
    }
  }

  private transition(newState: CircuitState): void {
    if (this.state === newState) return;
    this.state = newState;
    this.emit('state-change');
  }

  private emit(type: CircuitBreakerEvent['type'], error?: string): void {
    this.events$.next({
      type,
      state: this.state,
      name: this.config.name,
      timestamp: Date.now(),
      error,
    });
  }
}

export function createCircuitBreaker(config?: CircuitBreakerConfig): CircuitBreaker {
  return new CircuitBreaker(config);
}
