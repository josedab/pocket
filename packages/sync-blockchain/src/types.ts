/**
 * Type definitions for the @pocket/sync-blockchain package.
 *
 * Provides comprehensive types for content-addressed storage,
 * Merkle DAG structures, decentralized identity, block types,
 * sync protocol messages, and configuration.
 *
 * @module @pocket/sync-blockchain/types
 */

// ---------------------------------------------------------------------------
// Content Identifier (CID) Types
// ---------------------------------------------------------------------------

/** Hash algorithm used for content addressing. */
export type HashAlgorithm = 'sha-256';

/** Codec used for encoding block data. */
export type BlockCodec = 'json' | 'cbor' | 'raw';

/**
 * Content Identifier - uniquely identifies a block by its content hash.
 *
 * @example
 * ```typescript
 * const cid: CID = {
 *   hash: 'a1b2c3...',
 *   algorithm: 'sha-256',
 *   codec: 'json',
 *   version: 1,
 * };
 * ```
 */
export interface CID {
  /** The hex-encoded content hash. */
  readonly hash: string;
  /** Hash algorithm used. */
  readonly algorithm: HashAlgorithm;
  /** Codec used for encoding. */
  readonly codec: BlockCodec;
  /** CID version. */
  readonly version: number;
}

// ---------------------------------------------------------------------------
// Merkle DAG Node Types
// ---------------------------------------------------------------------------

/**
 * A node in the Merkle DAG representing a document version.
 */
export interface MerkleDAGNode {
  /** Content identifier for this node. */
  readonly cid: CID;
  /** CIDs of parent nodes (empty for genesis). */
  readonly parents: readonly string[];
  /** Timestamp when this node was created. */
  readonly timestamp: number;
  /** DID of the author who created this node. */
  readonly author: string;
  /** Arbitrary payload data. */
  readonly data: Uint8Array;
  /** Size of the data in bytes. */
  readonly size: number;
}

/**
 * A link between two nodes in the DAG.
 */
export interface DAGLink {
  /** Name/label for the link. */
  readonly name: string;
  /** CID of the target node. */
  readonly cid: string;
  /** Size of the linked content. */
  readonly size: number;
}

/**
 * Result of a DAG conflict detection.
 */
export interface DAGConflict {
  /** CIDs of the conflicting head nodes. */
  readonly heads: readonly string[];
  /** CID of the common ancestor. */
  readonly commonAncestor: string | null;
  /** Whether auto-resolution is possible. */
  readonly resolvable: boolean;
}

/**
 * Proof that a CID is included in the DAG.
 */
export interface InclusionProof {
  /** The CID being proved. */
  readonly targetCid: string;
  /** The root CID of the DAG. */
  readonly rootCid: string;
  /** Ordered list of intermediate CIDs from target to root. */
  readonly path: readonly string[];
  /** Timestamp of proof generation. */
  readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Decentralized Identity (DID) Types
// ---------------------------------------------------------------------------

/**
 * A cryptographic key pair for signing and verification.
 */
export interface KeyPair {
  /** Hex-encoded public key. */
  readonly publicKey: string;
  /** Hex-encoded private key (kept secret). */
  readonly privateKey: string;
  /** Key algorithm. */
  readonly algorithm: 'Ed25519';
  /** Timestamp when the key was created. */
  readonly createdAt: number;
}

/**
 * A Decentralized Identifier document.
 */
export interface DIDDocument {
  /** The DID string (e.g., "did:pocket:abc123"). */
  readonly id: string;
  /** Public keys associated with this DID. */
  readonly publicKeys: readonly DIDPublicKey[];
  /** Authentication methods. */
  readonly authentication: readonly string[];
  /** Timestamp of creation. */
  readonly created: number;
  /** Timestamp of last update. */
  readonly updated: number;
}

/**
 * A public key entry in a DID document.
 */
export interface DIDPublicKey {
  /** Key identifier. */
  readonly id: string;
  /** Key type. */
  readonly type: 'Ed25519VerificationKey2020';
  /** The DID that controls this key. */
  readonly controller: string;
  /** Hex-encoded public key material. */
  readonly publicKeyHex: string;
}

/**
 * A cryptographic signature over document data.
 */
export interface DocumentSignature {
  /** The DID of the signer. */
  readonly signer: string;
  /** Hex-encoded signature bytes. */
  readonly signature: string;
  /** Algorithm used. */
  readonly algorithm: 'Ed25519';
  /** Timestamp when signed. */
  readonly timestamp: number;
}

/**
 * A temporary session key derived from the master key pair.
 */
export interface SessionKey {
  /** Unique session key identifier. */
  readonly id: string;
  /** The associated DID. */
  readonly did: string;
  /** Hex-encoded session public key. */
  readonly publicKey: string;
  /** Hex-encoded session private key. */
  readonly privateKey: string;
  /** Expiration timestamp. */
  readonly expiresAt: number;
  /** Timestamp of creation. */
  readonly createdAt: number;
}

// ---------------------------------------------------------------------------
// Block Types
// ---------------------------------------------------------------------------

/**
 * Header of a block in the audit chain.
 */
export interface BlockHeader {
  /** Block sequence number. */
  readonly index: number;
  /** Hash of the previous block. */
  readonly previousHash: string;
  /** Timestamp of block creation. */
  readonly timestamp: number;
  /** Hash of the block body (Merkle root of entries). */
  readonly dataHash: string;
  /** DID of the block creator. */
  readonly creator: string;
}

/**
 * Body of a block containing audit entries.
 */
export interface BlockBody {
  /** Audit entries in this block. */
  readonly entries: readonly AuditEntry[];
}

/**
 * A complete block with header, body, and hash.
 */
export interface Block {
  /** Block header. */
  readonly header: BlockHeader;
  /** Block body. */
  readonly body: BlockBody;
  /** Hash of the entire block (header + body). */
  readonly hash: string;
}

// ---------------------------------------------------------------------------
// Audit Entry Types
// ---------------------------------------------------------------------------

/** Type of auditable operation. */
export type AuditOperation =
  | 'document:create'
  | 'document:update'
  | 'document:delete'
  | 'sync:push'
  | 'sync:pull'
  | 'sync:conflict-resolved'
  | 'identity:created'
  | 'identity:rotated';

/**
 * A single auditable entry in the chain.
 */
export interface AuditEntry {
  /** Unique entry identifier. */
  readonly id: string;
  /** Type of operation. */
  readonly operation: AuditOperation;
  /** Collection name. */
  readonly collection: string;
  /** Document identifier (if applicable). */
  readonly documentId: string | null;
  /** CID of the related content (if applicable). */
  readonly contentCid: string | null;
  /** DID of the user who performed the operation. */
  readonly actor: string;
  /** Timestamp of the operation. */
  readonly timestamp: number;
  /** Additional metadata. */
  readonly metadata: Record<string, unknown>;
}

/**
 * Query filter for audit entries.
 */
export interface AuditQuery {
  /** Start of time range (inclusive). */
  readonly startTime?: number;
  /** End of time range (inclusive). */
  readonly endTime?: number;
  /** Filter by actor DID. */
  readonly actor?: string;
  /** Filter by collection name. */
  readonly collection?: string;
  /** Filter by operation type. */
  readonly operation?: AuditOperation;
  /** Maximum number of results. */
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Sync Protocol Message Types
// ---------------------------------------------------------------------------

/** Types of P2P sync protocol messages. */
export type SyncMessageType =
  | 'have'
  | 'want'
  | 'block'
  | 'status'
  | 'handshake'
  | 'handshake-ack'
  | 'bye';

/**
 * Base interface for all sync protocol messages.
 */
export interface SyncMessageBase {
  /** Message type discriminator. */
  readonly type: SyncMessageType;
  /** Sender peer identifier. */
  readonly from: string;
  /** Message identifier. */
  readonly id: string;
  /** Timestamp of the message. */
  readonly timestamp: number;
}

/** Announces CIDs that a peer has. */
export interface HaveMessage extends SyncMessageBase {
  readonly type: 'have';
  /** List of CIDs the peer has. */
  readonly cids: readonly string[];
}

/** Requests specific CIDs from a peer. */
export interface WantMessage extends SyncMessageBase {
  readonly type: 'want';
  /** List of CIDs the peer wants. */
  readonly cids: readonly string[];
}

/** Sends a block of data to a peer. */
export interface BlockMessage extends SyncMessageBase {
  readonly type: 'block';
  /** The CID of the block. */
  readonly cid: string;
  /** Serialized block data. */
  readonly data: string;
}

/** Reports sync status to a peer. */
export interface StatusMessage extends SyncMessageBase {
  readonly type: 'status';
  /** Number of blocks held. */
  readonly blockCount: number;
  /** CIDs of DAG heads. */
  readonly heads: readonly string[];
}

/** Initial handshake message. */
export interface HandshakeMessage extends SyncMessageBase {
  readonly type: 'handshake';
  /** Protocol version. */
  readonly version: number;
  /** Peer's DID. */
  readonly did: string;
  /** Collections the peer wants to sync. */
  readonly collections: readonly string[];
}

/** Handshake acknowledgement. */
export interface HandshakeAckMessage extends SyncMessageBase {
  readonly type: 'handshake-ack';
  /** Whether the handshake was accepted. */
  readonly accepted: boolean;
  /** Reason for rejection (if not accepted). */
  readonly reason?: string;
}

/** Disconnect message. */
export interface ByeMessage extends SyncMessageBase {
  readonly type: 'bye';
  /** Reason for disconnecting. */
  readonly reason?: string;
}

/** Union of all sync protocol messages. */
export type SyncMessage =
  | HaveMessage
  | WantMessage
  | BlockMessage
  | StatusMessage
  | HandshakeMessage
  | HandshakeAckMessage
  | ByeMessage;

// ---------------------------------------------------------------------------
// Peer Types
// ---------------------------------------------------------------------------

/** Connection state of a peer. */
export type PeerState = 'connecting' | 'connected' | 'syncing' | 'idle' | 'disconnected';

/**
 * Information about a connected peer.
 */
export interface PeerInfo {
  /** Unique peer identifier. */
  readonly id: string;
  /** Peer's DID. */
  readonly did: string;
  /** Current connection state. */
  readonly state: PeerState;
  /** Timestamp of last activity. */
  readonly lastSeen: number;
  /** Number of blocks exchanged with this peer. */
  readonly blocksExchanged: number;
  /** Round-trip latency in milliseconds. */
  readonly latencyMs: number;
}

// ---------------------------------------------------------------------------
// Sync Progress Types
// ---------------------------------------------------------------------------

/**
 * Current sync progress information.
 */
export interface SyncProgress {
  /** Current sync phase. */
  readonly phase: 'idle' | 'discovering' | 'syncing' | 'verifying' | 'complete' | 'error';
  /** Number of blocks sent. */
  readonly blocksSent: number;
  /** Number of blocks received. */
  readonly blocksReceived: number;
  /** Total blocks to sync (0 if unknown). */
  readonly totalBlocks: number;
  /** Number of connected peers. */
  readonly connectedPeers: number;
  /** Error message if phase is 'error'. */
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

/**
 * Configuration for content pinning behavior.
 */
export interface PinningConfig {
  /** Whether to automatically pin new content. */
  readonly autoPinNew: boolean;
  /** Maximum number of pinned items. */
  readonly maxPinned: number;
  /** Strategy for unpinning when limit is reached. */
  readonly evictionStrategy: 'lru' | 'lfu' | 'fifo';
}

/**
 * Network configuration for P2P sync.
 */
export interface NetworkConfig {
  /** Maximum number of concurrent peer connections. */
  readonly maxPeers: number;
  /** Connection timeout in milliseconds. */
  readonly connectionTimeoutMs: number;
  /** Interval between peer discovery attempts in milliseconds. */
  readonly discoveryIntervalMs: number;
  /** HTTP fallback URL for hybrid mode. */
  readonly httpFallbackUrl?: string;
  /** Whether to enable HTTP fallback when P2P is unavailable. */
  readonly enableHttpFallback: boolean;
}

/**
 * Storage configuration for content-addressed blocks.
 */
export interface StorageConfig {
  /** Maximum storage size in bytes. */
  readonly maxStorageBytes: number;
  /** Interval between garbage collection runs in milliseconds. */
  readonly gcIntervalMs: number;
  /** Whether to enable automatic garbage collection. */
  readonly enableAutoGc: boolean;
}

/**
 * Main configuration for the sync-blockchain package.
 *
 * @example
 * ```typescript
 * const config: BlockchainSyncConfig = {
 *   collections: ['todos', 'notes'],
 *   pinning: { autoPinNew: true, maxPinned: 10000, evictionStrategy: 'lru' },
 *   network: { maxPeers: 8, connectionTimeoutMs: 5000, discoveryIntervalMs: 30000, enableHttpFallback: true },
 *   storage: { maxStorageBytes: 100 * 1024 * 1024, gcIntervalMs: 300000, enableAutoGc: true },
 * };
 * ```
 */
export interface BlockchainSyncConfig {
  /** Collections to sync. */
  readonly collections: readonly string[];
  /** Content pinning configuration. */
  readonly pinning: PinningConfig;
  /** Network configuration. */
  readonly network: NetworkConfig;
  /** Storage configuration. */
  readonly storage: StorageConfig;
}

/**
 * Default configuration values.
 */
export const DEFAULT_PINNING_CONFIG: PinningConfig = {
  autoPinNew: true,
  maxPinned: 10000,
  evictionStrategy: 'lru',
};

export const DEFAULT_NETWORK_CONFIG: NetworkConfig = {
  maxPeers: 8,
  connectionTimeoutMs: 5000,
  discoveryIntervalMs: 30000,
  enableHttpFallback: true,
};

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  maxStorageBytes: 100 * 1024 * 1024, // 100 MB
  gcIntervalMs: 300_000, // 5 minutes
  enableAutoGc: true,
};
