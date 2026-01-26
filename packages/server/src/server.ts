import type { ChangeEvent, Document } from '@pocket/core';
import type {
  ErrorMessage,
  PullMessage,
  PullResponseMessage,
  PushMessage,
  PushResponseMessage,
  SyncProtocolMessage,
} from '@pocket/sync';
import {
  ConflictResolver,
  detectConflict,
  type Checkpoint,
  type ConflictStrategy,
} from '@pocket/sync';
import type { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { createMemoryChangeLog, type ChangeLog } from './change-log.js';
import { ClientManager, type ConnectedClient } from './client-manager.js';

/**
 * Configuration options for the Pocket sync server.
 *
 * @example Basic server
 * ```typescript
 * const config: ServerConfig = {
 *   port: 8080
 * };
 * ```
 *
 * @example With authentication
 * ```typescript
 * const config: ServerConfig = {
 *   port: 8080,
 *   authenticate: async (token) => {
 *     const user = await verifyJWT(token);
 *     if (!user) return null;
 *     return {
 *       userId: user.id,
 *       metadata: { role: user.role }
 *     };
 *   },
 *   maxClientsPerUser: 5
 * };
 * ```
 *
 * @example With custom change log
 * ```typescript
 * import { PostgresChangeLog } from './postgres-change-log';
 *
 * const config: ServerConfig = {
 *   port: 8080,
 *   changeLog: new PostgresChangeLog(connectionString),
 *   conflictStrategy: 'server-wins'
 * };
 * ```
 *
 * @see {@link PocketServer}
 */
export interface ServerConfig {
  /**
   * TCP port number for the WebSocket server.
   * Common choices: 8080 for development, 443 for production with TLS.
   */
  port: number;

  /**
   * Network interface to bind to.
   * Use '0.0.0.0' to listen on all interfaces (default).
   * Use '127.0.0.1' for localhost only.
   * @default '0.0.0.0'
   */
  host?: string;

  /**
   * URL path for the WebSocket endpoint.
   * Clients connect to `ws://host:port/path`.
   * @default '/sync'
   */
  path?: string;

  /**
   * Authentication function called for each new connection.
   *
   * Receives the token from the client's connection URL query parameter.
   * Return null to reject the connection, or user info to allow it.
   *
   * @param token - The auth token from `?token=` query param
   * @returns User info object with userId and optional metadata, or null to reject
   *
   * @example
   * ```typescript
   * authenticate: async (token) => {
   *   try {
   *     const payload = jwt.verify(token, SECRET);
   *     return { userId: payload.sub, metadata: { role: payload.role } };
   *   } catch {
   *     return null;
   *   }
   * }
   * ```
   */
  authenticate?: (
    token: string
  ) => Promise<{ userId: string; metadata?: Record<string, unknown> } | null>;

  /**
   * Strategy for resolving conflicts when clients push conflicting changes.
   *
   * - `'last-write-wins'`: Most recent timestamp wins (default)
   * - `'server-wins'`: Server's version always wins
   * - `'client-wins'`: Client's version always wins
   *
   * @default 'last-write-wins'
   */
  conflictStrategy?: ConflictStrategy;

  /**
   * Maximum number of simultaneous WebSocket connections per user.
   * Helps prevent resource exhaustion from misbehaving clients.
   * @default 10
   */
  maxClientsPerUser?: number;

  /**
   * Time in milliseconds after which inactive clients are disconnected.
   * Inactive means no messages sent or received.
   * @default 60000 (1 minute)
   */
  clientTimeout?: number;

  /**
   * Change log implementation for persisting sync history.
   *
   * For production, provide a database-backed implementation.
   * Uses in-memory storage by default (data lost on restart).
   *
   * @see {@link ChangeLog} for the interface to implement
   * @default createMemoryChangeLog()
   */
  changeLog?: ChangeLog;
}

/**
 * WebSocket-based sync server for Pocket.
 *
 * PocketServer handles real-time synchronization between Pocket clients
 * and a central server. It manages:
 *
 * - **Connections**: WebSocket connections with authentication
 * - **Push Sync**: Receiving changes from clients and broadcasting to others
 * - **Pull Sync**: Sending missed changes to reconnecting clients
 * - **Conflicts**: Detecting and resolving concurrent modifications
 * - **Lifecycle**: Client timeout and cleanup
 *
 * @example Basic usage
 * ```typescript
 * import { createServer } from '@pocket/server';
 *
 * const server = createServer({ port: 8080 });
 * await server.start();
 *
 * // Later...
 * await server.stop();
 * ```
 *
 * @example With authentication and custom conflict strategy
 * ```typescript
 * import { createServer } from '@pocket/server';
 *
 * const server = createServer({
 *   port: 8080,
 *   authenticate: async (token) => {
 *     const user = await verifyToken(token);
 *     return user ? { userId: user.id } : null;
 *   },
 *   conflictStrategy: 'server-wins',
 *   maxClientsPerUser: 3
 * });
 *
 * await server.start();
 * console.log(`Server running, ${server.clientCount} clients connected`);
 * ```
 *
 * @example Express/HTTP integration
 * ```typescript
 * import express from 'express';
 * import { createServer } from 'http';
 * import { PocketServer } from '@pocket/server';
 *
 * const app = express();
 * const httpServer = createServer(app);
 *
 * // Note: For integration with existing HTTP server,
 * // you'll need to create WebSocketServer separately
 * // and pass the httpServer option
 * ```
 *
 * @see {@link ServerConfig} for configuration options
 * @see {@link createServer} for the factory function
 */
export class PocketServer {
  /** Resolved configuration with defaults applied */
  private readonly config: Required<Omit<ServerConfig, 'authenticate' | 'changeLog'>> & {
    authenticate?: ServerConfig['authenticate'];
    changeLog: ChangeLog;
  };

  /** WebSocket server instance, null when not running */
  private wss: WebSocketServer | null = null;

  /** Manages connected client state and lookups */
  private readonly clientManager: ClientManager;

  /** Persistent log of all sync changes */
  private readonly changeLog: ChangeLog;

  /** Resolves conflicts between concurrent client modifications */
  private readonly conflictResolver: ConflictResolver<Document>;

  /**
   * In-memory document storage.
   *
   * **Note**: In production, replace this with a real database.
   * This is a simple Map-based store for demonstration and testing.
   */
  private documents = new Map<string, Map<string, Document>>();

  /**
   * Create a new Pocket sync server.
   *
   * Prefer using {@link createServer} factory function instead of
   * calling this constructor directly.
   *
   * @param config - Server configuration options
   */
  constructor(config: ServerConfig) {
    this.config = {
      port: config.port,
      host: config.host ?? '0.0.0.0',
      path: config.path ?? '/sync',
      authenticate: config.authenticate,
      conflictStrategy: config.conflictStrategy ?? 'last-write-wins',
      maxClientsPerUser: config.maxClientsPerUser ?? 10,
      clientTimeout: config.clientTimeout ?? 60000,
      changeLog: config.changeLog ?? createMemoryChangeLog(),
    };

    this.clientManager = new ClientManager();
    this.changeLog = this.config.changeLog;
    this.conflictResolver = new ConflictResolver(this.config.conflictStrategy);
  }

  /**
   * Start the WebSocket server and begin accepting connections.
   *
   * This method:
   * 1. Creates a WebSocketServer bound to the configured host/port
   * 2. Sets up connection and message handlers
   * 3. Starts the client cleanup interval
   *
   * @returns Promise that resolves when the server is listening
   * @throws Error if the port is already in use or binding fails
   *
   * @example
   * ```typescript
   * const server = createServer({ port: 8080 });
   *
   * try {
   *   await server.start();
   *   console.log('Server started successfully');
   * } catch (error) {
   *   console.error('Failed to start server:', error);
   * }
   * ```
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({
        port: this.config.port,
        host: this.config.host,
        path: this.config.path,
      });

      this.wss.on('connection', (socket, request) => {
        void this.handleConnection(socket, request);
      });

      this.wss.on('listening', () => {
        console.log(
          `Pocket sync server listening on ${this.config.host}:${this.config.port}${this.config.path}`
        );
        resolve();
      });

      // Start client cleanup interval
      setInterval(() => {
        this.cleanupInactiveClients();
      }, this.config.clientTimeout / 2);
    });
  }

  /**
   * Stop the server and close all client connections.
   *
   * This method:
   * 1. Closes all active WebSocket connections gracefully
   * 2. Clears the client manager
   * 3. Shuts down the WebSocket server
   *
   * @returns Promise that resolves when the server has stopped
   *
   * @example
   * ```typescript
   * // Graceful shutdown on SIGTERM
   * process.on('SIGTERM', async () => {
   *   console.log('Shutting down...');
   *   await server.stop();
   *   process.exit(0);
   * });
   * ```
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.wss) {
        resolve();
        return;
      }

      // Close all client connections
      for (const client of this.clientManager.getAll()) {
        client.socket.close(1000, 'Server shutting down');
      }
      this.clientManager.clear();

      this.wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
      this.wss = null;
    });
  }

  /**
   * Handle a new WebSocket connection.
   *
   * Connection flow:
   * 1. Parse token and nodeId from URL query parameters
   * 2. Authenticate the client (if authentication is configured)
   * 3. Check max connections per user limit
   * 4. Register the client in ClientManager
   * 5. Set up message and disconnect handlers
   *
   * URL format: `ws://host:port/sync?token=<auth-token>&nodeId=<client-node-id>`
   *
   * @param socket - The WebSocket connection
   * @param request - The HTTP upgrade request containing URL and headers
   */
  private async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    const url = new URL(request.url ?? '', `http://${request.headers.host}`);
    const token = url.searchParams.get('token') ?? '';
    const nodeId = url.searchParams.get('nodeId') ?? this.generateClientId();

    // Authenticate if configured
    let userId: string | undefined;
    let metadata: Record<string, unknown> = {};

    if (this.config.authenticate) {
      const authResult = await this.config.authenticate(token);
      if (!authResult) {
        socket.close(4001, 'Authentication failed');
        return;
      }
      userId = authResult.userId;
      metadata = authResult.metadata ?? {};

      // Check max clients per user
      const userClients = this.clientManager.getByUser(userId);
      if (userClients.length >= this.config.maxClientsPerUser) {
        socket.close(4002, 'Too many connections');
        return;
      }
    }

    // Register client
    const clientId = this.generateClientId();
    const client = this.clientManager.add({
      id: clientId,
      socket,
      nodeId,
      collections: new Set(),
      checkpoint: null,
      userId,
      metadata,
    });

    // Set up message handler
    socket.on('message', (data) => {
      try {
        // Handle various RawData types from ws library
        let dataStr: string;
        if (Buffer.isBuffer(data)) {
          dataStr = data.toString('utf8');
        } else if (data instanceof ArrayBuffer) {
          dataStr = Buffer.from(data).toString('utf8');
        } else if (Array.isArray(data)) {
          dataStr = Buffer.concat(data).toString('utf8');
        } else {
          dataStr = data as string;
        }
        const message = JSON.parse(dataStr) as SyncProtocolMessage;
        void this.handleMessage(client, message);
      } catch {
        this.sendError(socket, 'PARSE_ERROR', 'Invalid message format', true);
      }
    });

    // Handle disconnection
    socket.on('close', () => {
      this.clientManager.remove(clientId);
    });

    socket.on('error', () => {
      this.clientManager.remove(clientId);
    });
  }

  /**
   * Route an incoming protocol message to the appropriate handler.
   *
   * Supported message types:
   * - `push`: Client sending local changes to server
   * - `pull`: Client requesting changes since last checkpoint
   *
   * Updates the client's last activity timestamp on each message.
   *
   * @param client - The client that sent the message
   * @param message - The parsed sync protocol message
   */
  private async handleMessage(
    client: ConnectedClient,
    message: SyncProtocolMessage
  ): Promise<void> {
    this.clientManager.touch(client.id);

    switch (message.type) {
      case 'push':
        await this.handlePush(client, message);
        break;
      case 'pull':
        await this.handlePull(client, message);
        break;
      default:
        this.sendError(
          client.socket,
          'UNKNOWN_MESSAGE',
          `Unknown message type: ${message.type}`,
          false
        );
    }
  }

  /**
   * Handle a push message from a client.
   *
   * Push flow:
   * 1. Update client's checkpoint and collection subscriptions
   * 2. For each change:
   *    - Check for conflicts with existing server state
   *    - Resolve conflicts using the configured strategy
   *    - Apply the change to server storage
   *    - Append to the change log
   * 3. Send push response with success/conflict status
   * 4. Broadcast changes to other clients watching the same collection
   *
   * @param client - The client pushing changes
   * @param message - The push message containing changes
   */
  private async handlePush(client: ConnectedClient, message: PushMessage): Promise<void> {
    const { collection, changes, checkpoint } = message;
    const conflicts: { documentId: string; serverDocument: Document }[] = [];

    // Update client checkpoint
    this.clientManager.updateCheckpoint(client.id, checkpoint);
    this.clientManager.addCollections(client.id, [collection]);

    // Get or create collection storage
    let collectionDocs = this.documents.get(collection);
    if (!collectionDocs) {
      collectionDocs = new Map();
      this.documents.set(collection, collectionDocs);
    }

    // Process each change
    for (const change of changes) {
      const existingDoc = collectionDocs.get(change.documentId);

      // Check for conflicts
      if (existingDoc && change.document && detectConflict(existingDoc, change.document)) {
        const resolution = this.conflictResolver.resolve({
          documentId: change.documentId,
          localDocument: change.document,
          remoteDocument: existingDoc,
          timestamp: Date.now(),
        });

        if (resolution.winner === 'remote') {
          // Server wins - report conflict
          conflicts.push({
            documentId: change.documentId,
            serverDocument: existingDoc,
          });
          continue;
        }

        // Use resolved document
        change.document = resolution.document;
      }

      // Apply change
      if (change.operation === 'delete') {
        collectionDocs.delete(change.documentId);
      } else if (change.document) {
        collectionDocs.set(change.documentId, change.document);
      }

      // Log change
      await this.changeLog.append({
        collection,
        change,
        clientId: client.id,
      });
    }

    // Get current checkpoint
    const currentSequence = await this.changeLog.getCurrentSequence();
    const serverCheckpoint: Partial<Checkpoint> = {
      sequences: { [collection]: currentSequence },
      timestamp: Date.now(),
    };

    // Send response
    const response: PushResponseMessage = {
      type: 'push-response',
      id: message.id,
      timestamp: Date.now(),
      success: conflicts.length === 0,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
      checkpoint: serverCheckpoint as Checkpoint,
    };

    this.send(client.socket, response);

    // Broadcast changes to other clients
    if (changes.length > 0) {
      this.broadcastChanges(client.id, collection, changes);
    }
  }

  /**
   * Handle a pull message from a client.
   *
   * Pull flow:
   * 1. Update client's checkpoint and collection subscriptions
   * 2. For each requested collection:
   *    - Query change log for changes since client's last sequence
   *    - Respect the limit parameter for pagination
   * 3. Send pull response with changes and updated checkpoint
   * 4. Set hasMore flag if there are additional changes to fetch
   *
   * @param client - The client requesting changes
   * @param message - The pull message with collections and checkpoint
   */
  private async handlePull(client: ConnectedClient, message: PullMessage): Promise<void> {
    const { collections, checkpoint, limit = 100 } = message;

    // Update client checkpoint and collections
    this.clientManager.updateCheckpoint(client.id, checkpoint);
    this.clientManager.addCollections(client.id, collections);

    const changes: Record<string, ChangeEvent<Document>[]> = {};
    let hasMore = false;

    for (const collection of collections) {
      const sequence = checkpoint.sequences[collection] ?? 0;
      const entries = await this.changeLog.getForCollection(collection, sequence, limit);

      if (entries.length > 0) {
        changes[collection] = entries.map((e) => e.change);
      }

      // Check if there are more
      const currentSeq = await this.changeLog.getCurrentSequence();
      if (entries.length === limit && entries[entries.length - 1]!.sequence < currentSeq) {
        hasMore = true;
      }
    }

    // Build response checkpoint
    const currentSequence = await this.changeLog.getCurrentSequence();
    const serverCheckpoint: Partial<Checkpoint> = {
      sequences: {},
      timestamp: Date.now(),
    };

    for (const collection of collections) {
      const collectionChanges = changes[collection] ?? [];
      const lastChange = collectionChanges[collectionChanges.length - 1];
      serverCheckpoint.sequences![collection] =
        lastChange?.sequence ?? checkpoint.sequences[collection] ?? currentSequence;
    }

    const response: PullResponseMessage = {
      type: 'pull-response',
      id: message.id,
      timestamp: Date.now(),
      changes,
      checkpoint: serverCheckpoint as Checkpoint,
      hasMore,
    };

    this.send(client.socket, response);
  }

  /**
   * Broadcast changes to other connected clients.
   *
   * Sends a pull-response message to all clients that:
   * 1. Are subscribed to the affected collection
   * 2. Are not the client that originated the changes
   *
   * This enables real-time sync between multiple clients.
   *
   * @param exceptClientId - Client ID to exclude (the change originator)
   * @param collection - The collection that was modified
   * @param changes - Array of changes to broadcast
   */
  private broadcastChanges(
    exceptClientId: string,
    collection: string,
    changes: ChangeEvent<Document>[]
  ): void {
    const otherClients = this.clientManager.getOthers(exceptClientId, collection);

    for (const client of otherClients) {
      const message: PullResponseMessage = {
        type: 'pull-response',
        id: `broadcast_${Date.now()}`,
        timestamp: Date.now(),
        changes: { [collection]: changes },
        checkpoint: client.checkpoint ?? ({} as Checkpoint),
        hasMore: false,
      };

      this.send(client.socket, message);
    }
  }

  /**
   * Send a protocol message to a client.
   *
   * Only sends if the socket is in OPEN state, silently ignoring
   * sends to disconnected clients.
   *
   * @param socket - The WebSocket to send to
   * @param message - The message to send (will be JSON stringified)
   */
  private send(socket: WebSocket, message: SyncProtocolMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  /**
   * Send an error message to a client.
   *
   * @param socket - The WebSocket to send to
   * @param code - Machine-readable error code (e.g., 'PARSE_ERROR')
   * @param msg - Human-readable error description
   * @param retryable - Whether the client should retry the operation
   */
  private sendError(socket: WebSocket, code: string, msg: string, retryable: boolean): void {
    const message: ErrorMessage = {
      type: 'error',
      id: `error_${Date.now()}`,
      timestamp: Date.now(),
      code,
      message: msg,
      retryable,
    };
    this.send(socket, message);
  }

  /**
   * Remove clients that have been inactive for too long.
   *
   * Called periodically (every clientTimeout/2 ms) to clean up
   * stale connections.
   */
  private cleanupInactiveClients(): void {
    this.clientManager.removeInactive(this.config.clientTimeout);
  }

  /**
   * Generate a unique identifier for a client connection.
   *
   * Format: `<timestamp-base36>_<random-string>`
   *
   * @returns A unique client ID string
   */
  private generateClientId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * Get the number of currently connected clients.
   *
   * @example
   * ```typescript
   * console.log(`Active connections: ${server.clientCount}`);
   * ```
   */
  get clientCount(): number {
    return this.clientManager.count;
  }

  /**
   * Get the client manager instance.
   *
   * Primarily for testing and debugging. In production, prefer
   * using the server's public API.
   *
   * @returns The ClientManager instance
   */
  getClientManager(): ClientManager {
    return this.clientManager;
  }

  /**
   * Get the change log instance.
   *
   * Primarily for testing and debugging. Useful for inspecting
   * stored changes or implementing custom cleanup logic.
   *
   * @returns The ChangeLog instance
   */
  getChangeLog(): ChangeLog {
    return this.changeLog;
  }
}

/**
 * Create a new Pocket sync server.
 *
 * This is the recommended way to create a server instance.
 *
 * @param config - Server configuration options
 * @returns A new PocketServer instance (not yet started)
 *
 * @example Basic server
 * ```typescript
 * import { createServer } from '@pocket/server';
 *
 * const server = createServer({ port: 8080 });
 * await server.start();
 * ```
 *
 * @example Production server with authentication
 * ```typescript
 * import { createServer } from '@pocket/server';
 * import { PostgresChangeLog } from './postgres-change-log';
 *
 * const server = createServer({
 *   port: parseInt(process.env.PORT || '8080'),
 *   host: '0.0.0.0',
 *   path: '/sync',
 *   authenticate: async (token) => {
 *     const user = await verifyJWT(token);
 *     return user ? { userId: user.id } : null;
 *   },
 *   conflictStrategy: 'last-write-wins',
 *   maxClientsPerUser: 5,
 *   clientTimeout: 120000,
 *   changeLog: new PostgresChangeLog(DATABASE_URL)
 * });
 *
 * await server.start();
 * console.log('Pocket sync server started');
 * ```
 *
 * @see {@link PocketServer} for the server class
 * @see {@link ServerConfig} for configuration options
 */
export function createServer(config: ServerConfig): PocketServer {
  return new PocketServer(config);
}
