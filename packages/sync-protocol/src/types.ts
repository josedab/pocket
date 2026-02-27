/**
 * Universal Sync Protocol (USP) v1.0 Specification Types
 *
 * Defines the wire format, message types, handshake protocol, and
 * conflict resolution semantics for client–server synchronization.
 *
 * Any server implementing these types and passing the conformance
 * test suite is USP-compliant and can sync with any USP client.
 */

// ─── Protocol Version ────────────────────────────────────────────

export const USP_VERSION = '1.0.0' as const;
export const USP_PROTOCOL_ID = 'usp' as const;

// ─── Identifiers ─────────────────────────────────────────────────

/** Globally unique node identifier. */
export type NodeId = string;
/** Collection name. */
export type CollectionName = string;
/** Document identifier within a collection. */
export type DocumentId = string;
/** Opaque checkpoint token for resuming sync. */
export type Checkpoint = string;

// ─── Vector Clock ────────────────────────────────────────────────

/** Logical timestamp per node, used for causality tracking. */
export type VectorClock = Record<NodeId, number>;

// ─── Documents ───────────────────────────────────────────────────

/** Metadata attached to every synced document. */
export interface DocumentMeta {
  readonly _id: DocumentId;
  readonly _rev: string;
  readonly _updatedAt: number;
  readonly _deleted?: boolean;
  readonly _vclock?: VectorClock;
}

/** A document change record transmitted during sync. */
export interface ChangeRecord {
  readonly collection: CollectionName;
  readonly documentId: DocumentId;
  readonly operation: 'insert' | 'update' | 'delete';
  readonly document?: Record<string, unknown> & DocumentMeta;
  readonly timestamp: number;
  readonly nodeId: NodeId;
  readonly vclock: VectorClock;
}

// ─── Message Types ───────────────────────────────────────────────

/** All possible message types in the USP protocol. */
export type MessageType =
  | 'handshake'
  | 'handshake-ack'
  | 'push'
  | 'push-ack'
  | 'pull'
  | 'pull-response'
  | 'error'
  | 'ping'
  | 'pong';

/** Base message envelope. */
export interface MessageEnvelope {
  readonly protocol: typeof USP_PROTOCOL_ID;
  readonly version: string;
  readonly type: MessageType;
  readonly id: string;
  readonly timestamp: number;
}

/** Client → Server: initiate sync session. */
export interface HandshakeMessage extends MessageEnvelope {
  readonly type: 'handshake';
  readonly payload: {
    readonly nodeId: NodeId;
    readonly collections: readonly CollectionName[];
    readonly checkpoint?: Checkpoint;
    readonly capabilities: readonly string[];
    readonly auth?: {
      readonly type: 'bearer' | 'api-key';
      readonly token: string;
    };
  };
}

/** Server → Client: acknowledge handshake. */
export interface HandshakeAckMessage extends MessageEnvelope {
  readonly type: 'handshake-ack';
  readonly payload: {
    readonly sessionId: string;
    readonly serverNodeId: NodeId;
    readonly acceptedCollections: readonly CollectionName[];
    readonly serverCapabilities: readonly string[];
    readonly checkpoint: Checkpoint;
  };
}

/** Client → Server: push local changes. */
export interface PushMessage extends MessageEnvelope {
  readonly type: 'push';
  readonly payload: {
    readonly sessionId: string;
    readonly changes: readonly ChangeRecord[];
    readonly checkpoint: Checkpoint;
  };
}

/** Server → Client: acknowledge pushed changes. */
export interface PushAckMessage extends MessageEnvelope {
  readonly type: 'push-ack';
  readonly payload: {
    readonly sessionId: string;
    readonly accepted: readonly DocumentId[];
    readonly rejected: readonly {
      readonly documentId: DocumentId;
      readonly reason: string;
      readonly serverVersion?: ChangeRecord;
    }[];
    readonly checkpoint: Checkpoint;
  };
}

/** Client → Server: request changes since checkpoint. */
export interface PullMessage extends MessageEnvelope {
  readonly type: 'pull';
  readonly payload: {
    readonly sessionId: string;
    readonly checkpoint: Checkpoint;
    readonly collections?: readonly CollectionName[];
    readonly limit?: number;
  };
}

/** Server → Client: respond with changes. */
export interface PullResponseMessage extends MessageEnvelope {
  readonly type: 'pull-response';
  readonly payload: {
    readonly sessionId: string;
    readonly changes: readonly ChangeRecord[];
    readonly checkpoint: Checkpoint;
    readonly hasMore: boolean;
  };
}

/** Error message. */
export interface ErrorMessage extends MessageEnvelope {
  readonly type: 'error';
  readonly payload: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly relatedMessageId?: string;
  };
}

/** Keepalive ping. */
export interface PingMessage extends MessageEnvelope {
  readonly type: 'ping';
}

/** Keepalive pong. */
export interface PongMessage extends MessageEnvelope {
  readonly type: 'pong';
}

/** Union of all USP messages. */
export type USPMessage =
  | HandshakeMessage
  | HandshakeAckMessage
  | PushMessage
  | PushAckMessage
  | PullMessage
  | PullResponseMessage
  | ErrorMessage
  | PingMessage
  | PongMessage;

// ─── Error Codes ─────────────────────────────────────────────────

export type ErrorCode =
  | 'AUTH_FAILED'
  | 'SESSION_EXPIRED'
  | 'COLLECTION_NOT_FOUND'
  | 'CONFLICT'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'INVALID_MESSAGE'
  | 'INTERNAL_ERROR'
  | 'VERSION_MISMATCH';

// ─── Conflict Resolution ─────────────────────────────────────────

export type ConflictStrategy =
  | 'server-wins'
  | 'client-wins'
  | 'last-write-wins'
  | 'merge'
  | 'custom';

export interface ConflictResolution {
  readonly strategy: ConflictStrategy;
  readonly resolved: ChangeRecord;
  readonly original: {
    readonly client: ChangeRecord;
    readonly server: ChangeRecord;
  };
}

// ─── Capabilities ────────────────────────────────────────────────

/** Standard capabilities that clients/servers can advertise. */
export const CAPABILITIES = {
  PUSH: 'push',
  PULL: 'pull',
  REALTIME: 'realtime',
  SELECTIVE_SYNC: 'selective-sync',
  COMPRESSION: 'compression',
  ENCRYPTION: 'e2e-encryption',
  CRDT: 'crdt',
  BINARY: 'binary-transport',
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];
