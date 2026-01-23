/**
 * WebSocket transport for remote presence
 */

import type { PresenceMessage, PresenceTransport } from '../types.js';

/**
 * WebSocket transport configuration
 */
export interface WebSocketTransportConfig {
  /** WebSocket server URL */
  url: string;
  /** Reconnect on disconnect */
  autoReconnect?: boolean;
  /** Max reconnection attempts */
  maxReconnectAttempts?: number;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
  /** Connection timeout in ms */
  connectionTimeout?: number;
  /** Authentication token */
  authToken?: string;
}

/**
 * Transport using WebSocket for remote presence communication
 */
export class WebSocketTransport implements PresenceTransport {
  private readonly config: Required<WebSocketTransportConfig>;
  private socket: WebSocket | null = null;
  private readonly subscriptions = new Map<string, Set<(message: PresenceMessage) => void>>();
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private connecting = false;
  private messageQueue: PresenceMessage[] = [];

  constructor(config: WebSocketTransportConfig) {
    this.config = {
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelay: 1000,
      connectionTimeout: 10000,
      authToken: '',
      ...config,
    };
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;

    this.connecting = true;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.connecting = false;
        reject(new Error('Connection timeout'));
      }, this.config.connectionTimeout);

      try {
        // Build URL with auth token if provided
        let url = this.config.url;
        if (this.config.authToken) {
          const separator = url.includes('?') ? '&' : '?';
          url = `${url}${separator}token=${encodeURIComponent(this.config.authToken)}`;
        }

        this.socket = new WebSocket(url);

        this.socket.onopen = () => {
          clearTimeout(timeoutId);
          this.connected = true;
          this.connecting = false;
          this.reconnectAttempts = 0;
          this.flushMessageQueue();
          resolve();
        };

        this.socket.onclose = (event) => {
          this.handleClose(event);
        };

        this.socket.onerror = (error) => {
          clearTimeout(timeoutId);
          if (this.connecting) {
            this.connecting = false;
            reject(error instanceof Error ? error : new Error('WebSocket connection failed'));
          }
        };

        this.socket.onmessage = (event) => {
          this.handleMessage(event);
        };
      } catch (error) {
        clearTimeout(timeoutId);
        this.connecting = false;
        reject(error instanceof Error ? error : new Error('WebSocket connection failed'));
      }
    });
  }

  async disconnect(): Promise<void> {
    this.clearReconnectTimeout();

    if (this.socket) {
      this.socket.onclose = null; // Prevent reconnect
      this.socket.close();
      this.socket = null;
    }

    this.connected = false;
    this.connecting = false;
    this.subscriptions.clear();
    this.messageQueue = [];
  }

  async send(message: PresenceMessage): Promise<void> {
    if (!this.connected || !this.socket) {
      // Queue message for later if auto-reconnect is enabled
      if (this.config.autoReconnect) {
        this.messageQueue.push(message);
        return;
      }
      throw new Error('Transport not connected');
    }

    this.socket.send(JSON.stringify(message));
  }

  subscribe(roomId: string, callback: (message: PresenceMessage) => void): () => void {
    if (!this.subscriptions.has(roomId)) {
      this.subscriptions.set(roomId, new Set());

      // Send subscription message to server
      if (this.connected) {
        void this.send({
          type: 'presence',
          userId: '',
          roomId,
          payload: { action: 'subscribe' },
          timestamp: Date.now(),
        });
      }
    }

    const callbacks = this.subscriptions.get(roomId)!;
    callbacks.add(callback);

    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.subscriptions.delete(roomId);

        // Send unsubscription message
        if (this.connected) {
          void this.send({
            type: 'presence',
            userId: '',
            roomId,
            payload: { action: 'unsubscribe' },
            timestamp: Date.now(),
          });
        }
      }
    };
  }

  isConnected(): boolean {
    return this.connected && this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data as string) as PresenceMessage;
      const callbacks = this.subscriptions.get(message.roomId);

      if (callbacks) {
        for (const callback of callbacks) {
          try {
            callback(message);
          } catch (error) {
            console.error('Error in presence message callback:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error parsing presence message:', error);
    }
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(event: CloseEvent): void {
    this.connected = false;

    // Attempt reconnection if enabled and not a clean close
    if (this.config.autoReconnect && !event.wasClean) {
      this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect to WebSocket server
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    this.reconnectTimeout = setTimeout(() => {
      void this.connect().catch((error: unknown) => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Clear reconnect timeout
   */
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    const queue = [...this.messageQueue];
    this.messageQueue = [];

    for (const message of queue) {
      void this.send(message);
    }

    // Re-subscribe to rooms
    for (const roomId of this.subscriptions.keys()) {
      void this.send({
        type: 'presence',
        userId: '',
        roomId,
        payload: { action: 'subscribe' },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get current connection state
   */
  getConnectionState(): 'connecting' | 'connected' | 'disconnected' | 'reconnecting' {
    if (this.connected) return 'connected';
    if (this.connecting) return 'connecting';
    if (this.reconnectTimeout) return 'reconnecting';
    return 'disconnected';
  }
}

/**
 * Create a WebSocket transport
 */
export function createWebSocketTransport(config: WebSocketTransportConfig): WebSocketTransport {
  return new WebSocketTransport(config);
}
