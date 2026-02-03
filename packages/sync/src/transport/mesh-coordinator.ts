/**
 * Mesh Coordinator — orchestrates multi-peer synchronization.
 *
 * Manages the mesh topology, routing sync messages between peers,
 * and coordinating state reconciliation across the network.
 */

import type { SyncProtocolMessage } from './types.js';
import type { LANPeer } from './lan-discovery.js';

export type MeshTopology = 'full-mesh' | 'star' | 'ring';

export interface MeshPeerState {
  peerId: string;
  connected: boolean;
  lastSync: number | null;
  latencyMs: number | null;
  syncedCollections: string[];
}

export interface MeshConfig {
  /** Topology strategy. @default 'full-mesh' */
  topology?: MeshTopology;
  /** Maximum number of concurrent peer connections. @default 8 */
  maxPeers?: number;
  /** Sync interval in ms for periodic reconciliation. @default 10000 */
  syncInterval?: number;
  /** Collections to sync across the mesh */
  collections?: string[];
}

/**
 * Coordinates sync across multiple peers in a mesh network.
 *
 * @example
 * ```typescript
 * const mesh = new MeshCoordinator({
 *   topology: 'full-mesh',
 *   maxPeers: 8,
 *   collections: ['todos', 'notes'],
 * });
 *
 * mesh.addPeer({ peerId: 'peer-1', ... });
 * mesh.onSyncRequired((peerId, collections) => {
 *   // Trigger sync with peer
 * });
 * mesh.start();
 * ```
 */
export class MeshCoordinator {
  private readonly peerStates = new Map<string, MeshPeerState>();
  private readonly config: Required<MeshConfig>;
  private _running = false;
  private syncTimer?: ReturnType<typeof setInterval>;
  private readonly messageLog: {
    from: string;
    to: string;
    type: SyncProtocolMessage['type'];
    timestamp: number;
  }[] = [];

  private syncRequiredHandlers: ((peerId: string, collections: string[]) => void)[] = [];
  private peerConnectedHandlers: ((peerId: string) => void)[] = [];
  private peerDisconnectedHandlers: ((peerId: string) => void)[] = [];

  constructor(config: MeshConfig = {}) {
    this.config = {
      topology: config.topology ?? 'full-mesh',
      maxPeers: config.maxPeers ?? 8,
      syncInterval: config.syncInterval ?? 10000,
      collections: config.collections ?? [],
    };
  }

  /**
   * Start the mesh coordinator.
   */
  start(): void {
    if (this._running) return;
    this._running = true;

    this.syncTimer = setInterval(
      () => this.periodicSync(),
      this.config.syncInterval,
    );
  }

  /**
   * Stop the mesh coordinator.
   */
  stop(): void {
    if (!this._running) return;
    this._running = false;

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
  }

  get running(): boolean {
    return this._running;
  }

  /**
   * Add a peer to the mesh.
   */
  addPeer(peer: LANPeer | { peerId: string }): boolean {
    if (this.peerStates.size >= this.config.maxPeers) {
      return false;
    }

    if (this.peerStates.has(peer.peerId)) {
      return false;
    }

    this.peerStates.set(peer.peerId, {
      peerId: peer.peerId,
      connected: true,
      lastSync: null,
      latencyMs: null,
      syncedCollections: [],
    });

    this.peerConnectedHandlers.forEach((h) => h(peer.peerId));
    return true;
  }

  /**
   * Remove a peer from the mesh.
   */
  removePeer(peerId: string): boolean {
    const removed = this.peerStates.delete(peerId);
    if (removed) {
      this.peerDisconnectedHandlers.forEach((h) => h(peerId));
    }
    return removed;
  }

  /**
   * Get the state of a specific peer.
   */
  getPeerState(peerId: string): MeshPeerState | undefined {
    return this.peerStates.get(peerId);
  }

  /**
   * Get all connected peers.
   */
  getConnectedPeers(): MeshPeerState[] {
    return Array.from(this.peerStates.values()).filter((p) => p.connected);
  }

  /**
   * Get the mesh topology.
   */
  get topology(): MeshTopology {
    return this.config.topology;
  }

  /**
   * Record a sync message for diagnostics.
   */
  recordMessage(from: string, to: string, type: SyncProtocolMessage['type']): void {
    this.messageLog.push({ from, to, type, timestamp: Date.now() });
    // Keep only last 1000 messages
    if (this.messageLog.length > 1000) {
      this.messageLog.splice(0, this.messageLog.length - 1000);
    }
  }

  /**
   * Update peer sync state after a successful sync.
   */
  markSynced(peerId: string, collections: string[]): void {
    const state = this.peerStates.get(peerId);
    if (state) {
      state.lastSync = Date.now();
      state.syncedCollections = collections;
    }
  }

  /**
   * Update peer latency measurement.
   */
  updateLatency(peerId: string, latencyMs: number): void {
    const state = this.peerStates.get(peerId);
    if (state) {
      state.latencyMs = latencyMs;
    }
  }

  /**
   * Get message log for diagnostics.
   */
  getMessageLog(): readonly { from: string; to: string; type: string; timestamp: number }[] {
    return this.messageLog;
  }

  /**
   * Get peers that need syncing (haven't synced recently).
   */
  getStalepeers(maxAge: number): MeshPeerState[] {
    const cutoff = Date.now() - maxAge;
    return Array.from(this.peerStates.values()).filter(
      (p) => p.connected && (p.lastSync === null || p.lastSync < cutoff),
    );
  }

  /**
   * Get the optimal sync order based on topology.
   */
  getSyncOrder(): string[] {
    const peers = this.getConnectedPeers();

    switch (this.config.topology) {
      case 'star':
        // Sort by latency, sync lowest latency first
        return peers
          .sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity))
          .map((p) => p.peerId);

      case 'ring':
        // Maintain insertion order (peers form a ring)
        return peers.map((p) => p.peerId);

      case 'full-mesh':
      default:
        // Sort by staleness (least recently synced first)
        return peers
          .sort((a, b) => (a.lastSync ?? 0) - (b.lastSync ?? 0))
          .map((p) => p.peerId);
    }
  }

  /**
   * Register handler for sync-required events.
   */
  onSyncRequired(handler: (peerId: string, collections: string[]) => void): void {
    this.syncRequiredHandlers.push(handler);
  }

  /**
   * Register handler for peer connection events.
   */
  onPeerConnected(handler: (peerId: string) => void): void {
    this.peerConnectedHandlers.push(handler);
  }

  /**
   * Register handler for peer disconnection events.
   */
  onPeerDisconnected(handler: (peerId: string) => void): void {
    this.peerDisconnectedHandlers.push(handler);
  }

  /**
   * Mesh statistics.
   */
  getStats(): {
    totalPeers: number;
    connectedPeers: number;
    topology: MeshTopology;
    totalMessages: number;
    collections: string[];
  } {
    return {
      totalPeers: this.peerStates.size,
      connectedPeers: this.getConnectedPeers().length,
      topology: this.config.topology,
      totalMessages: this.messageLog.length,
      collections: this.config.collections,
    };
  }

  private periodicSync(): void {
    const stalePeers = this.getStalepeers(this.config.syncInterval * 2);
    for (const peer of stalePeers) {
      this.syncRequiredHandlers.forEach((h) =>
        h(peer.peerId, this.config.collections),
      );
    }
  }
}

/**
 * Create a MeshCoordinator instance.
 */
export function createMeshCoordinator(config?: MeshConfig): MeshCoordinator {
  return new MeshCoordinator(config);
}
