import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ManagedRelay,
  createManagedRelay,
  type ManagedRelayConfig,
  type RelayEvent,
} from '../managed-relay.js';

const BASE_CONFIG: ManagedRelayConfig = { port: 8080 };

describe('ManagedRelay', () => {
  let relay: ManagedRelay;

  beforeEach(() => {
    relay = createManagedRelay(BASE_CONFIG);
  });

  afterEach(() => {
    relay.destroy();
  });

  describe('lifecycle', () => {
    it('should start and stop', async () => {
      await relay.start();
      const metrics = relay.getMetrics();
      expect(metrics.status).toBe('running');
      await relay.stop();
      expect(relay.getMetrics().status).toBe('stopped');
    });

    it('should be idempotent on double start', async () => {
      await relay.start();
      await relay.start();
      expect(relay.getMetrics().status).toBe('running');
    });

    it('should be idempotent on double stop', async () => {
      await relay.stop();
      expect(relay.getMetrics().status).toBe('stopped');
    });
  });

  describe('tenant management', () => {
    it('should register and remove tenants', () => {
      relay.registerTenant('t1', 'free');
      expect(relay.getTenantIds()).toContain('t1');
      relay.removeTenant('t1');
      expect(relay.getTenantIds()).not.toContain('t1');
    });

    it('should ignore duplicate registration', () => {
      relay.registerTenant('t1', 'free');
      relay.registerTenant('t1', 'pro');
      expect(relay.getTenantMetrics('t1')?.tier).toBe('free');
    });

    it('should return null metrics for unknown tenant', () => {
      expect(relay.getTenantMetrics('unknown')).toBeNull();
    });
  });

  describe('client connections', () => {
    beforeEach(() => {
      relay.registerTenant('t1', 'free');
    });

    it('should connect a client and return connection ID', () => {
      const connId = relay.connectClient('t1');
      expect(connId).toBeTruthy();
      expect(connId!.startsWith('conn_')).toBe(true);
      expect(relay.getTenantMetrics('t1')?.activeConnections).toBe(1);
    });

    it('should reject connections for unknown tenant', () => {
      expect(relay.connectClient('unknown')).toBeNull();
    });

    it('should enforce tier connection limits', () => {
      const r = createManagedRelay({ port: 9090, maxConnectionsPerTenant: 2 });
      r.registerTenant('t1', 'free');
      // free tier default is 10, but we set maxConnectionsPerTenant to 2
      // The tierLimits default is { free: 10 }, but maxConnectionsPerTenant is separate
      // Actually tierLimits controls per-tier limits: free=10 default
      const conns: string[] = [];
      for (let i = 0; i < 10; i++) {
        const c = r.connectClient('t1');
        if (c) conns.push(c);
      }
      expect(conns.length).toBe(10); // free tier limit
      expect(r.connectClient('t1')).toBeNull(); // 11th blocked
      r.destroy();
    });

    it('should disconnect a client', () => {
      const connId = relay.connectClient('t1')!;
      relay.disconnectClient('t1', connId);
      expect(relay.getTenantMetrics('t1')?.activeConnections).toBe(0);
    });

    it('should list connections for a tenant', () => {
      relay.connectClient('t1');
      relay.connectClient('t1');
      const conns = relay.getConnections('t1');
      expect(conns).toHaveLength(2);
      expect(conns[0]!.tenantId).toBe('t1');
    });

    it('should return empty connections for unknown tenant', () => {
      expect(relay.getConnections('unknown')).toHaveLength(0);
    });
  });

  describe('message relay', () => {
    it('should relay messages and track metrics', () => {
      relay.registerTenant('t1', 'free');
      const conn1 = relay.connectClient('t1')!;
      relay.connectClient('t1');

      const success = relay.relayMessage('t1', conn1, '{"op":"insert"}');
      expect(success).toBe(true);

      const metrics = relay.getTenantMetrics('t1')!;
      expect(metrics.messagesRelayed).toBe(1);
      expect(metrics.bytesRelayed).toBeGreaterThan(0);
    });

    it('should fail for unknown tenant or connection', () => {
      expect(relay.relayMessage('unknown', 'c1', 'test')).toBe(false);
      relay.registerTenant('t1', 'free');
      expect(relay.relayMessage('t1', 'unknown', 'test')).toBe(false);
    });

    it('should buffer messages for offline targets', () => {
      relay.registerTenant('t1', 'free');
      const conn1 = relay.connectClient('t1')!;
      relay.relayMessage('t1', conn1, '{"data":"buffered"}', 'offline-conn');
      const metrics = relay.getTenantMetrics('t1')!;
      expect(metrics.bufferedMessages).toBe(1);
    });
  });

  describe('events', () => {
    it('should emit events for connect/disconnect', async () => {
      await relay.start();
      const events: RelayEvent[] = [];
      relay.events.subscribe((e) => events.push(e));

      relay.registerTenant('t1', 'free');
      const connId = relay.connectClient('t1')!;
      relay.disconnectClient('t1', connId);

      expect(events.some((e) => e.type === 'client-connected')).toBe(true);
      expect(events.some((e) => e.type === 'client-disconnected')).toBe(true);
    });
  });

  describe('aggregate metrics', () => {
    it('should compute aggregate metrics correctly', () => {
      relay.registerTenant('t1', 'free');
      relay.registerTenant('t2', 'pro');
      relay.connectClient('t1');
      relay.connectClient('t2');
      relay.connectClient('t2');

      const metrics = relay.getMetrics();
      expect(metrics.totalTenants).toBe(2);
      expect(metrics.totalConnections).toBe(3);
    });
  });
});
