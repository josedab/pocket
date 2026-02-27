/**
 * Universal Sync Protocol (USP) v1.0 - Protocol Specification
 *
 * Defines the formal specification enabling any backend to sync with Pocket clients.
 */

export const USP_SPEC_VERSION = '1.0.0';

/** Protocol capabilities */
export interface ProtocolCapabilities {
  /** Supports delta sync (only changed documents) */
  deltaSync: boolean;
  /** Supports conflict resolution */
  conflictResolution: boolean;
  /** Supports real-time push subscriptions */
  realtimePush: boolean;
  /** Supports batch operations */
  batchOperations: boolean;
  /** Supports binary data (attachments) */
  binaryData: boolean;
  /** Supports vector clock ordering */
  vectorClocks: boolean;
  /** Supports checkpoint-based sync */
  checkpoints: boolean;
  /** Max message payload size in bytes */
  maxPayloadSize: number;
  /** Supported compression algorithms */
  compression: ('none' | 'gzip' | 'brotli')[];
}

export const DEFAULT_CAPABILITIES: ProtocolCapabilities = {
  deltaSync: true,
  conflictResolution: true,
  realtimePush: true,
  batchOperations: true,
  binaryData: false,
  vectorClocks: true,
  checkpoints: true,
  maxPayloadSize: 5 * 1024 * 1024, // 5MB
  compression: ['none', 'gzip'],
};

/** Sync session state */
export type SyncState = 'idle' | 'handshaking' | 'syncing' | 'error' | 'closed';

/** Protocol message envelope */
export interface ProtocolMessage<T = unknown> {
  /** Protocol version */
  version: string;
  /** Message type */
  type: MessageType;
  /** Unique message ID */
  messageId: string;
  /** In-reply-to message ID */
  replyTo?: string;
  /** Sender node ID */
  senderId: string;
  /** Message payload */
  payload: T;
  /** ISO timestamp */
  timestamp: string;
  /** Optional compression */
  compression?: 'none' | 'gzip' | 'brotli';
}

export type MessageType =
  | 'handshake'
  | 'handshake-ack'
  | 'push'
  | 'pull'
  | 'pull-response'
  | 'ack'
  | 'error'
  | 'ping'
  | 'pong'
  | 'checkpoint'
  | 'checkpoint-ack';

/** Handshake payload */
export interface HandshakePayload {
  protocolVersion: string;
  nodeId: string;
  capabilities: ProtocolCapabilities;
  collections: string[];
  lastCheckpoint?: string;
}

/** Handshake acknowledgement */
export interface HandshakeAckPayload {
  accepted: boolean;
  negotiatedCapabilities: ProtocolCapabilities;
  sessionId: string;
  serverTime: string;
  reason?: string;
}

/** Push payload for sending changes */
export interface PushPayload {
  sessionId: string;
  changes: DocumentChange[];
  checkpoint?: string;
  vectorClock: Record<string, number>;
}

/** Pull request payload */
export interface PullPayload {
  sessionId: string;
  collections: string[];
  since?: string;
  vectorClock?: Record<string, number>;
  limit?: number;
}

/** Pull response */
export interface PullResponsePayload {
  sessionId: string;
  changes: DocumentChange[];
  hasMore: boolean;
  checkpoint: string;
  vectorClock: Record<string, number>;
}

/** A single document change */
export interface DocumentChange {
  id: string;
  collection: string;
  operation: 'create' | 'update' | 'delete';
  data?: Record<string, unknown>;
  metadata: {
    revision: number;
    timestamp: string;
    origin: string;
    vectorClock: Record<string, number>;
  };
  previousRevision?: number;
}

/** Checkpoint payload */
export interface CheckpointPayload {
  sessionId: string;
  checkpoint: string;
  vectorClock: Record<string, number>;
  collections: string[];
}

/** Error payload */
export interface ErrorPayload {
  code: USPErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}

export type USPErrorCode =
  | 'PROTOCOL_MISMATCH'
  | 'AUTH_FAILED'
  | 'COLLECTION_NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SESSION_EXPIRED'
  | 'INVALID_CHECKPOINT';

/** Creates a protocol message envelope */
export function createMessage<T>(
  type: MessageType,
  senderId: string,
  payload: T,
  replyTo?: string
): ProtocolMessage<T> {
  return {
    version: USP_SPEC_VERSION,
    type,
    messageId: generateMessageId(),
    replyTo,
    senderId,
    payload,
    timestamp: new Date().toISOString(),
  };
}

function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
