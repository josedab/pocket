import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClientManager, createClientManager } from './client-manager.js';
import type { WebSocket } from 'ws';

// Mock WebSocket
const createMockSocket = (): WebSocket =>
  ({
    readyState: 1, // OPEN
    send: vi.fn(),
    close: vi.fn(),
  }) as unknown as WebSocket;

describe('ClientManager', () => {
  let manager: ClientManager;

  beforeEach(() => {
    manager = createClientManager();
  });

  describe('add', () => {
    it('should add a client', () => {
      const socket = createMockSocket();

      const client = manager.add({
        id: 'client1',
        socket,
        nodeId: 'node1',
        collections: new Set(['users']),
        checkpoint: null,
        metadata: {},
      });

      expect(client.id).toBe('client1');
      expect(client.nodeId).toBe('node1');
      expect(client.connectedAt).toBeDefined();
      expect(client.lastActiveAt).toBeDefined();
    });

    it('should track client by user', () => {
      const socket = createMockSocket();

      manager.add({
        id: 'client1',
        socket,
        nodeId: 'node1',
        collections: new Set(),
        checkpoint: null,
        userId: 'user1',
        metadata: {},
      });

      const userClients = manager.getByUser('user1');

      expect(userClients).toHaveLength(1);
      expect(userClients[0]?.id).toBe('client1');
    });

    it('should track client by collection', () => {
      const socket = createMockSocket();

      manager.add({
        id: 'client1',
        socket,
        nodeId: 'node1',
        collections: new Set(['users', 'posts']),
        checkpoint: null,
        metadata: {},
      });

      const usersClients = manager.getByCollection('users');
      const postsClients = manager.getByCollection('posts');

      expect(usersClients).toHaveLength(1);
      expect(postsClients).toHaveLength(1);
    });
  });

  describe('get', () => {
    it('should get a client by id', () => {
      const socket = createMockSocket();

      manager.add({
        id: 'client1',
        socket,
        nodeId: 'node1',
        collections: new Set(),
        checkpoint: null,
        metadata: {},
      });

      const client = manager.get('client1');

      expect(client).toBeDefined();
      expect(client?.id).toBe('client1');
    });

    it('should return undefined for non-existent client', () => {
      const client = manager.get('nonexistent');

      expect(client).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('should remove a client', () => {
      const socket = createMockSocket();

      manager.add({
        id: 'client1',
        socket,
        nodeId: 'node1',
        collections: new Set(['users']),
        checkpoint: null,
        userId: 'user1',
        metadata: {},
      });

      const removed = manager.remove('client1');

      expect(removed).toBe(true);
      expect(manager.get('client1')).toBeUndefined();
      expect(manager.getByUser('user1')).toHaveLength(0);
      expect(manager.getByCollection('users')).toHaveLength(0);
    });

    it('should return false for non-existent client', () => {
      const removed = manager.remove('nonexistent');

      expect(removed).toBe(false);
    });
  });

  describe('touch', () => {
    it('should update lastActiveAt', async () => {
      const socket = createMockSocket();

      manager.add({
        id: 'client1',
        socket,
        nodeId: 'node1',
        collections: new Set(),
        checkpoint: null,
        metadata: {},
      });

      const client1 = manager.get('client1');
      const initialTime = client1?.lastActiveAt ?? 0;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      manager.touch('client1');

      const client2 = manager.get('client1');

      expect(client2?.lastActiveAt).toBeGreaterThan(initialTime);
    });
  });

  describe('updateCheckpoint', () => {
    it('should update checkpoint and lastActiveAt', () => {
      const socket = createMockSocket();

      manager.add({
        id: 'client1',
        socket,
        nodeId: 'node1',
        collections: new Set(),
        checkpoint: null,
        metadata: {},
      });

      const checkpoint = {
        nodeId: 'node1',
        sequences: { users: 5 },
        timestamp: Date.now(),
        hash: 'abc123',
      };

      manager.updateCheckpoint('client1', checkpoint);

      const client = manager.get('client1');

      expect(client?.checkpoint).toEqual(checkpoint);
    });
  });

  describe('addCollections', () => {
    it('should add collections to a client', () => {
      const socket = createMockSocket();

      manager.add({
        id: 'client1',
        socket,
        nodeId: 'node1',
        collections: new Set(['users']),
        checkpoint: null,
        metadata: {},
      });

      manager.addCollections('client1', ['posts', 'comments']);

      const client = manager.get('client1');

      expect(client?.collections.has('users')).toBe(true);
      expect(client?.collections.has('posts')).toBe(true);
      expect(client?.collections.has('comments')).toBe(true);
      expect(manager.getByCollection('posts')).toHaveLength(1);
    });

    it('should not duplicate existing collections', () => {
      const socket = createMockSocket();

      manager.add({
        id: 'client1',
        socket,
        nodeId: 'node1',
        collections: new Set(['users']),
        checkpoint: null,
        metadata: {},
      });

      manager.addCollections('client1', ['users', 'posts']);

      const client = manager.get('client1');

      expect(client?.collections.size).toBe(2);
    });
  });

  describe('removeCollections', () => {
    it('should remove collections from a client', () => {
      const socket = createMockSocket();

      manager.add({
        id: 'client1',
        socket,
        nodeId: 'node1',
        collections: new Set(['users', 'posts', 'comments']),
        checkpoint: null,
        metadata: {},
      });

      manager.removeCollections('client1', ['posts', 'comments']);

      const client = manager.get('client1');

      expect(client?.collections.has('users')).toBe(true);
      expect(client?.collections.has('posts')).toBe(false);
      expect(client?.collections.has('comments')).toBe(false);
      expect(manager.getByCollection('posts')).toHaveLength(0);
    });
  });

  describe('getAll', () => {
    it('should return all clients', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      manager.add({
        id: 'client1',
        socket: socket1,
        nodeId: 'node1',
        collections: new Set(),
        checkpoint: null,
        metadata: {},
      });

      manager.add({
        id: 'client2',
        socket: socket2,
        nodeId: 'node2',
        collections: new Set(),
        checkpoint: null,
        metadata: {},
      });

      const clients = manager.getAll();

      expect(clients).toHaveLength(2);
    });
  });

  describe('getByUser', () => {
    it('should get all clients for a user', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();
      const socket3 = createMockSocket();

      manager.add({
        id: 'client1',
        socket: socket1,
        nodeId: 'node1',
        collections: new Set(),
        checkpoint: null,
        userId: 'user1',
        metadata: {},
      });

      manager.add({
        id: 'client2',
        socket: socket2,
        nodeId: 'node2',
        collections: new Set(),
        checkpoint: null,
        userId: 'user1',
        metadata: {},
      });

      manager.add({
        id: 'client3',
        socket: socket3,
        nodeId: 'node3',
        collections: new Set(),
        checkpoint: null,
        userId: 'user2',
        metadata: {},
      });

      const user1Clients = manager.getByUser('user1');
      const user2Clients = manager.getByUser('user2');

      expect(user1Clients).toHaveLength(2);
      expect(user2Clients).toHaveLength(1);
    });

    it('should return empty array for unknown user', () => {
      const clients = manager.getByUser('unknown');

      expect(clients).toHaveLength(0);
    });
  });

  describe('getOthers', () => {
    it('should get all clients except specified one', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();
      const socket3 = createMockSocket();

      manager.add({
        id: 'client1',
        socket: socket1,
        nodeId: 'node1',
        collections: new Set(),
        checkpoint: null,
        metadata: {},
      });

      manager.add({
        id: 'client2',
        socket: socket2,
        nodeId: 'node2',
        collections: new Set(),
        checkpoint: null,
        metadata: {},
      });

      manager.add({
        id: 'client3',
        socket: socket3,
        nodeId: 'node3',
        collections: new Set(),
        checkpoint: null,
        metadata: {},
      });

      const others = manager.getOthers('client1');

      expect(others).toHaveLength(2);
      expect(others.find((c) => c.id === 'client1')).toBeUndefined();
    });

    it('should filter by collection', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();
      const socket3 = createMockSocket();

      manager.add({
        id: 'client1',
        socket: socket1,
        nodeId: 'node1',
        collections: new Set(['users']),
        checkpoint: null,
        metadata: {},
      });

      manager.add({
        id: 'client2',
        socket: socket2,
        nodeId: 'node2',
        collections: new Set(['users']),
        checkpoint: null,
        metadata: {},
      });

      manager.add({
        id: 'client3',
        socket: socket3,
        nodeId: 'node3',
        collections: new Set(['posts']),
        checkpoint: null,
        metadata: {},
      });

      const others = manager.getOthers('client1', 'users');

      expect(others).toHaveLength(1);
      expect(others[0]?.id).toBe('client2');
    });
  });

  describe('count', () => {
    it('should return correct count', () => {
      expect(manager.count).toBe(0);

      const socket = createMockSocket();

      manager.add({
        id: 'client1',
        socket,
        nodeId: 'node1',
        collections: new Set(),
        checkpoint: null,
        metadata: {},
      });

      expect(manager.count).toBe(1);

      manager.remove('client1');

      expect(manager.count).toBe(0);
    });
  });

  describe('has', () => {
    it('should check if client exists', () => {
      const socket = createMockSocket();

      manager.add({
        id: 'client1',
        socket,
        nodeId: 'node1',
        collections: new Set(),
        checkpoint: null,
        metadata: {},
      });

      expect(manager.has('client1')).toBe(true);
      expect(manager.has('nonexistent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all clients', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      manager.add({
        id: 'client1',
        socket: socket1,
        nodeId: 'node1',
        collections: new Set(['users']),
        checkpoint: null,
        userId: 'user1',
        metadata: {},
      });

      manager.add({
        id: 'client2',
        socket: socket2,
        nodeId: 'node2',
        collections: new Set(['posts']),
        checkpoint: null,
        userId: 'user2',
        metadata: {},
      });

      manager.clear();

      expect(manager.count).toBe(0);
      expect(manager.getAll()).toHaveLength(0);
      expect(manager.getByUser('user1')).toHaveLength(0);
      expect(manager.getByCollection('users')).toHaveLength(0);
    });
  });

  describe('removeInactive', () => {
    it('should remove inactive clients', async () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      manager.add({
        id: 'client1',
        socket: socket1,
        nodeId: 'node1',
        collections: new Set(),
        checkpoint: null,
        metadata: {},
      });

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      manager.add({
        id: 'client2',
        socket: socket2,
        nodeId: 'node2',
        collections: new Set(),
        checkpoint: null,
        metadata: {},
      });

      // Touch client2 to keep it active
      manager.touch('client2');

      // Remove clients inactive for more than 30ms
      const removed = manager.removeInactive(30);

      expect(removed).toHaveLength(1);
      expect(removed[0]).toBe('client1');
      expect(manager.has('client1')).toBe(false);
      expect(manager.has('client2')).toBe(true);
    });
  });
});
