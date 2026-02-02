/**
 * RateLimiter - Token-bucket rate limiter for API request throttling.
 *
 * Provides configurable rate limiting with per-tier defaults for
 * controlling API request rates across Pocket Cloud service tiers.
 *
 * @module rate-limiter
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';
import type { CloudTier } from './types.js';

/**
 * Configuration for a token-bucket rate limiter.
 *
 * @example
 * ```typescript
 * const config: RateLimiterConfig = {
 *   maxTokens: 100,
 *   refillRate: 100,
 *   refillIntervalMs: 60_000,
 * };
 * ```
 *
 * @see {@link RateLimiter}
 */
export interface RateLimiterConfig {
  /** Maximum number of tokens the bucket can hold */
  readonly maxTokens: number;

  /** Number of tokens to add per refill interval */
  readonly refillRate: number;

  /** Interval in milliseconds between token refills */
  readonly refillIntervalMs: number;
}

/**
 * Result of a token consumption attempt.
 *
 * @see {@link RateLimiter.consume}
 */
export interface RateLimitResult {
  /** Whether the request was allowed */
  allowed: boolean;

  /** Number of tokens remaining after the attempt */
  remainingTokens: number;

  /** Milliseconds to wait before retrying (0 if allowed) */
  retryAfterMs: number;
}

/**
 * Current status snapshot of the rate limiter.
 *
 * @see {@link RateLimiter.getStatus}
 */
export interface RateLimiterStatus {
  /** Current number of available tokens */
  availableTokens: number;

  /** Maximum token capacity */
  maxTokens: number;

  /** Refill rate (tokens per interval) */
  refillRate: number;

  /** Refill interval in milliseconds */
  refillIntervalMs: number;
}

/**
 * Token-bucket rate limiter for API request throttling.
 *
 * Implements a token-bucket algorithm where tokens are consumed per request
 * and refilled at a configurable rate. When tokens are exhausted, requests
 * are denied with a retry-after hint.
 *
 * @example Basic usage
 * ```typescript
 * import { createRateLimiter } from '@pocket/cloud';
 *
 * const limiter = createRateLimiter({
 *   maxTokens: 100,
 *   refillRate: 100,
 *   refillIntervalMs: 60_000,
 * });
 *
 * const result = limiter.consume();
 * if (result.allowed) {
 *   console.log('Request allowed, remaining:', result.remainingTokens);
 * } else {
 *   console.log('Rate limited, retry after:', result.retryAfterMs, 'ms');
 * }
 *
 * limiter.destroy();
 * ```
 *
 * @see {@link createRateLimiter}
 * @see {@link RateLimiterConfig}
 */
export class RateLimiter {
  private readonly config: RateLimiterConfig;
  private readonly destroy$ = new Subject<void>();
  private readonly tokens$ = new BehaviorSubject<number>(0);

  private refillInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: RateLimiterConfig) {
    this.config = config;
    this.tokens$.next(config.maxTokens);

    this.refillInterval = setInterval(() => {
      this.refill();
    }, this.config.refillIntervalMs);
  }

  /**
   * Try to consume tokens from the bucket.
   *
   * @param tokens - Number of tokens to consume. @default 1
   * @returns Result indicating whether the request was allowed
   *
   * @example
   * ```typescript
   * const result = limiter.consume(5);
   * if (!result.allowed) {
   *   setTimeout(() => retry(), result.retryAfterMs);
   * }
   * ```
   */
  consume(tokens = 1): RateLimitResult {
    const current = this.tokens$.getValue();

    if (current >= tokens) {
      this.tokens$.next(current - tokens);
      return {
        allowed: true,
        remainingTokens: current - tokens,
        retryAfterMs: 0,
      };
    }

    // Calculate time until enough tokens are available
    const deficit = tokens - current;
    const intervalsNeeded = Math.ceil(deficit / this.config.refillRate);
    const retryAfterMs = intervalsNeeded * this.config.refillIntervalMs;

    return {
      allowed: false,
      remainingTokens: current,
      retryAfterMs,
    };
  }

  /**
   * Reset the token bucket to full capacity.
   *
   * @example
   * ```typescript
   * limiter.reset();
   * console.log(limiter.getStatus().availableTokens); // maxTokens
   * ```
   */
  reset(): void {
    this.tokens$.next(this.config.maxTokens);
  }

  /**
   * Get the current rate limiter status.
   *
   * @returns Current status snapshot
   *
   * @example
   * ```typescript
   * const status = limiter.getStatus();
   * console.log(`${status.availableTokens}/${status.maxTokens} tokens available`);
   * ```
   */
  getStatus(): RateLimiterStatus {
    return {
      availableTokens: this.tokens$.getValue(),
      maxTokens: this.config.maxTokens,
      refillRate: this.config.refillRate,
      refillIntervalMs: this.config.refillIntervalMs,
    };
  }

  /**
   * Get an observable of the current token count.
   *
   * @returns Observable that emits token count changes
   *
   * @example
   * ```typescript
   * limiter.getTokens$().subscribe(tokens => {
   *   console.log('Available tokens:', tokens);
   * });
   * ```
   */
  getTokens$(): Observable<number> {
    return this.tokens$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Permanently destroy the rate limiter and release all resources.
   *
   * Stops the refill interval and completes all observables.
   * After calling destroy(), the limiter cannot be reused.
   *
   * @example
   * ```typescript
   * limiter.destroy();
   * ```
   */
  destroy(): void {
    if (this.refillInterval) {
      clearInterval(this.refillInterval);
      this.refillInterval = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
    this.tokens$.complete();
  }

  private refill(): void {
    const current = this.tokens$.getValue();
    const next = Math.min(current + this.config.refillRate, this.config.maxTokens);
    this.tokens$.next(next);
  }
}

/**
 * Default rate limiter configurations per cloud tier.
 *
 * - `free`: 100 requests per minute
 * - `pro`: 1,000 requests per minute
 * - `enterprise`: 10,000 requests per minute
 */
export const TIER_RATE_LIMITS: Record<CloudTier, RateLimiterConfig> = {
  free: {
    maxTokens: 100,
    refillRate: 100,
    refillIntervalMs: 60_000,
  },
  pro: {
    maxTokens: 1_000,
    refillRate: 1_000,
    refillIntervalMs: 60_000,
  },
  enterprise: {
    maxTokens: 10_000,
    refillRate: 10_000,
    refillIntervalMs: 60_000,
  },
};

/**
 * Tiered rate limiter that maps cloud tiers to rate limiter instances.
 *
 * Manages a rate limiter per tier, using the default tier configurations.
 * Provides a convenient way to rate-limit requests based on the caller's
 * service tier.
 *
 * @example Basic usage
 * ```typescript
 * import { createTieredRateLimiter } from '@pocket/cloud';
 *
 * const tiered = createTieredRateLimiter();
 *
 * const result = tiered.consume('free');
 * if (!result.allowed) {
 *   console.log('Free tier rate limited');
 * }
 *
 * tiered.destroy();
 * ```
 *
 * @see {@link createTieredRateLimiter}
 * @see {@link TIER_RATE_LIMITS}
 */
export class TieredRateLimiter {
  private readonly limiters = new Map<CloudTier, RateLimiter>();
  constructor(configs: Record<CloudTier, RateLimiterConfig> = TIER_RATE_LIMITS) {

    for (const tier of Object.keys(configs) as CloudTier[]) {
      this.limiters.set(tier, new RateLimiter(configs[tier]));
    }
  }

  /**
   * Try to consume tokens for a specific tier.
   *
   * @param tier - The cloud tier to consume tokens for
   * @param tokens - Number of tokens to consume. @default 1
   * @returns Result indicating whether the request was allowed
   *
   * @example
   * ```typescript
   * const result = tiered.consume('pro', 5);
   * if (result.allowed) {
   *   console.log('Pro tier request allowed');
   * }
   * ```
   */
  consume(tier: CloudTier, tokens = 1): RateLimitResult {
    const limiter = this.limiters.get(tier);
    if (!limiter) {
      return { allowed: false, remainingTokens: 0, retryAfterMs: 0 };
    }
    return limiter.consume(tokens);
  }

  /**
   * Reset the rate limiter for a specific tier.
   *
   * @param tier - The cloud tier to reset
   *
   * @example
   * ```typescript
   * tiered.reset('free');
   * ```
   */
  reset(tier: CloudTier): void {
    this.limiters.get(tier)?.reset();
  }

  /**
   * Reset all tier rate limiters.
   *
   * @example
   * ```typescript
   * tiered.resetAll();
   * ```
   */
  resetAll(): void {
    for (const limiter of this.limiters.values()) {
      limiter.reset();
    }
  }

  /**
   * Get the rate limiter status for a specific tier.
   *
   * @param tier - The cloud tier to get status for
   * @returns Status snapshot, or null if tier not configured
   *
   * @example
   * ```typescript
   * const status = tiered.getStatus('pro');
   * console.log(status?.availableTokens);
   * ```
   */
  getStatus(tier: CloudTier): RateLimiterStatus | null {
    return this.limiters.get(tier)?.getStatus() ?? null;
  }

  /**
   * Get the rate limiter instance for a specific tier.
   *
   * @param tier - The cloud tier
   * @returns The rate limiter instance, or undefined if tier not configured
   */
  getLimiter(tier: CloudTier): RateLimiter | undefined {
    return this.limiters.get(tier);
  }

  /**
   * Permanently destroy all tier rate limiters and release resources.
   *
   * @example
   * ```typescript
   * tiered.destroy();
   * ```
   */
  destroy(): void {
    for (const limiter of this.limiters.values()) {
      limiter.destroy();
    }
    this.limiters.clear();
  }
}

/**
 * Create a rate limiter instance.
 *
 * Factory function that creates a configured {@link RateLimiter}.
 *
 * @param config - Rate limiter configuration
 * @returns A new RateLimiter instance
 *
 * @example
 * ```typescript
 * import { createRateLimiter } from '@pocket/cloud';
 *
 * const limiter = createRateLimiter({
 *   maxTokens: 500,
 *   refillRate: 500,
 *   refillIntervalMs: 60_000,
 * });
 * ```
 *
 * @see {@link RateLimiter}
 * @see {@link RateLimiterConfig}
 */
export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  return new RateLimiter(config);
}

/**
 * Create a tiered rate limiter instance.
 *
 * Factory function that creates a {@link TieredRateLimiter} with optional
 * custom tier configurations. Uses {@link TIER_RATE_LIMITS} defaults.
 *
 * @param configs - Optional custom tier configurations
 * @returns A new TieredRateLimiter instance
 *
 * @example
 * ```typescript
 * import { createTieredRateLimiter } from '@pocket/cloud';
 *
 * const tiered = createTieredRateLimiter();
 * const result = tiered.consume('pro');
 * ```
 *
 * @see {@link TieredRateLimiter}
 * @see {@link TIER_RATE_LIMITS}
 */
export function createTieredRateLimiter(
  configs?: Record<CloudTier, RateLimiterConfig>,
): TieredRateLimiter {
  return new TieredRateLimiter(configs);
}
