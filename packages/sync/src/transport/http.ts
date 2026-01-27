import { ConnectionError } from '@pocket/core';
import type { SyncProtocolMessage, SyncTransport, TransportConfig } from './types.js';

/**
 * HTTP-based transport implementation for sync operations.
 *
 * A fallback transport for environments that don't support WebSocket
 * (some edge runtimes, restricted networks, etc.). Uses standard HTTP
 * POST requests for each sync operation.
 *
 * ## Limitations
 *
 * Unlike {@link WebSocketTransport}, HTTP transport:
 * - **No server push**: Cannot receive server-initiated messages
 * - **Higher latency**: Each operation requires a new HTTP request
 * - **No auto-reconnect**: Connection state is per-request
 *
 * ## When to Use
 *
 * - Edge runtimes without WebSocket support (Cloudflare Workers, etc.)
 * - Corporate networks blocking WebSocket connections
 * - Simple sync scenarios without real-time requirements
 *
 * ## API Endpoints
 *
 * The transport expects these server endpoints:
 * - `GET /health` - Health check for connection verification
 * - `POST /sync/push` - Push local changes to server
 * - `POST /sync/pull` - Pull server changes
 * - `POST /sync` - Generic sync endpoint
 *
 * @example
 * ```typescript
 * const transport = createHttpTransport({
 *   serverUrl: 'https://api.example.com',
 *   authToken: 'user-token',
 *   timeout: 30000,
 * });
 *
 * await transport.connect(); // Performs health check
 *
 * const response = await transport.send<PushResponseMessage>({
 *   type: 'push',
 *   id: generateMessageId(),
 *   changes: myChanges,
 * });
 * ```
 *
 * @see {@link createHttpTransport} - Factory function
 * @see {@link WebSocketTransport} - Preferred transport with real-time support
 */
export class HttpTransport implements SyncTransport {
  private readonly config: Required<TransportConfig>;
  private disconnectHandler: (() => void) | null = null;

  private connected = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

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
    // Verify server is reachable
    const healthUrl = new URL('/health', this.config.serverUrl);

    const response = await fetch(healthUrl.toString(), {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new ConnectionError('POCKET_C501', `Server health check failed: ${response.status}`, {
        transport: 'http',
        statusCode: response.status,
      });
    }

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async send<T extends SyncProtocolMessage>(message: SyncProtocolMessage): Promise<T> {
    if (!this.connected) {
      throw new ConnectionError('POCKET_C501', 'Not connected', {
        transport: 'http',
        operation: 'send',
      });
    }

    const endpoint = this.getEndpoint(message);
    const url = new URL(endpoint, this.config.serverUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new ConnectionError('POCKET_C500', `HTTP error: ${response.status}`, {
          transport: 'http',
          statusCode: response.status,
          url: url.toString(),
        });
      }

      const responseMessage = await response.json();
      return responseMessage as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new ConnectionError('POCKET_C504', 'Request timeout', {
          transport: 'http',
          timeout: this.config.timeout,
        });
      }

      // Handle connection errors
      if (
        error instanceof Error &&
        (error.message.includes('fetch') || error.message.includes('network'))
      ) {
        this.connected = false;
        this.disconnectHandler?.();
      }

      throw error;
    }
  }

  onMessage(_handler: (message: SyncProtocolMessage) => void): void {
    // HTTP transport doesn't support server-initiated messages
  }

  onError(_handler: (error: Error) => void): void {
    // Errors are thrown directly from send()
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  onReconnect(_handler: () => void): void {
    // HTTP transport doesn't support automatic reconnection
  }

  /**
   * Get the endpoint for a message type
   */
  private getEndpoint(message: SyncProtocolMessage): string {
    switch (message.type) {
      case 'push':
        return '/sync/push';
      case 'pull':
        return '/sync/pull';
      default:
        return '/sync';
    }
  }

  /**
   * Get request headers
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.authToken) {
      headers.Authorization = `Bearer ${this.config.authToken}`;
    }

    return headers;
  }
}

/**
 * Creates an HTTP transport for sync operations.
 *
 * Use this as a fallback when WebSocket is not available.
 * For most applications, prefer {@link createWebSocketTransport}.
 *
 * @param config - Transport configuration including server URL and auth
 * @returns A configured HttpTransport instance
 *
 * @example
 * ```typescript
 * // For edge runtime without WebSocket support
 * const transport = createHttpTransport({
 *   serverUrl: 'https://api.example.com',
 *   authToken: getAuthToken(),
 * });
 *
 * const syncEngine = new SyncEngine(db, { transport });
 * ```
 */
export function createHttpTransport(config: TransportConfig): HttpTransport {
  return new HttpTransport(config);
}
