import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncEngine, type SyncConfig, type SyncStats, type SyncStatus } from './sync-engine.js';
import type {
  PullResponseMessage,
  PushResponseMessage,
  SyncProtocolMessage,
  SyncTransport,
} from './transport/types.js';

function createMockTransport(): SyncTransport {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    send: vi.fn().mockImplementation(async (msg: SyncProtocolMessage) => {
      if (msg.type === 'push') {
        return {
          type: 'push-response',
          id: msg.id,
          timestamp: Date.now(),
          success: true,
          checkpoint: { id: 'cp-1', sequences: {}, timestamp: Date.now(), nodeId: 'server' },
        } as PushResponseMessage;
      }
      if (msg.type === 'pull') {
        return {
          type: 'pull-response',
          id: msg.id,
          timestamp: Date.now(),
          changes: {},
          checkpoint: { id: 'cp-1', sequences: {}, timestamp: Date.now(), nodeId: 'server' },
          hasMore: false,
        } as PullResponseMessage;
      }
      return msg;
    }),
    onMessage: vi.fn(),
    onError: vi.fn(),
    onDisconnect: vi.fn(),
    onReconnect: vi.fn(),
  };
}

let currentMockTransport: SyncTransport;

vi.mock('./transport/websocket.js', () => ({
  createWebSocketTransport: vi.fn(() => currentMockTransport),
}));

vi.mock('./transport/http.js', () => ({
  createHttpTransport: vi.fn(() => currentMockTransport),
}));

function createMockDatabase(): any {
  const collections = new Map<string, any>();
  return {
    nodeId: 'test-node',
    listCollections: vi.fn().mockResolvedValue(['todos']),
    collection: vi.fn((name: string) => {
      if (!collections.has(name)) {
        collections.set(name, {
          changes: vi.fn().mockReturnValue({
            subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
            pipe: vi
              .fn()
              .mockReturnValue({ subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }) }),
          }),
          get: vi.fn().mockResolvedValue(null),
          applyRemoteChange: vi.fn().mockResolvedValue(undefined),
        });
      }
      return collections.get(name)!;
    }),
  };
}

describe('SyncEngine', () => {
  let engine: SyncEngine;
  let mockDb: any;
  const defaultConfig: SyncConfig = {
    serverUrl: 'ws://localhost:8080',
    collections: ['todos'],
    logger: false,
    pullInterval: 0,
  };

  beforeEach(() => {
    currentMockTransport = createMockTransport();
    mockDb = createMockDatabase();
  });

  afterEach(() => {
    if (engine) {
      engine.destroy();
    }
  });

  describe('constructor', () => {
    it('should create a sync engine with default config', () => {
      engine = new SyncEngine(mockDb, defaultConfig);
      expect(engine).toBeDefined();
    });

    it('should apply default config values', () => {
      engine = new SyncEngine(mockDb, { serverUrl: 'ws://localhost', logger: false });
      expect(engine).toBeDefined();
    });
  });

  describe('start()', () => {
    it('should connect to server and set status to idle', async () => {
      engine = new SyncEngine(mockDb, defaultConfig);
      const statuses: SyncStatus[] = [];
      engine.getStatus().subscribe((s) => statuses.push(s));

      await engine.start();

      expect(statuses).toContain('idle');
    });

    it('should be idempotent when already running', async () => {
      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();
      await engine.start();
    });

    it('should handle connection failure', async () => {
      currentMockTransport = createMockTransport();
      (currentMockTransport.connect as any).mockRejectedValue(new Error('connection failed'));

      engine = new SyncEngine(mockDb, defaultConfig);

      await expect(engine.start()).rejects.toThrow('connection failed');
    });
  });

  describe('stop()', () => {
    it('should stop the engine and disconnect', async () => {
      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();
      await engine.stop();

      expect(currentMockTransport.disconnect).toHaveBeenCalled();
    });
  });

  describe('forceSync()', () => {
    it('should execute push and pull', async () => {
      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();

      await engine.forceSync();

      // Transport should have received messages
      expect(currentMockTransport.send).toHaveBeenCalled();
    });

    it('should set status to syncing during operation', async () => {
      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();

      const statuses: SyncStatus[] = [];
      engine.getStatus().subscribe((s) => statuses.push(s));

      await engine.forceSync();

      expect(statuses).toContain('syncing');
    });

    it('should handle errors and set error status', async () => {
      // Set up failing transport before creating engine
      currentMockTransport = createMockTransport();
      const transport = currentMockTransport;

      engine = new SyncEngine(mockDb, { ...defaultConfig, direction: 'pull' });
      await engine.start();

      // Now make transport fail for the forceSync
      (transport.send as any).mockRejectedValue(new Error('network error'));

      await expect(engine.forceSync()).rejects.toThrow('network error');
    });
  });

  describe('push()', () => {
    it('should push local changes to server', async () => {
      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();

      await engine.push();
    });
  });

  describe('pull()', () => {
    it('should pull remote changes from server', async () => {
      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();

      await engine.pull();

      // Should have sent a pull message
      const calls = (currentMockTransport.send as any).mock.calls;
      const pullCalls = calls.filter((c: any) => c[0].type === 'pull');
      expect(pullCalls.length).toBeGreaterThan(0);
    });
  });

  describe('getStatus()', () => {
    it('should return observable of status', () => {
      engine = new SyncEngine(mockDb, defaultConfig);

      const statuses: SyncStatus[] = [];
      engine.getStatus().subscribe((s) => statuses.push(s));

      expect(statuses.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getStats()', () => {
    it('should return observable of stats with initial values', () => {
      engine = new SyncEngine(mockDb, defaultConfig);

      const stats: SyncStats[] = [];
      engine.getStats().subscribe((s) => stats.push(s));

      expect(stats.length).toBeGreaterThanOrEqual(1);
      expect(stats[0].pushCount).toBe(0);
      expect(stats[0].pullCount).toBe(0);
      expect(stats[0].conflictCount).toBe(0);
      expect(stats[0].lastSyncAt).toBeNull();
      expect(stats[0].lastError).toBeNull();
    });
  });

  describe('destroy()', () => {
    it('should release all resources', () => {
      engine = new SyncEngine(mockDb, defaultConfig);

      let completed = false;
      engine.getStatus().subscribe({
        complete: () => {
          completed = true;
        },
      });

      engine.destroy();
      expect(completed).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should support push-only direction', async () => {
      engine = new SyncEngine(mockDb, { ...defaultConfig, direction: 'push' });
      await engine.start();
      expect(engine).toBeDefined();
    });

    it('should support pull-only direction', async () => {
      engine = new SyncEngine(mockDb, { ...defaultConfig, direction: 'pull' });
      await engine.start();
      expect(engine).toBeDefined();
    });

    it('should support HTTP transport', () => {
      engine = new SyncEngine(mockDb, { ...defaultConfig, useWebSocket: false });
      expect(engine).toBeDefined();
    });
  });

  describe('pull() with remote changes', () => {
    it('should apply pulled changes to local collections', async () => {
      currentMockTransport = createMockTransport();
      (currentMockTransport.send as any).mockImplementation(async (msg: SyncProtocolMessage) => {
        if (msg.type === 'pull') {
          return {
            type: 'pull-response',
            id: msg.id,
            timestamp: Date.now(),
            changes: {
              todos: [
                {
                  operation: 'insert',
                  documentId: 'remote-1',
                  document: {
                    _id: 'remote-1',
                    title: 'Remote todo',
                    _rev: '1-abc',
                    _updatedAt: Date.now(),
                  },
                  timestamp: Date.now(),
                  sequence: 1,
                },
              ],
            },
            checkpoint: {
              id: 'cp',
              sequences: { todos: 1 },
              timestamp: Date.now(),
              nodeId: 'server',
            },
            hasMore: false,
          } as PullResponseMessage;
        }
        if (msg.type === 'push') {
          return {
            type: 'push-response',
            id: msg.id,
            timestamp: Date.now(),
            success: true,
            checkpoint: { id: 'cp', sequences: {}, timestamp: Date.now(), nodeId: 'server' },
          } as PushResponseMessage;
        }
        return msg;
      });

      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();
      await engine.pull();

      const todosCol = mockDb.collection('todos');
      expect(todosCol.applyRemoteChange).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'remote-1' })
      );
    });
  });

  describe('push() with server rejection', () => {
    it('should handle push response with conflicts', async () => {
      currentMockTransport = createMockTransport();
      // Make push return conflicts
      (currentMockTransport.send as any).mockImplementation(async (msg: SyncProtocolMessage) => {
        if (msg.type === 'push') {
          return {
            type: 'push-response',
            id: msg.id,
            timestamp: Date.now(),
            success: false,
            conflicts: [
              {
                documentId: 'doc-1',
                serverDocument: {
                  _id: 'doc-1',
                  title: 'Server version',
                  _rev: '2-srv',
                  _updatedAt: Date.now(),
                },
              },
            ],
            checkpoint: { id: 'cp', sequences: {}, timestamp: Date.now(), nodeId: 'server' },
          } as PushResponseMessage;
        }
        if (msg.type === 'pull') {
          return {
            type: 'pull-response',
            id: msg.id,
            timestamp: Date.now(),
            changes: {},
            checkpoint: { id: 'cp', sequences: {}, timestamp: Date.now(), nodeId: 'server' },
            hasMore: false,
          } as PullResponseMessage;
        }
        return msg;
      });

      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();

      // Push should handle conflicts without throwing
      await engine.push();
    });
  });

  describe('forceSync() stats update', () => {
    it('should update lastSyncAt on successful sync', async () => {
      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();

      const before = Date.now();
      await engine.forceSync();

      const stats: SyncStats[] = [];
      engine.getStats().subscribe((s) => stats.push(s));

      const latestStats = stats[stats.length - 1];
      expect(latestStats.lastSyncAt).toBeGreaterThanOrEqual(before);
      expect(latestStats.lastError).toBeNull();
    });
  });

  describe('transport event handlers', () => {
    it('should set status to error on transport error', async () => {
      currentMockTransport = createMockTransport();
      let errorHandler: ((error: Error) => void) | null = null;
      (currentMockTransport.onError as any).mockImplementation((handler: any) => {
        errorHandler = handler;
      });

      engine = new SyncEngine(mockDb, defaultConfig);

      const statuses: SyncStatus[] = [];
      engine.getStatus().subscribe((s) => statuses.push(s));

      // Trigger error handler
      if (errorHandler) {
        (errorHandler as (error: Error) => void)(new Error('transport error'));
      }

      expect(statuses).toContain('error');
    });

    it('should set status to offline on disconnect', async () => {
      currentMockTransport = createMockTransport();
      let disconnectHandler: (() => void) | null = null;
      (currentMockTransport.onDisconnect as any).mockImplementation((handler: any) => {
        disconnectHandler = handler;
      });

      engine = new SyncEngine(mockDb, defaultConfig);

      const statuses: SyncStatus[] = [];
      engine.getStatus().subscribe((s) => statuses.push(s));

      if (disconnectHandler) {
        (disconnectHandler as () => void)();
      }

      expect(statuses).toContain('offline');
    });

    it('should set status to idle on reconnect', async () => {
      currentMockTransport = createMockTransport();
      let reconnectHandler: (() => void) | null = null;
      (currentMockTransport.onReconnect as any).mockImplementation((handler: any) => {
        reconnectHandler = handler;
      });

      engine = new SyncEngine(mockDb, defaultConfig);

      const statuses: SyncStatus[] = [];
      engine.getStatus().subscribe((s) => statuses.push(s));

      if (reconnectHandler) {
        (reconnectHandler as () => void)();
      }

      expect(statuses).toContain('idle');
    });
  });

  describe('empty changeset', () => {
    it('should handle pull with empty changes', async () => {
      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();

      // Default mock returns empty changes
      await engine.pull();

      const todosCol = mockDb.collection('todos');
      expect(todosCol.applyRemoteChange).not.toHaveBeenCalled();
    });

    it('should handle push with no pending changes', async () => {
      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();

      // No optimistic updates exist, so push should be a no-op
      await engine.push();
    });
  });

  describe('forceSync() already syncing', () => {
    it('should not start another sync if already syncing', async () => {
      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();

      // Start first forceSync
      const sync1 = engine.forceSync();
      // Call again immediately - should be skipped
      const sync2 = engine.forceSync();

      await Promise.all([sync1, sync2]);
    });
  });

  describe('offline behavior', () => {
    it('should report offline status when transport disconnects', async () => {
      currentMockTransport = createMockTransport();
      let disconnectHandler: (() => void) | null = null;
      (currentMockTransport.onDisconnect as any).mockImplementation((handler: any) => {
        disconnectHandler = handler;
      });

      engine = new SyncEngine(mockDb, defaultConfig);

      const statuses: SyncStatus[] = [];
      engine.getStatus().subscribe((s) => statuses.push(s));

      // Simulate disconnect
      disconnectHandler!();

      expect(statuses).toContain('offline');
    });

    it('should track lastError on transport error', async () => {
      currentMockTransport = createMockTransport();
      let errorHandler: ((error: Error) => void) | null = null;
      (currentMockTransport.onError as any).mockImplementation((handler: any) => {
        errorHandler = handler;
      });

      engine = new SyncEngine(mockDb, defaultConfig);

      const allStats: SyncStats[] = [];
      engine.getStats().subscribe((s) => allStats.push(s));

      errorHandler!(new Error('connection lost'));

      const latestStats = allStats[allStats.length - 1];
      expect(latestStats.lastError).toBeDefined();
      expect(latestStats.lastError!.message).toBe('connection lost');
    });

    it('should attempt forceSync on reconnect when running', async () => {
      currentMockTransport = createMockTransport();
      let reconnectHandler: (() => void) | null = null;
      (currentMockTransport.onReconnect as any).mockImplementation((handler: any) => {
        reconnectHandler = handler;
      });

      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();

      // Clear send call count from initial start
      (currentMockTransport.send as any).mockClear();

      // Simulate reconnect
      reconnectHandler!();

      // Allow async forceSync to begin
      await new Promise((r) => setTimeout(r, 50));

      // forceSync should have sent at least one message (push or pull)
      expect((currentMockTransport.send as any).mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('pull with pagination (hasMore)', () => {
    it('should recursively pull when hasMore is true', async () => {
      let pullCallCount = 0;
      currentMockTransport = createMockTransport();
      (currentMockTransport.send as any).mockImplementation(async (msg: SyncProtocolMessage) => {
        if (msg.type === 'pull') {
          pullCallCount++;
          return {
            type: 'pull-response',
            id: msg.id,
            timestamp: Date.now(),
            changes: {
              todos: [
                {
                  operation: 'insert',
                  documentId: `doc-${pullCallCount}`,
                  document: { _id: `doc-${pullCallCount}`, _rev: '1-x', _updatedAt: Date.now() },
                  timestamp: Date.now(),
                  sequence: pullCallCount,
                },
              ],
            },
            checkpoint: {
              id: 'cp',
              sequences: { todos: pullCallCount },
              timestamp: Date.now(),
              nodeId: 'server',
            },
            hasMore: pullCallCount < 2, // two pages then done
          } as PullResponseMessage;
        }
        if (msg.type === 'push') {
          return {
            type: 'push-response',
            id: msg.id,
            timestamp: Date.now(),
            success: true,
            checkpoint: { id: 'cp', sequences: {}, timestamp: Date.now(), nodeId: 'server' },
          } as PushResponseMessage;
        }
        return msg;
      });

      engine = new SyncEngine(mockDb, defaultConfig);
      await engine.start();

      await engine.pull();

      // Should have called pull twice (first page hasMore=true, second hasMore=false)
      expect(pullCallCount).toBe(2);

      const todosCol = mockDb.collection('todos');
      expect(todosCol.applyRemoteChange).toHaveBeenCalledTimes(2);
    });
  });

  describe('start error sets error status and stats', () => {
    it('should set error status and lastError on start failure', async () => {
      currentMockTransport = createMockTransport();
      (currentMockTransport.connect as any).mockRejectedValue(new Error('refused'));

      engine = new SyncEngine(mockDb, defaultConfig);

      const statuses: SyncStatus[] = [];
      engine.getStatus().subscribe((s) => statuses.push(s));

      const allStats: SyncStats[] = [];
      engine.getStats().subscribe((s) => allStats.push(s));

      await expect(engine.start()).rejects.toThrow('refused');

      expect(statuses).toContain('error');
      const last = allStats[allStats.length - 1];
      expect(last.lastError).toBeDefined();
      expect(last.lastError!.message).toBe('refused');
    });
  });
});
