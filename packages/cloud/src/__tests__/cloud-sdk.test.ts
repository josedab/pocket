import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudSDK, createCloudSDK } from '../cloud-sdk.js';
import type { CloudSDKStatus } from '../cloud-sdk.js';

// ─── Mock dependencies ──────────────────────────────────────────────────────

vi.mock('../cloud-client.js', () => {
  return {
    CloudClient: vi.fn().mockImplementation(() => ({
      validateApiKey: vi.fn().mockResolvedValue({ valid: true, projectId: 'proj_123' }),
      getEndpoint: vi.fn().mockResolvedValue({
        httpUrl: 'https://sync.pocket-db.dev',
        websocketUrl: 'wss://sync.pocket-db.dev',
        region: 'us-east-1',
      }),
      destroy: vi.fn(),
    })),
  };
});

vi.mock('../cloud-sync.js', () => {
  return {
    CloudSync: vi.fn().mockImplementation(() => ({
      destroy: vi.fn(),
    })),
  };
});

vi.mock('../health-monitor.js', () => {
  return {
    HealthMonitor: vi.fn().mockImplementation(() => ({
      getCurrentStatus: vi.fn().mockReturnValue('healthy'),
      destroy: vi.fn(),
    })),
  };
});

// ─── CloudSDK ───────────────────────────────────────────────────────────────

describe('CloudSDK', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start in disconnected state', () => {
    const sdk = createCloudSDK({ apiKey: 'pk_live_test123456' });

    const stats = sdk.getStats();
    expect(stats.status).toBe('disconnected');
    expect(stats.connectedSince).toBeNull();
    expect(stats.reconnectAttempts).toBe(0);

    sdk.destroy();
  });

  it('should transition to connected after connect()', async () => {
    const sdk = new CloudSDK({ apiKey: 'pk_live_test123456' });

    await sdk.connect();

    expect(sdk.getStats().status).toBe('connected');
    expect(sdk.getStats().connectedSince).toBeTypeOf('number');

    sdk.destroy();
  });

  it('should transition to disconnected after disconnect()', async () => {
    const sdk = new CloudSDK({ apiKey: 'pk_live_test123456' });

    await sdk.connect();
    expect(sdk.getStats().status).toBe('connected');

    await sdk.disconnect();
    expect(sdk.getStats().status).toBe('disconnected');
    expect(sdk.getStats().connectedSince).toBeNull();

    sdk.destroy();
  });

  it('should emit status changes on status$ observable', async () => {
    const sdk = new CloudSDK({ apiKey: 'pk_live_test123456' });
    const statuses: CloudSDKStatus[] = [];

    sdk.status$.subscribe((s) => statuses.push(s));

    await sdk.connect();
    await sdk.disconnect();

    expect(statuses).toEqual(['disconnected', 'connecting', 'connected', 'disconnected']);

    sdk.destroy();
  });

  it('should return stats with health info after connect', async () => {
    const sdk = new CloudSDK({ apiKey: 'pk_live_test123456' });

    await sdk.connect();
    const stats = sdk.getStats();

    expect(stats.status).toBe('connected');
    expect(stats.health).toBe('healthy');
    expect(stats.reconnectAttempts).toBe(0);

    sdk.destroy();
  });

  it('should report healthy when connected', async () => {
    const sdk = new CloudSDK({ apiKey: 'pk_live_test123456' });

    expect(sdk.isHealthy()).toBe(false);

    await sdk.connect();
    expect(sdk.isHealthy()).toBe(true);

    await sdk.disconnect();
    expect(sdk.isHealthy()).toBe(false);

    sdk.destroy();
  });

  it('should not reconnect when autoReconnect is false', async () => {
    const { CloudClient } = await import('../cloud-client.js');
    const MockClient = vi.mocked(CloudClient);
    MockClient.mockImplementationOnce(
      () =>
        ({
          validateApiKey: vi.fn().mockRejectedValue(new Error('network error')),
          getEndpoint: vi.fn(),
          destroy: vi.fn(),
        }) as any,
    );

    const sdk = new CloudSDK({ apiKey: 'pk_live_test123456', autoReconnect: false });

    await sdk.connect();
    expect(sdk.getStats().status).toBe('error');
    expect(sdk.getStats().reconnectAttempts).toBe(0);

    sdk.destroy();
  });

  it('should be created via createCloudSDK factory', () => {
    const sdk = createCloudSDK({ apiKey: 'pk_live_test123456', projectId: 'proj_1' });
    expect(sdk).toBeInstanceOf(CloudSDK);
    sdk.destroy();
  });
});
