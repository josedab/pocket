import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServerLoader, PocketServerLoader } from '../server-loader.js';
import type { ServerLoaderConfig } from '../types.js';

// ---------- helpers ----------

function mockFetchResponse(data: unknown, status = 200, statusText = 'OK') {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(data),
  } as unknown as Response);
}

// ---------- tests ----------

describe('PocketServerLoader', () => {
  const baseConfig: ServerLoaderConfig = {
    serverUrl: 'http://localhost:3000',
    authToken: 'test-token',
    timeout: 5000,
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // --- creation ---

  it('should create a loader via factory function', () => {
    const loader = createServerLoader(baseConfig);
    expect(loader).toBeInstanceOf(PocketServerLoader);
  });

  it('should create a loader via constructor', () => {
    const loader = new PocketServerLoader(baseConfig);
    expect(loader).toBeInstanceOf(PocketServerLoader);
  });

  // --- loadCollection ---

  it('should load a collection and return result', async () => {
    const items = [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }];
    globalThis.fetch = mockFetchResponse(items);

    const loader = createServerLoader(baseConfig);
    const result = await loader.loadCollection('users');

    expect(result.data).toEqual(items);
    expect(result.stale).toBe(false);
    expect(typeof result.timestamp).toBe('number');
  });

  it('should pass filter as query parameter', async () => {
    globalThis.fetch = mockFetchResponse([]);

    const loader = createServerLoader(baseConfig);
    await loader.loadCollection('users', { role: 'admin' });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('filter=');
    expect(calledUrl).toContain(encodeURIComponent('"role"'));
  });

  it('should set Authorization header when authToken is provided', async () => {
    globalThis.fetch = mockFetchResponse([]);

    const loader = createServerLoader(baseConfig);
    await loader.loadCollection('users');

    const calledHeaders = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.headers;
    expect(calledHeaders).toHaveProperty('Authorization', 'Bearer test-token');
  });

  it('should throw on non-OK response', async () => {
    globalThis.fetch = mockFetchResponse(null, 404, 'Not Found');

    const loader = createServerLoader(baseConfig);

    await expect(loader.loadCollection('missing')).rejects.toThrow(
      'Failed to load collection "missing": 404 Not Found',
    );
  });

  // --- loadMultiple (batch) ---

  it('should batch-load multiple collections', async () => {
    const usersData = [{ id: '1' }];
    const postsData = [{ id: 'p1', title: 'Hello' }];

    let callIndex = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const data = callIndex === 0 ? usersData : postsData;
      callIndex++;
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(data),
      });
    });

    const loader = createServerLoader(baseConfig);
    const results = await loader.loadMultiple([
      { collection: 'users' },
      { collection: 'posts' },
    ]);

    expect(results.size).toBe(2);
    expect(results.get('users')?.data).toEqual(usersData);
    expect(results.get('posts')?.data).toEqual(postsData);
  });

  // --- getHydrationProps ---

  it('should return hydration props after loading', async () => {
    const items = [{ id: '1' }];
    globalThis.fetch = mockFetchResponse(items);

    const loader = createServerLoader(baseConfig);
    await loader.loadCollection('tasks');

    const props = loader.getHydrationProps();
    expect(props.initialData).toBeInstanceOf(Map);
    expect(props.initialData.get('tasks')).toEqual(items);
    expect(typeof props.serverTimestamp).toBe('number');
  });

  it('should return empty hydration props when nothing loaded', () => {
    const loader = createServerLoader(baseConfig);
    const props = loader.getHydrationProps();

    expect(props.initialData.size).toBe(0);
    expect(typeof props.serverTimestamp).toBe('number');
  });

  // --- error handling ---

  it('should throw on fetch failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const loader = createServerLoader(baseConfig);

    await expect(loader.loadCollection('users')).rejects.toThrow('Network error');
  });

  it('should handle timeout via abort', async () => {
    const config: ServerLoaderConfig = { ...baseConfig, timeout: 1 };

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new DOMException('The operation was aborted.', 'AbortError');
            reject(err);
          });
        }
      });
    });

    const loader = createServerLoader(config);

    await expect(loader.loadCollection('slow')).rejects.toThrow('Timeout loading collection "slow"');
  });
});
