/**
 * Retry metrics and monitoring hooks for the sync engine.
 *
 * Provides observable retry telemetry, circuit breaker pattern,
 * and monitoring hooks for sync operation failures.
 *
 * @module retry-metrics
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

/** Retry event type */
export type RetryEventType = 'retry-attempt' | 'retry-success' | 'retry-exhausted' | 'circuit-open' | 'circuit-close';

/** A single retry event */
export interface RetryEvent {
  readonly type: RetryEventType;
  readonly operation: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly timestamp: number;
  readonly delayMs: number;
  readonly error?: string;
  readonly collection?: string;
}

/** Aggregate retry metrics */
export interface RetryMetrics {
  readonly totalRetries: number;
  readonly successfulRetries: number;
  readonly exhaustedRetries: number;
  readonly retriesPerMinute: number;
  readonly avgRetryDelayMs: number;
  readonly circuitBreakerOpen: boolean;
  readonly topFailingOperations: readonly { operation: string; count: number }[];
}

/** Circuit breaker state */
export type CircuitState = 'closed' | 'open' | 'half-open';

/** Circuit breaker configuration */
export interface CircuitBreakerConfig {
  /** Failures before opening (default: 5) */
  readonly failureThreshold?: number;
  /** Time in open state before trying half-open (default: 30000ms) */
  readonly resetTimeoutMs?: number;
  /** Successes in half-open to close (default: 2) */
  readonly successThreshold?: number;
}

/**
 * Tracks retry metrics and implements circuit breaker pattern.
 *
 * @example
 * ```typescript
 * const monitor = new SyncRetryMonitor({ failureThreshold: 5 });
 *
 * monitor.events$.subscribe(e => {
 *   if (e.type === 'circuit-open') console.log('Sync circuit breaker tripped!');
 * });
 *
 * // Before each sync attempt:
 * if (monitor.canAttempt()) {
 *   try {
 *     await syncOperation();
 *     monitor.recordSuccess('push');
 *   } catch (err) {
 *     const shouldRetry = monitor.recordFailure('push', err.message);
 *     if (shouldRetry) { ... }
 *   }
 * }
 * ```
 */
export class SyncRetryMonitor {
  private readonly config: Required<CircuitBreakerConfig>;
  private readonly events$$ = new Subject<RetryEvent>();
  private readonly metrics$$: BehaviorSubject<RetryMetrics>;
  private readonly destroy$ = new Subject<void>();

  private circuitState: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailureAt: number | null = null;
  private totalRetries = 0;
  private successfulRetries = 0;
  private exhaustedRetries = 0;
  private totalDelayMs = 0;
  private readonly failureCounts = new Map<string, number>();
  private readonly recentEvents: RetryEvent[] = [];

  constructor(config: CircuitBreakerConfig = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeoutMs: config.resetTimeoutMs ?? 30_000,
      successThreshold: config.successThreshold ?? 2,
    };
    this.metrics$$ = new BehaviorSubject<RetryMetrics>(this.buildMetrics());
  }

  /** Retry event stream */
  get events$(): Observable<RetryEvent> {
    return this.events$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Aggregate metrics stream */
  get retryMetrics$(): Observable<RetryMetrics> {
    return this.metrics$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Check if the circuit breaker allows an attempt */
  canAttempt(): boolean {
    if (this.circuitState === 'closed') return true;
    if (this.circuitState === 'open') {
      // Check if reset timeout has elapsed → transition to half-open
      if (this.lastFailureAt && Date.now() - this.lastFailureAt >= this.config.resetTimeoutMs) {
        this.circuitState = 'half-open';
        return true;
      }
      return false;
    }
    return true; // half-open allows attempts
  }

  /** Record a successful operation */
  recordSuccess(operation: string, collection?: string): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;

    if (this.circuitState === 'half-open' && this.consecutiveSuccesses >= this.config.successThreshold) {
      this.circuitState = 'closed';
      this.emitEvent({ type: 'circuit-close', operation, attempt: 0, maxAttempts: 0, timestamp: Date.now(), delayMs: 0, collection });
    }

    this.successfulRetries++;
    this.emitEvent({ type: 'retry-success', operation, attempt: 0, maxAttempts: 0, timestamp: Date.now(), delayMs: 0, collection });
    this.updateMetrics();
  }

  /** Record a failed operation. Returns true if more retries should be attempted. */
  recordFailure(operation: string, error?: string, attempt = 1, maxAttempts = 5, delayMs = 1000, collection?: string): boolean {
    this.totalRetries++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureAt = Date.now();
    this.totalDelayMs += delayMs;
    this.failureCounts.set(operation, (this.failureCounts.get(operation) ?? 0) + 1);

    if (attempt >= maxAttempts) {
      this.exhaustedRetries++;
      this.emitEvent({ type: 'retry-exhausted', operation, attempt, maxAttempts, timestamp: Date.now(), delayMs, error, collection });
    } else {
      this.emitEvent({ type: 'retry-attempt', operation, attempt, maxAttempts, timestamp: Date.now(), delayMs, error, collection });
    }

    // Check circuit breaker
    if (this.consecutiveFailures >= this.config.failureThreshold && this.circuitState !== 'open') {
      this.circuitState = 'open';
      this.emitEvent({ type: 'circuit-open', operation, attempt, maxAttempts, timestamp: Date.now(), delayMs, error, collection });
    }

    this.updateMetrics();
    return attempt < maxAttempts && this.canAttempt();
  }

  /** Get current circuit breaker state */
  getCircuitState(): CircuitState {
    // Auto-transition from open to half-open on check
    if (this.circuitState === 'open' && this.lastFailureAt && Date.now() - this.lastFailureAt >= this.config.resetTimeoutMs) {
      this.circuitState = 'half-open';
    }
    return this.circuitState;
  }

  /** Get current metrics snapshot */
  getMetrics(): RetryMetrics {
    return this.buildMetrics();
  }

  /** Reset all state */
  reset(): void {
    this.circuitState = 'closed';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureAt = null;
    this.totalRetries = 0;
    this.successfulRetries = 0;
    this.exhaustedRetries = 0;
    this.totalDelayMs = 0;
    this.failureCounts.clear();
    this.recentEvents.length = 0;
    this.updateMetrics();
  }

  /** Destroy and release resources */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.events$$.complete();
    this.metrics$$.complete();
  }

  private emitEvent(event: RetryEvent): void {
    this.events$$.next(event);
    this.recentEvents.push(event);
    if (this.recentEvents.length > 1000) this.recentEvents.shift();
  }

  private updateMetrics(): void {
    this.metrics$$.next(this.buildMetrics());
  }

  private buildMetrics(): RetryMetrics {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    const recentRetries = this.recentEvents.filter((e) => e.timestamp >= oneMinuteAgo && e.type === 'retry-attempt').length;

    const topOps = Array.from(this.failureCounts.entries())
      .map(([operation, count]) => ({ operation, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalRetries: this.totalRetries,
      successfulRetries: this.successfulRetries,
      exhaustedRetries: this.exhaustedRetries,
      retriesPerMinute: recentRetries,
      avgRetryDelayMs: this.totalRetries > 0 ? Math.round(this.totalDelayMs / this.totalRetries) : 0,
      circuitBreakerOpen: this.circuitState === 'open',
      topFailingOperations: topOps,
    };
  }
}

/** Factory function */
export function createSyncRetryMonitor(config?: CircuitBreakerConfig): SyncRetryMonitor {
  return new SyncRetryMonitor(config);
}
