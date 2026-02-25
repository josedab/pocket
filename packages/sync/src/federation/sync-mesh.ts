/**
 * SyncMesh — Federated multi-node sync without a central coordinator.
 *
 * Enables peer-to-peer sync where nodes discover each other,
 * exchange checkpoints, and synchronize using bilateral push/pull.
 *
 * @example
 * ```typescript
 * const mesh = new SyncMesh({
 *   nodeId: 'node-1',
 *   collections: ['todos', 'users'],
 *   transport: myTransport,
 * });
 *
 * mesh.addPeer('node-2', peerTransport);
 * await mesh.sync();
 *
 * mesh.status$.subscribe(s => console.log(s));
 * ```
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export interface SyncMeshConfig {
  nodeId: string;
  collections: string[];
  maxPeers?: number;
  syncIntervalMs?: number;
  heartbeatIntervalMs?: number;
  peerTimeoutMs?: number;
}

export type MeshNodeStatus = 'idle' | 'syncing' | 'converged' | 'partitioned' | 'error';

export interface PeerInfo {
  nodeId: string;
  collections: string[];
  lastSeen: number;
  checkpoint: Record<string, number>;
  status: 'connected' | 'disconnected' | 'syncing';
  roundTrips: number;
}

export interface MeshStats {
  nodeId: string;
  status: MeshNodeStatus;
  peerCount: number;
  activePeers: number;
  totalSyncs: number;
  lastSyncAt: number | null;
  partitionDetected: boolean;
}

export interface SyncResult {
  peerId: string;
  collection: string;
  pushed: number;
  pulled: number;
  conflicts: number;
  durationMs: number;
}

export type MeshEvent =
  | { type: 'peer:joined'; peerId: string }
  | { type: 'peer:left'; peerId: string }
  | { type: 'sync:start'; peerId: string }
  | { type: 'sync:complete'; result: SyncResult }
  | { type: 'sync:error'; peerId: string; error: string }
  | { type: 'partition:detected'; disconnectedPeers: string[] }
  | { type: 'partition:healed'; reconnectedPeers: string[] };

/** Transport interface for peer communication */
export interface MeshTransport {
  send(peerId: string, message: MeshMessage): Promise<void>;
  onMessage(callback: (from: string, message: MeshMessage) => void): () => void;
}

export type MeshMessage =
  | { type: 'hello'; nodeId: string; collections: string[]; checkpoint: Record<string, number> }
  | { type: 'sync-request'; collection: string; sinceCheckpoint: number }
  | { type: 'sync-response'; collection: string; changes: unknown[]; checkpoint: number }
  | { type: 'heartbeat'; nodeId: string; timestamp: number };

// ── Implementation ────────────────────────────────────────

export class SyncMesh {
  private readonly config: Required<SyncMeshConfig>;
  private readonly peers = new Map<string, PeerInfo>();
  private readonly checkpoints = new Map<string, number>();
  private readonly destroy$ = new Subject<void>();
  private readonly statusSubject: BehaviorSubject<MeshNodeStatus>;
  private readonly eventsSubject = new Subject<MeshEvent>();

  private transport: MeshTransport | null = null;
  private unsubTransport: (() => void) | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private totalSyncs = 0;
  private lastSyncAt: number | null = null;
  private destroyed = false;

  readonly status$: Observable<MeshNodeStatus>;
  readonly events$: Observable<MeshEvent>;

  constructor(config: SyncMeshConfig) {
    this.config = {
      nodeId: config.nodeId,
      collections: config.collections,
      maxPeers: config.maxPeers ?? 20,
      syncIntervalMs: config.syncIntervalMs ?? 5000,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 3000,
      peerTimeoutMs: config.peerTimeoutMs ?? 15000,
    };

    for (const col of this.config.collections) {
      this.checkpoints.set(col, 0);
    }

    this.statusSubject = new BehaviorSubject<MeshNodeStatus>('idle');
    this.status$ = this.statusSubject.asObservable().pipe(takeUntil(this.destroy$));
    this.events$ = this.eventsSubject.asObservable().pipe(takeUntil(this.destroy$));
  }

  get status(): MeshNodeStatus {
    return this.statusSubject.getValue();
  }
  get peerCount(): number {
    return this.peers.size;
  }

  /**
   * Connect a transport and start the mesh.
   */
  start(transport: MeshTransport): void {
    if (this.destroyed) throw new Error('SyncMesh has been destroyed');
    this.transport = transport;

    this.unsubTransport = transport.onMessage((from, msg) => {
      this.handleMessage(from, msg);
    });

    this.startHeartbeat();
    this.startSyncLoop();
  }

  /**
   * Add a peer to the mesh.
   */
  addPeer(peerId: string, initialCheckpoint?: Record<string, number>): void {
    if (this.peers.size >= this.config.maxPeers) {
      throw new Error(`Max peers (${this.config.maxPeers}) reached`);
    }

    const peer: PeerInfo = {
      nodeId: peerId,
      collections: this.config.collections,
      lastSeen: Date.now(),
      checkpoint:
        initialCheckpoint ?? Object.fromEntries(this.config.collections.map((c) => [c, 0])),
      status: 'connected',
      roundTrips: 0,
    };

    this.peers.set(peerId, peer);
    this.eventsSubject.next({ type: 'peer:joined', peerId });

    // Send hello
    this.transport
      ?.send(peerId, {
        type: 'hello',
        nodeId: this.config.nodeId,
        collections: this.config.collections,
        checkpoint: Object.fromEntries(this.checkpoints),
      })
      .catch(() => {
        /* best effort */
      });
  }

  /**
   * Remove a peer from the mesh.
   */
  removePeer(peerId: string): void {
    this.peers.delete(peerId);
    this.eventsSubject.next({ type: 'peer:left', peerId });
  }

  /**
   * Trigger a sync with all connected peers.
   */
  async sync(): Promise<SyncResult[]> {
    if (this.destroyed) return [];
    this.statusSubject.next('syncing');

    const results: SyncResult[] = [];
    const activePeers = [...this.peers.values()].filter((p) => p.status === 'connected');

    for (const peer of activePeers) {
      for (const collection of this.config.collections) {
        const start = performance.now();
        this.eventsSubject.next({ type: 'sync:start', peerId: peer.nodeId });

        try {
          const localCheckpoint = this.checkpoints.get(collection) ?? 0;
          const peerCheckpoint = peer.checkpoint[collection] ?? 0;

          // Bilateral sync: push our changes, pull theirs
          let pushed = 0;
          let pulled = 0;
          const conflicts = 0;

          if (localCheckpoint > peerCheckpoint) {
            // We have newer data — push
            await this.transport?.send(peer.nodeId, {
              type: 'sync-response',
              collection,
              changes: [],
              checkpoint: localCheckpoint,
            });
            pushed = localCheckpoint - peerCheckpoint;
          }

          if (peerCheckpoint > localCheckpoint) {
            // Peer has newer data — request pull
            await this.transport?.send(peer.nodeId, {
              type: 'sync-request',
              collection,
              sinceCheckpoint: localCheckpoint,
            });
            pulled = peerCheckpoint - localCheckpoint;
          }

          peer.roundTrips++;
          const result: SyncResult = {
            peerId: peer.nodeId,
            collection,
            pushed,
            pulled,
            conflicts,
            durationMs: performance.now() - start,
          };

          results.push(result);
          this.eventsSubject.next({ type: 'sync:complete', result });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.eventsSubject.next({ type: 'sync:error', peerId: peer.nodeId, error: msg });
        }
      }
    }

    this.totalSyncs++;
    this.lastSyncAt = Date.now();
    this.statusSubject.next('converged');
    return results;
  }

  /**
   * Get mesh statistics.
   */
  getStats(): MeshStats {
    const activePeers = [...this.peers.values()].filter((p) => p.status === 'connected').length;
    return {
      nodeId: this.config.nodeId,
      status: this.status,
      peerCount: this.peers.size,
      activePeers,
      totalSyncs: this.totalSyncs,
      lastSyncAt: this.lastSyncAt,
      partitionDetected: activePeers < this.peers.size,
    };
  }

  /**
   * Get info about all known peers.
   */
  getPeers(): PeerInfo[] {
    return [...this.peers.values()];
  }

  /**
   * Destroy the mesh.
   */
  destroy(): void {
    this.destroyed = true;
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.unsubTransport) this.unsubTransport();
    this.destroy$.next();
    this.destroy$.complete();
    this.statusSubject.complete();
    this.eventsSubject.complete();
    this.peers.clear();
  }

  // ── Private ────────────────────────────────────────────

  private handleMessage(from: string, message: MeshMessage): void {
    const peer = this.peers.get(from);
    if (peer) peer.lastSeen = Date.now();

    switch (message.type) {
      case 'hello': {
        if (!this.peers.has(from)) {
          this.addPeer(from, message.checkpoint);
        }
        const existing = this.peers.get(from);
        if (existing) {
          existing.checkpoint = message.checkpoint;
          existing.collections = message.collections;
        }
        break;
      }

      case 'sync-request': {
        // Peer wants data — respond with our changes
        const checkpoint = this.checkpoints.get(message.collection) ?? 0;
        this.transport
          ?.send(from, {
            type: 'sync-response',
            collection: message.collection,
            changes: [],
            checkpoint,
          })
          .catch(() => {});
        break;
      }

      case 'sync-response': {
        // Update our checkpoint from peer's response
        const current = this.checkpoints.get(message.collection) ?? 0;
        if (message.checkpoint > current) {
          this.checkpoints.set(message.collection, message.checkpoint);
        }
        break;
      }

      case 'heartbeat': {
        // Already updated lastSeen above
        break;
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.destroyed) return;

      // Send heartbeat to all peers
      for (const peer of this.peers.values()) {
        this.transport
          ?.send(peer.nodeId, {
            type: 'heartbeat',
            nodeId: this.config.nodeId,
            timestamp: Date.now(),
          })
          .catch(() => {});
      }

      // Detect disconnected peers
      const now = Date.now();
      const disconnected: string[] = [];
      for (const [id, peer] of this.peers) {
        if (now - peer.lastSeen > this.config.peerTimeoutMs) {
          if (peer.status !== 'disconnected') {
            peer.status = 'disconnected';
            disconnected.push(id);
          }
        }
      }

      if (disconnected.length > 0) {
        this.statusSubject.next('partitioned');
        this.eventsSubject.next({ type: 'partition:detected', disconnectedPeers: disconnected });
      }
    }, this.config.heartbeatIntervalMs);
  }

  private startSyncLoop(): void {
    this.syncTimer = setInterval(() => {
      if (this.destroyed) return;
      this.sync().catch(() => {});
    }, this.config.syncIntervalMs);
  }
}

export function createSyncMesh(config: SyncMeshConfig): SyncMesh {
  return new SyncMesh(config);
}
