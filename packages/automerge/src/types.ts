/**
 * Configuration, types, and interfaces for the Automerge CRDT integration.
 */

/**
 * Configuration options for the Automerge sync adapter.
 */
export interface AutomergeConfig {
  /** Unique identifier for this actor/client in the CRDT network */
  readonly actorId: string;
  /** Strategy for merging concurrent changes */
  readonly mergeStrategy?: MergeStrategy;
  /** Maximum number of changes to batch before syncing */
  readonly batchSize?: number;
  /** Interval in ms between sync attempts */
  readonly syncIntervalMs?: number;
  /** Whether to compress sync messages */
  readonly compress?: boolean;
}

/**
 * Strategy for resolving merge conflicts in concurrent edits.
 */
export type MergeStrategy = 'auto' | 'last-writer-wins' | 'field-level-merge' | 'custom';

/**
 * Represents a single change in a CRDT document.
 */
export interface CrdtChange {
  /** Unique change identifier */
  readonly id: string;
  /** Actor that produced this change */
  readonly actorId: string;
  /** Logical timestamp (Lamport clock) */
  readonly timestamp: number;
  /** Sequence number within this actor's changes */
  readonly seq: number;
  /** The operations contained in this change */
  readonly operations: readonly CrdtOperation[];
  /** Hash of this change for integrity verification */
  readonly hash: string;
  /** Dependencies (hashes of preceding changes) */
  readonly deps: readonly string[];
}

/**
 * A single operation within a CRDT change.
 */
export interface CrdtOperation {
  readonly type: 'set' | 'delete' | 'increment' | 'insert' | 'splice';
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
}

/**
 * Represents the state of a CRDT document at a point in time.
 */
export interface CrdtDocumentState<T = Record<string, unknown>> {
  /** The current materialized document value */
  readonly value: T;
  /** All changes that produced this state */
  readonly changes: readonly CrdtChange[];
  /** The actor that owns this document copy */
  readonly actorId: string;
  /** Current logical clock value */
  readonly clock: number;
  /** Heads (latest change hashes) for sync */
  readonly heads: readonly string[];
}

/**
 * A CRDT document with methods for reading, modifying, and syncing.
 */
export interface CrdtDocument<T = Record<string, unknown>> {
  /** Get the current state snapshot */
  getState(): CrdtDocumentState<T>;
  /** Apply a local change to the document */
  change(fn: (draft: T) => void, message?: string): CrdtChange;
  /** Apply remote changes from another peer */
  applyChanges(changes: readonly CrdtChange[]): MergeResult<T>;
  /** Generate a sync message for a peer */
  generateSyncMessage(peerHeads: readonly string[]): CrdtSyncMessage | null;
  /** Receive and apply a sync message from a peer */
  receiveSyncMessage(message: CrdtSyncMessage): MergeResult<T>;
  /** Get all changes since given heads */
  getChangesSince(heads: readonly string[]): readonly CrdtChange[];
  /** Fork the document for a new actor */
  fork(actorId: string): CrdtDocument<T>;
  /** Destroy and free resources */
  destroy(): void;
}

/**
 * A sync message exchanged between peers.
 */
export interface CrdtSyncMessage {
  /** Sender actor ID */
  readonly senderId: string;
  /** Target actor ID */
  readonly targetId: string;
  /** Changes included in this message */
  readonly changes: readonly CrdtChange[];
  /** Sender's current heads */
  readonly heads: readonly string[];
  /** Whether this is a request for missing changes */
  readonly needsResponse: boolean;
  /** Compressed payload if compression is enabled */
  readonly compressed?: boolean;
}

/**
 * Result of merging changes into a document.
 */
export interface MergeResult<T = Record<string, unknown>> {
  /** Whether the merge succeeded */
  readonly success: boolean;
  /** The new document state after merge */
  readonly state: CrdtDocumentState<T>;
  /** Number of changes applied */
  readonly appliedCount: number;
  /** Changes that conflicted (resolved automatically) */
  readonly conflicts: readonly MergeConflict[];
}

/**
 * Describes a conflict that was automatically resolved during merge.
 */
export interface MergeConflict {
  /** Path to the conflicting field */
  readonly path: readonly (string | number)[];
  /** The value from the local actor */
  readonly localValue: unknown;
  /** The value from the remote actor */
  readonly remoteValue: unknown;
  /** The resolved value */
  readonly resolvedValue: unknown;
  /** Which actor's value was chosen */
  readonly winner: string;
}

/**
 * Tracks the sync state with a remote peer.
 */
export interface PeerState {
  /** Peer's actor ID */
  readonly peerId: string;
  /** Last known heads from this peer */
  readonly lastHeads: readonly string[];
  /** Whether we have outstanding changes to send */
  readonly hasPendingChanges: boolean;
  /** Last sync timestamp */
  readonly lastSyncAt: number;
  /** Number of sync round-trips completed */
  readonly syncCount: number;
}

/**
 * A sync session managing bidirectional sync with one or more peers.
 */
export interface SyncSession {
  /** The local document being synced */
  readonly documentId: string;
  /** Add a peer to this sync session */
  addPeer(peerId: string): void;
  /** Remove a peer from this sync session */
  removePeer(peerId: string): void;
  /** Get state for all connected peers */
  getPeerStates(): readonly PeerState[];
  /** Generate sync message for a specific peer */
  generateMessage(peerId: string): CrdtSyncMessage | null;
  /** Receive a sync message from a peer */
  receiveMessage(message: CrdtSyncMessage): MergeResult;
  /** Check if all peers are fully synced */
  isFullySynced(): boolean;
  /** Destroy the session */
  destroy(): void;
}

/**
 * Adapter that bridges Pocket's sync engine with CRDT-based sync.
 */
export interface AutomergeSyncAdapter {
  /** The actor ID for this adapter instance */
  readonly actorId: string;
  /** Create or load a CRDT document for a collection item */
  getDocument<T extends Record<string, unknown>>(collectionName: string, documentId: string): CrdtDocument<T>;
  /** Start a sync session with a remote peer */
  createSyncSession(documentId: string): SyncSession;
  /** Apply a local mutation through the CRDT layer */
  applyLocalChange<T extends Record<string, unknown>>(
    collectionName: string,
    documentId: string,
    changeFn: (draft: T) => void,
  ): CrdtChange;
  /** Apply remote changes received from sync transport */
  applyRemoteChanges(collectionName: string, documentId: string, changes: readonly CrdtChange[]): MergeResult;
  /** Get all documents managed by this adapter */
  getDocumentIds(collectionName: string): readonly string[];
  /** Destroy all resources */
  destroy(): void;
}
