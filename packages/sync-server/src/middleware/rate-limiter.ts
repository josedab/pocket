/**
 * Rate Limiting Middleware for Sync Server
 *
 * Implements token bucket algorithm for per-client rate limiting.
 *
 * @module @pocket/sync-server
 */

import type { ConnectedClient, SyncMessage } from '../types.js';

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  /** Maximum tokens per bucket (burst capacity) */
  maxTokens?: number;
  /** Token refill rate per second */
  refillRate?: number;
  /** Cost per message type */
  messageCosts?: Partial<Record<string, number>>;
  /** Global rate limit (messages per second across all clients) */
  globalLimit?: number;
  /** Skip rate limiting for authenticated clients */
  skipAuthenticated?: boolean;
  /** Custom cost calculator */
  calculateCost?: (message: SyncMessage) => number;
  /** Handler for rate limit exceeded */
  onRateLimitExceeded?: (clientId: string, message: SyncMessage) => void;
}

/**
 * Default rate limiter configuration
 */
export const DEFAULT_RATE_LIMITER_CONFIG: Required<
  Omit<RateLimiterConfig, 'calculateCost' | 'onRateLimitExceeded'>
> = {
  maxTokens: 100,
  refillRate: 10,
  messageCosts: {
    push: 5,
    pull: 2,
    subscribe: 1,
    unsubscribe: 1,
    ping: 0.1,
    pong: 0.1,
  },
  globalLimit: 1000,
  skipAuthenticated: false,
};

/**
 * Token bucket state for a client
 */
interface TokenBucket {
  /** Current token count */
  tokens: number;
  /** Last refill timestamp */
  lastRefill: number;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining tokens */
  remaining: number;
  /** Time until next token refill (ms) */
  retryAfter?: number;
  /** Current cost of the message */
  cost: number;
}

/**
 * Rate limiter for sync server
 */
export class RateLimiter {
  private config: Required<Omit<RateLimiterConfig, 'calculateCost' | 'onRateLimitExceeded'>> &
    Pick<RateLimiterConfig, 'calculateCost' | 'onRateLimitExceeded'>;
  private buckets = new Map<string, TokenBucket>();
  private globalBucket: TokenBucket;

  constructor(config: RateLimiterConfig = {}) {
    this.config = {
      ...DEFAULT_RATE_LIMITER_CONFIG,
      ...config,
    };

    this.globalBucket = {
      tokens: this.config.globalLimit,
      lastRefill: Date.now(),
    };

    // Start cleanup interval to remove stale buckets
    this.startCleanupInterval();
  }

  /**
   * Check if a message is allowed and consume tokens if so
   */
  check(clientId: string, message: SyncMessage, client?: ConnectedClient): RateLimitResult {
    // Skip rate limiting for authenticated clients if configured
    if (this.config.skipAuthenticated && client?.auth?.userId) {
      return { allowed: true, remaining: this.config.maxTokens, cost: 0 };
    }

    // Calculate message cost
    const cost = this.calculateMessageCost(message);

    // Check global rate limit
    this.refillBucket(this.globalBucket, this.config.globalLimit);
    if (this.globalBucket.tokens < cost) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: this.calculateRetryAfter(cost - this.globalBucket.tokens),
        cost,
      };
    }

    // Get or create client bucket
    let bucket = this.buckets.get(clientId);
    if (!bucket) {
      bucket = {
        tokens: this.config.maxTokens,
        lastRefill: Date.now(),
      };
      this.buckets.set(clientId, bucket);
    }

    // Refill client bucket based on time elapsed
    this.refillBucket(bucket, this.config.maxTokens);

    // Check if enough tokens
    if (bucket.tokens < cost) {
      const retryAfter = this.calculateRetryAfter(cost - bucket.tokens);

      if (this.config.onRateLimitExceeded) {
        this.config.onRateLimitExceeded(clientId, message);
      }

      return {
        allowed: false,
        remaining: Math.max(0, bucket.tokens),
        retryAfter,
        cost,
      };
    }

    // Consume tokens
    bucket.tokens -= cost;
    this.globalBucket.tokens -= cost;

    return {
      allowed: true,
      remaining: bucket.tokens,
      cost,
    };
  }

  /**
   * Get current token count for a client
   */
  getTokens(clientId: string): number {
    const bucket = this.buckets.get(clientId);
    if (!bucket) {
      return this.config.maxTokens;
    }

    this.refillBucket(bucket, this.config.maxTokens);
    return bucket.tokens;
  }

  /**
   * Reset rate limit for a client
   */
  reset(clientId: string): void {
    this.buckets.delete(clientId);
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    this.buckets.clear();
    this.globalBucket = {
      tokens: this.config.globalLimit,
      lastRefill: Date.now(),
    };
  }

  /**
   * Get rate limiter statistics
   */
  getStats(): {
    clientCount: number;
    globalTokens: number;
    globalLimit: number;
  } {
    return {
      clientCount: this.buckets.size,
      globalTokens: this.globalBucket.tokens,
      globalLimit: this.config.globalLimit,
    };
  }

  /**
   * Calculate message cost
   */
  private calculateMessageCost(message: SyncMessage): number {
    // Use custom cost calculator if provided
    if (this.config.calculateCost) {
      return this.config.calculateCost(message);
    }

    // Look up cost by message type
    const cost = this.config.messageCosts[message.type];
    if (cost !== undefined) {
      return cost;
    }

    // Default cost
    return 1;
  }

  /**
   * Refill a token bucket based on time elapsed
   */
  private refillBucket(bucket: TokenBucket, maxTokens: number): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000; // Convert to seconds
    const tokensToAdd = elapsed * this.config.refillRate;

    bucket.tokens = Math.min(maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  /**
   * Calculate retry-after time in milliseconds
   */
  private calculateRetryAfter(tokensNeeded: number): number {
    return Math.ceil((tokensNeeded / this.config.refillRate) * 1000);
  }

  /**
   * Start interval to clean up stale buckets
   */
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  private startCleanupInterval(): void {
    // Clean up buckets for clients that haven't been seen in 5 minutes
    const CLEANUP_INTERVAL = 60000; // 1 minute
    const MAX_BUCKET_AGE = 300000; // 5 minutes

    this.cleanupIntervalId = setInterval(() => {
      const now = Date.now();
      for (const [clientId, bucket] of this.buckets) {
        if (now - bucket.lastRefill > MAX_BUCKET_AGE) {
          this.buckets.delete(clientId);
        }
      }
    }, CLEANUP_INTERVAL);
  }

  /**
   * Stop the cleanup interval
   */
  stop(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }
}

/**
 * Create a rate limiter middleware function
 *
 * @example
 * ```typescript
 * const rateLimiter = createRateLimiter({
 *   maxTokens: 100,
 *   refillRate: 10,
 *   onRateLimitExceeded: (clientId, message) => {
 *     console.log(`Client ${clientId} exceeded rate limit`);
 *   },
 * });
 *
 * // Use with sync server
 * const server = createSyncServer({
 *   middleware: [rateLimiter.middleware],
 * });
 * ```
 */
export function createRateLimiter(config: RateLimiterConfig = {}): RateLimiter {
  return new RateLimiter(config);
}

/**
 * Rate limiter middleware for sync server
 *
 * @example
 * ```typescript
 * import { rateLimiterMiddleware } from '@pocket/sync-server';
 *
 * const server = createSyncServer({
 *   middleware: [
 *     rateLimiterMiddleware({
 *       maxTokens: 50,
 *       refillRate: 5,
 *     }),
 *   ],
 * });
 * ```
 */
export function rateLimiterMiddleware(
  config: RateLimiterConfig = {}
): (message: SyncMessage, client: ConnectedClient, next: () => Promise<void>) => Promise<void> {
  const rateLimiter = createRateLimiter(config);

  return async (message, client, next) => {
    const result = rateLimiter.check(client.id, message, client);

    if (!result.allowed) {
      // Create error response
      const errorMessage = {
        type: 'error' as const,
        id: message.id,
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Retry after ${result.retryAfter}ms`,
        timestamp: Date.now(),
      };

      // The server should handle sending this error
      throw Object.assign(new Error('Rate limit exceeded'), {
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: result.retryAfter,
        errorMessage,
      });
    }

    await next();
  };
}
