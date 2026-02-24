import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedWorkerHost, type MessagePortLike } from '../shared-worker-host.js';

function createMockPort(): MessagePortLike & { messages: unknown[] } {
  const port: MessagePortLike & { messages: unknown[] } = {
    messages: [],
    onmessage: null,
    postMessage(msg: unknown) {
      this.messages.push(msg);
    },
    close() {
      this.onmessage = null;
    },
  };
  return port;
}

function simulateMessage(port: MessagePortLike, message: unknown): void {
  if (port.onmessage) {
    port.onmessage({ data: message });
  }
}

describe('SharedWorkerHost', () => {
  let host: SharedWorkerHost;

  // Mock data store per collection
  const stores = new Map<string, Map<string, Record<string, unknown>>>();

  function getStore(collection: string): Map<string, Record<string, unknown>> {
    let store = stores.get(collection);
    if (!store) {
      store = new Map();
      stores.set(collection, store);
    }
    return store;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    stores.clear();
    host = new SharedWorkerHost({
      databaseFactory: async (name) => ({
        name,
        close: async () => {},
        collection: (collName: string) => {
          const store = getStore(collName);
          return {
            find: (filter?: Record<string, unknown>) => ({
              exec: async () => {
                const docs = [...store.values()];
                if (!filter || Object.keys(filter).length === 0) return docs;
                return docs.filter((doc) => Object.entries(filter).every(([k, v]) => doc[k] === v));
              },
            }),
            get: async (id: string) => store.get(id) ?? null,
            insert: async (doc: Record<string, unknown>) => {
              const id = (doc._id as string) ?? `auto_${Date.now()}`;
              const saved = { ...doc, _id: id };
              store.set(id, saved);
              return saved;
            },
            update: async (id: string, changes: Record<string, unknown>) => {
              const existing = store.get(id);
              if (!existing) return null;
              const updated = { ...existing, ...changes };
              store.set(id, updated);
              return updated;
            },
            delete: async (id: string) => {
              return store.delete(id);
            },
            count: async () => store.size,
          };
        },
      }),
      heartbeatIntervalMs: 5000,
      tabTimeoutMs: 15000,
    });
  });

  afterEach(async () => {
    await host.destroy();
    vi.useRealTimers();
  });

  it('should accept tab connections and send welcome', () => {
    const port = createMockPort();
    host.addConnection(port);

    expect(port.messages.length).toBe(1);
    const welcome = port.messages[0] as { id: string; success: boolean; data: { tabId: string } };
    expect(welcome.id).toBe('welcome');
    expect(welcome.success).toBe(true);
    expect(welcome.data.tabId).toBeDefined();
  });

  it('should handle ping/pong', () => {
    const port = createMockPort();
    host.addConnection(port);
    port.messages.length = 0;

    simulateMessage(port, {
      id: 'ping-1',
      type: 'ping',
      payload: null,
      tabId: 'tab1',
      timestamp: Date.now(),
    });

    expect(port.messages.length).toBe(1);
    const response = port.messages[0] as { id: string; data: string };
    expect(response.id).toBe('ping-1');
    expect(response.data).toBe('pong');
  });

  it('should handle database connect messages', async () => {
    const port = createMockPort();
    host.addConnection(port);
    port.messages.length = 0;

    simulateMessage(port, {
      id: 'connect-1',
      type: 'connect',
      payload: { databaseName: 'test-db' },
      tabId: 'tab1',
      timestamp: Date.now(),
    });

    // Wait for async handler
    await vi.advanceTimersByTimeAsync(10);

    const response = port.messages[0] as {
      id: string;
      success: boolean;
      data: { databaseName: string };
    };
    expect(response?.success).toBe(true);
    expect(response?.data?.databaseName).toBe('test-db');
  });

  it('should report stats', () => {
    const port1 = createMockPort();
    const port2 = createMockPort();
    host.addConnection(port1);
    host.addConnection(port2);

    const stats = host.getStats();
    expect(stats.connectedTabs).toBe(2);
    expect(stats.totalQueries).toBe(0);
  });

  it('should broadcast mutations to other tabs', async () => {
    const port1 = createMockPort();
    const port2 = createMockPort();

    host.addConnection(port1);
    host.addConnection(port2);

    // Connect to database first
    simulateMessage(port1, {
      id: 'conn',
      type: 'connect',
      payload: { databaseName: 'broadcast-db' },
      tabId: 'tab1',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(10);

    const welcome1 = port1.messages[0] as { data: { tabId: string } };
    const tab1Id = welcome1.data.tabId;
    port1.messages.length = 0;
    port2.messages.length = 0;

    simulateMessage(port1, {
      id: 'insert-1',
      type: 'insert',
      payload: { collection: 'todos', document: { _id: 'bc-1', title: 'Test' } },
      tabId: tab1Id,
      timestamp: Date.now(),
    });

    await vi.advanceTimersByTimeAsync(10);

    // port1 gets ack, port2 gets change notification
    expect(port1.messages.length).toBeGreaterThanOrEqual(1);
    const ack = port1.messages[0] as { id: string; success: boolean };
    expect(ack.success).toBe(true);

    expect(port2.messages.length).toBeGreaterThanOrEqual(1);
    const notification = port2.messages[0] as { type: string };
    expect(notification.type).toBe('change-notification');
  });

  it('should handle query messages', async () => {
    const port = createMockPort();
    host.addConnection(port);
    port.messages.length = 0;

    simulateMessage(port, {
      id: 'q-1',
      type: 'query',
      payload: { collection: 'todos', filter: {} },
      tabId: 'tab1',
      timestamp: Date.now(),
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(port.messages.length).toBeGreaterThanOrEqual(1);
    const response = port.messages[0] as { id: string; success: boolean };
    expect(response.success).toBe(true);
  });

  it('should handle subscribe/unsubscribe', () => {
    const port = createMockPort();
    host.addConnection(port);
    port.messages.length = 0;

    simulateMessage(port, {
      id: 'sub-1',
      type: 'subscribe',
      payload: { collection: 'todos' },
      tabId: 'tab1',
      timestamp: Date.now(),
    });

    const subResp = port.messages[0] as { success: boolean; data: { subscribed: boolean } };
    expect(subResp.success).toBe(true);
    expect(subResp.data.subscribed).toBe(true);

    port.messages.length = 0;
    simulateMessage(port, {
      id: 'unsub-1',
      type: 'unsubscribe',
      payload: { collection: 'todos' },
      tabId: 'tab1',
      timestamp: Date.now(),
    });

    const unsubResp = port.messages[0] as { data: { unsubscribed: boolean } };
    expect(unsubResp.data.unsubscribed).toBe(true);
  });

  it('should reject unknown message types', () => {
    const port = createMockPort();
    host.addConnection(port);
    port.messages.length = 0;

    simulateMessage(port, {
      id: 'bad-1',
      type: 'unknown',
      payload: null,
      tabId: 'tab1',
      timestamp: Date.now(),
    });

    const response = port.messages[0] as { success: boolean; error: string };
    expect(response.success).toBe(false);
    expect(response.error).toContain('Unknown message type');
  });

  it('should clean up on destroy', async () => {
    const port = createMockPort();
    host.addConnection(port);

    await host.destroy();
    expect(host.getStats().connectedTabs).toBe(0);
  });

  // ── Real database wiring tests ───────────────────────

  it('should execute queries against the real database', async () => {
    const port = createMockPort();
    host.addConnection(port);

    // First connect to a database
    simulateMessage(port, {
      id: 'conn-1',
      type: 'connect',
      payload: { databaseName: 'test-db' },
      tabId: 'tab1',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(10);

    // Insert via mutation
    port.messages.length = 0;
    simulateMessage(port, {
      id: 'ins-1',
      type: 'insert',
      payload: {
        collection: 'todos',
        document: { _id: 'td-1', title: 'Buy milk', completed: false },
      },
      tabId: 'tab1',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(10);

    const insertResp = port.messages.find((m) => (m as { id: string }).id === 'ins-1') as {
      success: boolean;
      data: { document: { _id: string } };
    };
    expect(insertResp?.success).toBe(true);
    expect(insertResp?.data?.document?._id).toBe('td-1');

    // Query it back
    port.messages.length = 0;
    simulateMessage(port, {
      id: 'q-2',
      type: 'query',
      payload: { collection: 'todos', filter: { completed: false } },
      tabId: 'tab1',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(10);

    const queryResp = port.messages.find((m) => (m as { id: string }).id === 'q-2') as {
      success: boolean;
      data: { results: Record<string, unknown>[]; count: number };
    };
    expect(queryResp?.success).toBe(true);
    expect(queryResp?.data?.results?.length).toBe(1);
    expect(queryResp?.data?.results?.[0]?.title).toBe('Buy milk');
  });

  it('should execute update mutations', async () => {
    const port = createMockPort();
    host.addConnection(port);

    simulateMessage(port, {
      id: 'conn',
      type: 'connect',
      payload: { databaseName: 'update-db' },
      tabId: 'tab1',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(10);

    // Insert
    simulateMessage(port, {
      id: 'ins',
      type: 'insert',
      payload: { collection: 'items', document: { _id: 'item-1', value: 10 } },
      tabId: 'tab1',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(10);

    // Update
    port.messages.length = 0;
    simulateMessage(port, {
      id: 'upd',
      type: 'update',
      payload: { collection: 'items', documentId: 'item-1', document: { value: 20 } },
      tabId: 'tab1',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(10);

    const resp = port.messages.find((m) => (m as { id: string }).id === 'upd') as {
      success: boolean;
      data: { document: { value: number } };
    };
    expect(resp?.success).toBe(true);
    expect(resp?.data?.document?.value).toBe(20);
  });

  it('should execute delete mutations', async () => {
    const port = createMockPort();
    host.addConnection(port);

    simulateMessage(port, {
      id: 'conn',
      type: 'connect',
      payload: { databaseName: 'delete-db' },
      tabId: 'tab1',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(10);

    simulateMessage(port, {
      id: 'ins',
      type: 'insert',
      payload: { collection: 'items', document: { _id: 'del-1', val: 1 } },
      tabId: 'tab1',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(10);

    port.messages.length = 0;
    simulateMessage(port, {
      id: 'del',
      type: 'delete',
      payload: { collection: 'items', documentId: 'del-1' },
      tabId: 'tab1',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(10);

    const resp = port.messages.find((m) => (m as { id: string }).id === 'del') as {
      success: boolean;
      data: { deleted: boolean };
    };
    expect(resp?.success).toBe(true);
    expect(resp?.data?.deleted).toBe(true);

    // Query should return empty
    port.messages.length = 0;
    simulateMessage(port, {
      id: 'q-empty',
      type: 'query',
      payload: { collection: 'items' },
      tabId: 'tab1',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(10);

    const qResp = port.messages.find((m) => (m as { id: string }).id === 'q-empty') as {
      data: { results: unknown[] };
    };
    expect(qResp?.data?.results?.length).toBe(0);
  });
});
