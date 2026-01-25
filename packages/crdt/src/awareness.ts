import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import type { AwarenessState, NodeId, PeerState } from './types.js';

/**
 * Message format for awareness updates between nodes.
 *
 * Used to broadcast local awareness changes to other nodes
 * and receive updates from remote nodes.
 */
export interface AwarenessUpdate {
  /** Node that generated this update */
  nodeId: NodeId;
  /** The awareness state (null means disconnecting) */
  state: AwarenessState | null;
  /** Unix timestamp of the update */
  timestamp: number;
}

/**
 * Awareness Manager for collaborative presence tracking.
 *
 * Manages real-time presence information for collaborative editing,
 * including cursor positions, selections, and user status. This is
 * separate from document state and uses ephemeral, eventually-consistent
 * updates.
 *
 * Key features:
 * - Track cursor positions for all connected users
 * - Show user selections in real-time
 * - Display user names and colors
 * - Automatic offline detection via timeout
 *
 * @example Basic usage
 * ```typescript
 * const awareness = createAwarenessManager('user-123');
 *
 * // Set user info
 * awareness.setUser({ name: 'Alice', color: '#ff0000' });
 *
 * // Update cursor position
 * awareness.setCursor(42, 42);
 *
 * // Subscribe to updates for broadcasting
 * awareness.updatesObservable().subscribe(update => {
 *   socket.emit('awareness', update);
 * });
 * ```
 *
 * @example Receiving remote updates
 * ```typescript
 * socket.on('awareness', (update: AwarenessUpdate) => {
 *   awareness.applyRemoteUpdate(update);
 * });
 *
 * // Get all peer cursors for rendering
 * const cursors = awareness.getCursors();
 * cursors.forEach(({ nodeId, cursor, user }) => {
 *   renderCursor(cursor, user?.color ?? '#000');
 * });
 * ```
 *
 * @see {@link createAwarenessManager} - Factory function
 * @see {@link AwarenessState} - State structure
 */
export class AwarenessManager {
  private readonly nodeId: NodeId;
  private readonly peers: Map<NodeId, PeerState>;
  private localState: AwarenessState | null = null;

  private readonly peers$ = new BehaviorSubject<Map<NodeId, PeerState>>(new Map());
  private readonly updates$ = new Subject<AwarenessUpdate>();

  /** Timeout for considering a peer offline (30 seconds) */
  private readonly peerTimeout = 30000;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a new AwarenessManager.
   *
   * @param nodeId - Unique identifier for this node/user
   */
  constructor(nodeId: NodeId) {
    this.nodeId = nodeId;
    this.peers = new Map();
    this.startCleanup();
  }

  /**
   * Set local awareness state.
   *
   * Merges the provided state with existing state and emits
   * an update for broadcasting.
   *
   * @param state - Partial state to merge with existing
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
   * Get the current local awareness state.
   *
   * @returns Local state, or null if not set
   */
  getLocalState(): AwarenessState | null {
    return this.localState;
  }

  /**
   * Clear local awareness state and notify peers.
   *
   * Emits a null state update to signal disconnection.
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
   * Set the local cursor position.
   *
   * @param anchor - Selection anchor position
   * @param head - Selection head position (same as anchor for no selection)
   *
   * @example
   * ```typescript
   * // Cursor at position 42
   * awareness.setCursor(42, 42);
   *
   * // Selection from 10 to 20
   * awareness.setCursor(10, 20);
   * ```
   */
  setCursor(anchor: number, head: number): void {
    this.setLocalState({
      cursor: { anchor, head },
    });
  }

  /**
   * Set the local selection for structured data.
   *
   * @param path - JSON path to the selected element
   * @param type - Type of selection
   *
   * @example
   * ```typescript
   * // Select a specific field
   * awareness.setSelection(['user', 'name'], 'field');
   *
   * // Select an array element
   * awareness.setSelection(['items', '2'], 'element');
   * ```
   */
  setSelection(path: string[], type: 'field' | 'element' | 'range'): void {
    this.setLocalState({
      selection: { path, type },
    });
  }

  /**
   * Set user display information.
   *
   * @param user - User info (name, color, avatar)
   *
   * @example
   * ```typescript
   * awareness.setUser({
   *   name: 'Alice',
   *   color: '#ff0000',
   *   avatar: 'https://example.com/avatar.png',
   * });
   * ```
   */
  setUser(user: { name?: string; color?: string; avatar?: string }): void {
    this.setLocalState({
      user,
    });
  }

  /**
   * Apply an awareness update from a remote node.
   *
   * @param update - The remote awareness update
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
   * Get all known peer states.
   *
   * @returns Map of node IDs to their peer state
   */
  getPeers(): Map<NodeId, PeerState> {
    return new Map(this.peers);
  }

  /**
   * Get a specific peer's state.
   *
   * @param nodeId - The peer's node ID
   * @returns Peer state, or undefined if not found
   */
  getPeer(nodeId: NodeId): PeerState | undefined {
    return this.peers.get(nodeId);
  }

  /**
   * Get only currently online peers.
   *
   * @returns Map of online peers
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
   * Observable of peer state changes.
   *
   * Emits whenever peers join, leave, or update their state.
   *
   * @returns Observable of all peer states
   */
  peersObservable(): Observable<Map<NodeId, PeerState>> {
    return this.peers$.asObservable();
  }

  /**
   * Observable of local awareness updates for broadcasting.
   *
   * Subscribe to this to send awareness updates to other nodes.
   *
   * @returns Observable of awareness updates to broadcast
   *
   * @example
   * ```typescript
   * awareness.updatesObservable().subscribe(update => {
   *   socket.emit('awareness', update);
   * });
   * ```
   */
  updatesObservable(): Observable<AwarenessUpdate> {
    return this.updates$.asObservable();
  }

  /**
   * Get all peer cursor positions for rendering.
   *
   * @returns Array of cursor info including position and user details
   *
   * @example
   * ```typescript
   * const cursors = awareness.getCursors();
   * cursors.forEach(({ cursor, user }) => {
   *   drawCursor(cursor.anchor, user?.color ?? '#888');
   * });
   * ```
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
   * Get all peer selections for structured data.
   *
   * @returns Array of selection info including path and user details
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
   * Start the cleanup interval for marking peers as offline.
   * @internal
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
   * Clean up resources.
   *
   * Stops the cleanup interval and completes observables.
   * Call this when the awareness manager is no longer needed.
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
 * Create a new Awareness Manager.
 *
 * @param nodeId - Unique identifier for this node/user
 * @returns A new AwarenessManager instance
 *
 * @example
 * ```typescript
 * const awareness = createAwarenessManager('user-session-123');
 *
 * awareness.setUser({ name: 'Bob', color: '#00ff00' });
 * awareness.setCursor(100, 100);
 *
 * // Clean up when done
 * awareness.dispose();
 * ```
 *
 * @see {@link AwarenessManager}
 */
export function createAwarenessManager(nodeId: NodeId): AwarenessManager {
  return new AwarenessManager(nodeId);
}
