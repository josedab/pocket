import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudProvisioner } from '../provisioner.js';
import { HealthMonitor, type HealthCheckResult } from '../health-monitor.js';
import type { CloudConfig, CloudEndpoint } from '../types.js';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const TEST_CONFIG: CloudConfig = {
  projectId: 'proj_test123',
  apiKey: 'pk_test_1234567890abcdef',
  region: 'us-east-1',
  tier: 'free',
};

const TEST_ENDPOINT: CloudEndpoint = {
  websocketUrl: 'wss://us-east-1.cloud.pocket-db.dev/sync/proj_test123',
  httpUrl: 'https://us-east-1.cloud.pocket-db.dev/sync/proj_test123',
  apiUrl: 'https://us-east-1.cloud.pocket-db.dev/v1',
  region: 'us-east-1',
};

describe('CloudProvisioner', () => {
  let provisioner: CloudProvisioner;

  beforeEach(() => {
    mockFetch.mockReset();
    provisioner = new CloudProvisioner(TEST_CONFIG);
  });

  describe('provision', () => {
    it('should provision a new project with keys and endpoint', async () => {
      const mockProject = {
        id: 'proj_new123',
        name: 'Test Project',
        tier: 'free' as const,
        region: 'us-east-1' as const,
        createdAt: Date.now(),
        lastSyncAt: null,
        active: true,
        maxOperationsPerMonth: 10_000,
        maxStorageBytes: 100 * 1024 * 1024,
      };

      const mockLiveKey = {
        id: 'key_live1',
        key: 'pk_live_newkey12345678',
        name: 'Test Project - Live',
        type: 'live' as const,
        permissions: ['sync:read', 'sync:write'],
        createdAt: Date.now(),
        lastUsedAt: null,
        expiresAt: null,
        active: true,
      };

      const mockTestKey = {
        id: 'key_test1',
        key: 'pk_test_newkey12345678',
        name: 'Test Project - Test',
        type: 'test' as const,
        permissions: ['sync:read', 'sync:write'],
        createdAt: Date.now(),
        lastUsedAt: null,
        expiresAt: null,
        active: true,
      };

      // Mock API calls in sequence
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockProject) }) // createProject
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockLiveKey) }) // createApiKey live
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockTestKey) }) // createApiKey test
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(TEST_ENDPOINT) }) // getEndpoint
        .mockResolvedValueOnce({ ok: true }); // health check

      const result = await provisioner.provision({
        name: 'Test Project',
        region: 'us-east-1',
      });

      expect(result.project.id).toBe('proj_new123');
      expect(result.project.name).toBe('Test Project');
      expect(result.keys.live).toBeDefined();
      expect(result.keys.test).toBeDefined();
      expect(result.keys.live!.type).toBe('live');
      expect(result.keys.test!.type).toBe('test');
      expect(result.endpoint).toBeDefined();
      expect(result.connectivity.checked).toBe(true);
      expect(result.config.projectId).toBe('proj_new123');
    });

    it('should skip key generation when generateKeys is false', async () => {
      const mockProject = {
        id: 'proj_nokeys',
        name: 'No Keys Project',
        tier: 'free' as const,
        region: 'us-east-1' as const,
        createdAt: Date.now(),
        lastSyncAt: null,
        active: true,
        maxOperationsPerMonth: 10_000,
        maxStorageBytes: 100 * 1024 * 1024,
      };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockProject) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(TEST_ENDPOINT) })
        .mockResolvedValueOnce({ ok: true });

      const result = await provisioner.provision({
        name: 'No Keys Project',
        generateKeys: false,
      });

      expect(result.keys.live).toBeUndefined();
      expect(result.keys.test).toBeUndefined();
    });
  });
});

describe('HealthMonitor', () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    monitor?.destroy();
    vi.useRealTimers();
  });

  it('should start with unknown status', () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    monitor = new HealthMonitor(TEST_ENDPOINT, { autoStart: false });
    expect(monitor.getCurrentStatus()).toBe('unknown');
  });

  it('should report healthy on successful check', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    monitor = new HealthMonitor(TEST_ENDPOINT, { autoStart: false });

    const result = await monitor.forceCheck();
    expect(result.healthy).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(monitor.getCurrentStatus()).toBe('healthy');
  });

  it('should track consecutive failures', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));
    monitor = new HealthMonitor(TEST_ENDPOINT, {
      autoStart: false,
      failureThreshold: 3,
    });

    await monitor.forceCheck();
    expect(monitor.getCurrentStatus()).toBe('degraded');

    await monitor.forceCheck();
    expect(monitor.getCurrentStatus()).toBe('degraded');

    await monitor.forceCheck();
    expect(monitor.getCurrentStatus()).toBe('unhealthy');
  });

  it('should reset failures on successful check', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });
    monitor = new HealthMonitor(TEST_ENDPOINT, { autoStart: false });

    await monitor.forceCheck();
    await monitor.forceCheck();
    await monitor.forceCheck();

    expect(monitor.getCurrentStatus()).toBe('healthy');
  });

  it('should provide accurate summary', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    monitor = new HealthMonitor(TEST_ENDPOINT, { autoStart: false });

    await monitor.forceCheck();
    await monitor.forceCheck();

    const summary = monitor.getSummary();
    expect(summary.totalChecks).toBe(2);
    expect(summary.totalFailures).toBe(1);
    expect(summary.uptimePercent).toBe(50);
  });
});
