import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter, TieredRateLimiter, TIER_RATE_LIMITS } from '../rate-limiter.js';
import { AuditLogger } from '../audit-logger.js';
import { RegionRouter } from '../region-router.js';

// ─── RateLimiter ────────────────────────────────────────────────────────────

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests within token limit', () => {
    const limiter = new RateLimiter({ maxTokens: 5, refillRate: 5, refillIntervalMs: 1000 });

    const r1 = limiter.consume();
    const r2 = limiter.consume();

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r1.retryAfterMs).toBe(0);

    limiter.destroy();
  });

  it('should deny requests when tokens exhausted', () => {
    const limiter = new RateLimiter({ maxTokens: 2, refillRate: 2, refillIntervalMs: 1000 });

    limiter.consume();
    limiter.consume();
    const denied = limiter.consume();

    expect(denied.allowed).toBe(false);
    expect(denied.remainingTokens).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);

    limiter.destroy();
  });

  it('should refill tokens after interval', () => {
    const limiter = new RateLimiter({ maxTokens: 2, refillRate: 2, refillIntervalMs: 1000 });

    limiter.consume();
    limiter.consume();
    expect(limiter.consume().allowed).toBe(false);

    vi.advanceTimersByTime(1000);

    const result = limiter.consume();
    expect(result.allowed).toBe(true);

    limiter.destroy();
  });

  it('should report remaining tokens correctly', () => {
    const limiter = new RateLimiter({ maxTokens: 10, refillRate: 10, refillIntervalMs: 1000 });

    expect(limiter.getStatus().availableTokens).toBe(10);

    limiter.consume(3);
    expect(limiter.getStatus().availableTokens).toBe(7);

    limiter.consume(7);
    expect(limiter.getStatus().availableTokens).toBe(0);

    limiter.destroy();
  });
});

describe('TieredRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should enforce tier-specific limits (free=100, pro=1000)', () => {
    const tiered = new TieredRateLimiter(TIER_RATE_LIMITS);

    const freeStatus = tiered.getStatus('free');
    const proStatus = tiered.getStatus('pro');

    expect(freeStatus?.maxTokens).toBe(100);
    expect(freeStatus?.availableTokens).toBe(100);

    expect(proStatus?.maxTokens).toBe(1000);
    expect(proStatus?.availableTokens).toBe(1000);

    // Exhaust free tier
    for (let i = 0; i < 100; i++) {
      tiered.consume('free');
    }
    expect(tiered.consume('free').allowed).toBe(false);

    // Pro tier should still have tokens
    expect(tiered.consume('pro').allowed).toBe(true);

    tiered.destroy();
  });
});

// ─── AuditLogger ────────────────────────────────────────────────────────────

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = new AuditLogger();
  });

  afterEach(() => {
    logger.destroy();
    vi.useRealTimers();
  });

  it('should log audit entries with auto-generated IDs', () => {
    const entry = logger.log({
      tenantId: 'tenant-a',
      action: 'data.write',
      resource: 'collection:todos',
      details: 'Created doc',
    });

    expect(entry.id).toBe('aud_1');
    expect(entry.timestamp).toBeTypeOf('number');
    expect(entry.tenantId).toBe('tenant-a');

    const entry2 = logger.log({
      tenantId: 'tenant-b',
      action: 'data.read',
      resource: 'collection:notes',
      details: 'Read doc',
    });

    expect(entry2.id).toBe('aud_2');
  });

  it('should query entries by tenantId filter', () => {
    logger.log({ tenantId: 'tenant-a', action: 'data.write', resource: 'r1', details: 'd1' });
    logger.log({ tenantId: 'tenant-b', action: 'data.read', resource: 'r2', details: 'd2' });
    logger.log({ tenantId: 'tenant-a', action: 'data.delete', resource: 'r3', details: 'd3' });

    const results = logger.query({ tenantId: 'tenant-a' });

    expect(results).toHaveLength(2);
    expect(results.every((e) => e.tenantId === 'tenant-a')).toBe(true);
  });

  it('should query entries by action filter', () => {
    logger.log({ tenantId: 't1', action: 'auth.login', resource: 'session', details: 'login' });
    logger.log({ tenantId: 't1', action: 'data.write', resource: 'r1', details: 'write' });
    logger.log({ tenantId: 't2', action: 'auth.login', resource: 'session', details: 'login' });

    const results = logger.query({ action: 'auth.login' });

    expect(results).toHaveLength(2);
    expect(results.every((e) => e.action === 'auth.login')).toBe(true);
  });

  it('should query entries by date range', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    logger.log({ tenantId: 't1', action: 'data.read', resource: 'r1', details: 'old' });

    vi.setSystemTime(new Date('2024-06-15T00:00:00Z'));
    logger.log({ tenantId: 't1', action: 'data.write', resource: 'r2', details: 'mid' });

    vi.setSystemTime(new Date('2024-12-31T00:00:00Z'));
    logger.log({ tenantId: 't1', action: 'data.delete', resource: 'r3', details: 'new' });

    const start = new Date('2024-06-01T00:00:00Z').getTime();
    const end = new Date('2024-07-01T00:00:00Z').getTime();

    const results = logger.query({ dateRange: { start, end } });

    expect(results).toHaveLength(1);
    expect(results[0]!.details).toBe('mid');
  });

  it('should export as JSON format', () => {
    logger.log({ tenantId: 't1', action: 'data.write', resource: 'r1', details: 'test' });

    const json = logger.export('json');
    const parsed = JSON.parse(json);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].tenantId).toBe('t1');
  });

  it('should export as CSV format', () => {
    logger.log({ tenantId: 't1', action: 'data.write', resource: 'r1', details: 'test', userId: 'u1' });

    const csv = logger.export('csv');
    const lines = csv.split('\n');

    expect(lines[0]).toBe('id,timestamp,tenantId,action,resource,details,userId,ipAddress');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('t1');
    expect(lines[1]).toContain('data.write');
    expect(lines[1]).toContain('u1');
  });

  it('should emit entries via observable stream', () => {
    const emitted: string[] = [];

    logger.getEntries$().subscribe((entry) => {
      emitted.push(entry.id);
    });

    logger.log({ tenantId: 't1', action: 'data.read', resource: 'r1', details: 'd1' });
    logger.log({ tenantId: 't2', action: 'data.write', resource: 'r2', details: 'd2' });

    expect(emitted).toEqual(['aud_1', 'aud_2']);
  });
});

// ─── RegionRouter ───────────────────────────────────────────────────────────

describe('RegionRouter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return best endpoint (lowest latency, healthy)', () => {
    const router = new RegionRouter({
      regions: [
        { region: 'us-east-1', url: 'https://us-east-1.example.com' },
        { region: 'eu-west-1', url: 'https://eu-west-1.example.com' },
      ],
    });

    // Manually set endpoint states via checkLatency stub
    // Instead of calling start(), directly test getBestEndpoint logic
    // by using the internal BehaviorSubject via getEndpoints + knowing initial state
    // All endpoints start healthy with Infinity latency, so simulate a check:
    vi.spyOn(router, 'checkLatency').mockImplementation(async (url: string) => {
      if (url.includes('us-east-1')) return 50;
      if (url.includes('eu-west-1')) return 120;
      return Infinity;
    });

    // Start triggers checkAllEndpoints
    const startPromise = router.start();
    vi.runAllTimersAsync().then(() => {});

    return startPromise.then(() => {
      const best = router.getBestEndpoint();
      expect(best).not.toBeNull();
      expect(best!.region).toBe('us-east-1');
      expect(best!.latencyMs).toBe(50);
      expect(best!.healthy).toBe(true);

      router.destroy();
    });
  });

  it('should skip unhealthy endpoints', () => {
    const router = new RegionRouter({
      regions: [
        { region: 'us-east-1', url: 'https://us-east-1.example.com' },
        { region: 'eu-west-1', url: 'https://eu-west-1.example.com' },
      ],
      latencyThresholdMs: 500,
    });

    // us-east-1 is fast but fails (Infinity), eu-west-1 is healthy
    vi.spyOn(router, 'checkLatency').mockImplementation(async (url: string) => {
      if (url.includes('us-east-1')) return Infinity; // unreachable
      if (url.includes('eu-west-1')) return 100;
      return Infinity;
    });

    const startPromise = router.start();
    vi.runAllTimersAsync().then(() => {});

    return startPromise.then(() => {
      const best = router.getBestEndpoint();
      expect(best).not.toBeNull();
      expect(best!.region).toBe('eu-west-1');
      expect(best!.healthy).toBe(true);

      router.destroy();
    });
  });

  it('should return specific region endpoint', () => {
    const router = new RegionRouter({
      regions: [
        { region: 'us-east-1', url: 'https://us-east-1.example.com' },
        { region: 'eu-west-1', url: 'https://eu-west-1.example.com' },
        { region: 'ap-southeast-1', url: 'https://ap-southeast-1.example.com' },
      ],
    });

    const ep = router.getEndpointForRegion('eu-west-1');
    expect(ep).not.toBeNull();
    expect(ep!.region).toBe('eu-west-1');
    expect(ep!.url).toBe('https://eu-west-1.example.com');

    const missing = router.getEndpointForRegion('ap-northeast-1');
    expect(missing).toBeNull();

    router.destroy();
  });

  it('should return all endpoints', () => {
    const router = new RegionRouter({
      regions: [
        { region: 'us-east-1', url: 'https://us-east-1.example.com' },
        { region: 'eu-west-1', url: 'https://eu-west-1.example.com' },
      ],
    });

    const endpoints = router.getEndpoints();
    expect(endpoints).toHaveLength(2);
    expect(endpoints.map((e) => e.region)).toEqual(['us-east-1', 'eu-west-1']);

    router.destroy();
  });
});
