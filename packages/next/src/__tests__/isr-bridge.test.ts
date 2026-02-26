import { describe, expect, it } from 'vitest';
import {
  createRevalidationHandler,
  createStaticPropsFactory,
  HydrationBridge,
  verifyRevalidationSignature,
} from '../index.js';
import type { ISRDataSource } from '../isr-bridge.js';

const mockDataSource: ISRDataSource = {
  async fetchCollection(collection, _query) {
    if (collection === 'todos') {
      return [
        { _id: '1', title: 'Buy milk', completed: false },
        { _id: '2', title: 'Write docs', completed: true },
      ];
    }
    return [];
  },
};

describe('ISR Static Props', () => {
  it('should fetch and hydrate collection data', async () => {
    const getProps = createStaticPropsFactory(mockDataSource, {
      collections: ['todos'],
      revalidateSeconds: 60,
    });

    const result = await getProps([{ collection: 'todos' }]);
    expect(result.props._pocketHydration).toHaveLength(1);
    expect(result.props._pocketHydration[0]!.collection).toBe('todos');
    expect(result.props._pocketHydration[0]!.documents).toHaveLength(2);
    expect(result.revalidate).toBe(60);
  });

  it('should include fetch metadata', async () => {
    const getProps = createStaticPropsFactory(mockDataSource, {
      collections: ['todos'],
    });

    const result = await getProps([{ collection: 'todos' }]);
    const payload = result.props._pocketHydration[0]!;
    expect(payload.fetchedAt).toBeGreaterThan(0);
    expect(payload.stale).toBe(false);
  });

  it('should fetch multiple collections', async () => {
    const getProps = createStaticPropsFactory(mockDataSource, {
      collections: ['todos', 'users'],
    });

    const result = await getProps([{ collection: 'todos' }, { collection: 'users' }]);
    expect(result.props._pocketHydration).toHaveLength(2);
  });
});

describe('HydrationBridge', () => {
  it('should load and retrieve hydration data', () => {
    const bridge = new HydrationBridge();
    bridge.loadServerData([
      {
        collection: 'todos',
        documents: [{ _id: '1', title: 'Test' }],
        fetchedAt: Date.now(),
        revalidateAfter: Date.now() + 60000,
        stale: false,
      },
    ]);

    const data = bridge.getHydrationData('todos');
    expect(data).not.toBeNull();
    expect(data!.documents).toHaveLength(1);
  });

  it('should report hydration status', () => {
    const bridge = new HydrationBridge();
    expect(bridge.isHydrated('todos')).toBe(false);

    bridge.loadServerData([
      {
        collection: 'todos',
        documents: [],
        fetchedAt: Date.now(),
        revalidateAfter: Date.now() + 60000,
        stale: false,
      },
    ]);
    expect(bridge.isHydrated('todos')).toBe(true);
  });

  it('should mark data as stale when expired', () => {
    const bridge = new HydrationBridge();
    bridge.loadServerData([
      {
        collection: 'todos',
        documents: [],
        fetchedAt: Date.now() - 120000,
        revalidateAfter: Date.now() - 60000, // expired
        stale: false,
      },
    ]);

    const data = bridge.getHydrationData('todos');
    expect(data!.stale).toBe(true);
    expect(bridge.isHydrated('todos')).toBe(false);
  });

  it('should track live transition', () => {
    const bridge = new HydrationBridge();
    expect(bridge.isLive).toBe(false);
    bridge.markLive();
    expect(bridge.isLive).toBe(true);
  });

  it('should list loaded collections', () => {
    const bridge = new HydrationBridge();
    bridge.loadServerData([
      { collection: 'todos', documents: [], fetchedAt: Date.now(), stale: false },
      { collection: 'users', documents: [], fetchedAt: Date.now(), stale: false },
    ]);
    expect(bridge.getCollections()).toEqual(['todos', 'users']);
  });
});

describe('Revalidation', () => {
  it('should verify valid signatures', () => {
    const payload = '{"collection":"todos","timestamp":1234}';
    const secret = 'my-secret';
    // Generate signature with same algorithm
    let hash = 0;
    const input = `${payload}:${secret}`;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    const sig = Math.abs(hash).toString(36);

    expect(verifyRevalidationSignature(payload, sig, secret)).toBe(true);
  });

  it('should reject invalid signatures', () => {
    expect(verifyRevalidationSignature('data', 'wrong', 'secret')).toBe(false);
  });

  it('should handle revalidation webhook', async () => {
    const revalidated: string[] = [];
    const handler = createRevalidationHandler('test-secret', async (path) => {
      revalidated.push(path);
    });

    // Create a valid request
    const payload = JSON.stringify({
      collection: 'todos',
      documentId: 'doc-1',
      timestamp: Date.now(),
    });
    let hash = 0;
    const input = `${payload}:test-secret`;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }

    const result = await handler(
      {
        collection: 'todos',
        documentId: 'doc-1',
        timestamp: Date.now(),
        signature: Math.abs(hash).toString(36),
      },
      { todos: ['/todos', '/dashboard'] }
    );

    expect(result.revalidated).toBe(true);
    expect(result.paths).toEqual(['/todos', '/dashboard']);
  });

  it('should reject invalid webhook signature', async () => {
    const handler = createRevalidationHandler('secret', async () => {});
    const result = await handler(
      { collection: 'todos', timestamp: Date.now(), signature: 'invalid' },
      {}
    );
    expect(result.revalidated).toBe(false);
    expect(result.error).toContain('Invalid signature');
  });
});
