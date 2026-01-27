import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedClient, SyncMessage } from '../types.js';
import {
  createRateLimiter,
  DEFAULT_RATE_LIMITER_CONFIG,
  RateLimiter,
  rateLimiterMiddleware,
} from './rate-limiter.js';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  afterEach(() => {
    rateLimiter?.stop();
  });

  describe('constructor', () => {
    it('creates with default config', () => {
      rateLimiter = new RateLimiter();
      const stats = rateLimiter.getStats();

      expect(stats.globalLimit).toBe(DEFAULT_RATE_LIMITER_CONFIG.globalLimit);
      expect(stats.clientCount).toBe(0);
    });

    it('creates with custom config', () => {
      rateLimiter = new RateLimiter({
        maxTokens: 50,
        refillRate: 5,
        globalLimit: 500,
      });
      const stats = rateLimiter.getStats();

      expect(stats.globalLimit).toBe(500);
    });
  });

  describe('check', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({
        maxTokens: 100,
        refillRate: 10,
        globalLimit: 1000,
      });
    });

    it('allows message within rate limit', () => {
      const message: SyncMessage = {
        type: 'ping',
        id: 'msg1',
        timestamp: Date.now(),
      };

      const result = rateLimiter.check('client1', message);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
      expect(result.cost).toBe(0.1); // ping cost from default config
    });

    it('uses message type costs from config', () => {
      const pushMessage: SyncMessage = {
        type: 'push',
        id: 'msg1',
        timestamp: Date.now(),
      };
      const pullMessage: SyncMessage = {
        type: 'pull',
        id: 'msg2',
        timestamp: Date.now(),
      };

      const pushResult = rateLimiter.check('client1', pushMessage);
      const pullResult = rateLimiter.check('client1', pullMessage);

      expect(pushResult.cost).toBe(5); // push cost from default config
      expect(pullResult.cost).toBe(2); // pull cost from default config
    });

    it('uses default cost of 1 for unknown message types', () => {
      const message: SyncMessage = {
        type: 'unknown' as never,
        id: 'msg1',
        timestamp: Date.now(),
      };

      const result = rateLimiter.check('client1', message);
      expect(result.cost).toBe(1);
    });

    it('creates new bucket for new client', () => {
      const message: SyncMessage = {
        type: 'ping',
        id: 'msg1',
        timestamp: Date.now(),
      };

      rateLimiter.check('client1', message);
      rateLimiter.check('client2', message);

      expect(rateLimiter.getStats().clientCount).toBe(2);
    });

    it('denies when client bucket exhausted', () => {
      rateLimiter = new RateLimiter({
        maxTokens: 10,
        refillRate: 1,
        globalLimit: 1000,
      });

      const message: SyncMessage = {
        type: 'push', // cost: 5
        id: 'msg1',
        timestamp: Date.now(),
      };

      // First two pushes should succeed (10 tokens, 5 each)
      const result1 = rateLimiter.check('client1', message);
      const result2 = rateLimiter.check('client1', message);
      // Third should fail
      const result3 = rateLimiter.check('client1', message);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(false);
      expect(result3.retryAfter).toBeDefined();
    });

    it('denies when global limit exceeded', () => {
      rateLimiter = new RateLimiter({
        maxTokens: 1000,
        refillRate: 10,
        globalLimit: 10, // Very low global limit
      });

      const message: SyncMessage = {
        type: 'push', // cost: 5
        id: 'msg1',
        timestamp: Date.now(),
      };

      const result1 = rateLimiter.check('client1', message);
      const result2 = rateLimiter.check('client2', message);
      const result3 = rateLimiter.check('client3', message);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(false);
    });

    it('skips rate limiting for authenticated clients when configured', () => {
      rateLimiter = new RateLimiter({
        maxTokens: 1,
        refillRate: 0.1,
        globalLimit: 1000,
        skipAuthenticated: true,
      });

      const message: SyncMessage = {
        type: 'push', // cost: 5
        id: 'msg1',
        timestamp: Date.now(),
      };

      const client: ConnectedClient = {
        id: 'client1',
        socket: {},
        subscriptions: new Set(),
        auth: { userId: 'user1' },
        lastActivity: Date.now(),
        connectedAt: Date.now(),
      };

      // Should always be allowed for authenticated client
      const result1 = rateLimiter.check('client1', message, client);
      const result2 = rateLimiter.check('client1', message, client);
      const result3 = rateLimiter.check('client1', message, client);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(true);
      expect(result1.cost).toBe(0); // No cost for authenticated
    });

    it('does not skip for authenticated when not configured', () => {
      rateLimiter = new RateLimiter({
        maxTokens: 10,
        refillRate: 1,
        globalLimit: 1000,
        skipAuthenticated: false,
      });

      const message: SyncMessage = {
        type: 'push', // cost: 5
        id: 'msg1',
        timestamp: Date.now(),
      };

      const client: ConnectedClient = {
        id: 'client1',
        socket: {},
        subscriptions: new Set(),
        auth: { userId: 'user1' },
        lastActivity: Date.now(),
        connectedAt: Date.now(),
      };

      rateLimiter.check('client1', message, client);
      rateLimiter.check('client1', message, client);
      const result = rateLimiter.check('client1', message, client);

      expect(result.allowed).toBe(false);
    });

    it('uses custom cost calculator when provided', () => {
      rateLimiter = new RateLimiter({
        maxTokens: 100,
        refillRate: 10,
        globalLimit: 1000,
        calculateCost: (msg) => {
          if (msg.type === 'push') return 50;
          return 1;
        },
      });

      const message: SyncMessage = {
        type: 'push',
        id: 'msg1',
        timestamp: Date.now(),
      };

      const result = rateLimiter.check('client1', message);
      expect(result.cost).toBe(50);
    });

    it('calls onRateLimitExceeded handler when limit exceeded', () => {
      const onExceeded = vi.fn();

      rateLimiter = new RateLimiter({
        maxTokens: 1,
        refillRate: 0.1,
        globalLimit: 1000,
        onRateLimitExceeded: onExceeded,
      });

      const message: SyncMessage = {
        type: 'push', // cost: 5
        id: 'msg1',
        timestamp: Date.now(),
      };

      rateLimiter.check('client1', message);

      expect(onExceeded).toHaveBeenCalledWith('client1', message);
    });
  });

  describe('getTokens', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({ maxTokens: 100 });
    });

    it('returns maxTokens for new client', () => {
      const tokens = rateLimiter.getTokens('newclient');
      expect(tokens).toBe(100);
    });

    it('returns current tokens for existing client', () => {
      const message: SyncMessage = {
        type: 'push', // cost: 5
        id: 'msg1',
        timestamp: Date.now(),
      };

      rateLimiter.check('client1', message);
      const tokens = rateLimiter.getTokens('client1');

      expect(tokens).toBeLessThan(100);
    });
  });

  describe('reset', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({ maxTokens: 100 });
    });

    it('resets rate limit for specific client', () => {
      const message: SyncMessage = {
        type: 'push',
        id: 'msg1',
        timestamp: Date.now(),
      };

      rateLimiter.check('client1', message);
      rateLimiter.check('client2', message);

      rateLimiter.reset('client1');

      expect(rateLimiter.getStats().clientCount).toBe(1);
      expect(rateLimiter.getTokens('client1')).toBe(100);
    });
  });

  describe('resetAll', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({
        maxTokens: 100,
        globalLimit: 1000,
      });
    });

    it('resets all client buckets and global bucket', () => {
      const message: SyncMessage = {
        type: 'push',
        id: 'msg1',
        timestamp: Date.now(),
      };

      rateLimiter.check('client1', message);
      rateLimiter.check('client2', message);

      rateLimiter.resetAll();

      const stats = rateLimiter.getStats();
      expect(stats.clientCount).toBe(0);
      expect(stats.globalTokens).toBe(1000);
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      rateLimiter = new RateLimiter({
        maxTokens: 100,
        globalLimit: 500,
      });

      const message: SyncMessage = {
        type: 'push',
        id: 'msg1',
        timestamp: Date.now(),
      };

      rateLimiter.check('client1', message);
      rateLimiter.check('client2', message);

      const stats = rateLimiter.getStats();

      expect(stats.clientCount).toBe(2);
      expect(stats.globalLimit).toBe(500);
      expect(stats.globalTokens).toBeLessThan(500);
    });
  });

  describe('token refill', () => {
    it('refills tokens over time', async () => {
      vi.useFakeTimers();

      rateLimiter = new RateLimiter({
        maxTokens: 100,
        refillRate: 100, // 100 tokens per second
        globalLimit: 1000,
      });

      const message: SyncMessage = {
        type: 'push', // cost: 5
        id: 'msg1',
        timestamp: Date.now(),
      };

      // Consume some tokens
      for (let i = 0; i < 10; i++) {
        rateLimiter.check('client1', message);
      }

      const tokensBefore = rateLimiter.getTokens('client1');
      expect(tokensBefore).toBe(50); // 100 - (10 * 5)

      // Advance time by 0.5 seconds (should add 50 tokens)
      vi.advanceTimersByTime(500);

      const tokensAfter = rateLimiter.getTokens('client1');
      expect(tokensAfter).toBe(100); // Capped at maxTokens

      vi.useRealTimers();
    });
  });

  describe('stop', () => {
    it('stops cleanup interval', () => {
      rateLimiter = new RateLimiter();
      rateLimiter.stop();
      // Should not throw when called multiple times
      rateLimiter.stop();
    });
  });
});

describe('createRateLimiter factory', () => {
  it('creates a RateLimiter instance', () => {
    const limiter = createRateLimiter();
    expect(limiter).toBeInstanceOf(RateLimiter);
    limiter.stop();
  });

  it('passes config to constructor', () => {
    const limiter = createRateLimiter({ maxTokens: 50 });
    expect(limiter).toBeInstanceOf(RateLimiter);
    limiter.stop();
  });
});

describe('rateLimiterMiddleware', () => {
  it('allows requests within limit', async () => {
    const middleware = rateLimiterMiddleware({ maxTokens: 100 });
    const next = vi.fn().mockResolvedValue(undefined);

    const message: SyncMessage = {
      type: 'ping',
      id: 'msg1',
      timestamp: Date.now(),
    };

    const client: ConnectedClient = {
      id: 'client1',
      socket: {},
      subscriptions: new Set(),
      lastActivity: Date.now(),
      connectedAt: Date.now(),
    };

    await middleware(message, client, next);
    expect(next).toHaveBeenCalled();
  });

  it('throws error when rate limit exceeded', async () => {
    const middleware = rateLimiterMiddleware({
      maxTokens: 1,
      refillRate: 0.001,
    });
    const next = vi.fn().mockResolvedValue(undefined);

    const message: SyncMessage = {
      type: 'push', // cost: 5
      id: 'msg1',
      timestamp: Date.now(),
    };

    const client: ConnectedClient = {
      id: 'client1',
      socket: {},
      subscriptions: new Set(),
      lastActivity: Date.now(),
      connectedAt: Date.now(),
    };

    await expect(middleware(message, client, next)).rejects.toThrow('Rate limit exceeded');
    expect(next).not.toHaveBeenCalled();
  });

  it('includes retry information in error', async () => {
    const middleware = rateLimiterMiddleware({
      maxTokens: 1,
      refillRate: 0.001,
    });
    const next = vi.fn().mockResolvedValue(undefined);

    const message: SyncMessage = {
      type: 'push',
      id: 'msg1',
      timestamp: Date.now(),
    };

    const client: ConnectedClient = {
      id: 'client1',
      socket: {},
      subscriptions: new Set(),
      lastActivity: Date.now(),
      connectedAt: Date.now(),
    };

    try {
      await middleware(message, client, next);
    } catch (error) {
      expect((error as { code: string }).code).toBe('RATE_LIMIT_EXCEEDED');
      expect((error as { retryAfter: number }).retryAfter).toBeDefined();
    }
  });
});
