/**
 * Realtime Adapter — bridges the {@link RealtimeEngine} into the sync
 * server's WebSocket transport layer.
 *
 * @module @pocket/sync-server
 */

import type { RealtimeEvent, SubscriptionMatch, Unsubscribable } from './realtime.js';
import { RealtimeEngine, createRealtimeEngine } from './realtime.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Represents a WebSocket connection for a realtime client.
 */
export interface RealtimeClientConnection {
  id: string;
  send: (data: unknown) => void;
  close: () => void;
}

/**
 * Configuration for the realtime adapter.
 */
export interface RealtimeAdapterConfig {
  engine?: RealtimeEngine;
  pingIntervalMs?: number;
  maxConnectionsPerClient?: number;
}

/**
 * Protocol messages exchanged over the WebSocket connection.
 */
export type RealtimeProtocolMessage =
  | { type: 'subscribe'; collection: string; filter?: Record<string, unknown>; requestId: string }
  | { type: 'unsubscribe'; subscriptionId: string; requestId: string }
  | { type: 'unsubscribe-all'; requestId: string }
  | { type: 'ack'; requestId: string; subscriptionId?: string }
  | { type: 'change'; subscriptionId: string; event: RealtimeEvent }
  | { type: 'error'; requestId?: string; message: string }
  | { type: 'ping' }
  | { type: 'pong' };

// ---------------------------------------------------------------------------
// RealtimeAdapter
// ---------------------------------------------------------------------------

/**
 * Bridges the {@link RealtimeEngine} and WebSocket connections.
 *
 * Parses incoming protocol messages, routes subscribe/unsubscribe calls to
 * the engine, and forwards matching change events to connected clients.
 */
export class RealtimeAdapter {
  private readonly engine: RealtimeEngine;
  private readonly connections = new Map<string, RealtimeClientConnection>();
  private readonly pingIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private readonly pingIntervalMs: number;
  private readonly matchesSub: Unsubscribable;

  private messagesProcessed = 0;

  constructor(config?: RealtimeAdapterConfig) {
    this.engine = config?.engine ?? createRealtimeEngine();
    this.pingIntervalMs = config?.pingIntervalMs ?? 30_000;

    // Subscribe to engine matches and route to clients
    this.matchesSub = this.engine.matches$.subscribe((match: SubscriptionMatch) => {
      this.sendToClient(match.clientId, {
        type: 'change',
        subscriptionId: match.subscriptionId,
        event: match.event,
      });
    });
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  /**
   * Register a new WebSocket connection for a client.
   */
  handleConnection(clientId: string, connection: RealtimeClientConnection): void {
    this.connections.set(clientId, connection);

    if (this.pingIntervalMs > 0) {
      const interval = setInterval(() => {
        this.sendToClient(clientId, { type: 'ping' });
      }, this.pingIntervalMs);
      this.pingIntervals.set(clientId, interval);
    }
  }

  /**
   * Clean up all resources for a disconnected client.
   */
  handleDisconnect(clientId: string): void {
    this.engine.unsubscribeClient(clientId);
    this.connections.delete(clientId);

    const interval = this.pingIntervals.get(clientId);
    if (interval) {
      clearInterval(interval);
      this.pingIntervals.delete(clientId);
    }
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  /**
   * Parse a raw JSON string and route the resulting protocol message.
   */
  handleMessage(clientId: string, raw: string): void {
    this.messagesProcessed++;

    let msg: RealtimeProtocolMessage;
    try {
      msg = JSON.parse(raw) as RealtimeProtocolMessage;
    } catch {
      this.sendToClient(clientId, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    if (!msg || typeof msg !== 'object' || !('type' in msg)) {
      this.sendToClient(clientId, { type: 'error', message: 'Missing message type' });
      return;
    }

    switch (msg.type) {
      case 'subscribe':
        this.handleSubscribe(clientId, msg);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(clientId, msg);
        break;
      case 'unsubscribe-all':
        this.handleUnsubscribeAll(clientId, msg);
        break;
      case 'pong':
        // Client responded to ping — nothing else to do
        break;
      default:
        this.sendToClient(clientId, {
          type: 'error',
          requestId: (msg as { requestId?: string }).requestId,
          message: `Unknown message type: ${(msg as { type: string }).type}`,
        });
    }
  }

  // -----------------------------------------------------------------------
  // Broadcasting
  // -----------------------------------------------------------------------

  /**
   * Process a database change event through the engine. Matching
   * subscriptions will be notified via the matches$ observable.
   */
  broadcastChange(event: RealtimeEvent): void {
    this.engine.processChange(event);
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /** Return the list of currently connected client IDs. */
  getConnectedClients(): string[] {
    return Array.from(this.connections.keys());
  }

  /** Aggregate adapter statistics. */
  getStats(): { connectedClients: number; totalSubscriptions: number; messagesProcessed: number } {
    const engineStats = this.engine.getStats();
    return {
      connectedClients: this.connections.size,
      totalSubscriptions: engineStats.totalSubscriptions,
      messagesProcessed: this.messagesProcessed,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Dispose of the adapter and its underlying engine. */
  dispose(): void {
    for (const interval of this.pingIntervals.values()) {
      clearInterval(interval);
    }
    this.pingIntervals.clear();
    this.matchesSub.unsubscribe();
    this.connections.clear();
    this.engine.dispose();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private handleSubscribe(
    clientId: string,
    msg: { type: 'subscribe'; collection: string; filter?: Record<string, unknown>; requestId: string },
  ): void {
    try {
      const sub = this.engine.subscribe(clientId, msg.collection, msg.filter);
      this.sendToClient(clientId, { type: 'ack', requestId: msg.requestId, subscriptionId: sub.id });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Subscribe failed';
      this.sendToClient(clientId, { type: 'error', requestId: msg.requestId, message });
    }
  }

  private handleUnsubscribe(
    clientId: string,
    msg: { type: 'unsubscribe'; subscriptionId: string; requestId: string },
  ): void {
    this.engine.unsubscribe(msg.subscriptionId);
    this.sendToClient(clientId, { type: 'ack', requestId: msg.requestId });
  }

  private handleUnsubscribeAll(clientId: string, msg: { type: 'unsubscribe-all'; requestId: string }): void {
    this.engine.unsubscribeClient(clientId);
    this.sendToClient(clientId, { type: 'ack', requestId: msg.requestId });
  }

  private sendToClient(clientId: string, message: RealtimeProtocolMessage): void {
    const conn = this.connections.get(clientId);
    if (conn) {
      conn.send(message);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a realtime adapter.
 *
 * @example
 * ```typescript
 * import { createRealtimeAdapter } from '@pocket/sync-server';
 *
 * const adapter = createRealtimeAdapter();
 * ```
 */
export function createRealtimeAdapter(config?: RealtimeAdapterConfig): RealtimeAdapter {
  return new RealtimeAdapter(config);
}
