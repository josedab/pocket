import type { SyncProtocolMessage, SyncTransport, TransportConfig } from './types.js';

/**
 * WebSocket transport implementation
 */
export class WebSocketTransport implements SyncTransport {
  private readonly config: Required<TransportConfig>;
  private socket: WebSocket | null = null;
  private messageHandler: ((message: SyncProtocolMessage) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private disconnectHandler: (() => void) | null = null;
  private reconnectHandler: (() => void) | null = null;

  private pendingRequests = new Map<
    string,
    {
      resolve: (message: SyncProtocolMessage) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  private reconnectAttempts = 0;
  private isReconnecting = false;

  constructor(config: TransportConfig) {
    this.config = {
      serverUrl: config.serverUrl,
      authToken: config.authToken ?? '',
      timeout: config.timeout ?? 30000,
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelay: config.reconnectDelay ?? 1000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.config.serverUrl);

      // Add auth token as query param if provided
      if (this.config.authToken) {
        url.searchParams.set('token', this.config.authToken);
      }

      this.socket = new WebSocket(url.toString());

      this.socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        resolve();
      };

      this.socket.onclose = () => {
        this.handleDisconnect();
      };

      this.socket.onerror = (_event) => {
        const error = new Error('WebSocket error');
        if (this.socket?.readyState !== WebSocket.OPEN) {
          reject(error);
        }
        this.errorHandler?.(error);
      };

      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as SyncProtocolMessage;
          this.handleMessage(message);
        } catch (error) {
          this.errorHandler?.(error instanceof Error ? error : new Error(String(error)));
        }
      };
    });
  }

  async disconnect(): Promise<void> {
    this.config.autoReconnect = false; // Prevent auto-reconnect

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async send<T extends SyncProtocolMessage>(message: SyncProtocolMessage): Promise<T> {
    if (!this.isConnected()) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      // Set up request tracking
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error('Request timeout'));
      }, this.config.timeout);

      this.pendingRequests.set(message.id, {
        resolve: resolve as (msg: SyncProtocolMessage) => void,
        reject,
        timeout,
      });

      // Send the message
      this.socket!.send(JSON.stringify(message));
    });
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

  private handleMessage(message: SyncProtocolMessage): void {
    // Check if this is a response to a pending request
    const requestId = this.getRequestId(message);
    if (requestId) {
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);
        pending.resolve(message);
        return;
      }
    }

    // Otherwise, pass to general message handler
    this.messageHandler?.(message);
  }

  private getRequestId(message: SyncProtocolMessage): string | null {
    // Response messages should reference the original request ID
    if (
      message.type === 'push-response' ||
      message.type === 'pull-response' ||
      message.type === 'ack' ||
      message.type === 'error'
    ) {
      // The id field in response should match the request id
      return message.id;
    }
    return null;
  }

  private handleDisconnect(): void {
    this.socket = null;
    this.disconnectHandler?.();

    // Attempt reconnection if enabled
    if (
      this.config.autoReconnect &&
      !this.isReconnecting &&
      this.reconnectAttempts < this.config.maxReconnectAttempts
    ) {
      this.attemptReconnect();
    }
  }

  private attemptReconnect(): void {
    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(
      () => {
        this.connect()
          .then(() => {
            this.reconnectHandler?.();
          })
          .catch(() => {
            if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
              this.attemptReconnect();
            } else {
              this.isReconnecting = false;
              this.errorHandler?.(new Error('Max reconnection attempts reached'));
            }
          });
      },
      Math.min(delay, 30000)
    );
  }
}

/**
 * Create a WebSocket transport
 */
export function createWebSocketTransport(config: TransportConfig): WebSocketTransport {
  return new WebSocketTransport(config);
}
