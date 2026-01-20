import type { ChangeEvent, Document } from '@pocket/core';
import type { Checkpoint } from '../checkpoint.js';

/**
 * Sync message types
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
 * Base sync message
 */
export interface SyncMessage {
  type: SyncMessageType;
  id: string;
  timestamp: number;
}

/**
 * Push message - client sending changes to server
 */
export interface PushMessage extends SyncMessage {
  type: 'push';
  collection: string;
  changes: ChangeEvent<Document>[];
  checkpoint: Checkpoint;
}

/**
 * Pull message - client requesting changes from server
 */
export interface PullMessage extends SyncMessage {
  type: 'pull';
  collections: string[];
  checkpoint: Checkpoint;
  limit?: number;
}

/**
 * Push response from server
 */
export interface PushResponseMessage extends SyncMessage {
  type: 'push-response';
  success: boolean;
  conflicts?: { documentId: string; serverDocument: Document }[];
  checkpoint: Checkpoint;
}

/**
 * Pull response from server
 */
export interface PullResponseMessage extends SyncMessage {
  type: 'pull-response';
  changes: Record<string, ChangeEvent<Document>[]>;
  checkpoint: Checkpoint;
  hasMore: boolean;
}

/**
 * Error message
 */
export interface ErrorMessage extends SyncMessage {
  type: 'error';
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Acknowledgement message
 */
export interface AckMessage extends SyncMessage {
  type: 'ack';
  originalId: string;
}

/**
 * Union of all sync messages
 */
export type SyncProtocolMessage =
  | PushMessage
  | PullMessage
  | PushResponseMessage
  | PullResponseMessage
  | ErrorMessage
  | AckMessage;

/**
 * Transport interface for sync communication
 */
export interface SyncTransport {
  /** Connect to the server */
  connect(): Promise<void>;

  /** Disconnect from the server */
  disconnect(): Promise<void>;

  /** Check if connected */
  isConnected(): boolean;

  /** Send a message and wait for response */
  send<T extends SyncProtocolMessage>(message: SyncProtocolMessage): Promise<T>;

  /** Set up message handler */
  onMessage(handler: (message: SyncProtocolMessage) => void): void;

  /** Set up error handler */
  onError(handler: (error: Error) => void): void;

  /** Set up disconnect handler */
  onDisconnect(handler: () => void): void;

  /** Set up reconnect handler */
  onReconnect(handler: () => void): void;
}

/**
 * Transport configuration
 */
export interface TransportConfig {
  /** Server URL */
  serverUrl: string;
  /** Authentication token */
  authToken?: string;
  /** Request timeout in ms */
  timeout?: number;
  /** Auto reconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
  /** Max reconnect attempts */
  maxReconnectAttempts?: number;
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}
