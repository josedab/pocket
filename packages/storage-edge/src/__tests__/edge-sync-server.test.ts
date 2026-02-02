import { describe, it, expect, beforeEach } from 'vitest';
import { EdgeSyncServer, type EdgeRequest, type SyncChange } from '../edge-sync-server.js';
import { InMemorySyncStorage } from '../in-memory-sync-storage.js';

describe('EdgeSyncServer', () => {
  let storage: InMemorySyncStorage;
  let server: EdgeSyncServer;

  beforeEach(() => {
    storage = new InMemorySyncStorage();
    server = new EdgeSyncServer({
      storage,
      conflictStrategy: 'last-write-wins',
    });
  });

  describe('health endpoint', () => {
    it('should return healthy status', async () => {
      const response = await server.handleRequest({
        method: 'GET',
        url: 'https://example.com/health',
        headers: {},
      });

      expect(response.status).toBe(200);
      const body = response.body as Record<string, unknown>;
      expect(body.status).toBe('healthy');
    });
  });

  describe('push endpoint', () => {
    it('should accept and store changes', async () => {
      const changes: SyncChange[] = [
        {
          id: 'c1',
          collection: 'todos',
          documentId: 'doc1',
          operation: 'insert',
          data: { title: 'Hello', completed: false },
          timestamp: Date.now(),
          clientId: 'client1',
          checkpoint: 'cp1',
        },
      ];

      const response = await server.handleRequest({
        method: 'POST',
        url: 'https://example.com/push',
        headers: {},
        body: { changes, clientId: 'client1' },
      });

      expect(response.status).toBe(200);
      const body = response.body as Record<string, unknown>;
      expect(body.applied).toBe(1);
      expect(storage.getChangeCount()).toBe(1);
    });

    it('should reject empty changes', async () => {
      const response = await server.handleRequest({
        method: 'POST',
        url: 'https://example.com/push',
        headers: {},
        body: {},
      });

      expect(response.status).toBe(400);
    });

    it('should reject too many changes', async () => {
      const server2 = new EdgeSyncServer({
        storage,
        maxChangesPerRequest: 2,
      });

      const changes: SyncChange[] = Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        collection: 'todos',
        documentId: `doc${i}`,
        operation: 'insert' as const,
        data: { title: `Item ${i}` },
        timestamp: Date.now(),
        clientId: 'client1',
        checkpoint: `cp${i}`,
      }));

      const response = await server2.handleRequest({
        method: 'POST',
        url: 'https://example.com/push',
        headers: {},
        body: { changes, clientId: 'client1' },
      });

      expect(response.status).toBe(400);
    });
  });

  describe('pull endpoint', () => {
    it('should return changes since checkpoint', async () => {
      // First push some data
      await storage.putChanges([
        {
          id: 'c1',
          collection: 'todos',
          documentId: 'doc1',
          operation: 'insert',
          data: { title: 'First' },
          timestamp: 1000,
          clientId: 'client2',
          checkpoint: 'cp1',
        },
        {
          id: 'c2',
          collection: 'todos',
          documentId: 'doc2',
          operation: 'insert',
          data: { title: 'Second' },
          timestamp: 2000,
          clientId: 'client2',
          checkpoint: 'cp2',
        },
      ]);

      await storage.setCheckpoint('client1', 'cp1');

      const response = await server.handleRequest({
        method: 'POST',
        url: 'https://example.com/pull',
        headers: {},
        body: { clientId: 'client1', collections: ['todos'] },
      });

      expect(response.status).toBe(200);
      const body = response.body as { changes: SyncChange[]; hasMore: boolean };
      expect(body.changes).toHaveLength(1);
      expect(body.changes[0]!.documentId).toBe('doc2');
    });

    it('should reject missing clientId', async () => {
      const response = await server.handleRequest({
        method: 'POST',
        url: 'https://example.com/pull',
        headers: {},
        body: {},
      });

      expect(response.status).toBe(400);
    });
  });

  describe('CORS', () => {
    it('should handle OPTIONS preflight', async () => {
      const response = await server.handleRequest({
        method: 'OPTIONS',
        url: 'https://example.com/push',
        headers: {},
      });

      expect(response.status).toBe(204);
      expect(response.headers['Access-Control-Allow-Methods']).toContain('POST');
    });
  });

  describe('authentication', () => {
    it('should reject unauthenticated requests', async () => {
      const authServer = new EdgeSyncServer({
        storage,
        authenticate: async () => ({ authenticated: false, error: 'Invalid token' }),
      });

      const response = await authServer.handleRequest({
        method: 'GET',
        url: 'https://example.com/health',
        headers: {},
      });

      expect(response.status).toBe(401);
    });
  });

  describe('stats', () => {
    it('should track request stats', async () => {
      await server.handleRequest({
        method: 'GET',
        url: 'https://example.com/health',
        headers: {},
      });
      await server.handleRequest({
        method: 'GET',
        url: 'https://example.com/health',
        headers: {},
      });

      const stats = server.getStats();
      expect(stats.totalRequests).toBe(2);
    });
  });

  describe('fetch handler', () => {
    it('should create a standard fetch handler', async () => {
      const handler = server.asFetchHandler();
      expect(typeof handler).toBe('function');
    });
  });
});
