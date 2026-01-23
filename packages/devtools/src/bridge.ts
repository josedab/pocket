import type { Database } from '@pocket/core';
import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import { DatabaseInspector } from './inspector.js';
import type { DevToolsConfig, DevToolsMessage, ErrorMessage, InitMessage } from './types.js';

/**
 * Handler function for DevTools messages.
 *
 * @param message - The received message to handle
 */
export type MessageHandler = (message: DevToolsMessage) => void | Promise<void>;

/**
 * DevTools Bridge for communication between page and browser extension.
 *
 * The bridge establishes a MessageChannel connection with the DevTools
 * extension and handles bidirectional communication. It manages database
 * registration and provides the inspector for database introspection.
 *
 * Key features:
 * - Automatic connection to DevTools extension
 * - Database registration and unregistration
 * - Message handling with custom handlers
 * - Real-time changes and operation forwarding
 *
 * @example Basic usage
 * ```typescript
 * import { initDevTools } from '@pocket/devtools';
 *
 * const db = createDatabase({ name: 'mydb' });
 *
 * // Initialize DevTools (auto-connects)
 * const bridge = initDevTools(db);
 *
 * // Bridge is now ready for DevTools extension
 * ```
 *
 * @example Manual connection management
 * ```typescript
 * const bridge = createBridge({ autoConnect: false });
 *
 * // Register databases
 * bridge.register(db1);
 * bridge.register(db2);
 *
 * // Connect when ready
 * bridge.connect();
 *
 * // Check connection status
 * bridge.isConnected().subscribe(connected => {
 *   console.log('DevTools connected:', connected);
 * });
 *
 * // Clean up
 * bridge.destroy();
 * ```
 *
 * @see {@link createBridge} - Factory function
 * @see {@link initDevTools} - Quick initialization
 * @see {@link DatabaseInspector} - Database inspection API
 */
export class DevToolsBridge {
  private readonly inspector: DatabaseInspector;

  private readonly connected$ = new BehaviorSubject<boolean>(false);
  private readonly messages$ = new Subject<DevToolsMessage>();

  private messageCounter = 0;
  private handlers = new Map<string, MessageHandler>();
  private port: MessagePort | null = null;

  /**
   * Create a new DevTools bridge.
   *
   * @param config - DevTools configuration options
   */
  constructor(config: DevToolsConfig = {}) {
    this.inspector = new DatabaseInspector(config);

    this.setupMessageHandlers();
  }

  /**
   * Connect to the DevTools extension.
   *
   * Creates a MessageChannel and posts the port to the extension
   * via window.postMessage. The extension listens for 'pocket-devtools'
   * messages to establish the connection.
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
   * Disconnect from the DevTools extension.
   *
   * Closes the message port and updates connection status.
   */
  disconnect(): void {
    if (this.port) {
      this.port.close();
      this.port = null;
    }
    this.connected$.next(false);
  }

  /**
   * Register a database for inspection.
   *
   * Once registered, the database will appear in DevTools and
   * its collections, documents, and changes can be inspected.
   *
   * @param database - The database to register
   *
   * @example
   * ```typescript
   * const bridge = getDevToolsBridge();
   * bridge.register(myDatabase);
   * ```
   */
  register(database: Database): void {
    this.inspector.register(database);

    // Notify extension of new database
    if (this.connected$.getValue()) {
      void this.sendDatabasesUpdate();
    }
  }

  /**
   * Unregister a database from inspection.
   *
   * @param name - Name of the database to unregister
   */
  unregister(name: string): void {
    this.inspector.unregister(name);

    // Notify extension
    if (this.connected$.getValue()) {
      void this.sendDatabasesUpdate();
    }
  }

  /**
   * Get an observable of the connection status.
   *
   * @returns Observable that emits true when connected, false when disconnected
   */
  isConnected(): Observable<boolean> {
    return this.connected$.asObservable();
  }

  /**
   * Get an observable of all incoming messages.
   *
   * @returns Observable of DevTools messages
   */
  getMessages(): Observable<DevToolsMessage> {
    return this.messages$.asObservable();
  }

  /**
   * Get the database inspector instance.
   *
   * @returns The DatabaseInspector for direct database introspection
   */
  getInspector(): DatabaseInspector {
    return this.inspector;
  }

  /**
   * Send a message to the DevTools extension.
   *
   * @param message - Message to send (id and timestamp added automatically)
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
   * Register a message handler for a specific message type.
   *
   * @param type - Message type to handle
   * @param handler - Handler function
   *
   * @example
   * ```typescript
   * bridge.on('custom', async (message) => {
   *   console.log('Received custom message:', message);
   * });
   * ```
   */
  on(type: string, handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Unregister a message handler.
   *
   * @param type - Message type to stop handling
   */
  off(type: string): void {
    this.handlers.delete(type);
  }

  /**
   * Destroy the bridge and clean up resources.
   *
   * Disconnects from DevTools, destroys the inspector, and
   * completes all observables.
   */
  destroy(): void {
    this.disconnect();
    this.inspector.destroy();
    this.connected$.complete();
    this.messages$.complete();
    this.handlers.clear();
  }

  /**
   * Handle incoming messages from the extension.
   * @internal
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
   * Set up default message handlers for standard DevTools operations.
   * @internal
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
   * Send a databases update message to the extension.
   * @internal
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
   * Send an error message to the extension.
   * @internal
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
   * Generate a unique message ID.
   * @internal
   */
  private generateMessageId(): string {
    return `msg_${++this.messageCounter}_${Date.now()}`;
  }
}

/**
 * Create a new DevTools bridge instance.
 *
 * @param config - DevTools configuration options
 * @returns A new DevToolsBridge instance
 *
 * @example
 * ```typescript
 * const bridge = createBridge({
 *   maxOperations: 500,
 *   trackPerformance: true,
 * });
 * ```
 *
 * @see {@link DevToolsBridge}
 */
export function createBridge(config?: DevToolsConfig): DevToolsBridge {
  return new DevToolsBridge(config);
}

/**
 * Global bridge instance (singleton).
 * @internal
 */
let globalBridge: DevToolsBridge | null = null;

/**
 * Get or create the global DevTools bridge.
 *
 * Returns a singleton bridge instance. Configuration is only
 * applied on first call.
 *
 * @param config - DevTools configuration (applied on first call only)
 * @returns The global DevToolsBridge instance
 *
 * @example
 * ```typescript
 * const bridge = getDevToolsBridge();
 * bridge.register(myDatabase);
 * ```
 */
export function getDevToolsBridge(config?: DevToolsConfig): DevToolsBridge {
  globalBridge ??= new DevToolsBridge(config);
  return globalBridge;
}

/**
 * Initialize DevTools for a database with minimal setup.
 *
 * This is the recommended way to enable DevTools for your application.
 * It registers the database and auto-connects to the extension.
 *
 * @param database - Database to register for inspection
 * @param config - DevTools configuration options
 * @returns The DevToolsBridge instance
 *
 * @example
 * ```typescript
 * import { createDatabase } from '@pocket/core';
 * import { initDevTools } from '@pocket/devtools';
 *
 * const db = createDatabase({ name: 'myapp' });
 *
 * // Enable DevTools (typically in development only)
 * if (process.env.NODE_ENV === 'development') {
 *   initDevTools(db);
 * }
 * ```
 *
 * @see {@link DevToolsBridge}
 */
export function initDevTools(database: Database, config?: DevToolsConfig): DevToolsBridge {
  const bridge = getDevToolsBridge(config);
  bridge.register(database);

  if (config?.autoConnect !== false) {
    bridge.connect();
  }

  return bridge;
}
