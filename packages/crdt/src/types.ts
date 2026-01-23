/**
 * Unique identifier for a node/replica in the CRDT network
 */
export type NodeId = string;

/**
 * Lamport timestamp for ordering operations
 */
export interface LamportTimestamp {
  /** Counter value */
  counter: number;
  /** Node ID for tie-breaking */
  nodeId: NodeId;
}

/**
 * Vector clock for tracking causality
 */
export type VectorClock = Record<NodeId, number>;

/**
 * Operation types for CRDT
 */
export type OperationType = 'insert' | 'delete' | 'update' | 'move';

/**
 * Base operation interface
 */
export interface CRDTOperation {
  /** Operation ID */
  id: string;
  /** Operation type */
  type: OperationType;
  /** Lamport timestamp */
  timestamp: LamportTimestamp;
  /** Node that created the operation */
  origin: NodeId;
  /** Dependencies (operations that must be applied first) */
  dependencies?: string[];
}

/**
 * CRDT data types
 */
export type CRDTType =
  | 'lww-register' // Last-Writer-Wins Register
  | 'mv-register' // Multi-Value Register
  | 'g-counter' // Grow-only Counter
  | 'pn-counter' // Positive-Negative Counter
  | 'g-set' // Grow-only Set
  | 'or-set' // Observed-Remove Set
  | 'lww-map' // Last-Writer-Wins Map
  | 'rga' // Replicated Growable Array (for text)
  | 'json'; // JSON CRDT

/**
 * CRDT value wrapper
 */
export interface CRDTValue<T = unknown> {
  /** CRDT type */
  type: CRDTType;
  /** Current value */
  value: T;
  /** Metadata for conflict resolution */
  metadata: CRDTMetadata;
}

/**
 * CRDT metadata
 */
export interface CRDTMetadata {
  /** Last update timestamp */
  timestamp: LamportTimestamp;
  /** Vector clock */
  vclock: VectorClock;
  /** Tombstone flag for deleted items */
  tombstone?: boolean;
}

/**
 * LWW Register value
 */
export interface LWWRegisterValue<T = unknown> {
  value: T;
  timestamp: LamportTimestamp;
}

/**
 * MV Register value (can have concurrent values)
 */
export interface MVRegisterValue<T = unknown> {
  values: {
    value: T;
    timestamp: LamportTimestamp;
    vclock: VectorClock;
  }[];
}

/**
 * Counter value
 */
export interface CounterValue {
  /** Positive counts per node */
  positive: Record<NodeId, number>;
  /** Negative counts per node (for PN-Counter) */
  negative?: Record<NodeId, number>;
}

/**
 * OR-Set element
 */
export interface ORSetElement<T = unknown> {
  value: T;
  /** Unique tags for add operations */
  addTags: Set<string>;
  /** Tags that have been removed */
  removeTags: Set<string>;
}

/**
 * RGA (text) character
 */
export interface RGAChar {
  /** Character value */
  char: string;
  /** Unique ID */
  id: string;
  /** ID of the character this comes after */
  afterId: string | null;
  /** Tombstone flag */
  deleted: boolean;
  /** Timestamp */
  timestamp: LamportTimestamp;
}

/**
 * JSON CRDT operation
 */
export interface JSONCRDTOperation extends CRDTOperation {
  /** Path in the JSON document */
  path: string[];
  /** Value for the operation */
  value?: unknown;
  /** Previous value (for undo support) */
  previousValue?: unknown;
}

/**
 * CRDT document representing a full document state
 */
export interface CRDTDocument {
  /** Document ID */
  id: string;
  /** Document version */
  version: number;
  /** Vector clock */
  vclock: VectorClock;
  /** Root value */
  root: CRDTValue;
  /** Pending operations */
  pendingOps: CRDTOperation[];
  /** Applied operation IDs */
  appliedOps: Set<string>;
}

/**
 * Merge result
 */
export interface MergeResult<T = unknown> {
  /** Merged value */
  value: T;
  /** Whether there was a conflict */
  hadConflict: boolean;
  /** Conflicting values (if any) */
  conflictingValues?: T[];
}

/**
 * CRDT synchronization message
 */
export interface CRDTSyncMessage {
  /** Message type */
  type: 'sync-request' | 'sync-response' | 'operation' | 'state';
  /** Sender node ID */
  from: NodeId;
  /** Document ID */
  documentId: string;
  /** Operations to sync */
  operations?: CRDTOperation[];
  /** Full state (for initial sync) */
  state?: CRDTDocument;
  /** Sender's vector clock */
  vclock?: VectorClock;
}

/**
 * Awareness state for collaborative cursors/presence
 */
export interface AwarenessState {
  /** User information */
  user?: {
    name?: string;
    color?: string;
    avatar?: string;
  };
  /** Cursor position (for text) */
  cursor?: {
    anchor: number;
    head: number;
  };
  /** Selection (for structured data) */
  selection?: {
    path: string[];
    type: 'field' | 'element' | 'range';
  };
  /** Last update timestamp */
  lastUpdated: number;
}

/**
 * Collaborative session
 */
export interface CollaborativeSession {
  /** Session ID */
  id: string;
  /** Document ID */
  documentId: string;
  /** Connected peers */
  peers: Map<NodeId, PeerState>;
  /** Local node ID */
  localNodeId: NodeId;
  /** Is connected */
  connected: boolean;
}

/**
 * Peer state
 */
export interface PeerState {
  /** Node ID */
  nodeId: NodeId;
  /** Awareness state */
  awareness?: AwarenessState;
  /** Last seen timestamp */
  lastSeen: number;
  /** Is online */
  online: boolean;
}

/**
 * Collaboration event types
 */
export type CollaborationEventType =
  | 'peer:join'
  | 'peer:leave'
  | 'peer:update'
  | 'operation:local'
  | 'operation:remote'
  | 'sync:start'
  | 'sync:complete'
  | 'conflict:detected'
  | 'awareness:update';

/**
 * Collaboration event
 */
export interface CollaborationEvent {
  type: CollaborationEventType;
  nodeId?: NodeId;
  operation?: CRDTOperation;
  awareness?: AwarenessState;
  timestamp: number;
}
