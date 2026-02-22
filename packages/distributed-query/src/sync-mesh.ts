/**
 * Sync Mesh - Serverless peer-to-peer database synchronization
 *
 * Orchestrates P2PTransport and GossipProtocol to create a mesh network
 * that synchronizes Pocket database changes across peers without a
 * central server.
 *
 * @example
 * ```typescript
 * import { createSyncMesh } from '@pocket/distributed-query';
 *
 * const mesh = createSyncMesh({
 *   peerId: 'node-1',
 *   collections: ['todos', 'notes'],
 *   fanout: 3,
 *   maxPeers: 20,
 * });
 *
 * // Join the mesh
 * await mesh.start();
 *
 * // Connect to known peers
 * await mesh.addPeer('node-2', 'ws://node-2.local:8080');
 *
 * // Propagate a local change to the mesh
 * mesh.propagateChange('todos', 'todo-1', { title: 'Buy milk' }, 'create');
 *
 * // Listen for remote changes
 * mesh.remoteChanges$.subscribe((change) => {
 *   console.log(`Remote ${change.changeType} on ${change.collection}/${change.documentId}`);
 * });
 *
 * // Monitor mesh topology
 * mesh.topology$.subscribe((topo) => {
 *   console.log(`Peers: ${topo.peerCount}, Healthy: ${topo.healthyPeers}`);
 * });
 *
 * await mesh.stop();
 * ```
 */

import { BehaviorSubject, Subject, type Observable, type Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import {
  P2PTransport,
  type P2PTransportConfig,
  type PeerConnectionState,
  type TransportMessage,
} from './p2p-transport.js';
import {
  GossipProtocol,
  type GossipConfig,
  type GossipMessage,
} from './gossip-protocol.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A remote change received from the mesh */
export interface MeshChange {
  /** Source peer that originated the change */
  sourcePeerId: string;
  /** Target collection */
  collection: string;
  /** Document identifier */
  documentId: string;
  /** Document data */
  data: Record<string, unknown>;
  /** Type of change */
  changeType: 'create' | 'update' | 'delete';
  /** Timestamp of the change */
  timestamp: number;
}

/** Current topology of the sync mesh */
export interface MeshTopology {
  /** Local peer identifier */
  localPeerId: string;
  /** Total number of known peers */
  peerCount: number;
  /** Number of healthy (connected) peers */
  healthyPeers: number;
  /** Peer details with connection state */
  peers: Array<{
    peerId: string;
    state: PeerConnectionState;
    latencyMs: number;
    lastSeen: number;
  }>;
}

/** Aggregate mesh statistics */
export interface MeshStats {
  /** Number of changes propagated from this node */
  changesPropagated: number;
  /** Number of remote changes received */
  changesReceived: number;
  /** Number of changes deduplicated */
  changesDeduplicated: number;
  /** Uptime in milliseconds */
  uptimeMs: number;
  /** Transport-level statistics */
  transport: {
    messagesSent: number;
    messagesReceived: number;
    bytesTransferred: number;
  };
  /** Gossip-level statistics */
  gossip: {
    messagesSent: number;
    antiEntropyRuns: number;
    convergenceTime: number;
  };
}

/** Mesh status */
export type MeshStatus = 'stopped' | 'starting' | 'running' | 'stopping';

/** Configuration for the sync mesh */
export interface SyncMeshConfig {
  /** Unique identifier for this peer */
  peerId: string;
  /** Collections to synchronize across the mesh */
  collections: string[];
  /** Number of peers to forward each change to (default: 3) */
  fanout?: number;
  /** Maximum number of peer connections (default: 20) */
  maxPeers?: number;
  /** Heartbeat interval in ms (default: 10000) */
  heartbeatIntervalMs?: number;
  /** Maximum hops for gossip propagation (default: 6) */
  maxHops?: number;
  /** Anti-entropy interval in ms (default: 30000) */
  antiEntropyIntervalMs?: number;
  /** Enable relay fallback for NAT traversal (default: false) */
  enableRelay?: boolean;
  /** Relay server address */
  relayAddress?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_FANOUT = 3;
const DEFAULT_MAX_PEERS = 20;
const DEFAULT_HEARTBEAT_MS = 10_000;
const DEFAULT_MAX_HOPS = 6;
const DEFAULT_ANTI_ENTROPY_MS = 30_000;

// ---------------------------------------------------------------------------
// SyncMesh
// ---------------------------------------------------------------------------

/**
 * High-level sync mesh that coordinates P2P transport and gossip protocol
 * to provide serverless database synchronization.
 *
 * @example
 * ```typescript
 * const mesh = new SyncMesh({
 *   peerId: 'node-1',
 *   collections: ['todos'],
 * });
 *
 * await mesh.start();
 * await mesh.addPeer('node-2');
 *
 * mesh.propagateChange('todos', 'todo-1', { done: true }, 'update');
 * mesh.remoteChanges$.subscribe(console.log);
 *
 * await mesh.stop();
 * ```
 */
export class SyncMesh {
  private readonly config: Required<SyncMeshConfig>;
  private transport: P2PTransport | undefined;
  private gossip: GossipProtocol | undefined;
  private readonly subscriptions: Subscription[] = [];
  private startedAt = 0;
  private changesPropagated = 0;
  private changesReceived = 0;

  private readonly statusSubject = new BehaviorSubject<MeshStatus>('stopped');
  private readonly remoteChangesSubject = new Subject<MeshChange>();
  private readonly topologySubject = new BehaviorSubject<MeshTopology>({
    localPeerId: '',
    peerCount: 0,
    healthyPeers: 0,
    peers: [],
  });

  /** Observable of the current mesh status */
  readonly status$: Observable<MeshStatus> = this.statusSubject.asObservable();

  /** Observable of remote changes received from the mesh */
  readonly remoteChanges$: Observable<MeshChange> = this.remoteChangesSubject.asObservable();

  /** Observable of current mesh topology */
  readonly topology$: Observable<MeshTopology> = this.topologySubject.asObservable();

  constructor(config: SyncMeshConfig) {
    this.config = {
      peerId: config.peerId,
      collections: [...config.collections],
      fanout: config.fanout ?? DEFAULT_FANOUT,
      maxPeers: config.maxPeers ?? DEFAULT_MAX_PEERS,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS,
      maxHops: config.maxHops ?? DEFAULT_MAX_HOPS,
      antiEntropyIntervalMs: config.antiEntropyIntervalMs ?? DEFAULT_ANTI_ENTROPY_MS,
      enableRelay: config.enableRelay ?? false,
      relayAddress: config.relayAddress ?? '',
    };

    this.topologySubject.next({
      localPeerId: this.config.peerId,
      peerCount: 0,
      healthyPeers: 0,
      peers: [],
    });
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Start the sync mesh, initializing transport and gossip layers */
  async start(): Promise<void> {
    if (this.statusSubject.value !== 'stopped') {
      return;
    }

    this.statusSubject.next('starting');
    this.startedAt = Date.now();

    const transportConfig: P2PTransportConfig = {
      localPeerId: this.config.peerId,
      maxPeers: this.config.maxPeers,
      heartbeatIntervalMs: this.config.heartbeatIntervalMs,
      enableRelay: this.config.enableRelay,
      relayAddress: this.config.relayAddress,
    };

    const gossipConfig: GossipConfig = {
      localPeerId: this.config.peerId,
      fanout: this.config.fanout,
      maxHops: this.config.maxHops,
      antiEntropyIntervalMs: this.config.antiEntropyIntervalMs,
    };

    this.transport = new P2PTransport(transportConfig);
    this.gossip = new GossipProtocol(gossipConfig);

    this.wireTransportToGossip();
    this.wireGossipToChanges();
    this.wireTopologyUpdates();

    this.statusSubject.next('running');
  }

  /** Stop the sync mesh, disconnecting all peers and cleaning up */
  async stop(): Promise<void> {
    if (this.statusSubject.value !== 'running') {
      return;
    }

    this.statusSubject.next('stopping');

    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions.length = 0;

    this.gossip?.dispose();
    this.transport?.dispose();
    this.gossip = undefined;
    this.transport = undefined;

    this.statusSubject.next('stopped');
  }

  // -----------------------------------------------------------------------
  // Peer Management
  // -----------------------------------------------------------------------

  /**
   * Add a peer to the mesh
   *
   * @param peerId - Unique identifier of the peer
   * @param address - Optional network address for direct connection
   * @returns `true` if the peer was connected successfully
   */
  async addPeer(peerId: string, address?: string): Promise<boolean> {
    if (!this.transport || !this.gossip) {
      return false;
    }

    const connected = await this.transport.connect(peerId, address);
    if (connected) {
      this.gossip.registerPeer(peerId);
      this.updateTopology();
    }

    return connected;
  }

  /**
   * Remove a peer from the mesh
   *
   * @param peerId - Peer to disconnect
   */
  removePeer(peerId: string): void {
    this.transport?.disconnect(peerId);
    this.gossip?.removePeer(peerId);
    this.updateTopology();
  }

  /**
   * Get the list of currently connected peer IDs
   */
  getConnectedPeers(): string[] {
    return this.transport?.getConnectedPeers().map((p) => p.peerId) ?? [];
  }

  // -----------------------------------------------------------------------
  // Data Synchronization
  // -----------------------------------------------------------------------

  /**
   * Propagate a local change to the mesh for distribution to peers
   *
   * @param collection - Collection name
   * @param documentId - Document ID
   * @param data - Document data
   * @param changeType - Type of change
   */
  propagateChange(
    collection: string,
    documentId: string,
    data: Record<string, unknown>,
    changeType: 'create' | 'update' | 'delete'
  ): void {
    if (!this.gossip || !this.transport) {
      return;
    }

    if (!this.config.collections.includes(collection)) {
      return;
    }

    const message = this.gossip.propagate(collection, documentId, data, changeType);
    const targets = this.gossip.getPeersForGossip();

    for (const peerId of targets) {
      this.transport.send(peerId, 'sync', message);
    }

    this.changesPropagated++;
  }

  /**
   * Request anti-entropy synchronization with a specific peer
   *
   * @param peerId - Peer to synchronize with
   */
  requestSync(peerId: string): void {
    if (!this.gossip || !this.transport) {
      return;
    }

    const digest = this.gossip.requestAntiEntropy(peerId);
    this.transport.send(peerId, 'sync', digest);
  }

  // -----------------------------------------------------------------------
  // Statistics
  // -----------------------------------------------------------------------

  /** Get the current mesh status */
  getStatus(): MeshStatus {
    return this.statusSubject.value;
  }

  /** Get aggregate mesh statistics */
  getStats(): MeshStats {
    const transportStats = this.transport?.getStats();
    const gossipStats = this.gossip?.getStats();

    return {
      changesPropagated: this.changesPropagated,
      changesReceived: this.changesReceived,
      changesDeduplicated: gossipStats?.messagesDeduplicated ?? 0,
      uptimeMs: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
      transport: {
        messagesSent: transportStats?.totalMessagesSent ?? 0,
        messagesReceived: transportStats?.totalMessagesReceived ?? 0,
        bytesTransferred: transportStats?.totalBytesTransferred ?? 0,
      },
      gossip: {
        messagesSent: gossipStats?.messagesSent ?? 0,
        antiEntropyRuns: gossipStats?.antiEntropyRuns ?? 0,
        convergenceTime: gossipStats?.convergenceTime ?? 0,
      },
    };
  }

  /** Get current mesh topology snapshot */
  getTopology(): MeshTopology {
    return this.topologySubject.value;
  }

  // -----------------------------------------------------------------------
  // Private wiring
  // -----------------------------------------------------------------------

  /** Route incoming transport messages to the gossip layer */
  private wireTransportToGossip(): void {
    if (!this.transport || !this.gossip) return;

    const gossip = this.gossip;

    const sub = this.transport.messages$
      .pipe(filter((msg: TransportMessage) => msg.type === 'sync'))
      .subscribe((msg) => {
        const gossipMsg = msg.payload as GossipMessage;
        gossip.receiveMessage(gossipMsg);
      });

    this.subscriptions.push(sub);
  }

  /** Route gossip updates to the remote changes observable */
  private wireGossipToChanges(): void {
    if (!this.gossip) return;

    const sub = this.gossip.updates$.subscribe((update) => {
      const collection = update.collection;
      if (!this.config.collections.includes(collection)) {
        return;
      }

      this.changesReceived++;

      this.remoteChangesSubject.next({
        sourcePeerId: '',
        collection: update.collection,
        documentId: update.documentId,
        data: update.data,
        changeType: update.changeType as MeshChange['changeType'],
        timestamp: Date.now(),
      });
    });

    this.subscriptions.push(sub);
  }

  /** Forward gossip outbound messages through the transport */
  private wireTopologyUpdates(): void {
    if (!this.transport) return;

    const sub = this.transport.connectionEvents$.subscribe(() => {
      this.updateTopology();
    });

    this.subscriptions.push(sub);
  }

  /** Recompute and emit the current mesh topology */
  private updateTopology(): void {
    const allPeers = this.transport?.getPeers() ?? [];
    const connected = allPeers.filter((p) => p.connectionState === 'connected');

    this.topologySubject.next({
      localPeerId: this.config.peerId,
      peerCount: allPeers.length,
      healthyPeers: connected.length,
      peers: allPeers.map((p) => ({
        peerId: p.peerId,
        state: p.connectionState,
        latencyMs: p.latencyMs,
        lastSeen: p.lastMessageAt ?? p.connectedAt ?? 0,
      })),
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a sync mesh for serverless peer-to-peer database synchronization
 *
 * @param config - Mesh configuration
 * @returns A new {@link SyncMesh} instance
 *
 * @example
 * ```typescript
 * const mesh = createSyncMesh({
 *   peerId: 'node-1',
 *   collections: ['todos', 'notes'],
 *   fanout: 3,
 * });
 *
 * await mesh.start();
 * await mesh.addPeer('node-2', 'ws://node-2.local:8080');
 * ```
 */
export function createSyncMesh(config: SyncMeshConfig): SyncMesh {
  return new SyncMesh(config);
}
