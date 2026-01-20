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
 * Server configuration
 */
export interface ServerConfig {
  /** Port to listen on */
  port: number;
  /** Host to bind to */
  host?: string;
  /** Path for WebSocket endpoint */
  path?: string;
  /** Authentication function */
  authenticate?: (
    token: string
  ) => Promise<{ userId: string; metadata?: Record<string, unknown> } | null>;
  /** Conflict resolution strategy */
  conflictStrategy?: ConflictStrategy;
  /** Maximum clients per user */
  maxClientsPerUser?: number;
  /** Client timeout (ms) */
  clientTimeout?: number;
  /** Change log implementation */
  changeLog?: ChangeLog;
}

/**
 * Pocket sync server
 */
export class PocketServer {
  private readonly config: Required<Omit<ServerConfig, 'authenticate' | 'changeLog'>> & {
    authenticate?: ServerConfig['authenticate'];
    changeLog: ChangeLog;
  };
  private wss: WebSocketServer | null = null;
  private readonly clientManager: ClientManager;
  private readonly changeLog: ChangeLog;
  private readonly conflictResolver: ConflictResolver<Document>;

  // Document storage (in production, use a real database)
  private documents = new Map<string, Map<string, Document>>();

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
   * Start the server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({
        port: this.config.port,
        host: this.config.host,
        path: this.config.path,
      });

      this.wss.on('connection', (socket, request) => {
        this.handleConnection(socket, request);
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
   * Stop the server
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
   * Handle new WebSocket connection
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
    socket.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as SyncProtocolMessage;
        await this.handleMessage(client, message);
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
   * Handle incoming message
   */
  private async handleMessage(
    client: ConnectedClient,
    message: SyncProtocolMessage
  ): Promise<void> {
    this.clientManager.touch(client.id);

    switch (message.type) {
      case 'push':
        await this.handlePush(client, message as PushMessage);
        break;
      case 'pull':
        await this.handlePull(client, message as PullMessage);
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
   * Handle push message
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
   * Handle pull message
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
   * Broadcast changes to other clients
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
   * Send message to client
   */
  private send(socket: WebSocket, message: SyncProtocolMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  /**
   * Send error to client
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
   * Clean up inactive clients
   */
  private cleanupInactiveClients(): void {
    this.clientManager.removeInactive(this.config.clientTimeout);
  }

  /**
   * Generate a unique client ID
   */
  private generateClientId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * Get connected client count
   */
  get clientCount(): number {
    return this.clientManager.count;
  }

  /**
   * Get client manager (for testing)
   */
  getClientManager(): ClientManager {
    return this.clientManager;
  }

  /**
   * Get change log (for testing)
   */
  getChangeLog(): ChangeLog {
    return this.changeLog;
  }
}

/**
 * Create a Pocket server
 */
export function createServer(config: ServerConfig): PocketServer {
  return new PocketServer(config);
}
