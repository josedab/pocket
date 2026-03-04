/**
 * P2P communication layer using BroadcastChannel for same-device tabs
 * and WebRTC signaling for cross-device communication.
 */
import { Subject, type Observable } from 'rxjs';

export interface P2PMessage<T = unknown> {
  type: string;
  senderId: string;
  targetId?: string;
  payload: T;
  timestamp: number;
}

export interface P2PChannelConfig {
  nodeId: string;
  channelName?: string;
  enableBroadcastChannel?: boolean;
}

/**
 * P2P channel for query federation across tabs and devices.
 */
export class P2PChannel {
  private readonly nodeId: string;
  private readonly channelName: string;
  private broadcastChannel: BroadcastChannel | null = null;
  private readonly messages$ = new Subject<P2PMessage>();
  private readonly peers = new Set<string>();
  private readonly messageHandlers = new Map<string, (msg: P2PMessage) => void>();
  private destroyed = false;

  constructor(config: P2PChannelConfig) {
    this.nodeId = config.nodeId;
    this.channelName = config.channelName ?? 'pocket-p2p';

    if (config.enableBroadcastChannel !== false) {
      this.initBroadcastChannel();
    }
  }

  /** Get all received messages as observable */
  get messages(): Observable<P2PMessage> {
    return this.messages$.asObservable();
  }

  /** Get connected peer IDs */
  getPeers(): string[] {
    return Array.from(this.peers);
  }

  /** Send a message to a specific peer or broadcast */
  send<T>(type: string, payload: T, targetId?: string): void {
    if (this.destroyed) return;

    const message: P2PMessage<T> = {
      type,
      senderId: this.nodeId,
      targetId,
      payload,
      timestamp: Date.now(),
    };

    // Send via BroadcastChannel
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(message);
      } catch {
        // BroadcastChannel may not be available
      }
    }
  }

  /** Register a handler for a specific message type */
  onMessage(type: string, handler: (msg: P2PMessage) => void): () => void {
    this.messageHandlers.set(type, handler);
    return () => this.messageHandlers.delete(type);
  }

  /** Announce presence to discover peers */
  announce(): void {
    this.send('peer:announce', { nodeId: this.nodeId });
  }

  /** Disconnect and clean up */
  destroy(): void {
    this.destroyed = true;
    this.send('peer:leave', { nodeId: this.nodeId });

    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }

    this.messages$.complete();
    this.peers.clear();
    this.messageHandlers.clear();
  }

  private initBroadcastChannel(): void {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.broadcastChannel = new BroadcastChannel(this.channelName);
        this.broadcastChannel.onmessage = (event: MessageEvent) => {
          this.handleMessage(event.data);
        };
      }
    } catch {
      // BroadcastChannel not available (e.g., Node.js)
    }
  }

  private handleMessage(msg: P2PMessage): void {
    // Ignore own messages
    if (msg.senderId === this.nodeId) return;

    // Check if targeted to us
    if (msg.targetId && msg.targetId !== this.nodeId) return;

    // Track peers
    if (msg.type === 'peer:announce') {
      this.peers.add(msg.senderId);
      // Reply with our announcement
      this.send('peer:ack', { nodeId: this.nodeId }, msg.senderId);
    } else if (msg.type === 'peer:ack') {
      this.peers.add(msg.senderId);
    } else if (msg.type === 'peer:leave') {
      this.peers.delete(msg.senderId);
    }

    // Emit to observable
    this.messages$.next(msg);

    // Call registered handler
    const handler = this.messageHandlers.get(msg.type);
    handler?.(msg);
  }
}

export function createP2PChannel(config: P2PChannelConfig): P2PChannel {
  return new P2PChannel(config);
}
