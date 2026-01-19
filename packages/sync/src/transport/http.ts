import type { SyncProtocolMessage, SyncTransport, TransportConfig } from './types.js';

/**
 * HTTP transport implementation (fallback for environments without WebSocket)
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
      throw new Error(`Server health check failed: ${response.status}`);
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
      throw new Error('Not connected');
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
        throw new Error(`HTTP error: ${response.status}`);
      }

      const responseMessage = await response.json();
      return responseMessage as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
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
 * Create an HTTP transport
 */
export function createHttpTransport(config: TransportConfig): HttpTransport {
  return new HttpTransport(config);
}
