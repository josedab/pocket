/**
 * Unique identifier for a node/replica in the CRDT network.
 *
 * Each client/device participating in collaborative editing needs
 * a unique NodeId to track operations and resolve conflicts.
 *
 * @example
 * ```typescript
 * const nodeId: NodeId = crypto.randomUUID();
 * const doc = createJSONCRDTDocument('doc-1', nodeId);
 * ```
 */
export type NodeId = string;

/**
 * Lamport timestamp for ordering distributed operations.
 *
 * Provides a logical clock that can order events across multiple nodes.
 * When timestamps have the same counter, nodeId is used as a tiebreaker.
 *
 * @example
 * ```typescript
 * const ts: LamportTimestamp = { counter: 42, nodeId: 'node-abc' };
 * ```
 */
export interface LamportTimestamp {
  /** Logical clock counter value */
  counter: number;

  /** Node ID for deterministic tie-breaking */
  nodeId: NodeId;
}

/**
 * Vector clock for tracking causality between distributed nodes.
 *
 * Maps each node to the latest counter value seen from that node.
 * Used to detect concurrent operations and determine causal ordering.
 *
 * @example
 * ```typescript
 * const vclock: VectorClock = {
 *   'node-a': 5,
 *   'node-b': 3,
 *   'node-c': 1,
 * };
 * ```
 */
export type VectorClock = Record<NodeId, number>;

/**
 * Types of operations in CRDT documents.
 */
export type OperationType = 'insert' | 'delete' | 'update' | 'move';

/**
 * Base interface for all CRDT operations.
 *
 * Operations are the atomic units of change in CRDTs. They are
 * designed to be commutative (order-independent) so that any
 * two nodes applying the same set of operations will converge
 * to the same state.
 */
export interface CRDTOperation {
  /** Unique operation ID */
  id: string;

  /** Type of operation */
  type: OperationType;

  /** Lamport timestamp for ordering */
  timestamp: LamportTimestamp;

  /** Node that created this operation */
  origin: NodeId;

  /** IDs of operations this depends on (for causal ordering) */
  dependencies?: string[];
}

/**
 * Supported CRDT data types.
 *
 * Each type has different conflict resolution semantics:
 *
 * - `'lww-register'` - Last-Writer-Wins Register: most recent write wins
 * - `'mv-register'` - Multi-Value Register: preserves all concurrent values
 * - `'g-counter'` - Grow-only Counter: can only increment
 * - `'pn-counter'` - Positive-Negative Counter: can increment and decrement
 * - `'g-set'` - Grow-only Set: can only add elements
 * - `'or-set'` - Observed-Remove Set: can add and remove elements
 * - `'lww-map'` - Last-Writer-Wins Map: LWW semantics per key
 * - `'rga'` - Replicated Growable Array: for collaborative text editing
 * - `'json'` - JSON CRDT: for structured document editing
 */
export type CRDTType =
  | 'lww-register'
  | 'mv-register'
  | 'g-counter'
  | 'pn-counter'
  | 'g-set'
  | 'or-set'
  | 'lww-map'
  | 'rga'
  | 'json';

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
 * Result from merging two CRDT states.
 *
 * @typeParam T - The value type
 *
 * @example
 * ```typescript
 * const result = doc.merge(remoteState);
 * if (result.hadConflict) {
 *   console.log('Conflicts resolved:', result.conflictingValues);
 * }
 * console.log('Merged value:', result.value);
 * ```
 */
export interface MergeResult<T = unknown> {
  /** The merged value after conflict resolution */
  value: T;

  /** Whether any conflicts were detected during merge */
  hadConflict: boolean;

  /** The conflicting values that were resolved (if any) */
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
 * Awareness state for collaborative presence and cursors.
 *
 * Used to show other users' cursors, selections, and online status
 * in real-time collaborative editing.
 *
 * @example
 * ```typescript
 * const awareness: AwarenessState = {
 *   user: { name: 'Alice', color: '#ff0000' },
 *   cursor: { anchor: 42, head: 42 },
 *   lastUpdated: Date.now(),
 * };
 *
 * session.setLocalAwareness(awareness);
 * ```
 */
export interface AwarenessState {
  /** User information for display */
  user?: {
    name?: string;
    color?: string;
    avatar?: string;
  };

  /** Cursor position for text editing (anchor and head for selection) */
  cursor?: {
    anchor: number;
    head: number;
  };

  /** Selection for structured data editing */
  selection?: {
    path: string[];
    type: 'field' | 'element' | 'range';
  };

  /** Unix timestamp of last awareness update */
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
