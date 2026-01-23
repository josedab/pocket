/**
 * Types for Zero-Config Sync Server
 */

import type { Document } from '@pocket/core';

/**
 * Sync message types
 */
export type SyncMessageType =
  | 'connect'
  | 'connected'
  | 'subscribe'
  | 'unsubscribe'
  | 'push'
  | 'pull'
  | 'sync'
  | 'ack'
  | 'error'
  | 'ping'
  | 'pong';

/**
 * Base sync message
 */
export interface SyncMessage {
  /** Message type */
  type: SyncMessageType;
  /** Message ID for correlation */
  id: string;
  /** Client ID */
  clientId?: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Connect message from client
 */
export interface ConnectMessage extends SyncMessage {
  type: 'connect';
  /** Client info */
  clientInfo?: {
    name?: string;
    version?: string;
    platform?: string;
  };
  /** Auth token (optional) */
  authToken?: string;
}

/**
 * Connected response from server
 */
export interface ConnectedMessage extends SyncMessage {
  type: 'connected';
  /** Assigned client ID */
  clientId: string;
  /** Server info */
  serverInfo: {
    version: string;
    capabilities: string[];
  };
}

/**
 * Subscribe to a collection
 */
export interface SubscribeMessage extends SyncMessage {
  type: 'subscribe';
  /** Collection name */
  collection: string;
  /** Optional filter query */
  filter?: Record<string, unknown>;
  /** Last sync timestamp for this collection */
  lastSyncAt?: number;
}

/**
 * Unsubscribe from a collection
 */
export interface UnsubscribeMessage extends SyncMessage {
  type: 'unsubscribe';
  /** Collection name */
  collection: string;
}

/**
 * Push changes to server
 */
export interface PushMessage extends SyncMessage {
  type: 'push';
  /** Collection name */
  collection: string;
  /** Changes to push */
  changes: SyncChange[];
}

/**
 * Pull changes from server
 */
export interface PullMessage extends SyncMessage {
  type: 'pull';
  /** Collection name */
  collection: string;
  /** Since timestamp */
  since?: number;
  /** Limit results */
  limit?: number;
}

/**
 * Sync response with changes
 */
export interface SyncResponseMessage extends SyncMessage {
  type: 'sync';
  /** Collection name */
  collection: string;
  /** Changes from server */
  changes: SyncChange[];
  /** Server timestamp */
  serverTimestamp: number;
  /** Whether there are more changes */
  hasMore: boolean;
}

/**
 * Acknowledgment message
 */
export interface AckMessage extends SyncMessage {
  type: 'ack';
  /** Original message ID being acknowledged */
  ackId: string;
  /** Success status */
  success: boolean;
  /** Error if any */
  error?: string;
}

/**
 * Error message
 */
export interface ErrorMessage extends SyncMessage {
  type: 'error';
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Original message ID that caused error */
  originalId?: string;
}

/**
 * A single sync change
 */
export interface SyncChange<T extends Document = Document> {
  /** Change type */
  type: 'create' | 'update' | 'delete';
  /** Document ID */
  documentId: string;
  /** Document data (null for delete) */
  document: T | null;
  /** Change timestamp */
  timestamp: number;
  /** Client ID that made the change */
  clientId: string;
  /** Vector clock for conflict detection */
  vectorClock?: Record<string, number>;
}

/**
 * Server configuration
 */
export interface SyncServerConfig {
  /** Port to listen on */
  port?: number;
  /** Host to bind to */
  host?: string;
  /** Path for WebSocket endpoint */
  path?: string;
  /** Enable authentication */
  requireAuth?: boolean;
  /** Auth validation function */
  validateAuth?: (token: string) => Promise<boolean | { userId: string; [key: string]: unknown }>;
  /** CORS origins (for HTTP upgrade) */
  corsOrigins?: string[] | '*';
  /** Heartbeat interval in ms */
  heartbeatInterval?: number;
  /** Client timeout in ms */
  clientTimeout?: number;
  /** Max message size in bytes */
  maxMessageSize?: number;
  /** Storage backend */
  storage?: StorageBackend;
  /** Enable logging */
  logging?: boolean | LogLevel;
}

/**
 * Log level
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Default server configuration
 */
export const DEFAULT_SERVER_CONFIG: Required<Omit<SyncServerConfig, 'validateAuth' | 'storage'>> = {
  port: 8080,
  host: '0.0.0.0',
  path: '/sync',
  requireAuth: false,
  corsOrigins: '*',
  heartbeatInterval: 30000,
  clientTimeout: 60000,
  maxMessageSize: 1024 * 1024, // 1MB
  logging: 'info',
};

/**
 * Storage backend interface
 */
export interface StorageBackend {
  /** Get documents from a collection */
  getDocuments<T extends Document>(
    collection: string,
    options?: {
      since?: number;
      limit?: number;
      filter?: Record<string, unknown>;
    }
  ): Promise<T[]>;

  /** Get a single document */
  getDocument<T extends Document>(collection: string, documentId: string): Promise<T | null>;

  /** Save a document */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  saveDocument<T extends Document>(collection: string, document: T): Promise<void>;

  /** Delete a document */
  deleteDocument(collection: string, documentId: string): Promise<void>;

  /** Get changes since timestamp */
  getChanges(collection: string, since: number, limit?: number): Promise<SyncChange[]>;

  /** Record a change */
  recordChange(change: SyncChange): Promise<void>;

  /** Initialize storage */
  init?(): Promise<void>;

  /** Close storage */
  close?(): Promise<void>;
}

/**
 * Connected client info
 */
export interface ConnectedClient {
  /** Client ID */
  id: string;
  /** WebSocket connection */
  socket: unknown;
  /** Subscribed collections */
  subscriptions: Set<string>;
  /** Client info */
  info?: {
    name?: string;
    version?: string;
    platform?: string;
  };
  /** Auth info */
  auth?: {
    userId?: string;
    [key: string]: unknown;
  };
  /** Last activity timestamp */
  lastActivity: number;
  /** Connected at */
  connectedAt: number;
}

/**
 * Server event types
 */
export type ServerEventType =
  | 'client_connected'
  | 'client_disconnected'
  | 'message_received'
  | 'message_sent'
  | 'error'
  | 'sync_completed';

/**
 * Server event
 */
export interface ServerEvent {
  /** Event type */
  type: ServerEventType;
  /** Event timestamp */
  timestamp: number;
  /** Client ID (if applicable) */
  clientId?: string;
  /** Event data */
  data?: unknown;
}
