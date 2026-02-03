/**
 * LAN Peer Discovery for mesh synchronization.
 *
 * Discovers and tracks Pocket peers on the local network
 * for direct peer-to-peer synchronization.
 */

/**
 * A discovered peer on the local network.
 */
export interface LANPeer {
  /** Unique peer identifier */
  peerId: string;
  /** Display name (device or user) */
  displayName: string;
  /** IP address or hostname */
  address: string;
  /** Port number for sync */
  port: number;
  /** When the peer was first discovered */
  discoveredAt: number;
  /** When the peer was last seen */
  lastSeen: number;
  /** Peer metadata (device type, pocket version, etc.) */
  metadata?: Record<string, string>;
}

/**
 * Options for LAN discovery.
 */
export interface LANDiscoveryConfig {
  /** How often to broadcast presence (ms). @default 5000 */
  broadcastInterval?: number;
  /** Peer timeout — remove if not seen within this duration (ms). @default 15000 */
  peerTimeout?: number;
  /** Display name for this peer */
  displayName?: string;
  /** Port to advertise for sync connections */
  port?: number;
  /** Service type for discovery (e.g., '_pocket-sync._tcp'). @default '_pocket-sync._tcp' */
  serviceType?: string;
}

type PeerEventHandler = (peer: LANPeer) => void;

/**
 * Discovers and tracks Pocket peers on the local network.
 *
 * @example
 * ```typescript
 * const discovery = new LANDiscovery({
 *   displayName: 'My Laptop',
 *   port: 8765,
 * });
 *
 * discovery.onPeerFound((peer) => {
 *   console.log(`Found peer: ${peer.displayName} at ${peer.address}:${peer.port}`);
 * });
 *
 * discovery.onPeerLost((peer) => {
 *   console.log(`Lost peer: ${peer.displayName}`);
 * });
 *
 * discovery.start();
 * ```
 */
export class LANDiscovery {
  private readonly peers = new Map<string, LANPeer>();
  private readonly config: Required<LANDiscoveryConfig>;
  private _running = false;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  private foundHandlers: PeerEventHandler[] = [];
  private lostHandlers: PeerEventHandler[] = [];
  private updatedHandlers: PeerEventHandler[] = [];

  constructor(config: LANDiscoveryConfig = {}) {
    this.config = {
      broadcastInterval: config.broadcastInterval ?? 5000,
      peerTimeout: config.peerTimeout ?? 15000,
      displayName: config.displayName ?? `Pocket-${Date.now().toString(36)}`,
      port: config.port ?? 8765,
      serviceType: config.serviceType ?? '_pocket-sync._tcp',
    };
  }

  /**
   * Start discovering peers.
   */
  start(): void {
    if (this._running) return;
    this._running = true;

    this.cleanupTimer = setInterval(
      () => this.cleanupStalePeers(),
      this.config.peerTimeout,
    );
  }

  /**
   * Stop discovery and clean up.
   */
  stop(): void {
    if (!this._running) return;
    this._running = false;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    this.peers.clear();
  }

  /**
   * Whether discovery is currently active.
   */
  get running(): boolean {
    return this._running;
  }

  /**
   * Manually announce a peer (used for testing or manual peer registration).
   */
  announcePeer(
    peerId: string,
    info: {
      displayName: string;
      address: string;
      port: number;
      metadata?: Record<string, string>;
    },
  ): void {
    const now = Date.now();
    const existing = this.peers.get(peerId);

    if (existing) {
      existing.lastSeen = now;
      existing.displayName = info.displayName;
      existing.address = info.address;
      existing.port = info.port;
      if (info.metadata) existing.metadata = info.metadata;
      this.updatedHandlers.forEach((h) => h(existing));
    } else {
      const peer: LANPeer = {
        peerId,
        displayName: info.displayName,
        address: info.address,
        port: info.port,
        discoveredAt: now,
        lastSeen: now,
        metadata: info.metadata,
      };
      this.peers.set(peerId, peer);
      this.foundHandlers.forEach((h) => h(peer));
    }
  }

  /**
   * Remove a peer by ID.
   */
  removePeer(peerId: string): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    this.peers.delete(peerId);
    this.lostHandlers.forEach((h) => h(peer));
    return true;
  }

  /**
   * Get all currently known peers.
   */
  getPeers(): LANPeer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Get a specific peer by ID.
   */
  getPeer(peerId: string): LANPeer | undefined {
    return this.peers.get(peerId);
  }

  /**
   * Register handler for newly discovered peers.
   */
  onPeerFound(handler: PeerEventHandler): void {
    this.foundHandlers.push(handler);
  }

  /**
   * Register handler for lost peers.
   */
  onPeerLost(handler: PeerEventHandler): void {
    this.lostHandlers.push(handler);
  }

  /**
   * Register handler for peer updates.
   */
  onPeerUpdated(handler: PeerEventHandler): void {
    this.updatedHandlers.push(handler);
  }

  /**
   * Get discovery configuration.
   */
  getConfig(): Readonly<Required<LANDiscoveryConfig>> {
    return this.config;
  }

  /**
   * Remove peers that haven't been seen within the timeout.
   */
  private cleanupStalePeers(): void {
    const cutoff = Date.now() - this.config.peerTimeout;
    for (const [id, peer] of this.peers) {
      if (peer.lastSeen < cutoff) {
        this.peers.delete(id);
        this.lostHandlers.forEach((h) => h(peer));
      }
    }
  }
}

/**
 * Create a LAN discovery instance.
 */
export function createLANDiscovery(config?: LANDiscoveryConfig): LANDiscovery {
  return new LANDiscovery(config);
}
