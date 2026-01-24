import type { ChangeEvent, Document } from '@pocket/core';
import type { Checkpoint } from '../checkpoint.js';

/**
 * Types of messages in the sync protocol.
 */
export type SyncMessageType =
  | 'push'
  | 'pull'
  | 'push-response'
  | 'pull-response'
  | 'checkpoint'
  | 'error'
  | 'ack';

/**
 * Base interface for all sync protocol messages.
 */
export interface SyncMessage {
  /** Message type discriminator */
  type: SyncMessageType;
  /** Unique message identifier for correlation */
  id: string;
  /** Unix timestamp when message was created */
  timestamp: number;
}

/**
 * Message sent from client to server to push local changes.
 */
export interface PushMessage extends SyncMessage {
  type: 'push';
  /** Collection containing the changes */
  collection: string;
  /** List of change events to sync */
  changes: ChangeEvent<Document>[];
  /** Client's current checkpoint for conflict detection */
  checkpoint: Checkpoint;
}

/**
 * Message sent from client to server to request remote changes.
 */
export interface PullMessage extends SyncMessage {
  type: 'pull';
  /** Collections to pull changes from */
  collections: string[];
  /** Client's checkpoint to get changes since */
  checkpoint: Checkpoint;
  /** Maximum number of changes to return */
  limit?: number;
}

/**
 * Server response to a push message.
 */
export interface PushResponseMessage extends SyncMessage {
  type: 'push-response';
  /** Whether all changes were accepted */
  success: boolean;
  /** Conflicts detected during push (if any) */
  conflicts?: { documentId: string; serverDocument: Document }[];
  /** Updated server checkpoint */
  checkpoint: Checkpoint;
}

/**
 * Server response to a pull message.
 */
export interface PullResponseMessage extends SyncMessage {
  type: 'pull-response';
  /** Changes by collection name */
  changes: Record<string, ChangeEvent<Document>[]>;
  /** Updated server checkpoint */
  checkpoint: Checkpoint;
  /** Whether more changes are available (pagination) */
  hasMore: boolean;
}

/**
 * Error message from server.
 */
export interface ErrorMessage extends SyncMessage {
  type: 'error';
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Whether the operation can be retried */
  retryable: boolean;
}

/**
 * Acknowledgement message for confirming receipt.
 */
export interface AckMessage extends SyncMessage {
  type: 'ack';
  /** ID of the message being acknowledged */
  originalId: string;
}

/**
 * Union type of all sync protocol messages.
 */
export type SyncProtocolMessage =
  | PushMessage
  | PullMessage
  | PushResponseMessage
  | PullResponseMessage
  | ErrorMessage
  | AckMessage;

/**
 * Transport layer interface for sync communication.
 *
 * Implementations handle the actual network communication
 * (WebSocket, HTTP, etc.) while providing a consistent API.
 *
 * @see {@link createWebSocketTransport}
 * @see {@link createHttpTransport}
 */
export interface SyncTransport {
  /**
   * Establish connection to the sync server.
   * @throws Error if connection fails
   */
  connect(): Promise<void>;

  /**
   * Close the connection to the server.
   */
  disconnect(): Promise<void>;

  /**
   * Check if currently connected to the server.
   */
  isConnected(): boolean;

  /**
   * Send a message and wait for the response.
   * @typeParam T - Expected response message type
   * @param message - Message to send
   * @returns Promise resolving to the response
   */
  send<T extends SyncProtocolMessage>(message: SyncProtocolMessage): Promise<T>;

  /**
   * Register handler for incoming messages.
   * @param handler - Function called for each received message
   */
  onMessage(handler: (message: SyncProtocolMessage) => void): void;

  /**
   * Register handler for connection errors.
   * @param handler - Function called when an error occurs
   */
  onError(handler: (error: Error) => void): void;

  /**
   * Register handler for disconnection events.
   * @param handler - Function called when disconnected
   */
  onDisconnect(handler: () => void): void;

  /**
   * Register handler for reconnection events.
   * @param handler - Function called after reconnecting
   */
  onReconnect(handler: () => void): void;
}

/**
 * Configuration for sync transports.
 */
export interface TransportConfig {
  /** Sync server URL (wss:// or https://) */
  serverUrl: string;
  /** Authentication token for requests */
  authToken?: string;
  /** Request timeout in milliseconds. @default 30000 */
  timeout?: number;
  /** Automatically reconnect on disconnect. @default true */
  autoReconnect?: boolean;
  /** Delay between reconnection attempts in ms. @default 1000 */
  reconnectDelay?: number;
  /** Maximum reconnection attempts. @default 10 */
  maxReconnectAttempts?: number;
}

/**
 * Generate a unique message ID for sync protocol messages.
 *
 * @returns A unique identifier string
 *
 * @example
 * ```typescript
 * const message: PushMessage = {
 *   type: 'push',
 *   id: generateMessageId(),
 *   timestamp: Date.now(),
 *   collection: 'todos',
 *   changes: [...]
 * };
 * ```
 */
export function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}
