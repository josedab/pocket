/**
 * Tenant quota enforcement for the managed relay.
 *
 * Wraps ManagedRelay with per-tenant rate limiting, bandwidth quotas,
 * and connection limit enforcement based on cloud tier.
 *
 * @module tenant-quota
 */

import type { CloudTier } from './types.js';

/** Quota configuration per tier */
export interface TierQuota {
  /** Max operations per minute */
  readonly opsPerMinute: number;
  /** Max bandwidth per minute in bytes */
  readonly bandwidthPerMinute: number;
  /** Max concurrent connections */
  readonly maxConnections: number;
  /** Max message size in bytes */
  readonly maxMessageSize: number;
}

/** Quota check result */
export interface QuotaCheckResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly remaining?: number;
  readonly resetsAt?: number;
}

/** Per-tenant quota tracker state */
export interface TenantQuotaState {
  readonly tenantId: string;
  readonly tier: CloudTier;
  readonly opsThisMinute: number;
  readonly bytesThisMinute: number;
  readonly activeConnections: number;
  readonly windowStart: number;
  readonly isThrottled: boolean;
}

/** Default quotas per tier */
export const DEFAULT_TIER_QUOTAS: Record<CloudTier, TierQuota> = {
  free: {
    opsPerMinute: 100,
    bandwidthPerMinute: 1_000_000,    // 1MB/min
    maxConnections: 10,
    maxMessageSize: 64_000,           // 64KB
  },
  pro: {
    opsPerMinute: 10_000,
    bandwidthPerMinute: 100_000_000,  // 100MB/min
    maxConnections: 100,
    maxMessageSize: 1_000_000,        // 1MB
  },
  enterprise: {
    opsPerMinute: 1_000_000,
    bandwidthPerMinute: 10_000_000_000, // 10GB/min
    maxConnections: 10_000,
    maxMessageSize: 16_000_000,       // 16MB
  },
};

/**
 * Per-tenant quota tracker with sliding window rate limiting.
 *
 * @example
 * ```typescript
 * import { TenantQuotaTracker } from '@pocket/cloud';
 *
 * const tracker = new TenantQuotaTracker();
 * tracker.registerTenant('t1', 'free');
 *
 * const check = tracker.checkOp('t1', 1024);
 * if (!check.allowed) {
 *   console.log('Rate limited:', check.reason);
 * }
 * ```
 */
export class TenantQuotaTracker {
  private readonly quotas: Record<CloudTier, TierQuota>;
  private readonly tenants = new Map<string, TenantWindow>();

  constructor(customQuotas?: Partial<Record<CloudTier, Partial<TierQuota>>>) {
    this.quotas = {
      free: { ...DEFAULT_TIER_QUOTAS.free, ...customQuotas?.free },
      pro: { ...DEFAULT_TIER_QUOTAS.pro, ...customQuotas?.pro },
      enterprise: { ...DEFAULT_TIER_QUOTAS.enterprise, ...customQuotas?.enterprise },
    };
  }

  /** Register a tenant for quota tracking */
  registerTenant(tenantId: string, tier: CloudTier): void {
    if (!this.tenants.has(tenantId)) {
      this.tenants.set(tenantId, {
        tenantId,
        tier,
        ops: 0,
        bytes: 0,
        connections: 0,
        windowStart: Date.now(),
      });
    }
  }

  /** Remove a tenant from tracking */
  removeTenant(tenantId: string): void {
    this.tenants.delete(tenantId);
  }

  /** Check if an operation is allowed and record it */
  checkOp(tenantId: string, messageBytes: number): QuotaCheckResult {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return { allowed: false, reason: 'Unknown tenant' };

    this.maybeResetWindow(tenant);
    const quota = this.quotas[tenant.tier];

    // Check message size
    if (messageBytes > quota.maxMessageSize) {
      return {
        allowed: false,
        reason: `Message size ${messageBytes} exceeds limit ${quota.maxMessageSize}`,
      };
    }

    // Check ops rate
    if (tenant.ops >= quota.opsPerMinute) {
      return {
        allowed: false,
        reason: 'Operations per minute quota exceeded',
        remaining: 0,
        resetsAt: tenant.windowStart + 60_000,
      };
    }

    // Check bandwidth
    if (tenant.bytes + messageBytes > quota.bandwidthPerMinute) {
      return {
        allowed: false,
        reason: 'Bandwidth per minute quota exceeded',
        remaining: quota.bandwidthPerMinute - tenant.bytes,
        resetsAt: tenant.windowStart + 60_000,
      };
    }

    // Record the operation
    tenant.ops++;
    tenant.bytes += messageBytes;

    return {
      allowed: true,
      remaining: quota.opsPerMinute - tenant.ops,
    };
  }

  /** Check if a connection is allowed */
  checkConnection(tenantId: string): QuotaCheckResult {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return { allowed: false, reason: 'Unknown tenant' };

    const quota = this.quotas[tenant.tier];
    if (tenant.connections >= quota.maxConnections) {
      return {
        allowed: false,
        reason: `Connection limit ${quota.maxConnections} reached`,
        remaining: 0,
      };
    }

    tenant.connections++;
    return { allowed: true, remaining: quota.maxConnections - tenant.connections };
  }

  /** Record a disconnection */
  recordDisconnect(tenantId: string): void {
    const tenant = this.tenants.get(tenantId);
    if (tenant && tenant.connections > 0) {
      tenant.connections--;
    }
  }

  /** Get current quota state for a tenant */
  getState(tenantId: string): TenantQuotaState | null {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;
    this.maybeResetWindow(tenant);
    const quota = this.quotas[tenant.tier];
    return {
      tenantId: tenant.tenantId,
      tier: tenant.tier,
      opsThisMinute: tenant.ops,
      bytesThisMinute: tenant.bytes,
      activeConnections: tenant.connections,
      windowStart: tenant.windowStart,
      isThrottled: tenant.ops >= quota.opsPerMinute || tenant.bytes >= quota.bandwidthPerMinute,
    };
  }

  private maybeResetWindow(tenant: TenantWindow): void {
    const now = Date.now();
    if (now - tenant.windowStart >= 60_000) {
      tenant.ops = 0;
      tenant.bytes = 0;
      tenant.windowStart = now;
    }
  }
}

interface TenantWindow {
  tenantId: string;
  tier: CloudTier;
  ops: number;
  bytes: number;
  connections: number;
  windowStart: number;
}

/** Factory function */
export function createTenantQuotaTracker(
  customQuotas?: Partial<Record<CloudTier, Partial<TierQuota>>>,
): TenantQuotaTracker {
  return new TenantQuotaTracker(customQuotas);
}
