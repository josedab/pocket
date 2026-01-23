import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import type { AwarenessState, NodeId, PeerState } from './types.js';

/**
 * Awareness update message
 */
export interface AwarenessUpdate {
  nodeId: NodeId;
  state: AwarenessState | null;
  timestamp: number;
}

/**
 * Awareness manager for collaborative presence
 * Handles cursor positions, selections, and user presence
 */
export class AwarenessManager {
  private readonly nodeId: NodeId;
  private readonly peers: Map<NodeId, PeerState>;
  private localState: AwarenessState | null = null;

  private readonly peers$ = new BehaviorSubject<Map<NodeId, PeerState>>(new Map());
  private readonly updates$ = new Subject<AwarenessUpdate>();

  // Timeout for considering a peer offline (30 seconds)
  private readonly peerTimeout = 30000;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(nodeId: NodeId) {
    this.nodeId = nodeId;
    this.peers = new Map();
    this.startCleanup();
  }

  /**
   * Set local awareness state
   */
  setLocalState(state: Partial<AwarenessState>): void {
    this.localState = {
      ...this.localState,
      ...state,
      lastUpdated: Date.now(),
    };

    const update: AwarenessUpdate = {
      nodeId: this.nodeId,
      state: this.localState,
      timestamp: Date.now(),
    };

    this.updates$.next(update);
  }

  /**
   * Get local awareness state
   */
  getLocalState(): AwarenessState | null {
    return this.localState;
  }

  /**
   * Clear local awareness state
   */
  clearLocalState(): void {
    this.localState = null;

    const update: AwarenessUpdate = {
      nodeId: this.nodeId,
      state: null,
      timestamp: Date.now(),
    };

    this.updates$.next(update);
  }

  /**
   * Set cursor position
   */
  setCursor(anchor: number, head: number): void {
    this.setLocalState({
      cursor: { anchor, head },
    });
  }

  /**
   * Set selection
   */
  setSelection(path: string[], type: 'field' | 'element' | 'range'): void {
    this.setLocalState({
      selection: { path, type },
    });
  }

  /**
   * Set user info
   */
  setUser(user: { name?: string; color?: string; avatar?: string }): void {
    this.setLocalState({
      user,
    });
  }

  /**
   * Apply a remote awareness update
   */
  applyRemoteUpdate(update: AwarenessUpdate): void {
    if (update.nodeId === this.nodeId) {
      return; // Ignore our own updates
    }

    if (update.state === null) {
      // Peer is disconnecting
      this.peers.delete(update.nodeId);
    } else {
      const existing = this.peers.get(update.nodeId);
      this.peers.set(update.nodeId, {
        nodeId: update.nodeId,
        awareness: update.state,
        lastSeen: update.timestamp,
        online: true,
      });

      // Emit event if this is a new peer
      if (!existing) {
        // New peer joined
      }
    }

    this.peers$.next(new Map(this.peers));
  }

  /**
   * Get all peer states
   */
  getPeers(): Map<NodeId, PeerState> {
    return new Map(this.peers);
  }

  /**
   * Get a specific peer's state
   */
  getPeer(nodeId: NodeId): PeerState | undefined {
    return this.peers.get(nodeId);
  }

  /**
   * Get online peers only
   */
  getOnlinePeers(): Map<NodeId, PeerState> {
    const online = new Map<NodeId, PeerState>();
    for (const [id, peer] of this.peers) {
      if (peer.online) {
        online.set(id, peer);
      }
    }
    return online;
  }

  /**
   * Observable of peer updates
   */
  peersObservable(): Observable<Map<NodeId, PeerState>> {
    return this.peers$.asObservable();
  }

  /**
   * Observable of awareness updates (for broadcasting)
   */
  updatesObservable(): Observable<AwarenessUpdate> {
    return this.updates$.asObservable();
  }

  /**
   * Get all peer cursors
   */
  getCursors(): {
    nodeId: NodeId;
    cursor: { anchor: number; head: number };
    user?: { name?: string; color?: string };
  }[] {
    const cursors: {
      nodeId: NodeId;
      cursor: { anchor: number; head: number };
      user?: { name?: string; color?: string };
    }[] = [];

    for (const [nodeId, peer] of this.peers) {
      if (peer.online && peer.awareness?.cursor) {
        cursors.push({
          nodeId,
          cursor: peer.awareness.cursor,
          user: peer.awareness.user,
        });
      }
    }

    return cursors;
  }

  /**
   * Get all peer selections
   */
  getSelections(): {
    nodeId: NodeId;
    selection: { path: string[]; type: 'field' | 'element' | 'range' };
    user?: { name?: string; color?: string };
  }[] {
    const selections: {
      nodeId: NodeId;
      selection: { path: string[]; type: 'field' | 'element' | 'range' };
      user?: { name?: string; color?: string };
    }[] = [];

    for (const [id, peer] of this.peers) {
      if (peer.online && peer.awareness?.selection) {
        selections.push({
          nodeId: id,
          selection: peer.awareness.selection,
          user: peer.awareness.user,
        });
      }
    }

    return selections;
  }

  /**
   * Start cleanup interval for offline peers
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let changed = false;

      for (const peer of this.peers.values()) {
        if (peer.online && now - peer.lastSeen > this.peerTimeout) {
          peer.online = false;
          changed = true;
        }
      }

      if (changed) {
        this.peers$.next(new Map(this.peers));
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.updates$.complete();
    this.peers$.complete();
  }
}

/**
 * Create an awareness manager
 */
export function createAwarenessManager(nodeId: NodeId): AwarenessManager {
  return new AwarenessManager(nodeId);
}
