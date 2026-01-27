import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { MemoryStorage } from './storage/memory-storage.js';
import { createSyncServer, SyncServer } from './sync-server.js';
import type { ServerEvent } from './types.js';

// Helper to create a test client
function createTestClient(serverPort: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${serverPort}/sync`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

// Helper to wait for a message
function waitForMessage<T>(ws: WebSocket, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeout);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)) as T);
    });
  });
}

// Helper to send message and wait for response
async function sendAndReceive<T>(ws: WebSocket, message: object): Promise<T> {
  const responsePromise = waitForMessage<T>(ws);
  ws.send(JSON.stringify(message));
  return responsePromise;
}

describe('SyncServer', () => {
  let server: SyncServer;
  let testPort: number;

  beforeEach(() => {
    // Use random high port to avoid conflicts
    testPort = 30000 + Math.floor(Math.random() * 10000);
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('constructor', () => {
    it('creates server with default config', () => {
      server = new SyncServer();
      const info = server.getInfo();

      expect(info.running).toBe(false);
      expect(info.port).toBe(8080);
      expect(info.host).toBe('0.0.0.0');
    });

    it('creates server with custom config', () => {
      server = new SyncServer({
        port: testPort,
        host: '127.0.0.1',
        path: '/ws',
      });
      const info = server.getInfo();

      expect(info.port).toBe(testPort);
      expect(info.host).toBe('127.0.0.1');
    });

    it('creates server with custom storage', () => {
      const storage = new MemoryStorage();
      server = new SyncServer({ port: testPort, storage });

      expect(server).toBeDefined();
    });

    it('creates server with rate limiting enabled', () => {
      server = new SyncServer({ port: testPort, rateLimit: true });
      expect(server.getInfo().rateLimit).toBe(true);
    });

    it('creates server with rate limiting config', () => {
      server = new SyncServer({
        port: testPort,
        rateLimit: { maxTokens: 50 },
      });
      expect(server.getInfo().rateLimit).toBe(true);
    });

    it('creates server with compression enabled', () => {
      server = new SyncServer({ port: testPort, compression: true });
      expect(server.getInfo().compression).toBe(true);
    });

    it('creates server with compression config', () => {
      server = new SyncServer({
        port: testPort,
        compression: { enabled: true, level: 9 },
      });
      expect(server.getInfo().compression).toBe(true);
    });
  });

  describe('start and stop', () => {
    it('starts the server', async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.start();

      expect(server.getInfo().running).toBe(true);
    });

    it('throws when starting already running server', async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.start();

      await expect(server.start()).rejects.toThrow('Server already running');
    });

    it('stops the server', async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.start();
      await server.stop();

      expect(server.getInfo().running).toBe(false);
    });

    it('handles stop when not running', async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.stop(); // Should not throw
    });
  });

  describe('client connection', () => {
    beforeEach(async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.start();
    });

    it('accepts client connections', async () => {
      const ws = await createTestClient(testPort);

      // Send connect message
      const response = await sendAndReceive<{ type: string; clientId: string }>(ws, {
        type: 'connect',
        id: 'msg1',
        timestamp: Date.now(),
      });

      expect(response.type).toBe('connected');
      expect(response.clientId).toBeDefined();
      expect(server.getClientCount()).toBe(1);

      ws.close();
    });

    it('rejects non-connect first message', async () => {
      const ws = await createTestClient(testPort);

      const closePromise = new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code));
      });

      ws.send(
        JSON.stringify({
          type: 'ping',
          id: 'msg1',
          timestamp: Date.now(),
        })
      );

      const closeCode = await closePromise;
      expect(closeCode).toBe(4002);
    });

    it('includes server info in connected response', async () => {
      const ws = await createTestClient(testPort);

      const response = await sendAndReceive<{
        type: string;
        serverInfo: { version: string; capabilities: string[] };
      }>(ws, {
        type: 'connect',
        id: 'msg1',
        timestamp: Date.now(),
      });

      expect(response.serverInfo).toBeDefined();
      expect(response.serverInfo.version).toBe('1.0.0');
      expect(response.serverInfo.capabilities).toContain('push');
      expect(response.serverInfo.capabilities).toContain('pull');
      expect(response.serverInfo.capabilities).toContain('subscribe');

      ws.close();
    });

    it('removes client on disconnect', async () => {
      const ws = await createTestClient(testPort);

      await sendAndReceive(ws, {
        type: 'connect',
        id: 'msg1',
        timestamp: Date.now(),
      });

      expect(server.getClientCount()).toBe(1);

      ws.close();
      // Wait for disconnect to be processed
      await new Promise((r) => setTimeout(r, 100));

      expect(server.getClientCount()).toBe(0);
    });
  });

  describe('authentication', () => {
    it('requires auth when configured', async () => {
      server = new SyncServer({
        port: testPort,
        logging: false,
        requireAuth: true,
        validateAuth: async (token) => token === 'valid-token',
      });
      await server.start();

      const ws = await createTestClient(testPort);

      const closePromise = new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code));
      });

      ws.send(
        JSON.stringify({
          type: 'connect',
          id: 'msg1',
          timestamp: Date.now(),
          // No auth token
        })
      );

      const closeCode = await closePromise;
      expect(closeCode).toBe(4003); // Authentication required
    });

    it('accepts valid auth token', async () => {
      server = new SyncServer({
        port: testPort,
        logging: false,
        requireAuth: true,
        validateAuth: async (token) => token === 'valid-token',
      });
      await server.start();

      const ws = await createTestClient(testPort);

      const response = await sendAndReceive<{ type: string }>(ws, {
        type: 'connect',
        id: 'msg1',
        timestamp: Date.now(),
        authToken: 'valid-token',
      });

      expect(response.type).toBe('connected');
      ws.close();
    });

    it('rejects invalid auth token', async () => {
      server = new SyncServer({
        port: testPort,
        logging: false,
        requireAuth: true,
        validateAuth: async (token) => token === 'valid-token',
      });
      await server.start();

      const ws = await createTestClient(testPort);

      const closePromise = new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code));
      });

      ws.send(
        JSON.stringify({
          type: 'connect',
          id: 'msg1',
          timestamp: Date.now(),
          authToken: 'invalid-token',
        })
      );

      const closeCode = await closePromise;
      expect(closeCode).toBe(4004); // Authentication failed
    });

    it('stores auth info from validator', async () => {
      server = new SyncServer({
        port: testPort,
        logging: false,
        requireAuth: true,
        validateAuth: async () => ({ userId: 'user123', role: 'admin' }),
      });
      await server.start();

      const ws = await createTestClient(testPort);

      await sendAndReceive(ws, {
        type: 'connect',
        id: 'msg1',
        timestamp: Date.now(),
        authToken: 'any-token',
      });

      const clients = server.getClients();
      expect(clients[0].auth?.userId).toBe('user123');
      expect(clients[0].auth?.role).toBe('admin');

      ws.close();
    });
  });

  describe('subscribe and unsubscribe', () => {
    let ws: WebSocket;

    beforeEach(async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.start();
      ws = await createTestClient(testPort);
      await sendAndReceive(ws, {
        type: 'connect',
        id: 'conn1',
        timestamp: Date.now(),
      });
    });

    afterEach(() => {
      ws?.close();
    });

    it('handles subscribe message', async () => {
      const response = await sendAndReceive<{ type: string; success: boolean }>(ws, {
        type: 'subscribe',
        id: 'sub1',
        collection: 'users',
        timestamp: Date.now(),
      });

      expect(response.type).toBe('ack');
      expect(response.success).toBe(true);

      const clients = server.getClients();
      expect(clients[0].subscriptions.has('users')).toBe(true);
    });

    it('handles unsubscribe message', async () => {
      // First subscribe
      await sendAndReceive(ws, {
        type: 'subscribe',
        id: 'sub1',
        collection: 'users',
        timestamp: Date.now(),
      });

      // Then unsubscribe
      const response = await sendAndReceive<{ type: string; success: boolean }>(ws, {
        type: 'unsubscribe',
        id: 'unsub1',
        collection: 'users',
        timestamp: Date.now(),
      });

      expect(response.type).toBe('ack');
      expect(response.success).toBe(true);

      const clients = server.getClients();
      expect(clients[0].subscriptions.has('users')).toBe(false);
    });

    it('sends initial sync data when lastSyncAt provided', async () => {
      // Record some changes first
      const storage = new MemoryStorage();
      await storage.recordChange({
        type: 'create',
        documentId: 'doc1',
        document: { _id: 'doc1', name: 'Test', _collection: 'users' },
        timestamp: 1000,
        clientId: 'other-client',
      });

      server = new SyncServer({ port: testPort + 1, logging: false, storage });
      await server.start();

      const ws2 = await createTestClient(testPort + 1);
      await sendAndReceive(ws2, {
        type: 'connect',
        id: 'conn1',
        timestamp: Date.now(),
      });

      // Subscribe with lastSyncAt
      ws2.send(
        JSON.stringify({
          type: 'subscribe',
          id: 'sub1',
          collection: 'users',
          lastSyncAt: 0,
          timestamp: Date.now(),
        })
      );

      // Should get ack then sync message
      const ack = await waitForMessage<{ type: string }>(ws2);
      expect(ack.type).toBe('ack');

      const sync = await waitForMessage<{ type: string; changes: unknown[] }>(ws2);
      expect(sync.type).toBe('sync');
      expect(sync.changes.length).toBeGreaterThan(0);

      ws2.close();
      await server.stop();
    });
  });

  describe('push and pull', () => {
    let ws: WebSocket;

    beforeEach(async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.start();
      ws = await createTestClient(testPort);
      await sendAndReceive(ws, {
        type: 'connect',
        id: 'conn1',
        timestamp: Date.now(),
      });
    });

    afterEach(() => {
      ws?.close();
    });

    it('handles push message', async () => {
      const response = await sendAndReceive<{ type: string; success: boolean }>(ws, {
        type: 'push',
        id: 'push1',
        collection: 'users',
        changes: [
          {
            type: 'create',
            documentId: 'doc1',
            document: { _id: 'doc1', name: 'Test' },
            timestamp: Date.now(),
          },
        ],
        timestamp: Date.now(),
      });

      expect(response.type).toBe('ack');
      expect(response.success).toBe(true);
    });

    it('handles pull message', async () => {
      const response = await sendAndReceive<{
        type: string;
        collection: string;
        changes: unknown[];
      }>(ws, {
        type: 'pull',
        id: 'pull1',
        collection: 'users',
        timestamp: Date.now(),
      });

      expect(response.type).toBe('sync');
      expect(response.collection).toBe('users');
      expect(Array.isArray(response.changes)).toBe(true);
    });

    it('broadcasts push to other subscribers', async () => {
      // Create second client
      const ws2 = await createTestClient(testPort);
      await sendAndReceive(ws2, {
        type: 'connect',
        id: 'conn2',
        timestamp: Date.now(),
      });

      // Both subscribe to users
      await sendAndReceive(ws, {
        type: 'subscribe',
        id: 'sub1',
        collection: 'users',
        timestamp: Date.now(),
      });
      await sendAndReceive(ws2, {
        type: 'subscribe',
        id: 'sub2',
        collection: 'users',
        timestamp: Date.now(),
      });

      // Set up listener for sync message on ws2
      const syncPromise = waitForMessage<{ type: string; changes: unknown[] }>(ws2);

      // Push from ws
      ws.send(
        JSON.stringify({
          type: 'push',
          id: 'push1',
          collection: 'users',
          changes: [
            {
              type: 'create',
              documentId: 'doc1',
              document: { _id: 'doc1', name: 'Test' },
              timestamp: Date.now(),
            },
          ],
          timestamp: Date.now(),
        })
      );

      // ws2 should receive sync
      const syncMsg = await syncPromise;
      expect(syncMsg.type).toBe('sync');
      expect(syncMsg.changes).toHaveLength(1);

      ws2.close();
    });
  });

  describe('ping/pong', () => {
    let ws: WebSocket;

    beforeEach(async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.start();
      ws = await createTestClient(testPort);
      await sendAndReceive(ws, {
        type: 'connect',
        id: 'conn1',
        timestamp: Date.now(),
      });
    });

    afterEach(() => {
      ws?.close();
    });

    it('responds to ping with pong', async () => {
      const response = await sendAndReceive<{ type: string; id: string }>(ws, {
        type: 'ping',
        id: 'ping1',
        timestamp: Date.now(),
      });

      expect(response.type).toBe('pong');
      expect(response.id).toBe('ping1');
    });
  });

  describe('error handling', () => {
    let ws: WebSocket;

    beforeEach(async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.start();
      ws = await createTestClient(testPort);
      await sendAndReceive(ws, {
        type: 'connect',
        id: 'conn1',
        timestamp: Date.now(),
      });
    });

    afterEach(() => {
      ws?.close();
    });

    it('returns error for unknown message type', async () => {
      const response = await sendAndReceive<{ type: string; code: string }>(ws, {
        type: 'unknown',
        id: 'msg1',
        timestamp: Date.now(),
      });

      expect(response.type).toBe('error');
      expect(response.code).toBe('UNKNOWN_MESSAGE');
    });
  });

  describe('events', () => {
    it('emits client_connected event', async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.start();

      const events: ServerEvent[] = [];
      server.onEvent((event) => events.push(event));

      const ws = await createTestClient(testPort);
      await sendAndReceive(ws, {
        type: 'connect',
        id: 'conn1',
        timestamp: Date.now(),
      });

      expect(events.some((e) => e.type === 'client_connected')).toBe(true);

      ws.close();
    });

    it('emits client_disconnected event', async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.start();

      const events: ServerEvent[] = [];
      server.onEvent((event) => events.push(event));

      const ws = await createTestClient(testPort);
      await sendAndReceive(ws, {
        type: 'connect',
        id: 'conn1',
        timestamp: Date.now(),
      });

      ws.close();
      await new Promise((r) => setTimeout(r, 100));

      expect(events.some((e) => e.type === 'client_disconnected')).toBe(true);
    });

    it('emits message_received event', async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.start();

      const events: ServerEvent[] = [];
      server.onEvent((event) => events.push(event));

      const ws = await createTestClient(testPort);
      await sendAndReceive(ws, {
        type: 'connect',
        id: 'conn1',
        timestamp: Date.now(),
      });

      await sendAndReceive(ws, {
        type: 'ping',
        id: 'ping1',
        timestamp: Date.now(),
      });

      expect(events.some((e) => e.type === 'message_received')).toBe(true);

      ws.close();
    });

    it('allows removing event handler', async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.start();

      const events: ServerEvent[] = [];
      const unsubscribe = server.onEvent((event) => events.push(event));

      unsubscribe();

      const ws = await createTestClient(testPort);
      await sendAndReceive(ws, {
        type: 'connect',
        id: 'conn1',
        timestamp: Date.now(),
      });

      // Events should not be recorded after unsubscribe
      expect(events.filter((e) => e.type === 'client_connected')).toHaveLength(0);

      ws.close();
    });
  });

  describe('getClients and getClientCount', () => {
    it('returns connected clients', async () => {
      server = new SyncServer({ port: testPort, logging: false });
      await server.start();

      const ws = await createTestClient(testPort);
      await sendAndReceive(ws, {
        type: 'connect',
        id: 'conn1',
        timestamp: Date.now(),
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      const clients = server.getClients();
      expect(clients).toHaveLength(1);
      expect(clients[0].info?.name).toBe('test-client');

      ws.close();
    });
  });

  describe('getInfo', () => {
    it('returns server info', async () => {
      server = new SyncServer({
        port: testPort,
        logging: false,
        compression: true,
        rateLimit: true,
      });
      await server.start();

      const info = server.getInfo();

      expect(info.running).toBe(true);
      expect(info.port).toBe(testPort);
      expect(info.clientCount).toBe(0);
      expect(info.compression).toBe(true);
      expect(info.rateLimit).toBe(true);
      expect(Array.isArray(info.collections)).toBe(true);
    });
  });

  describe('createSyncServer factory', () => {
    it('creates a SyncServer instance', () => {
      server = createSyncServer({ port: testPort });
      expect(server).toBeInstanceOf(SyncServer);
    });

    it('creates with no config', () => {
      server = createSyncServer();
      expect(server).toBeInstanceOf(SyncServer);
    });
  });
});
