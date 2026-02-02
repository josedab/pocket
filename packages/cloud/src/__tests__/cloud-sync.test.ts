import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { CloudClient } from '../cloud-client.js';
import { CloudSync } from '../cloud-sync.js';
import type { CloudSyncOptions, CloudEndpoint, ApiKeyValidation, CloudStats } from '../types.js';
import {
  API_KEY_LIVE_PREFIX,
  API_KEY_MIN_LENGTH,
  API_KEY_TEST_PREFIX,
  DEFAULT_CLOUD_REGION,
  REGION_ENDPOINTS,
  TIER_LIMITS,
} from '../types.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/**
 * Helper to create a mock Response object.
 */
function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    clone: () => mockResponse(body, status) as Response,
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

/**
 * Helper to generate a valid test API key.
 */
function makeApiKey(prefix: string = API_KEY_LIVE_PREFIX): string {
  return prefix + 'a'.repeat(API_KEY_MIN_LENGTH);
}

/**
 * Default mock endpoint response.
 */
const mockEndpoint: CloudEndpoint = {
  websocketUrl: 'wss://us-east-1.cloud.pocket-db.dev/sync/proj_test123',
  httpUrl: 'https://us-east-1.cloud.pocket-db.dev/sync/proj_test123',
  apiUrl: 'https://us-east-1.cloud.pocket-db.dev/v1',
  region: 'us-east-1',
};

/**
 * Default mock validation response.
 */
const mockValidation: ApiKeyValidation = {
  valid: true,
  projectId: 'proj_test123',
  keyType: 'live',
  permissions: ['sync:read', 'sync:write'],
  expiresAt: null,
};

/**
 * Default mock stats response.
 */
const mockStats: CloudStats = {
  syncOperations: 500,
  maxSyncOperations: 10000,
  syncQuotaUsedPercent: 5,
  storageUsedBytes: 1024 * 1024,
  maxStorageBytes: 100 * 1024 * 1024,
  storageQuotaUsedPercent: 1,
  activeConnections: 1,
  maxConnections: 5,
  lastUpdatedAt: Date.now(),
};

describe('CloudClient', () => {
  let client: CloudClient;
  const defaultConfig: CloudSyncOptions = {
    projectId: 'proj_test123',
    apiKey: makeApiKey(),
  };

  beforeEach(() => {
    mockFetch.mockReset();
    client = new CloudClient(defaultConfig);
  });

  afterEach(() => {
    client.destroy();
  });

  describe('constructor', () => {
    it('should create a client with default region endpoint', () => {
      const c = new CloudClient({
        projectId: 'proj_abc',
        apiKey: makeApiKey(),
      });
      expect(c.getBaseUrl()).toBe(REGION_ENDPOINTS[DEFAULT_CLOUD_REGION]);
      c.destroy();
    });

    it('should use custom endpoint when provided', () => {
      const c = new CloudClient({
        projectId: 'proj_abc',
        apiKey: makeApiKey(),
        endpoint: 'https://custom.example.com/',
      });
      expect(c.getBaseUrl()).toBe('https://custom.example.com');
      c.destroy();
    });

    it('should use region-specific endpoint', () => {
      const c = new CloudClient({
        projectId: 'proj_abc',
        apiKey: makeApiKey(),
        region: 'eu-west-1',
      });
      expect(c.getBaseUrl()).toBe(REGION_ENDPOINTS['eu-west-1']);
      c.destroy();
    });
  });

  describe('validateApiKey', () => {
    it('should reject keys that are too short', async () => {
      const c = new CloudClient({
        projectId: 'proj_abc',
        apiKey: 'short',
      });

      const result = await c.validateApiKey();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least');
      c.destroy();
    });

    it('should reject keys with invalid prefix', async () => {
      const c = new CloudClient({
        projectId: 'proj_abc',
        apiKey: 'xx_invalid_' + 'a'.repeat(20),
      });

      const result = await c.validateApiKey();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('pk_live_');
      c.destroy();
    });

    it('should accept valid live keys and call server validation', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockValidation));

      const result = await client.validateApiKey();
      expect(result.valid).toBe(true);
      expect(result.projectId).toBe('proj_test123');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should accept valid test keys', async () => {
      const c = new CloudClient({
        projectId: 'proj_abc',
        apiKey: makeApiKey(API_KEY_TEST_PREFIX),
      });

      mockFetch.mockResolvedValueOnce(mockResponse({
        valid: true,
        projectId: 'proj_abc',
        keyType: 'test',
        permissions: ['sync:read', 'sync:write'],
        expiresAt: null,
      }));

      const result = await c.validateApiKey();
      expect(result.valid).toBe(true);
      c.destroy();
    });

    it('should throw ConnectionError when server is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.validateApiKey()).rejects.toThrow('Failed to validate API key');
    });
  });

  describe('getProjectInfo', () => {
    it('should fetch project info and update status', async () => {
      const projectInfo = {
        id: 'proj_test123',
        name: 'Test Project',
        tier: 'free' as const,
        region: 'us-east-1' as const,
        createdAt: Date.now(),
        lastSyncAt: null,
        active: true,
        maxOperationsPerMonth: 10000,
        maxStorageBytes: 100 * 1024 * 1024,
      };

      mockFetch.mockResolvedValueOnce(mockResponse(projectInfo));

      const result = await client.getProjectInfo();

      expect(result.id).toBe('proj_test123');
      expect(result.name).toBe('Test Project');
      expect(result.tier).toBe('free');
      expect(client.getCurrentStatus()).toBe('connected');
    });

    it('should set error status on failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(client.getProjectInfo()).rejects.toThrow('Failed to fetch project info');
      expect(client.getCurrentStatus()).toBe('error');
    });
  });

  describe('getUsageStats', () => {
    it('should fetch usage stats', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockStats));

      const stats = await client.getUsageStats();

      expect(stats.syncOperations).toBe(500);
      expect(stats.maxSyncOperations).toBe(10000);
      expect(stats.syncQuotaUsedPercent).toBe(5);
    });

    it('should set quota-exceeded status when over limit', async () => {
      const overQuotaStats = {
        ...mockStats,
        syncQuotaUsedPercent: 100,
      };
      mockFetch.mockResolvedValueOnce(mockResponse(overQuotaStats));

      await client.getUsageStats();

      expect(client.getCurrentStatus()).toBe('quota-exceeded');
    });
  });

  describe('getEndpoint', () => {
    it('should fetch endpoint from server', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockEndpoint));

      const endpoint = await client.getEndpoint();

      expect(endpoint.websocketUrl).toContain('wss://');
      expect(endpoint.httpUrl).toContain('https://');
      expect(endpoint.region).toBe('us-east-1');
    });

    it('should fall back to constructed endpoint on failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Not found'));

      const endpoint = await client.getEndpoint();

      expect(endpoint.websocketUrl).toContain('wss://');
      expect(endpoint.websocketUrl).toContain('proj_test123');
      expect(endpoint.httpUrl).toContain('https://');
      expect(endpoint.region).toBe(DEFAULT_CLOUD_REGION);
    });
  });

  describe('getStatus', () => {
    it('should emit initial disconnected status', async () => {
      const status = await firstValueFrom(client.getStatus());
      expect(status).toBe('disconnected');
    });
  });
});

describe('CloudSync', () => {
  let cloudSync: CloudSync;
  let client: CloudClient;
  const defaultOptions: CloudSyncOptions = {
    projectId: 'proj_test123',
    apiKey: makeApiKey(),
    collections: ['todos'],
  };

  beforeEach(() => {
    mockFetch.mockReset();
    client = new CloudClient(defaultOptions);
    cloudSync = new CloudSync(defaultOptions, client);
  });

  afterEach(() => {
    cloudSync.destroy();
  });

  describe('initialize', () => {
    it('should validate API key and discover endpoint', async () => {
      // Mock validate API key
      mockFetch.mockResolvedValueOnce(mockResponse(mockValidation));
      // Mock get endpoint
      mockFetch.mockResolvedValueOnce(mockResponse(mockEndpoint));

      await cloudSync.initialize();

      expect(cloudSync.getEndpoint()).toBeDefined();
      expect(cloudSync.getEndpoint()!.websocketUrl).toContain('wss://');
    });

    it('should throw when API key is invalid', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        valid: false,
        error: 'Invalid key',
      }));

      await expect(cloudSync.initialize()).rejects.toThrow('Invalid API key');
    });

    it('should set error status on initialization failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(cloudSync.initialize()).rejects.toThrow();

      const status = await firstValueFrom(cloudSync.getCloudStatus());
      expect(status).toBe('error');
    });
  });

  describe('connect', () => {
    it('should throw if not initialized', () => {
      const mockDb = {} as any;
      expect(() => cloudSync.connect(mockDb)).toThrow('not initialized');
    });

    it('should create sync engine when initialized', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockValidation));
      mockFetch.mockResolvedValueOnce(mockResponse(mockEndpoint));

      await cloudSync.initialize();

      const mockDb = {
        nodeId: 'node-1',
        collection: vi.fn(),
        listCollections: vi.fn().mockResolvedValue([]),
      } as any;

      cloudSync.connect(mockDb);

      expect(cloudSync.getSyncEngine()).not.toBeNull();
    });
  });

  describe('start/stop', () => {
    it('should throw if not connected', async () => {
      await expect(cloudSync.start()).rejects.toThrow('not connected');
    });

    it('should be not running initially', () => {
      expect(cloudSync.getIsRunning()).toBe(false);
    });
  });

  describe('getSyncStatus', () => {
    it('should return offline when no sync engine', async () => {
      const status = await firstValueFrom(cloudSync.getSyncStatus());
      expect(status).toBe('offline');
    });
  });

  describe('getCloudStatus', () => {
    it('should emit initial disconnected status', async () => {
      const status = await firstValueFrom(cloudSync.getCloudStatus());
      expect(status).toBe('disconnected');
    });

    it('should emit connecting during initialization', async () => {
      const statusPromise = new Promise<string>((resolve) => {
        const sub = cloudSync.getCloudStatus().subscribe((status) => {
          if (status === 'connecting') {
            resolve(status);
            sub.unsubscribe();
          }
        });
      });

      // Start initialization (will fail, but we catch the connecting status)
      mockFetch.mockResolvedValueOnce(mockResponse(mockValidation));
      mockFetch.mockResolvedValueOnce(mockResponse(mockEndpoint));

      void cloudSync.initialize();

      const status = await statusPromise;
      expect(status).toBe('connecting');
    });
  });

  describe('getSyncStats', () => {
    it('should return empty stats when no sync engine', async () => {
      const stats = await firstValueFrom(cloudSync.getSyncStats());
      expect(stats.pushCount).toBe(0);
      expect(stats.pullCount).toBe(0);
      expect(stats.conflictCount).toBe(0);
      expect(stats.lastSyncAt).toBeNull();
      expect(stats.lastError).toBeNull();
    });
  });

  describe('getUsageMetrics', () => {
    it('should return initial empty usage metrics', async () => {
      const usage = await firstValueFrom(cloudSync.getUsageMetrics());
      expect(usage.sessionOperations).toBe(0);
      expect(usage.sessionBytesTransferred).toBe(0);
      expect(usage.quotaWarning).toBe(false);
      expect(usage.quotaExceeded).toBe(false);
      expect(usage.remainingOperations).toBeNull();
    });
  });

  describe('getCombinedStatus', () => {
    it('should combine all status observables', async () => {
      const combined = await firstValueFrom(cloudSync.getCombinedStatus());
      expect(combined).toHaveProperty('syncStatus');
      expect(combined).toHaveProperty('cloudStatus');
      expect(combined).toHaveProperty('stats');
      expect(combined).toHaveProperty('usage');
      expect(combined.syncStatus).toBe('offline');
      expect(combined.cloudStatus).toBe('disconnected');
    });
  });

  describe('forceSync', () => {
    it('should throw if not connected', async () => {
      await expect(cloudSync.forceSync()).rejects.toThrow('not connected');
    });
  });

  describe('destroy', () => {
    it('should clean up all resources', () => {
      cloudSync.destroy();
      expect(cloudSync.getSyncEngine()).toBeNull();
      expect(cloudSync.getEndpoint()).toBeNull();
      expect(cloudSync.getIsRunning()).toBe(false);
    });

    it('should be safe to call multiple times', () => {
      cloudSync.destroy();
      expect(() => cloudSync.destroy()).not.toThrow();
    });
  });
});

describe('Types and Constants', () => {
  describe('TIER_LIMITS', () => {
    it('should have limits for free tier', () => {
      const free = TIER_LIMITS.free;
      expect(free.maxOperations).toBe(10_000);
      expect(free.maxStorageBytes).toBe(100 * 1024 * 1024);
      expect(free.maxConnections).toBe(5);
    });

    it('should have limits for pro tier', () => {
      const pro = TIER_LIMITS.pro;
      expect(pro.maxOperations).toBe(1_000_000);
      expect(pro.maxConnections).toBe(100);
    });

    it('should have unlimited enterprise tier', () => {
      const enterprise = TIER_LIMITS.enterprise;
      expect(enterprise.maxOperations).toBe(Infinity);
      expect(enterprise.maxStorageBytes).toBe(Infinity);
      expect(enterprise.maxConnections).toBe(Infinity);
    });
  });

  describe('REGION_ENDPOINTS', () => {
    it('should have endpoints for all regions', () => {
      expect(REGION_ENDPOINTS['us-east-1']).toContain('us-east-1');
      expect(REGION_ENDPOINTS['us-west-2']).toContain('us-west-2');
      expect(REGION_ENDPOINTS['eu-west-1']).toContain('eu-west-1');
      expect(REGION_ENDPOINTS['eu-central-1']).toContain('eu-central-1');
      expect(REGION_ENDPOINTS['ap-southeast-1']).toContain('ap-southeast-1');
      expect(REGION_ENDPOINTS['ap-northeast-1']).toContain('ap-northeast-1');
    });

    it('should all use HTTPS', () => {
      for (const endpoint of Object.values(REGION_ENDPOINTS)) {
        expect(endpoint).toMatch(/^https:\/\//);
      }
    });
  });

  describe('API key constants', () => {
    it('should define correct prefixes', () => {
      expect(API_KEY_LIVE_PREFIX).toBe('pk_live_');
      expect(API_KEY_TEST_PREFIX).toBe('pk_test_');
    });

    it('should define minimum key length', () => {
      expect(API_KEY_MIN_LENGTH).toBe(24);
    });
  });
});
