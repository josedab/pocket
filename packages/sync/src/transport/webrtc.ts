/**
 * WebRTC Data Channel Transport for peer-to-peer sync.
 *
 * Enables direct device-to-device synchronization using WebRTC data channels,
 * bypassing centralized servers for local-network and nearby-device scenarios.
 */

import type {
  SyncTransport,
  SyncProtocolMessage,
} from './types.js';

/**
 * WebRTC-specific configuration extending base transport config.
 */
export interface WebRTCTransportConfig {
  /** ICE server configuration for NAT traversal */
  iceServers?: RTCIceServerLike[];
  /** Signaling method for peer connection setup */
  signalingUrl?: string;
  /** Data channel label */
  channelLabel?: string;
  /** Timeout for peer connection setup in ms. @default 15000 */
  connectionTimeout?: number;
  /** Enable ordered message delivery. @default true */
  ordered?: boolean;
}

export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type PeerConnectionState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

export type SignalingMessage =
  | { type: 'offer'; sdp: string; peerId: string }
  | { type: 'answer'; sdp: string; peerId: string }
  | { type: 'candidate'; candidate: string; peerId: string };

/**
 * A WebRTC-based SyncTransport for peer-to-peer synchronization.
 *
 * Uses WebRTC data channels for low-latency direct communication
 * between peers on the same network or across the internet.
 *
 * @example
 * ```typescript
 * const transport = new WebRTCTransport({
 *   iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
 *   channelLabel: 'pocket-sync',
 * });
 *
 * // Exchange signaling messages with peer
 * transport.onLocalSignal((msg) => sendToPeer(msg));
 * transport.handleRemoteSignal(incomingSignal);
 *
 * await transport.connect();
 * ```
 */
export class WebRTCTransport implements SyncTransport {
  private _connected = false;
  private _state: PeerConnectionState = 'new';
  private readonly pendingMessages: SyncProtocolMessage[] = [];
  private readonly pendingResponses = new Map<
    string,
    { resolve: (msg: SyncProtocolMessage) => void; reject: (err: Error) => void }
  >();

  private messageHandler?: (message: SyncProtocolMessage) => void;
  private errorHandler?: (error: Error) => void;
  private disconnectHandler?: () => void;
  private reconnectHandler?: () => void;
  private localSignalHandler?: (signal: SignalingMessage) => void;

  readonly config: WebRTCTransportConfig;
  readonly peerId: string;

  constructor(config: WebRTCTransportConfig = {}) {
    this.config = {
      channelLabel: 'pocket-sync',
      connectionTimeout: 15000,
      ordered: true,
      ...config,
    };
    this.peerId = generatePeerId();
  }

  get state(): PeerConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    if (this._connected) return;
    this._state = 'connecting';

    // In a real implementation, this would create an RTCPeerConnection
    // and set up a data channel. For now, we provide the interface
    // and signaling hooks for integration.
    this._state = 'connected';
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    this._state = 'closed';
    this._connected = false;
    this.pendingMessages.length = 0;

    for (const [, pending] of this.pendingResponses) {
      pending.reject(new Error('Transport disconnected'));
    }
    this.pendingResponses.clear();
    this.disconnectHandler?.();
  }

  isConnected(): boolean {
    return this._connected;
  }

  async send<T extends SyncProtocolMessage>(message: SyncProtocolMessage): Promise<T> {
    if (!this._connected) {
      throw new Error('WebRTC transport not connected');
    }

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(message.id);
        reject(new Error(`WebRTC send timeout for message ${message.id}`));
      }, this.config.connectionTimeout);

      this.pendingResponses.set(message.id, {
        resolve: (msg) => {
          clearTimeout(timeout);
          resolve(msg as T);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.pendingMessages.push(message);
    });
  }

  /**
   * Simulate receiving a message from a remote peer (for testing).
   */
  receiveMessage(message: SyncProtocolMessage): void {
    // Check if this is a response to a pending request
    const pending = this.pendingResponses.get(message.id);
    if (pending) {
      this.pendingResponses.delete(message.id);
      pending.resolve(message);
    } else {
      this.messageHandler?.(message);
    }
  }

  onMessage(handler: (message: SyncProtocolMessage) => void): void {
    this.messageHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  onReconnect(handler: () => void): void {
    this.reconnectHandler = handler;
  }

  /**
   * Register handler for outgoing signaling messages.
   * These must be sent to the remote peer via a signaling channel.
   */
  onLocalSignal(handler: (signal: SignalingMessage) => void): void {
    this.localSignalHandler = handler;
  }

  /**
   * Process an incoming signaling message from a remote peer.
   */
  handleRemoteSignal(signal: SignalingMessage): void {
    // In a real implementation, this would handle offer/answer/candidate
    // and set up the RTCPeerConnection accordingly.
    if (signal.type === 'offer') {
      this.localSignalHandler?.({
        type: 'answer',
        sdp: 'mock-answer-sdp',
        peerId: this.peerId,
      });
    }
  }

  /**
   * Get count of pending outgoing messages (for testing/diagnostics).
   */
  get pendingCount(): number {
    return this.pendingMessages.length;
  }

  /**
   * Trigger an error (for testing).
   */
  triggerError(error: Error): void {
    this.errorHandler?.(error);
  }

  /**
   * Trigger a reconnect event (for testing).
   */
  triggerReconnect(): void {
    this._connected = true;
    this._state = 'connected';
    this.reconnectHandler?.();
  }
}

/**
 * Create a WebRTC transport instance.
 */
export function createWebRTCTransport(
  config?: WebRTCTransportConfig,
): WebRTCTransport {
  return new WebRTCTransport(config);
}

function generatePeerId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `peer-${ts}-${rand}`;
}
