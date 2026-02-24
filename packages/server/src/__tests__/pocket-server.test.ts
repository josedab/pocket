import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createMemoryChangeLog } from '../change-log.js';
import { PocketServer, createServer } from '../server.js';

// Use a dynamic port to avoid conflicts
let port = 19100;
function getPort() {
  return port++;
}

describe('PocketServer', () => {
  let server: PocketServer;

  afterEach(async () => {
    if (server) {
      try {
        await server.stop();
      } catch {
        // Ignore
      }
    }
  });

  describe('createServer factory', () => {
    it('should create a PocketServer instance', () => {
      server = createServer({ port: getPort() });
      expect(server).toBeInstanceOf(PocketServer);
    });
  });

  describe('start / stop', () => {
    it('should start and stop the server', async () => {
      const p = getPort();
      server = createServer({ port: p });

      await server.start();
      expect(server.clientCount).toBe(0);

      await server.stop();
    });

    it('should handle stop when not started', async () => {
      server = createServer({ port: getPort() });
      await server.stop(); // Should not throw
    });
  });

  describe('client connections', () => {
    it('should accept client connections', async () => {
      const p = getPort();
      server = createServer({ port: p, path: '/sync' });
      await server.start();

      const ws = new WebSocket(`ws://localhost:${p}/sync?nodeId=test-node`);

      await new Promise<void>((resolve) => {
        ws.on('open', () => resolve());
      });

      // Wait for server to register the client
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(server.clientCount).toBe(1);
      ws.close();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.clientCount).toBe(0);
    });

    it('should reject unauthenticated client when auth is required', async () => {
      const p = getPort();
      server = createServer({
        port: p,
        path: '/sync',
        authenticate: async (token) => {
          if (token === 'valid-token') {
            return { userId: 'user-1' };
          }
          return null;
        },
      });
      await server.start();

      const ws = new WebSocket(`ws://localhost:${p}/sync?token=invalid`);

      const closeCode = await new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code));
      });

      expect(closeCode).toBe(4001);
    });

    it('should accept authenticated client', async () => {
      const p = getPort();
      server = createServer({
        port: p,
        path: '/sync',
        authenticate: async (token) => {
          if (token === 'valid-token') {
            return { userId: 'user-1' };
          }
          return null;
        },
      });
      await server.start();

      const ws = new WebSocket(`ws://localhost:${p}/sync?token=valid-token&nodeId=n1`);

      await new Promise<void>((resolve) => {
        ws.on('open', () => resolve());
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.clientCount).toBe(1);
      ws.close();
    });
  });

  describe('push message handling', () => {
    it('should handle push messages and respond', async () => {
      const p = getPort();
      const changeLog = createMemoryChangeLog();
      server = createServer({ port: p, path: '/sync', changeLog });
      await server.start();

      const ws = new WebSocket(`ws://localhost:${p}/sync?nodeId=n1`);

      await new Promise<void>((resolve) => {
        ws.on('open', () => resolve());
      });

      const responsePromise = new Promise<any>((resolve) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      ws.send(
        JSON.stringify({
          type: 'push',
          id: 'msg-1',
          timestamp: Date.now(),
          collection: 'todos',
          changes: [
            {
              operation: 'insert',
              documentId: 'doc-1',
              document: { _id: 'doc-1', title: 'Test' },
              timestamp: Date.now(),
              sequence: 0,
            },
          ],
          checkpoint: { id: 'cp', sequences: {}, timestamp: Date.now(), nodeId: 'n1' },
        })
      );

      const response = await responsePromise;

      expect(response.type).toBe('push-response');
      expect(response.success).toBe(true);

      ws.close();
    });
  });

  describe('pull message handling', () => {
    it('should handle pull messages and respond', async () => {
      const p = getPort();
      server = createServer({ port: p, path: '/sync' });
      await server.start();

      const ws = new WebSocket(`ws://localhost:${p}/sync?nodeId=n1`);

      await new Promise<void>((resolve) => {
        ws.on('open', () => resolve());
      });

      const responsePromise = new Promise<any>((resolve) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      ws.send(
        JSON.stringify({
          type: 'pull',
          id: 'msg-2',
          timestamp: Date.now(),
          collections: ['todos'],
          checkpoint: { id: 'cp', sequences: { todos: 0 }, timestamp: Date.now(), nodeId: 'n1' },
          limit: 100,
        })
      );

      const response = await responsePromise;

      expect(response.type).toBe('pull-response');
      expect(response.hasMore).toBe(false);

      ws.close();
    });
  });

  describe('error handling', () => {
    it('should send error for malformed messages', async () => {
      const p = getPort();
      server = createServer({ port: p, path: '/sync' });
      await server.start();

      const ws = new WebSocket(`ws://localhost:${p}/sync?nodeId=n1`);

      await new Promise<void>((resolve) => {
        ws.on('open', () => resolve());
      });

      const responsePromise = new Promise<any>((resolve) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      ws.send('not-json');

      const response = await responsePromise;
      expect(response.type).toBe('error');
      expect(response.code).toBe('PARSE_ERROR');

      ws.close();
    });

    it('should send error for unknown message types', async () => {
      const p = getPort();
      server = createServer({ port: p, path: '/sync' });
      await server.start();

      const ws = new WebSocket(`ws://localhost:${p}/sync?nodeId=n1`);

      await new Promise<void>((resolve) => {
        ws.on('open', () => resolve());
      });

      const responsePromise = new Promise<any>((resolve) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      ws.send(JSON.stringify({ type: 'unknown', id: 'x', timestamp: Date.now() }));

      const response = await responsePromise;
      expect(response.type).toBe('error');

      ws.close();
    });
  });

  describe('max clients per user', () => {
    it('should reject connections exceeding max clients per user', async () => {
      const p = getPort();
      server = createServer({
        port: p,
        path: '/sync',
        maxClientsPerUser: 1,
        authenticate: async () => ({ userId: 'user-1' }),
      });
      await server.start();

      // First connection
      const ws1 = new WebSocket(`ws://localhost:${p}/sync?token=t`);
      await new Promise<void>((resolve) => {
        ws1.on('open', () => resolve());
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second connection should be rejected
      const ws2 = new WebSocket(`ws://localhost:${p}/sync?token=t`);
      const closeCode = await new Promise<number>((resolve) => {
        ws2.on('close', (code) => resolve(code));
      });

      expect(closeCode).toBe(4002);
      ws1.close();
    });
  });

  describe('getClientManager / getChangeLog', () => {
    it('should expose client manager', () => {
      server = createServer({ port: getPort() });
      expect(server.getClientManager()).toBeDefined();
    });

    it('should expose change log', () => {
      server = createServer({ port: getPort() });
      expect(server.getChangeLog()).toBeDefined();
    });
  });

  describe('broadcast to other clients', () => {
    it('should broadcast pushed changes to other connected clients', async () => {
      const p = getPort();
      server = createServer({ port: p, path: '/sync' });
      await server.start();

      // Connect two clients
      const ws1 = new WebSocket(`ws://localhost:${p}/sync?nodeId=node1`);
      const ws2 = new WebSocket(`ws://localhost:${p}/sync?nodeId=node2`);

      await Promise.all([
        new Promise<void>((resolve) => ws1.on('open', () => resolve())),
        new Promise<void>((resolve) => ws2.on('open', () => resolve())),
      ]);

      // Subscribe ws2 to the 'todos' collection by sending a pull first
      ws2.send(
        JSON.stringify({
          type: 'pull',
          id: 'pull-1',
          timestamp: Date.now(),
          collections: ['todos'],
          checkpoint: { id: 'cp', sequences: { todos: 0 }, timestamp: Date.now(), nodeId: 'node2' },
        })
      );

      // Wait for pull response on ws2
      await new Promise<void>((resolve) => {
        ws2.once('message', () => resolve());
      });

      // Now set up listener on ws2 for broadcast
      const broadcastPromise = new Promise<any>((resolve) => {
        ws2.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'pull-response' && msg.id.startsWith('broadcast_')) {
            resolve(msg);
          }
        });
      });

      // ws1 pushes a change
      ws1.send(
        JSON.stringify({
          type: 'push',
          id: 'push-1',
          timestamp: Date.now(),
          collection: 'todos',
          changes: [
            {
              operation: 'insert',
              documentId: 'doc-1',
              document: { _id: 'doc-1', title: 'Broadcast test' },
              timestamp: Date.now(),
              sequence: 0,
            },
          ],
          checkpoint: { id: 'cp', sequences: {}, timestamp: Date.now(), nodeId: 'node1' },
        })
      );

      // Wait for broadcast with timeout
      const broadcast = await Promise.race([
        broadcastPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);

      expect(broadcast).not.toBeNull();
      expect(broadcast.changes.todos).toBeDefined();
      expect(broadcast.changes.todos[0].documentId).toBe('doc-1');

      ws1.close();
      ws2.close();
    });
  });

  describe('change log persistence', () => {
    it('should persist changes in the change log', async () => {
      const p = getPort();
      const changeLog = createMemoryChangeLog();
      server = createServer({ port: p, path: '/sync', changeLog });
      await server.start();

      const ws = new WebSocket(`ws://localhost:${p}/sync?nodeId=n1`);
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));

      // Wait for push response
      const responsePromise = new Promise<any>((resolve) => {
        ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      });

      ws.send(
        JSON.stringify({
          type: 'push',
          id: 'push-1',
          timestamp: Date.now(),
          collection: 'todos',
          changes: [
            {
              operation: 'insert',
              documentId: 'doc-persist',
              document: { _id: 'doc-persist', title: 'Persisted' },
              timestamp: Date.now(),
              sequence: 0,
            },
          ],
          checkpoint: { id: 'cp', sequences: {}, timestamp: Date.now(), nodeId: 'n1' },
        })
      );

      await responsePromise;

      // Verify change log has the entry
      const seq = await changeLog.getCurrentSequence();
      expect(seq).toBeGreaterThan(0);

      const entries = await changeLog.getForCollection('todos', 0, 100);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].change.documentId).toBe('doc-persist');

      ws.close();
    });
  });

  describe('client disconnect cleanup', () => {
    it('should remove client on WebSocket close and not include in count', async () => {
      const p = getPort();
      server = createServer({ port: p, path: '/sync' });
      await server.start();

      const ws = new WebSocket(`ws://localhost:${p}/sync?nodeId=n1`);
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      await new Promise((r) => setTimeout(r, 50));

      expect(server.clientCount).toBe(1);

      ws.close();
      await new Promise((r) => setTimeout(r, 100));

      expect(server.clientCount).toBe(0);
    });

    it('should not broadcast to disconnected clients', async () => {
      const p = getPort();
      server = createServer({ port: p, path: '/sync' });
      await server.start();

      // Connect two clients
      const ws1 = new WebSocket(`ws://localhost:${p}/sync?nodeId=n1`);
      const ws2 = new WebSocket(`ws://localhost:${p}/sync?nodeId=n2`);
      await Promise.all([
        new Promise<void>((r) => ws1.on('open', () => r())),
        new Promise<void>((r) => ws2.on('open', () => r())),
      ]);

      // Subscribe ws2 to todos
      ws2.send(
        JSON.stringify({
          type: 'pull',
          id: 'p1',
          timestamp: Date.now(),
          collections: ['todos'],
          checkpoint: { id: 'cp', sequences: { todos: 0 }, timestamp: Date.now(), nodeId: 'n2' },
        })
      );
      await new Promise<void>((r) => ws2.once('message', () => r()));

      // Disconnect ws2
      ws2.close();
      await new Promise((r) => setTimeout(r, 100));

      // ws1 pushes a change - should not crash even though ws2 is gone
      const responsePromise = new Promise<any>((resolve) => {
        ws1.on('message', (data) => resolve(JSON.parse(data.toString())));
      });

      ws1.send(
        JSON.stringify({
          type: 'push',
          id: 'push-1',
          timestamp: Date.now(),
          collection: 'todos',
          changes: [
            {
              operation: 'insert',
              documentId: 'doc-x',
              document: { _id: 'doc-x', title: 'Test' },
              timestamp: Date.now(),
              sequence: 0,
            },
          ],
          checkpoint: { id: 'cp', sequences: {}, timestamp: Date.now(), nodeId: 'n1' },
        })
      );

      const response = await responsePromise;
      expect(response.type).toBe('push-response');
      expect(response.success).toBe(true);

      ws1.close();
    });
  });
});
