/**
 * WebSocket-based transport for production real-time collaboration.
 *
 * Provides auto-reconnection with exponential backoff, message queuing
 * during disconnection, and heartbeat-based connection health monitoring.
 */

import { BehaviorSubject, type Observable } from 'rxjs';
import type { CollabMessage, CollabTransport } from './types.js';

export type WebSocketConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface WebSocketTransportConfig {
  /** WebSocket server URL (e.g. wss://example.com/collab) */
  url: string;
  /** Session identifier sent with each message */
  sessionId: string;
  /** Base reconnect interval in ms (default: 1000) */
  reconnectIntervalMs?: number;
  /** Maximum reconnect attempts before giving up (default: 10) */
  maxReconnectAttempts?: number;
  /** Heartbeat ping interval in ms (default: 5000) */
  heartbeatIntervalMs?: number;
  /** Maximum queued messages while disconnected (default: 1000) */
  messageQueueMaxSize?: number;
  /** WebSocket sub-protocols */
  protocols?: string[];
}

/**
 * WebSocketTransport — production-grade transport backed by WebSocket.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Message queuing while disconnected (replayed on reconnect)
 * - Heartbeat / ping-pong for connection health
 * - Graceful degradation when WebSocket is not available
 */
export class WebSocketTransport implements CollabTransport {
  private readonly config: Required<Omit<WebSocketTransportConfig, 'protocols'>> & { protocols?: string[] };
  private readonly handlers: ((message: CollabMessage) => void)[] = [];
  private readonly messageQueue: CollabMessage[] = [];
  private readonly connectionStateSubject: BehaviorSubject<WebSocketConnectionState>;

  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalDisconnect = false;

  constructor(config: WebSocketTransportConfig) {
    this.config = {
      url: config.url,
      sessionId: config.sessionId,
      reconnectIntervalMs: config.reconnectIntervalMs ?? 1000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 5000,
      messageQueueMaxSize: config.messageQueueMaxSize ?? 1000,
      protocols: config.protocols,
    };
    this.connectionStateSubject = new BehaviorSubject<WebSocketConnectionState>('disconnected');
  }

  // ── Observables ──────────────────────────────────────────

  /** Reactive stream of connection state changes. */
  get connectionState$(): Observable<WebSocketConnectionState> {
    return this.connectionStateSubject.asObservable();
  }

  /** Current connection state snapshot. */
  get connectionState(): WebSocketConnectionState {
    return this.connectionStateSubject.getValue();
  }

  // ── CollabTransport implementation ───────────────────────

  send(message: CollabMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.enqueueMessage(message);
    }
  }

  onMessage(handler: (message: CollabMessage) => void): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx !== -1) this.handlers.splice(idx, 1);
    };
  }

  async connect(): Promise<void> {
    if (typeof WebSocket === 'undefined') {
      throw new Error('WebSocket is not available in this environment');
    }
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;

    return this.createConnection();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    this.clearHeartbeat();

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.close();
      this.ws = null;
    }

    this.connectionStateSubject.next('disconnected');
  }

  // ── Private ──────────────────────────────────────────────

  private createConnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connectionStateSubject.next(
        this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting',
      );

      try {
        this.ws = this.config.protocols
          ? new WebSocket(this.config.url, this.config.protocols)
          : new WebSocket(this.config.url);
      } catch {
        this.connectionStateSubject.next('disconnected');
        reject(new Error(`Failed to create WebSocket connection to ${this.config.url}`));
        return;
      }

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.connectionStateSubject.next('connected');
        this.flushMessageQueue();
        this.startHeartbeat();
        resolve();
      };

      this.ws.onclose = () => {
        this.clearHeartbeat();
        this.connectionStateSubject.next('disconnected');

        if (!this.intentionalDisconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        if (this.connectionState === 'connecting' && this.reconnectAttempts === 0) {
          reject(new Error(`WebSocket connection error for ${this.config.url}`));
        }
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleRawMessage(event.data as string);
      };
    });
  }

  private handleRawMessage(data: string): void {
    try {
      const message = JSON.parse(data) as CollabMessage;
      // Ignore heartbeat acks from server
      if (message.type === 'heartbeat') return;

      for (const handler of this.handlers) {
        handler(message);
      }
    } catch {
      // Silently ignore malformed messages
    }
  }

  private enqueueMessage(message: CollabMessage): void {
    if (this.messageQueue.length >= this.config.messageQueueMaxSize) {
      this.messageQueue.shift();
    }
    this.messageQueue.push(message);
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      this.send(message);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.connectionStateSubject.next('disconnected');
      return;
    }

    this.reconnectAttempts++;
    this.connectionStateSubject.next('reconnecting');

    // Exponential backoff: baseInterval * 2^(attempt-1), capped at 30s
    const delay = Math.min(
      this.config.reconnectIntervalMs * Math.pow(2, this.reconnectAttempts - 1),
      30_000,
    );

    this.reconnectTimer = setTimeout(() => {
      this.createConnection().catch(() => {
        // Reconnection failure is handled by the onclose/onerror handlers
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'heartbeat',
          sessionId: this.config.sessionId,
          userId: '',
          payload: null,
          timestamp: Date.now(),
        }));
      }
    }, this.config.heartbeatIntervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/**
 * Create a new WebSocketTransport.
 */
export function createWebSocketTransport(config: WebSocketTransportConfig): WebSocketTransport {
  return new WebSocketTransport(config);
}
