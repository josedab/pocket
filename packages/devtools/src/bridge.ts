import type { Database } from '@pocket/core';
import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import { DatabaseInspector } from './inspector.js';
import type { DevToolsConfig, DevToolsMessage, ErrorMessage, InitMessage } from './types.js';

/**
 * Message handler type
 */
export type MessageHandler = (message: DevToolsMessage) => void | Promise<void>;

/**
 * DevTools bridge for communication between page and extension
 */
export class DevToolsBridge {
  private readonly inspector: DatabaseInspector;

  private readonly connected$ = new BehaviorSubject<boolean>(false);
  private readonly messages$ = new Subject<DevToolsMessage>();

  private messageCounter = 0;
  private handlers = new Map<string, MessageHandler>();
  private port: MessagePort | null = null;

  constructor(config: DevToolsConfig = {}) {
    this.inspector = new DatabaseInspector(config);

    this.setupMessageHandlers();
  }

  /**
   * Connect to DevTools extension
   */
  connect(): void {
    if (typeof window === 'undefined') return;

    // Create message channel for communication
    const channel = new MessageChannel();
    this.port = channel.port1;

    // Set up message handling
    this.port.onmessage = (event) => {
      void this.handleIncomingMessage(event.data);
    };

    // Post init message to extension
    window.postMessage(
      {
        source: 'pocket-devtools',
        type: 'init',
        port: channel.port2,
      },
      '*',
      [channel.port2]
    );

    this.connected$.next(true);
  }

  /**
   * Disconnect from DevTools
   */
  disconnect(): void {
    if (this.port) {
      this.port.close();
      this.port = null;
    }
    this.connected$.next(false);
  }

  /**
   * Register a database
   */
  register(database: Database): void {
    this.inspector.register(database);

    // Notify extension of new database
    if (this.connected$.getValue()) {
      void this.sendDatabasesUpdate();
    }
  }

  /**
   * Unregister a database
   */
  unregister(name: string): void {
    this.inspector.unregister(name);

    // Notify extension
    if (this.connected$.getValue()) {
      void this.sendDatabasesUpdate();
    }
  }

  /**
   * Get connection status
   */
  isConnected(): Observable<boolean> {
    return this.connected$.asObservable();
  }

  /**
   * Get message stream
   */
  getMessages(): Observable<DevToolsMessage> {
    return this.messages$.asObservable();
  }

  /**
   * Get the inspector
   */
  getInspector(): DatabaseInspector {
    return this.inspector;
  }

  /**
   * Send a message to DevTools
   */
  send(message: Omit<DevToolsMessage, 'id' | 'timestamp'>): void {
    if (!this.port) return;

    const fullMessage: DevToolsMessage = {
      ...message,
      id: this.generateMessageId(),
      timestamp: Date.now(),
    } as DevToolsMessage;

    this.port.postMessage(fullMessage);
  }

  /**
   * Register a message handler
   */
  on(type: string, handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Unregister a message handler
   */
  off(type: string): void {
    this.handlers.delete(type);
  }

  /**
   * Destroy the bridge
   */
  destroy(): void {
    this.disconnect();
    this.inspector.destroy();
    this.connected$.complete();
    this.messages$.complete();
    this.handlers.clear();
  }

  /**
   * Handle incoming messages from extension
   */
  private async handleIncomingMessage(message: DevToolsMessage): Promise<void> {
    this.messages$.next(message);

    const handler = this.handlers.get(message.type);
    if (handler) {
      try {
        await handler(message);
      } catch (error) {
        this.sendError(error instanceof Error ? error.message : String(error), 'HANDLER_ERROR');
      }
    }
  }

  /**
   * Set up default message handlers
   */
  private setupMessageHandlers(): void {
    // Handle ping
    this.on('ping', () => {
      this.send({ type: 'pong' });
    });

    // Handle database list request
    this.on('databases', async () => {
      const databases = await this.inspector.getDatabases();
      this.send({
        type: 'databases',
        databases,
      } as unknown as Omit<DevToolsMessage, 'id' | 'timestamp'>);
    });

    // Handle collection info request
    this.on('collections', async (message) => {
      const msg = message as DevToolsMessage & { database: string; collection: string };
      const info = await this.inspector.getCollectionInfo(msg.database, msg.collection);
      this.send({
        type: 'collections',
        database: msg.database,
        collection: msg.collection,
        info,
      } as unknown as Omit<DevToolsMessage, 'id' | 'timestamp'>);
    });

    // Handle documents request
    this.on('documents', async (message) => {
      const msg = message as DevToolsMessage & {
        database: string;
        collection: string;
        offset?: number;
        limit?: number;
        filter?: Record<string, unknown>;
      };
      const result = await this.inspector.getDocuments(msg.database, msg.collection, {
        offset: msg.offset,
        limit: msg.limit,
        filter: msg.filter,
      });
      this.send({
        type: 'documents',
        database: msg.database,
        collection: msg.collection,
        ...result,
      } as unknown as Omit<DevToolsMessage, 'id' | 'timestamp'>);
    });

    // Handle single document request
    this.on('document', async (message) => {
      const msg = message as DevToolsMessage & {
        database: string;
        collection: string;
        documentId: string;
      };
      const document = await this.inspector.getDocument(
        msg.database,
        msg.collection,
        msg.documentId
      );
      this.send({
        type: 'document',
        database: msg.database,
        collection: msg.collection,
        document,
      } as unknown as Omit<DevToolsMessage, 'id' | 'timestamp'>);
    });

    // Handle query request
    this.on('query', async (message) => {
      const msg = message as DevToolsMessage & {
        database: string;
        collection: string;
        spec: {
          filter?: Record<string, unknown>;
          sort?: Record<string, 'asc' | 'desc'>;
          limit?: number;
          skip?: number;
        };
      };
      const result = await this.inspector.executeQuery(msg.database, msg.collection, msg.spec);
      this.send({
        type: 'query',
        database: msg.database,
        collection: msg.collection,
        ...result,
      } as unknown as Omit<DevToolsMessage, 'id' | 'timestamp'>);
    });

    // Handle stats request
    this.on('stats', async (message) => {
      const msg = message as DevToolsMessage & { database: string };
      const stats = await this.inspector.getStats(msg.database);
      this.send({
        type: 'stats',
        database: msg.database,
        stats,
      } as unknown as Omit<DevToolsMessage, 'id' | 'timestamp'>);
    });

    // Subscribe to changes and forward to extension
    this.inspector.getChanges().subscribe((change) => {
      this.send({
        type: 'changes',
        change,
      } as unknown as Omit<DevToolsMessage, 'id' | 'timestamp'>);
    });

    // Subscribe to operations and forward to extension
    this.inspector.getOperations().subscribe((operations) => {
      if (operations.length > 0) {
        this.send({
          type: 'operation',
          operation: operations[0],
        } as unknown as Omit<DevToolsMessage, 'id' | 'timestamp'>);
      }
    });
  }

  /**
   * Send databases update
   */
  private async sendDatabasesUpdate(): Promise<void> {
    const databases = await this.inspector.getDatabases();
    const init: Omit<InitMessage, 'id' | 'timestamp'> = {
      type: 'init',
      version: '0.1.0',
      databases,
    };
    this.send(init);
  }

  /**
   * Send error message
   */
  private sendError(error: string, code?: string): void {
    const errorMsg: Omit<ErrorMessage, 'id' | 'timestamp'> = {
      type: 'error',
      error,
      code,
    };
    this.send(errorMsg);
  }

  /**
   * Generate message ID
   */
  private generateMessageId(): string {
    return `msg_${++this.messageCounter}_${Date.now()}`;
  }
}

/**
 * Create a DevTools bridge
 */
export function createBridge(config?: DevToolsConfig): DevToolsBridge {
  return new DevToolsBridge(config);
}

/**
 * Global bridge instance
 */
let globalBridge: DevToolsBridge | null = null;

/**
 * Get or create the global DevTools bridge
 */
export function getDevToolsBridge(config?: DevToolsConfig): DevToolsBridge {
  globalBridge ??= new DevToolsBridge(config);
  return globalBridge;
}

/**
 * Initialize DevTools for a database
 */
export function initDevTools(database: Database, config?: DevToolsConfig): DevToolsBridge {
  const bridge = getDevToolsBridge(config);
  bridge.register(database);

  if (config?.autoConnect !== false) {
    bridge.connect();
  }

  return bridge;
}
