import type { Checkpoint } from '@pocket/sync';
import type { WebSocket } from 'ws';

/**
 * Connected client info
 */
export interface ConnectedClient {
  /** Client ID */
  id: string;
  /** WebSocket connection */
  socket: WebSocket;
  /** Client's node ID */
  nodeId: string;
  /** Collections the client is syncing */
  collections: Set<string>;
  /** Client's last checkpoint */
  checkpoint: Checkpoint | null;
  /** Connection timestamp */
  connectedAt: number;
  /** Last activity timestamp */
  lastActiveAt: number;
  /** User ID (if authenticated) */
  userId?: string;
  /** Metadata */
  metadata: Record<string, unknown>;
}

/**
 * Client manager for tracking connected clients
 */
export class ClientManager {
  private clients = new Map<string, ConnectedClient>();
  private clientsByUser = new Map<string, Set<string>>();
  private clientsByCollection = new Map<string, Set<string>>();

  /**
   * Add a client
   */
  add(client: Omit<ConnectedClient, 'connectedAt' | 'lastActiveAt'>): ConnectedClient {
    const fullClient: ConnectedClient = {
      ...client,
      connectedAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.clients.set(client.id, fullClient);

    // Track by user
    if (client.userId) {
      let userClients = this.clientsByUser.get(client.userId);
      if (!userClients) {
        userClients = new Set();
        this.clientsByUser.set(client.userId, userClients);
      }
      userClients.add(client.id);
    }

    // Track by collection
    for (const collection of client.collections) {
      let collectionClients = this.clientsByCollection.get(collection);
      if (!collectionClients) {
        collectionClients = new Set();
        this.clientsByCollection.set(collection, collectionClients);
      }
      collectionClients.add(client.id);
    }

    return fullClient;
  }

  /**
   * Get a client by ID
   */
  get(id: string): ConnectedClient | undefined {
    return this.clients.get(id);
  }

  /**
   * Remove a client
   */
  remove(id: string): boolean {
    const client = this.clients.get(id);
    if (!client) return false;

    this.clients.delete(id);

    // Remove from user tracking
    if (client.userId) {
      const userClients = this.clientsByUser.get(client.userId);
      if (userClients) {
        userClients.delete(id);
        if (userClients.size === 0) {
          this.clientsByUser.delete(client.userId);
        }
      }
    }

    // Remove from collection tracking
    for (const collection of client.collections) {
      const collectionClients = this.clientsByCollection.get(collection);
      if (collectionClients) {
        collectionClients.delete(id);
        if (collectionClients.size === 0) {
          this.clientsByCollection.delete(collection);
        }
      }
    }

    return true;
  }

  /**
   * Update client's last activity time
   */
  touch(id: string): void {
    const client = this.clients.get(id);
    if (client) {
      client.lastActiveAt = Date.now();
    }
  }

  /**
   * Update client's checkpoint
   */
  updateCheckpoint(id: string, checkpoint: Checkpoint): void {
    const client = this.clients.get(id);
    if (client) {
      client.checkpoint = checkpoint;
      client.lastActiveAt = Date.now();
    }
  }

  /**
   * Add collections to a client's subscription
   */
  addCollections(id: string, collections: string[]): void {
    const client = this.clients.get(id);
    if (!client) return;

    for (const collection of collections) {
      if (!client.collections.has(collection)) {
        client.collections.add(collection);

        let collectionClients = this.clientsByCollection.get(collection);
        if (!collectionClients) {
          collectionClients = new Set();
          this.clientsByCollection.set(collection, collectionClients);
        }
        collectionClients.add(id);
      }
    }
  }

  /**
   * Remove collections from a client's subscription
   */
  removeCollections(id: string, collections: string[]): void {
    const client = this.clients.get(id);
    if (!client) return;

    for (const collection of collections) {
      if (client.collections.has(collection)) {
        client.collections.delete(collection);

        const collectionClients = this.clientsByCollection.get(collection);
        if (collectionClients) {
          collectionClients.delete(id);
          if (collectionClients.size === 0) {
            this.clientsByCollection.delete(collection);
          }
        }
      }
    }
  }

  /**
   * Get all clients
   */
  getAll(): ConnectedClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get clients for a user
   */
  getByUser(userId: string): ConnectedClient[] {
    const clientIds = this.clientsByUser.get(userId);
    if (!clientIds) return [];
    return Array.from(clientIds)
      .map((id) => this.clients.get(id))
      .filter((c): c is ConnectedClient => c !== undefined);
  }

  /**
   * Get clients subscribed to a collection
   */
  getByCollection(collection: string): ConnectedClient[] {
    const clientIds = this.clientsByCollection.get(collection);
    if (!clientIds) return [];
    return Array.from(clientIds)
      .map((id) => this.clients.get(id))
      .filter((c): c is ConnectedClient => c !== undefined);
  }

  /**
   * Get clients except one (for broadcasting)
   */
  getOthers(exceptId: string, collection?: string): ConnectedClient[] {
    if (collection) {
      return this.getByCollection(collection).filter((c) => c.id !== exceptId);
    }
    return this.getAll().filter((c) => c.id !== exceptId);
  }

  /**
   * Get total client count
   */
  get count(): number {
    return this.clients.size;
  }

  /**
   * Check if a client exists
   */
  has(id: string): boolean {
    return this.clients.has(id);
  }

  /**
   * Clear all clients
   */
  clear(): void {
    this.clients.clear();
    this.clientsByUser.clear();
    this.clientsByCollection.clear();
  }

  /**
   * Remove inactive clients
   */
  removeInactive(maxInactiveMs: number): string[] {
    const now = Date.now();
    const removed: string[] = [];

    for (const [id, client] of this.clients) {
      if (now - client.lastActiveAt > maxInactiveMs) {
        this.remove(id);
        removed.push(id);
      }
    }

    return removed;
  }
}

/**
 * Create a client manager
 */
export function createClientManager(): ClientManager {
  return new ClientManager();
}
