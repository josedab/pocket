/**
 * SubscriptionClient - client-side subscription management
 *
 * Manages active subscriptions to the server, maintains local result
 * caches, applies incoming deltas incrementally, and provides Observable
 * interfaces for consuming subscription results reactively.
 *
 * On reconnection, all active subscriptions are automatically re-established.
 */

import { BehaviorSubject, Subject } from 'rxjs';
import type { ClientSubscription, SubscriptionDelta, SubscriptionMessage, SubscriptionQuery } from '../types.js';

/**
 * Transport abstraction for the subscription client.
 * Allows the client to work with any WebSocket-like connection.
 */
export interface SubscriptionTransport {
  /** Send a message to the server */
  send(message: SubscriptionMessage): void;
  /** Register a handler for incoming messages */
  onMessage(handler: (message: SubscriptionMessage) => void): void;
  /** Register a handler for connection events */
  onConnect(handler: () => void): void;
  /** Register a handler for disconnection events */
  onDisconnect(handler: () => void): void;
  /** Whether the transport is currently connected */
  isConnected(): boolean;
}

/**
 * Generate a unique subscription ID on the client side
 */
function generateClientSubscriptionId(): string {
  return `csub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Internal state for a client-side subscription
 */
interface InternalSubscription<T = unknown> {
  id: string;
  query: SubscriptionQuery;
  results$: BehaviorSubject<T[]>;
  delta$: Subject<SubscriptionDelta<T>>;
  cache: Map<string, T>;
  active: boolean;
}

/**
 * SubscriptionClient manages subscriptions from the client side.
 *
 * It:
 * - Sends subscribe/unsubscribe messages to the server
 * - Maintains a local result cache per subscription
 * - Applies incoming deltas incrementally to the cache
 * - Emits updated result sets through Observables
 * - Automatically re-subscribes on reconnection
 */
export class SubscriptionClient {
  /** Active subscriptions indexed by subscription ID */
  private readonly subscriptions = new Map<string, InternalSubscription>();
  /** Transport for communication with the server */
  private transport: SubscriptionTransport | null = null;
  /** Whether the client has been destroyed */
  private destroyed = false;

  /**
   * Connect to a subscription server using the provided transport.
   *
   * @param transport - The transport to use for communication
   */
  connect(transport: SubscriptionTransport): void {
    this.transport = transport;

    // Listen for incoming messages
    transport.onMessage((message) => {
      this.handleMessage(message);
    });

    // Re-subscribe on reconnection
    transport.onConnect(() => {
      this.resubscribeAll();
    });
  }

  /**
   * Subscribe to a query on the server.
   *
   * Returns a ClientSubscription handle with:
   * - `results$`: Observable emitting the full result set after each delta
   * - `delta$`: Observable emitting raw delta messages
   * - `unsubscribe()`: Cleanup function
   *
   * @param query - The subscription query
   * @returns A ClientSubscription handle
   */
  subscribe<T = unknown>(query: SubscriptionQuery): ClientSubscription<T> {
    const id = query.id || generateClientSubscriptionId();
    const fullQuery: SubscriptionQuery = { ...query, id };

    const internal: InternalSubscription<T> = {
      id,
      query: fullQuery,
      results$: new BehaviorSubject<T[]>([]),
      delta$: new Subject<SubscriptionDelta<T>>(),
      cache: new Map<string, T>(),
      active: true,
    };

    this.subscriptions.set(id, internal as InternalSubscription);

    // Send subscribe message to server
    this.sendMessage({
      type: 'subscribe',
      query: fullQuery,
    });

    const subscription: ClientSubscription<T> = {
      id,
      query: fullQuery,
      results$: internal.results$.asObservable(),
      delta$: internal.delta$.asObservable(),
      unsubscribe: () => {
        this.unsubscribe(id);
      },
    };

    return subscription;
  }

  /**
   * Unsubscribe from a subscription.
   *
   * Sends an unsubscribe message to the server, completes the Observables,
   * and cleans up local state.
   *
   * @param subscriptionId - The subscription to cancel
   */
  unsubscribe(subscriptionId: string): void {
    const internal = this.subscriptions.get(subscriptionId);
    if (!internal) return;

    internal.active = false;

    // Send unsubscribe to server
    this.sendMessage({
      type: 'unsubscribe',
      subscriptionId,
    });

    // Complete observables
    internal.results$.complete();
    internal.delta$.complete();

    // Clean up
    internal.cache.clear();
    this.subscriptions.delete(subscriptionId);
  }

  /**
   * Unsubscribe from all active subscriptions.
   */
  unsubscribeAll(): void {
    const ids = [...this.subscriptions.keys()];
    for (const id of ids) {
      this.unsubscribe(id);
    }
  }

  /**
   * Get the number of active subscriptions.
   */
  getActiveCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get the current cached results for a subscription.
   *
   * @param subscriptionId - The subscription ID
   * @returns The current results, or undefined if not found
   */
  getResults<T = unknown>(subscriptionId: string): T[] | undefined {
    const internal = this.subscriptions.get(subscriptionId);
    if (!internal) return undefined;
    return Array.from(internal.cache.values()) as T[];
  }

  /**
   * Destroy the client, cleaning up all subscriptions and resources.
   */
  destroy(): void {
    this.destroyed = true;
    this.unsubscribeAll();
    this.transport = null;
  }

  /**
   * Handle an incoming message from the server.
   */
  private handleMessage(message: SubscriptionMessage): void {
    if (this.destroyed) return;

    switch (message.type) {
      case 'delta':
        this.handleDelta(message.delta);
        break;

      case 'initial':
        this.handleInitial(message.subscriptionId, message.results, message.sequence);
        break;

      case 'error':
        this.handleError(message.subscriptionId, message.error);
        break;

      case 'ack':
        // Acknowledgment received - no action needed for basic implementation
        break;

      default:
        break;
    }
  }

  /**
   * Handle a delta message: apply changes to local cache and emit.
   */
  private handleDelta(delta: SubscriptionDelta): void {
    const internal = this.subscriptions.get(delta.subscriptionId);
    if (!internal?.active) return;

    // Apply added documents
    for (const doc of delta.added) {
      const docWithId = doc as { _id: string };
      if (docWithId._id) {
        internal.cache.set(docWithId._id, doc);
      }
    }

    // Apply removed documents
    for (const removedId of delta.removed) {
      internal.cache.delete(removedId);
    }

    // Apply modified documents
    for (const doc of delta.modified) {
      const docWithId = doc as { _id: string };
      if (docWithId._id) {
        internal.cache.set(docWithId._id, doc);
      }
    }

    // Emit the delta
    internal.delta$.next(delta as SubscriptionDelta<never>);

    // Emit the updated full result set
    const results = Array.from(internal.cache.values());
    internal.results$.next(results);
  }

  /**
   * Handle an initial result set message.
   */
  private handleInitial(subscriptionId: string, results: unknown[], _sequence: number): void {
    const internal = this.subscriptions.get(subscriptionId);
    if (!internal?.active) return;

    // Replace the cache entirely with initial results
    internal.cache.clear();
    for (const doc of results) {
      const docWithId = doc as { _id: string };
      if (docWithId._id) {
        internal.cache.set(docWithId._id, doc);
      }
    }

    // Emit the initial delta
    internal.delta$.next({
      subscriptionId,
      type: 'initial',
      added: results,
      removed: [],
      modified: [],
      sequence: _sequence,
      timestamp: Date.now(),
    } as unknown as SubscriptionDelta<never>);

    // Emit the full result set
    internal.results$.next(Array.from(internal.cache.values()));
  }

  /**
   * Handle an error message for a subscription.
   */
  private handleError(subscriptionId: string, error: string): void {
    const internal = this.subscriptions.get(subscriptionId);
    if (!internal) return;

    // Emit error through the delta subject
    internal.delta$.error(new Error(error));
  }

  /**
   * Re-subscribe all active subscriptions (called on reconnection).
   */
  private resubscribeAll(): void {
    for (const internal of this.subscriptions.values()) {
      if (internal.active) {
        this.sendMessage({
          type: 'subscribe',
          query: internal.query,
        });
      }
    }
  }

  /**
   * Send a message through the transport.
   */
  private sendMessage(message: SubscriptionMessage): void {
    if (this.transport?.isConnected()) {
      this.transport.send(message);
    }
  }
}

/**
 * Create a new SubscriptionClient.
 *
 * @returns A new SubscriptionClient instance
 */
export function createSubscriptionClient(): SubscriptionClient {
  return new SubscriptionClient();
}
