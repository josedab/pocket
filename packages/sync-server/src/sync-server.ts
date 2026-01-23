/**
 * Zero-Config Sync Server
 */

import type { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { MemoryStorage } from './storage/memory-storage.js';
import type {
  ConnectedClient,
  ConnectMessage,
  LogLevel,
  PullMessage,
  PushMessage,
  ServerEvent,
  StorageBackend,
  SubscribeMessage,
  SyncServerConfig,
  UnsubscribeMessage,
} from './types.js';
import { DEFAULT_SERVER_CONFIG } from './types.js';

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Internal config type
 */
interface InternalConfig {
  port: number;
  host: string;
  path: string;
  requireAuth: boolean;
  corsOrigins: string[] | '*';
  heartbeatInterval: number;
  clientTimeout: number;
  maxMessageSize: number;
  logging: boolean | LogLevel;
  validateAuth?: (token: string) => Promise<boolean | { userId: string; [key: string]: unknown }>;
}

/**
 * Zero-config sync server for Pocket
 */
export class SyncServer {
  private readonly config: InternalConfig;
  private readonly storage: StorageBackend;
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<string, ConnectedClient>();
  private readonly collectionSubscribers = new Map<string, Set<string>>();
  private heartbeatInterval_: ReturnType<typeof setInterval> | null = null;
  private readonly eventHandlers: ((event: ServerEvent) => void)[] = [];

  constructor(config: SyncServerConfig = {}) {
    this.config = {
      ...DEFAULT_SERVER_CONFIG,
      ...config,
    };

    this.storage = config.storage ?? new MemoryStorage();
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (this.wss) {
      throw new Error('Server already running');
    }

    // Initialize storage
    await this.storage.init?.();

    // Create WebSocket server
    this.wss = new WebSocketServer({
      port: this.config.port,
      host: this.config.host,
      path: this.config.path,
      maxPayload: this.config.maxMessageSize,
    });

    this.wss.on('connection', (socket, request) => {
      void this.handleConnection(socket, request);
    });

    this.wss.on('error', (error) => {
      this.log('error', 'Server error:', error);
      this.emitEvent('error', undefined, { error });
    });

    // Start heartbeat
    this.startHeartbeat();

    this.log(
      'info',
      `Sync server started on ${this.config.host}:${this.config.port}${this.config.path}`
    );
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (!this.wss) return;

    // Stop heartbeat
    if (this.heartbeatInterval_) {
      clearInterval(this.heartbeatInterval_);
      this.heartbeatInterval_ = null;
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      const socket = client.socket as WebSocket;
      socket.close(1001, 'Server shutting down');
    }

    this.clients.clear();
    this.collectionSubscribers.clear();

    // Close server
    await new Promise<void>((resolve, reject) => {
      this.wss!.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    this.wss = null;

    // Close storage
    await this.storage.close?.();

    this.log('info', 'Sync server stopped');
  }

  /**
   * Handle new WebSocket connection
   */
  private async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    const clientId = generateId();

    this.log('debug', `New connection from ${request.socket.remoteAddress}`);

    // Set up message handler
    socket.on('message', (data: Buffer) => {
      void (async () => {
        try {
          const message = JSON.parse(String(data)) as {
            type: string;
            id: string;
            timestamp: number;
          };
          await this.handleMessage(clientId, message);
        } catch (error) {
          this.log('error', 'Error handling message:', error);
          this.sendError(socket, 'INVALID_MESSAGE', 'Invalid message format');
        }
      })();
    });

    socket.on('close', () => {
      this.handleDisconnect(clientId);
    });

    socket.on('error', (error) => {
      this.log('error', `Client ${clientId} error:`, error);
    });

    // Wait for connect message with auth
    const connectTimeout = setTimeout(() => {
      if (!this.clients.has(clientId)) {
        socket.close(4001, 'Connection timeout');
      }
    }, 10000);

    socket.once('message', (data: Buffer) => {
      clearTimeout(connectTimeout);

      void (async () => {
        try {
          const message = JSON.parse(String(data)) as ConnectMessage;

          if (message.type !== 'connect') {
            socket.close(4002, 'Expected connect message');
            return;
          }

          // Validate auth if required
          if (this.config.requireAuth) {
            if (!message.authToken) {
              socket.close(4003, 'Authentication required');
              return;
            }

            const authResult = await this.config.validateAuth?.(message.authToken);
            if (!authResult) {
              socket.close(4004, 'Authentication failed');
              return;
            }

            // Store auth info
            const auth =
              typeof authResult === 'object' ? authResult : { userId: message.authToken };

            this.registerClient(clientId, socket, message.clientInfo, auth);
          } else {
            this.registerClient(clientId, socket, message.clientInfo);
          }

          // Send connected response
          this.sendJson(socket, {
            type: 'connected',
            id: generateId(),
            clientId,
            timestamp: Date.now(),
            serverInfo: {
              version: '1.0.0',
              capabilities: ['push', 'pull', 'subscribe'],
            },
          });

          this.emitEvent('client_connected', clientId, {
            clientInfo: message.clientInfo,
          });
        } catch (error) {
          this.log('error', 'Error handling connect:', error);
          socket.close(4005, 'Connection error');
        }
      })();
    });
  }

  /**
   * Register a client
   */
  private registerClient(
    clientId: string,
    socket: WebSocket,
    clientInfo?: { name?: string; version?: string; platform?: string },
    auth?: { userId?: string; [key: string]: unknown }
  ): void {
    const client: ConnectedClient = {
      id: clientId,
      socket,
      subscriptions: new Set(),
      info: clientInfo,
      auth,
      lastActivity: Date.now(),
      connectedAt: Date.now(),
    };

    this.clients.set(clientId, client);
    this.log('info', `Client ${clientId} connected`);
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from all subscriptions
    for (const collection of client.subscriptions) {
      const subscribers = this.collectionSubscribers.get(collection);
      if (subscribers) {
        subscribers.delete(clientId);
        if (subscribers.size === 0) {
          this.collectionSubscribers.delete(collection);
        }
      }
    }

    this.clients.delete(clientId);
    this.log('info', `Client ${clientId} disconnected`);
    this.emitEvent('client_disconnected', clientId);
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(
    clientId: string,
    message: { type: string; id: string; timestamp: number }
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.lastActivity = Date.now();
    this.emitEvent('message_received', clientId, { message });

    switch (message.type) {
      case 'subscribe':
        await this.handleSubscribe(client, message as unknown as SubscribeMessage);
        break;

      case 'unsubscribe':
        this.handleUnsubscribe(client, message as unknown as UnsubscribeMessage);
        break;

      case 'push':
        await this.handlePush(client, message as unknown as PushMessage);
        break;

      case 'pull':
        await this.handlePull(client, message as unknown as PullMessage);
        break;

      case 'ping':
        this.sendJson(client.socket as WebSocket, {
          type: 'pong',
          id: message.id,
          timestamp: Date.now(),
        });
        break;

      default:
        this.sendError(
          client.socket as WebSocket,
          'UNKNOWN_MESSAGE',
          `Unknown message type: ${message.type}`,
          message.id
        );
    }
  }

  /**
   * Handle subscribe message
   */
  private async handleSubscribe(client: ConnectedClient, message: SubscribeMessage): Promise<void> {
    const { collection, lastSyncAt } = message;

    // Add to subscriptions
    client.subscriptions.add(collection);

    if (!this.collectionSubscribers.has(collection)) {
      this.collectionSubscribers.set(collection, new Set());
    }
    this.collectionSubscribers.get(collection)!.add(client.id);

    // Send ack
    this.sendAck(client.socket as WebSocket, message.id, true);

    // Send initial data if requested
    if (lastSyncAt !== undefined) {
      const changes = await this.storage.getChanges(collection, lastSyncAt);

      if (changes.length > 0) {
        this.sendJson(client.socket as WebSocket, {
          type: 'sync',
          id: generateId(),
          collection,
          changes,
          serverTimestamp: Date.now(),
          hasMore: false,
          timestamp: Date.now(),
        });
      }
    }

    this.log('debug', `Client ${client.id} subscribed to ${collection}`);
  }

  /**
   * Handle unsubscribe message
   */
  private handleUnsubscribe(client: ConnectedClient, message: UnsubscribeMessage): void {
    const { collection } = message;

    client.subscriptions.delete(collection);

    const subscribers = this.collectionSubscribers.get(collection);
    if (subscribers) {
      subscribers.delete(client.id);
      if (subscribers.size === 0) {
        this.collectionSubscribers.delete(collection);
      }
    }

    this.sendAck(client.socket as WebSocket, message.id, true);
    this.log('debug', `Client ${client.id} unsubscribed from ${collection}`);
  }

  /**
   * Handle push message
   */
  private async handlePush(client: ConnectedClient, message: PushMessage): Promise<void> {
    const { collection, changes } = message;

    try {
      // Store changes
      for (const change of changes) {
        await this.storage.recordChange({
          ...change,
          clientId: client.id,
          timestamp: Date.now(),
        });
      }

      // Send ack
      this.sendAck(client.socket as WebSocket, message.id, true);

      // Broadcast to other subscribers
      this.broadcastToCollection(collection, client.id, {
        type: 'sync',
        id: generateId(),
        collection,
        changes: changes.map((c) => ({ ...c, clientId: client.id })),
        serverTimestamp: Date.now(),
        hasMore: false,
        timestamp: Date.now(),
      });

      this.emitEvent('sync_completed', client.id, { collection, changeCount: changes.length });
    } catch (error) {
      this.log('error', 'Error handling push:', error);
      this.sendAck(client.socket as WebSocket, message.id, false, 'Failed to save changes');
    }
  }

  /**
   * Handle pull message
   */
  private async handlePull(client: ConnectedClient, message: PullMessage): Promise<void> {
    const { collection, since, limit } = message;

    try {
      const changes = await this.storage.getChanges(collection, since ?? 0, limit);

      this.sendJson(client.socket as WebSocket, {
        type: 'sync',
        id: generateId(),
        collection,
        changes,
        serverTimestamp: Date.now(),
        hasMore: limit ? changes.length >= limit : false,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.log('error', 'Error handling pull:', error);
      this.sendError(
        client.socket as WebSocket,
        'PULL_ERROR',
        'Failed to retrieve changes',
        message.id
      );
    }
  }

  /**
   * Broadcast message to all subscribers of a collection
   */
  private broadcastToCollection(
    collection: string,
    excludeClientId: string,
    message: Record<string, unknown>
  ): void {
    const subscribers = this.collectionSubscribers.get(collection);
    if (!subscribers) return;

    for (const clientId of subscribers) {
      if (clientId === excludeClientId) continue;

      const client = this.clients.get(clientId);
      if (client) {
        this.sendJson(client.socket as WebSocket, message);
      }
    }
  }

  /**
   * Send a JSON message to a client
   */
  private sendJson(socket: WebSocket, message: Record<string, unknown>): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      this.emitEvent('message_sent', undefined, { message });
    }
  }

  /**
   * Send an ack message
   */
  private sendAck(socket: WebSocket, ackId: string, success: boolean, error?: string): void {
    this.sendJson(socket, {
      type: 'ack',
      id: generateId(),
      ackId,
      success,
      error,
      timestamp: Date.now(),
    });
  }

  /**
   * Send an error message
   */
  private sendError(socket: WebSocket, code: string, message: string, originalId?: string): void {
    this.sendJson(socket, {
      type: 'error',
      id: generateId(),
      code,
      message,
      originalId,
      timestamp: Date.now(),
    });
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    this.heartbeatInterval_ = setInterval(() => {
      const now = Date.now();

      for (const [clientId, client] of this.clients) {
        // Check for timeout
        if (now - client.lastActivity > this.config.clientTimeout) {
          this.log('info', `Client ${clientId} timed out`);
          (client.socket as WebSocket).close(4006, 'Timeout');
          this.handleDisconnect(clientId);
          continue;
        }

        // Send ping
        this.sendJson(client.socket as WebSocket, {
          type: 'ping',
          id: generateId(),
          timestamp: now,
        });
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Add event handler
   */
  onEvent(handler: (event: ServerEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index >= 0) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event
   */
  private emitEvent(type: ServerEvent['type'], clientId?: string, data?: unknown): void {
    const event: ServerEvent = {
      type,
      timestamp: Date.now(),
      clientId,
      data,
    };

    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        this.log('error', 'Error in event handler:', error);
      }
    }
  }

  /**
   * Log a message
   */
  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.config.logging) return;

    const configLevel = typeof this.config.logging === 'string' ? this.config.logging : 'info';
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const configLevelIndex = levels.indexOf(configLevel);
    const messageLevelIndex = levels.indexOf(level);

    if (messageLevelIndex >= configLevelIndex) {
      const prefix = `[pocket-sync] [${level.toUpperCase()}]`;
      console[level === 'debug' ? 'log' : level](prefix, message, ...args);
    }
  }

  /**
   * Get connected clients
   */
  getClients(): ConnectedClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get server info
   */
  getInfo(): {
    running: boolean;
    port: number;
    host: string;
    clientCount: number;
    collections: string[];
  } {
    return {
      running: this.wss !== null,
      port: this.config.port,
      host: this.config.host,
      clientCount: this.clients.size,
      collections: Array.from(this.collectionSubscribers.keys()),
    };
  }
}

/**
 * Create a sync server
 */
export function createSyncServer(config?: SyncServerConfig): SyncServer {
  return new SyncServer(config);
}
