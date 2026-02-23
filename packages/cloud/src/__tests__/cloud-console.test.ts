import { describe, expect, it } from 'vitest';
import { CloudConsole } from '../cloud-console.js';

describe('CloudConsole', () => {
  it('should create tenants', () => {
    const console = new CloudConsole();
    const tenant = console.createTenant('Acme Corp', 'pro');
    expect(tenant.name).toBe('Acme Corp');
    expect(tenant.plan).toBe('pro');
    expect(tenant.status).toBe('active');
    console.destroy();
  });

  it('should create and revoke API keys', () => {
    const c = new CloudConsole();
    const tenant = c.createTenant('Test');
    const key = c.createApiKey(tenant.id, 'Production Key', 'live');
    expect(key.key).toContain('pk_live_');
    expect(key.active).toBe(true);

    c.revokeApiKey(tenant.id, key.id);
    expect(tenant.apiKeys.find((k) => k.id === key.id)!.active).toBe(false);
    c.destroy();
  });

  it('should track usage and detect free tier limits', () => {
    const c = new CloudConsole({ freeTierDocLimit: 100 });
    const tenant = c.createTenant('Free Tier');

    const events: string[] = [];
    c.events$.subscribe((e) => events.push(e.type));

    c.recordUsage(tenant.id, 'documents', 101);
    expect(events).toContain('usage:exceeded');
    c.destroy();
  });

  it('should suspend tenants', () => {
    const c = new CloudConsole();
    const tenant = c.createTenant('Bad Actor');
    c.suspendTenant(tenant.id, 'Abuse');
    expect(c.getTenant(tenant.id)!.status).toBe('suspended');
    c.destroy();
  });

  it('should upgrade plans', () => {
    const c = new CloudConsole();
    const tenant = c.createTenant('Startup');
    expect(tenant.plan).toBe('free');
    c.upgradePlan(tenant.id, 'enterprise');
    expect(c.getTenant(tenant.id)!.plan).toBe('enterprise');
    c.destroy();
  });

  it('should enforce max tenant limit', () => {
    const c = new CloudConsole({ maxTenantsPerAccount: 2 });
    c.createTenant('A');
    c.createTenant('B');
    expect(() => c.createTenant('C')).toThrow('Max tenants');
    c.destroy();
  });

  it('should report console statistics', () => {
    const c = new CloudConsole();
    c.createTenant('A');
    c.createTenant('B');
    c.createApiKey(c.listTenants()[0]!.id, 'key1');
    c.recordUsage(c.listTenants()[0]!.id, 'documents', 50);

    const stats = c.getStats();
    expect(stats.totalTenants).toBe(2);
    expect(stats.activeTenants).toBe(2);
    expect(stats.totalApiKeys).toBe(1);
    expect(stats.totalDocuments).toBe(50);
    c.destroy();
  });
});
