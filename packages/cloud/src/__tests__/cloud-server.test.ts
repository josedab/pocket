import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { CloudSyncServer, createCloudSyncServer } from '../cloud-server.js';
import type { CloudServerConfig, ServerStatus } from '../cloud-server.js';

describe('CloudSyncServer', () => {
  let server: CloudSyncServer;

  beforeEach(() => {
    server = new CloudSyncServer();
  });

  afterEach(() => {
    server.destroy();
  });

  describe('creation with defaults', () => {
    it('should create a server with default configuration', () => {
      const config = server.getConfig();
      expect(config.port).toBe(8080);
      expect(config.host).toBe('0.0.0.0');
      expect(config.auth.required).toBe(false);
      expect(config.corsOrigins).toEqual(['*']);
      expect(config.maxConnectionsPerTenant).toBe(50);
      expect(config.tier).toBe('free');
    });

    it('should create a server with custom configuration', () => {
      const custom = new CloudSyncServer({
        port: 3000,
        host: 'localhost',
        auth: { required: true, apiKeys: ['key1'] },
        corsOrigins: ['https://example.com'],
        maxConnectionsPerTenant: 10,
        tier: 'pro',
      });

      const config = custom.getConfig();
      expect(config.port).toBe(3000);
      expect(config.host).toBe('localhost');
      expect(config.auth.required).toBe(true);
      expect(config.auth.apiKeys).toEqual(['key1']);
      expect(config.corsOrigins).toEqual(['https://example.com']);
      expect(config.maxConnectionsPerTenant).toBe(10);
      expect(config.tier).toBe('pro');
      custom.destroy();
    });

    it('should create via factory function', () => {
      const s = createCloudSyncServer({ port: 9090 });
      expect(s).toBeInstanceOf(CloudSyncServer);
      expect(s.getConfig().port).toBe(9090);
      s.destroy();
    });

    it('should create via factory function with no args', () => {
      const s = createCloudSyncServer();
      expect(s).toBeInstanceOf(CloudSyncServer);
      expect(s.getConfig().port).toBe(8080);
      s.destroy();
    });
  });

  describe('tenant isolation', () => {
    it('should return unique namespaces per tenant', () => {
      const ns1 = server.getTenantNamespace('tenant-a');
      const ns2 = server.getTenantNamespace('tenant-b');
      expect(ns1).toBe('ns:tenant-a');
      expect(ns2).toBe('ns:tenant-b');
      expect(ns1).not.toBe(ns2);
    });

    it('should return consistent namespace for same tenant', () => {
      const ns1 = server.getTenantNamespace('tenant-a');
      const ns2 = server.getTenantNamespace('tenant-a');
      expect(ns1).toBe(ns2);
    });

    it('should isolate connections between tenants', () => {
      server.addConnection('tenant-a', 'conn-1');
      server.addConnection('tenant-a', 'conn-2');
      server.addConnection('tenant-b', 'conn-3');

      const metricsA = server.getTenantMetrics('tenant-a');
      const metricsB = server.getTenantMetrics('tenant-b');

      expect(metricsA.activeConnections).toBe(2);
      expect(metricsB.activeConnections).toBe(1);
    });

    it('should isolate bandwidth between tenants', () => {
      server.recordBandwidth('tenant-a', 1000, 500);
      server.recordBandwidth('tenant-b', 2000, 1000);

      const metricsA = server.getTenantMetrics('tenant-a');
      const metricsB = server.getTenantMetrics('tenant-b');

      expect(metricsA.bytesSent).toBe(1000);
      expect(metricsA.bytesReceived).toBe(500);
      expect(metricsB.bytesSent).toBe(2000);
      expect(metricsB.bytesReceived).toBe(1000);
    });
  });

  describe('connection tracking', () => {
    it('should track active connections per tenant', () => {
      server.addConnection('tenant-a', 'conn-1');
      server.addConnection('tenant-a', 'conn-2');

      const metrics = server.getTenantMetrics('tenant-a');
      expect(metrics.activeConnections).toBe(2);
    });

    it('should reject connections over the limit', () => {
      const limitedServer = new CloudSyncServer({ maxConnectionsPerTenant: 2 });

      expect(limitedServer.addConnection('tenant-a', 'conn-1')).toBe(true);
      expect(limitedServer.addConnection('tenant-a', 'conn-2')).toBe(true);
      expect(limitedServer.addConnection('tenant-a', 'conn-3')).toBe(false);

      expect(limitedServer.getTenantMetrics('tenant-a').activeConnections).toBe(2);
      limitedServer.destroy();
    });

    it('should remove connections', () => {
      server.addConnection('tenant-a', 'conn-1');
      server.addConnection('tenant-a', 'conn-2');

      const removed = server.removeConnection('tenant-a', 'conn-1');
      expect(removed).toBe(true);
      expect(server.getTenantMetrics('tenant-a').activeConnections).toBe(1);
    });

    it('should return false when removing non-existent connection', () => {
      expect(server.removeConnection('tenant-a', 'conn-999')).toBe(false);
    });

    it('should clean up tenant entry when last connection removed', () => {
      server.addConnection('tenant-a', 'conn-1');
      server.removeConnection('tenant-a', 'conn-1');

      expect(server.getTotalConnections()).toBe(0);
    });

    it('should track total connections across tenants', () => {
      server.addConnection('tenant-a', 'conn-1');
      server.addConnection('tenant-b', 'conn-2');
      server.addConnection('tenant-b', 'conn-3');

      expect(server.getTotalConnections()).toBe(3);
    });

    it('should record bandwidth per tenant', () => {
      server.recordBandwidth('tenant-a', 100, 50);
      server.recordBandwidth('tenant-a', 200, 100);

      const metrics = server.getTenantMetrics('tenant-a');
      expect(metrics.bytesSent).toBe(300);
      expect(metrics.bytesReceived).toBe(150);
    });

    it('should track timestamps for bandwidth', () => {
      server.recordBandwidth('tenant-a', 100, 50);

      const metrics = server.getTenantMetrics('tenant-a');
      expect(metrics.connectedSince).toBeTypeOf('number');
      expect(metrics.lastActivityAt).toBeTypeOf('number');
    });

    it('should return zero metrics for unknown tenant', () => {
      const metrics = server.getTenantMetrics('unknown');
      expect(metrics.activeConnections).toBe(0);
      expect(metrics.bytesSent).toBe(0);
      expect(metrics.bytesReceived).toBe(0);
      expect(metrics.connectedSince).toBeNull();
      expect(metrics.lastActivityAt).toBeNull();
    });

    it('should list all tenant metrics', () => {
      server.addConnection('tenant-a', 'conn-1');
      server.addConnection('tenant-b', 'conn-2');

      const allMetrics = server.getAllTenantMetrics();
      expect(allMetrics).toHaveLength(2);

      const ids = allMetrics.map((m) => m.tenantId);
      expect(ids).toContain('tenant-a');
      expect(ids).toContain('tenant-b');
    });
  });

  describe('health status', () => {
    it('should report unhealthy when stopped', () => {
      const health = server.handleHealthCheck();
      expect(health.healthy).toBe(false);
      expect(health.status).toBe('stopped');
      expect(health.uptimeMs).toBe(0);
      expect(health.totalConnections).toBe(0);
      expect(health.activeTenants).toBe(0);
      expect(health.checkedAt).toBeTypeOf('number');
    });

    it('should report healthy when running', async () => {
      await server.start();

      const health = server.handleHealthCheck();
      expect(health.healthy).toBe(true);
      expect(health.status).toBe('running');
      expect(health.uptimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should include connection counts in health check', async () => {
      await server.start();
      server.addConnection('tenant-a', 'conn-1');
      server.addConnection('tenant-b', 'conn-2');

      const health = server.handleHealthCheck();
      expect(health.totalConnections).toBe(2);
      expect(health.activeTenants).toBe(2);
    });
  });

  describe('API key validation', () => {
    it('should accept any key when auth is not required', async () => {
      const result = await server.validateApiKey('anything');
      expect(result).toBe(true);
    });

    it('should validate against static API key list', async () => {
      const authServer = new CloudSyncServer({
        auth: { required: true, apiKeys: ['valid-key'] },
      });

      expect(await authServer.validateApiKey('valid-key')).toBe(true);
      expect(await authServer.validateApiKey('invalid-key')).toBe(false);
      authServer.destroy();
    });

    it('should use custom validator when provided', async () => {
      const customValidator = vi.fn().mockResolvedValue(true);
      const authServer = new CloudSyncServer({
        auth: { required: true, validateKey: customValidator },
      });

      const result = await authServer.validateApiKey('my-key');
      expect(result).toBe(true);
      expect(customValidator).toHaveBeenCalledWith('my-key');
      authServer.destroy();
    });

    it('should reject all keys when auth required but no mechanism configured', async () => {
      const authServer = new CloudSyncServer({
        auth: { required: true },
      });

      expect(await authServer.validateApiKey('any-key')).toBe(false);
      authServer.destroy();
    });
  });

  describe('server start/stop lifecycle', () => {
    it('should start in stopped status', () => {
      expect(server.getStatus()).toBe('stopped');
    });

    it('should transition to running on start', async () => {
      await server.start();
      expect(server.getStatus()).toBe('running');
    });

    it('should transition to stopped on stop', async () => {
      await server.start();
      await server.stop();
      expect(server.getStatus()).toBe('stopped');
    });

    it('should be idempotent for start', async () => {
      await server.start();
      await server.start();
      expect(server.getStatus()).toBe('running');
    });

    it('should be idempotent for stop', async () => {
      await server.stop();
      expect(server.getStatus()).toBe('stopped');
    });

    it('should clear connections on stop', async () => {
      await server.start();
      server.addConnection('tenant-a', 'conn-1');
      expect(server.getTotalConnections()).toBe(1);

      await server.stop();
      expect(server.getTotalConnections()).toBe(0);
    });

    it('should emit status changes via observable', async () => {
      const statuses: ServerStatus[] = [];
      const sub = server.getStatus$().subscribe((s) => statuses.push(s));

      await server.start();
      await server.stop();

      sub.unsubscribe();

      expect(statuses).toContain('stopped');
      expect(statuses).toContain('starting');
      expect(statuses).toContain('running');
      expect(statuses).toContain('stopping');
    });

    it('should emit initial status via BehaviorSubject', async () => {
      const status = await firstValueFrom(server.getStatus$());
      expect(status).toBe('stopped');
    });
  });

  describe('destroy cleanup', () => {
    it('should complete all observables on destroy', () => {
      let completed = false;
      server.getStatus$().subscribe({
        complete: () => { completed = true; },
      });

      server.destroy();
      expect(completed).toBe(true);
    });

    it('should clear all tenant data on destroy', () => {
      server.addConnection('tenant-a', 'conn-1');
      server.recordBandwidth('tenant-a', 1000, 500);

      server.destroy();

      // After destroy, a new server check should have no data
      expect(server.getTotalConnections()).toBe(0);
      expect(server.getAllTenantMetrics()).toHaveLength(0);
    });

    it('should be safe to call destroy multiple times', () => {
      server.destroy();
      expect(() => server.destroy()).not.toThrow();
    });

    it('should stop the server if running when destroyed', async () => {
      await server.start();
      server.destroy();
      // Status$ is completed, but internal state should be cleaned
      expect(server.getTotalConnections()).toBe(0);
    });
  });
});
