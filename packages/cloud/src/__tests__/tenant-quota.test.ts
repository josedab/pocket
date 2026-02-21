import { describe, it, expect, beforeEach } from 'vitest';
import { TenantQuotaTracker, createTenantQuotaTracker, DEFAULT_TIER_QUOTAS } from '../tenant-quota.js';

describe('TenantQuotaTracker', () => {
  let tracker: TenantQuotaTracker;

  beforeEach(() => {
    tracker = createTenantQuotaTracker();
  });

  describe('tenant registration', () => {
    it('should register and track tenants', () => {
      tracker.registerTenant('t1', 'free');
      expect(tracker.getState('t1')).not.toBeNull();
      expect(tracker.getState('t1')!.tier).toBe('free');
    });

    it('should return null for unknown tenant', () => {
      expect(tracker.getState('unknown')).toBeNull();
    });

    it('should remove tenants', () => {
      tracker.registerTenant('t1', 'free');
      tracker.removeTenant('t1');
      expect(tracker.getState('t1')).toBeNull();
    });
  });

  describe('operation quotas', () => {
    it('should allow operations within quota', () => {
      tracker.registerTenant('t1', 'free');
      const result = tracker.checkOp('t1', 100);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });

    it('should block unknown tenants', () => {
      const result = tracker.checkOp('unknown', 100);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Unknown');
    });

    it('should reject oversized messages', () => {
      tracker.registerTenant('t1', 'free');
      const result = tracker.checkOp('t1', DEFAULT_TIER_QUOTAS.free.maxMessageSize + 1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('size');
    });

    it('should enforce ops-per-minute limit', () => {
      tracker.registerTenant('t1', 'free');
      const limit = DEFAULT_TIER_QUOTAS.free.opsPerMinute;
      for (let i = 0; i < limit; i++) {
        tracker.checkOp('t1', 10);
      }
      const result = tracker.checkOp('t1', 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Operations');
    });

    it('should decrement remaining count', () => {
      tracker.registerTenant('t1', 'free');
      const r1 = tracker.checkOp('t1', 10);
      const r2 = tracker.checkOp('t1', 10);
      expect(r2.remaining!).toBeLessThan(r1.remaining!);
    });
  });

  describe('connection quotas', () => {
    it('should allow connections within limit', () => {
      tracker.registerTenant('t1', 'free');
      const result = tracker.checkConnection('t1');
      expect(result.allowed).toBe(true);
    });

    it('should enforce connection limit', () => {
      tracker.registerTenant('t1', 'free');
      const limit = DEFAULT_TIER_QUOTAS.free.maxConnections;
      for (let i = 0; i < limit; i++) tracker.checkConnection('t1');
      const result = tracker.checkConnection('t1');
      expect(result.allowed).toBe(false);
    });

    it('should track disconnections', () => {
      tracker.registerTenant('t1', 'free');
      tracker.checkConnection('t1');
      tracker.recordDisconnect('t1');
      expect(tracker.getState('t1')!.activeConnections).toBe(0);
    });
  });

  describe('tier differences', () => {
    it('should give pro tier higher limits than free', () => {
      expect(DEFAULT_TIER_QUOTAS.pro.opsPerMinute).toBeGreaterThan(DEFAULT_TIER_QUOTAS.free.opsPerMinute);
      expect(DEFAULT_TIER_QUOTAS.pro.maxConnections).toBeGreaterThan(DEFAULT_TIER_QUOTAS.free.maxConnections);
    });

    it('should give enterprise higher limits than pro', () => {
      expect(DEFAULT_TIER_QUOTAS.enterprise.opsPerMinute).toBeGreaterThan(DEFAULT_TIER_QUOTAS.pro.opsPerMinute);
    });
  });

  describe('throttle state', () => {
    it('should report throttled when at limit', () => {
      tracker.registerTenant('t1', 'free');
      const limit = DEFAULT_TIER_QUOTAS.free.opsPerMinute;
      for (let i = 0; i < limit; i++) tracker.checkOp('t1', 10);
      expect(tracker.getState('t1')!.isThrottled).toBe(true);
    });

    it('should not report throttled under limit', () => {
      tracker.registerTenant('t1', 'free');
      tracker.checkOp('t1', 10);
      expect(tracker.getState('t1')!.isThrottled).toBe(false);
    });
  });
});
