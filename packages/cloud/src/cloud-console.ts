/**
 * CloudConsole — Multi-tenant admin console backend engine.
 *
 * Manages tenants, API keys, usage metrics, and sync status
 * for the Pocket Cloud managed service.
 */

import { Subject, type Observable } from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export interface ConsoleConfig {
  maxTenantsPerAccount?: number;
  freeTierDocLimit?: number;
  freeTierSyncLimit?: number;
}

export interface Tenant {
  id: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  apiKeys: ApiKey[];
  createdAt: number;
  usage: TenantUsage;
  status: 'active' | 'suspended' | 'deleted';
}

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  environment: 'test' | 'live';
  active: boolean;
}

export interface TenantUsage {
  documentsStored: number;
  syncOperations: number;
  bandwidthBytes: number;
  lastActivityAt: number | null;
  periodStart: number;
}

export interface ConsoleStats {
  totalTenants: number;
  activeTenants: number;
  totalApiKeys: number;
  totalDocuments: number;
  totalSyncOps: number;
}

export type ConsoleEvent =
  | { type: 'tenant:created'; tenantId: string }
  | { type: 'tenant:suspended'; tenantId: string; reason: string }
  | { type: 'apikey:created'; tenantId: string; keyId: string }
  | { type: 'apikey:revoked'; tenantId: string; keyId: string }
  | { type: 'usage:exceeded'; tenantId: string; metric: string };

// ── Implementation ────────────────────────────────────────

export class CloudConsole {
  private readonly config: Required<ConsoleConfig>;
  private readonly tenants = new Map<string, Tenant>();
  private readonly eventsSubject = new Subject<ConsoleEvent>();
  private tenantCounter = 0;
  private keyCounter = 0;

  readonly events$: Observable<ConsoleEvent> = this.eventsSubject.asObservable();

  constructor(config: ConsoleConfig = {}) {
    this.config = {
      maxTenantsPerAccount: config.maxTenantsPerAccount ?? 10,
      freeTierDocLimit: config.freeTierDocLimit ?? 10000,
      freeTierSyncLimit: config.freeTierSyncLimit ?? 100000,
    };
  }

  /**
   * Create a new tenant.
   */
  createTenant(name: string, plan: 'free' | 'pro' | 'enterprise' = 'free'): Tenant {
    if (this.tenants.size >= this.config.maxTenantsPerAccount) {
      throw new Error(`Max tenants (${this.config.maxTenantsPerAccount}) reached`);
    }

    const tenant: Tenant = {
      id: `tenant_${++this.tenantCounter}`,
      name,
      plan,
      apiKeys: [],
      createdAt: Date.now(),
      usage: {
        documentsStored: 0,
        syncOperations: 0,
        bandwidthBytes: 0,
        lastActivityAt: null,
        periodStart: Date.now(),
      },
      status: 'active',
    };

    this.tenants.set(tenant.id, tenant);
    this.eventsSubject.next({ type: 'tenant:created', tenantId: tenant.id });
    return tenant;
  }

  /**
   * Get a tenant by ID.
   */
  getTenant(id: string): Tenant | undefined {
    return this.tenants.get(id);
  }

  /**
   * List all tenants.
   */
  listTenants(): Tenant[] {
    return [...this.tenants.values()];
  }

  /**
   * Suspend a tenant.
   */
  suspendTenant(id: string, reason: string): boolean {
    const tenant = this.tenants.get(id);
    if (!tenant) return false;
    tenant.status = 'suspended';
    this.eventsSubject.next({ type: 'tenant:suspended', tenantId: id, reason });
    return true;
  }

  /**
   * Create an API key for a tenant.
   */
  createApiKey(tenantId: string, name: string, env: 'test' | 'live' = 'live'): ApiKey {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant "${tenantId}" not found`);

    const key: ApiKey = {
      id: `key_${++this.keyCounter}`,
      key: `pk_${env}_${this.randomString(24)}`,
      name,
      createdAt: Date.now(),
      lastUsedAt: null,
      environment: env,
      active: true,
    };

    tenant.apiKeys.push(key);
    this.eventsSubject.next({ type: 'apikey:created', tenantId, keyId: key.id });
    return key;
  }

  /**
   * Revoke an API key.
   */
  revokeApiKey(tenantId: string, keyId: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    const key = tenant.apiKeys.find((k) => k.id === keyId);
    if (!key) return false;

    key.active = false;
    this.eventsSubject.next({ type: 'apikey:revoked', tenantId, keyId });
    return true;
  }

  /**
   * Record usage for a tenant.
   */
  recordUsage(tenantId: string, metric: 'documents' | 'sync' | 'bandwidth', amount: number): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return;

    tenant.usage.lastActivityAt = Date.now();
    switch (metric) {
      case 'documents':
        tenant.usage.documentsStored += amount;
        break;
      case 'sync':
        tenant.usage.syncOperations += amount;
        break;
      case 'bandwidth':
        tenant.usage.bandwidthBytes += amount;
        break;
    }

    // Check limits for free tier
    if (tenant.plan === 'free') {
      if (tenant.usage.documentsStored > this.config.freeTierDocLimit) {
        this.eventsSubject.next({ type: 'usage:exceeded', tenantId, metric: 'documents' });
      }
      if (tenant.usage.syncOperations > this.config.freeTierSyncLimit) {
        this.eventsSubject.next({ type: 'usage:exceeded', tenantId, metric: 'sync' });
      }
    }
  }

  /**
   * Upgrade a tenant's plan.
   */
  upgradePlan(tenantId: string, plan: 'pro' | 'enterprise'): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    tenant.plan = plan;
    return true;
  }

  /**
   * Get console-wide statistics.
   */
  getStats(): ConsoleStats {
    let totalKeys = 0;
    let totalDocs = 0;
    let totalSync = 0;
    let active = 0;

    for (const tenant of this.tenants.values()) {
      totalKeys += tenant.apiKeys.length;
      totalDocs += tenant.usage.documentsStored;
      totalSync += tenant.usage.syncOperations;
      if (tenant.status === 'active') active++;
    }

    return {
      totalTenants: this.tenants.size,
      activeTenants: active,
      totalApiKeys: totalKeys,
      totalDocuments: totalDocs,
      totalSyncOps: totalSync,
    };
  }

  destroy(): void {
    this.eventsSubject.complete();
  }

  private randomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)] ?? '';
    }
    return result;
  }
}

export function createCloudConsole(config?: ConsoleConfig): CloudConsole {
  return new CloudConsole(config);
}
