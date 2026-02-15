import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeploymentManager } from '../deployment-manager.js';
import { createDeploymentManager } from '../deployment-manager.js';
import type { EdgeHealthMonitor } from '../health-monitor.js';
import { createEdgeHealthMonitor } from '../health-monitor.js';

describe('DeploymentManager', () => {
  let manager: DeploymentManager;

  beforeEach(() => {
    manager = createDeploymentManager({
      provider: 'cloudflare',
      projectName: 'my-app',
    });
  });

  describe('validateConfig', () => {
    it('should validate a correct config', () => {
      const result = manager.validateConfig();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return error for empty projectName', () => {
      const m = createDeploymentManager({ provider: 'cloudflare', projectName: '' });
      const result = m.validateConfig();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return error for invalid region', () => {
      const m = createDeploymentManager({
        provider: 'cloudflare',
        projectName: 'app',
        region: 'invalid-region',
      });
      const result = m.validateConfig();
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('invalid-region'));
    });

    it('should warn for bun provider', () => {
      const m = createDeploymentManager({ provider: 'bun', projectName: 'app' });
      const result = m.validateConfig();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should warn for non-standard projectName', () => {
      const m = createDeploymentManager({ provider: 'deno', projectName: 'MyApp' });
      const result = m.validateConfig();
      expect(result.warnings).toContainEqual(expect.stringContaining('lowercase'));
    });
  });

  describe('generateConfig', () => {
    it('should generate config for cloudflare', () => {
      const config = manager.generateConfig();
      expect(config.provider).toBe('cloudflare');
      expect(config.region).toBe('auto');
      expect(config.environment['POCKET_PROVIDER']).toBe('cloudflare');
      expect(config.environment['POCKET_KV_NAMESPACE']).toBeDefined();
      expect(config.syncServerConfig['durableObjects']).toBe(true);
    });

    it('should generate config for vercel', () => {
      const m = createDeploymentManager({ provider: 'vercel', projectName: 'app' });
      const config = m.generateConfig();
      expect(config.provider).toBe('vercel');
      expect(config.environment['KV_REST_API_URL']).toBeDefined();
    });

    it('should generate config for deno', () => {
      const m = createDeploymentManager({ provider: 'deno', projectName: 'app' });
      const config = m.generateConfig();
      expect(config.provider).toBe('deno');
      expect(config.region).toBe('auto');
    });

    it('should generate config for bun', () => {
      const m = createDeploymentManager({ provider: 'bun', projectName: 'app' });
      const config = m.generateConfig();
      expect(config.provider).toBe('bun');
      expect(config.syncServerConfig['sqliteFilename']).toBe('app.db');
    });

    it('should use specified region', () => {
      const m = createDeploymentManager({
        provider: 'cloudflare',
        projectName: 'app',
        region: 'enam',
      });
      const config = m.generateConfig();
      expect(config.region).toBe('enam');
    });
  });

  describe('getProviderInfo', () => {
    it('should return provider info for cloudflare', () => {
      const info = manager.getProviderInfo();
      expect(info.name).toBe('Cloudflare Workers');
      expect(info.supportedFeatures.length).toBeGreaterThan(0);
      expect(info.regions.length).toBeGreaterThan(0);
      expect(info.limitations.length).toBeGreaterThan(0);
    });

    it('should return different info per provider', () => {
      const denoManager = createDeploymentManager({ provider: 'deno', projectName: 'app' });
      const denoInfo = denoManager.getProviderInfo();
      const cfInfo = manager.getProviderInfo();
      expect(denoInfo.name).not.toBe(cfInfo.name);
    });
  });

  describe('estimateResources', () => {
    it('should estimate free tier for small counts', () => {
      const estimate = manager.estimateResources(100);
      expect(estimate.tier).toBe('free');
      expect(estimate.estimatedStorageMB).toBeGreaterThanOrEqual(0);
      expect(estimate.estimatedBandwidthMB).toBeGreaterThan(0);
    });

    it('should estimate starter tier for medium counts', () => {
      const estimate = manager.estimateResources(10_000);
      expect(estimate.tier).toBe('starter');
    });

    it('should estimate pro tier for larger counts', () => {
      const estimate = manager.estimateResources(500_000);
      expect(estimate.tier).toBe('pro');
    });

    it('should estimate enterprise tier for very large counts', () => {
      const estimate = manager.estimateResources(5_000_000);
      expect(estimate.tier).toBe('enterprise');
    });
  });
});

describe('EdgeHealthMonitor', () => {
  let monitor: EdgeHealthMonitor;

  beforeEach(() => {
    monitor = createEdgeHealthMonitor({
      healthyThresholdMs: 200,
      unhealthyAfterFailures: 3,
    });
  });

  afterEach(() => {
    monitor.destroy();
  });

  describe('recordCheck', () => {
    it('should record a successful check', () => {
      monitor.recordCheck('https://api.example.com', 50, true);
      const health = monitor.getEndpointHealth('https://api.example.com');
      expect(health).not.toBeNull();
      expect(health!.status).toBe('healthy');
      expect(health!.avgLatencyMs).toBe(50);
      expect(health!.successRate).toBe(1);
      expect(health!.totalChecks).toBe(1);
    });

    it('should track consecutive failures', () => {
      monitor.recordCheck('https://api.example.com', 50, false);
      monitor.recordCheck('https://api.example.com', 50, false);
      const health = monitor.getEndpointHealth('https://api.example.com');
      expect(health!.consecutiveFailures).toBe(2);
      expect(health!.status).toBe('degraded');
    });

    it('should reset consecutive failures on success', () => {
      monitor.recordCheck('https://api.example.com', 50, false);
      monitor.recordCheck('https://api.example.com', 50, false);
      monitor.recordCheck('https://api.example.com', 50, true);
      const health = monitor.getEndpointHealth('https://api.example.com');
      expect(health!.consecutiveFailures).toBe(0);
    });

    it('should mark unhealthy after threshold failures', () => {
      monitor.recordCheck('https://api.example.com', 50, false);
      monitor.recordCheck('https://api.example.com', 50, false);
      monitor.recordCheck('https://api.example.com', 50, false);
      const health = monitor.getEndpointHealth('https://api.example.com');
      expect(health!.status).toBe('unhealthy');
    });

    it('should mark degraded for high latency', () => {
      monitor.recordCheck('https://api.example.com', 500, true);
      const health = monitor.getEndpointHealth('https://api.example.com');
      expect(health!.status).toBe('degraded');
    });
  });

  describe('getEndpointHealth', () => {
    it('should return null for unknown endpoint', () => {
      const health = monitor.getEndpointHealth('https://unknown.com');
      expect(health).toBeNull();
    });
  });

  describe('getAllEndpoints', () => {
    it('should return all tracked endpoints', () => {
      monitor.recordCheck('https://api1.example.com', 50, true);
      monitor.recordCheck('https://api2.example.com', 100, true);
      const all = monitor.getAllEndpoints();
      expect(all).toHaveLength(2);
    });

    it('should return empty array when no endpoints', () => {
      expect(monitor.getAllEndpoints()).toHaveLength(0);
    });
  });

  describe('getOverallHealth', () => {
    it('should return healthy when no endpoints', () => {
      expect(monitor.getOverallHealth()).toBe('healthy');
    });

    it('should return healthy when all healthy', () => {
      monitor.recordCheck('https://api1.example.com', 50, true);
      monitor.recordCheck('https://api2.example.com', 50, true);
      expect(monitor.getOverallHealth()).toBe('healthy');
    });

    it('should return degraded when one is degraded', () => {
      monitor.recordCheck('https://api1.example.com', 50, true);
      monitor.recordCheck('https://api2.example.com', 500, true);
      expect(monitor.getOverallHealth()).toBe('degraded');
    });

    it('should return unhealthy when one is unhealthy', () => {
      monitor.recordCheck('https://api1.example.com', 50, true);
      monitor.recordCheck('https://api2.example.com', 50, false);
      monitor.recordCheck('https://api2.example.com', 50, false);
      monitor.recordCheck('https://api2.example.com', 50, false);
      expect(monitor.getOverallHealth()).toBe('unhealthy');
    });
  });

  describe('health$', () => {
    it('should emit health updates on recordCheck', () => {
      const emissions: unknown[] = [];
      const sub = monitor.health$.subscribe((val) => emissions.push(val));

      monitor.recordCheck('https://api.example.com', 50, true);
      monitor.recordCheck('https://api.example.com', 100, true);

      // BehaviorSubject emits initial value + 2 recordCheck updates
      expect(emissions.length).toBe(3);
      sub.unsubscribe();
    });
  });

  describe('destroy', () => {
    it('should complete the observable', () => {
      let completed = false;
      monitor.health$.subscribe({
        complete: () => {
          completed = true;
        },
      });
      monitor.destroy();
      expect(completed).toBe(true);
    });
  });

  describe('default config', () => {
    it('should work with default config', () => {
      const m = createEdgeHealthMonitor();
      m.recordCheck('https://api.example.com', 50, true);
      expect(m.getEndpointHealth('https://api.example.com')!.status).toBe('healthy');
      m.destroy();
    });
  });
});
