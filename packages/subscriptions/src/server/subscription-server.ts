/**
 * SubscriptionServer - integrates subscriptions with WebSocket infrastructure
 *
 * Handles subscription protocol messages from clients, routes document changes
 * to affected subscriptions, batches deltas within a configurable window,
 * and delivers coalesced delta messages over WebSocket.
 */

import type { ChangeEvent, Document } from '@pocket/core';
import type {
  SubscriptionDelta,
  SubscriptionManagerConfig,
  SubscriptionMessage,
  SubscriptionStats,
} from '../types.js';
import { DeltaComputer } from './delta-computer.js';
import { SubscriptionRegistry } from './subscription-registry.js';

/**
 * Callback type for sending messages to a specific client
 */
export type SendToClient = (clientId: string, message: SubscriptionMessage) => void;

/**
 * Pending delta awaiting batch window expiry
 */
interface PendingDelta {
  subscriptionId: string;
  clientId: string;
  added: Document[];
  removed: string[];
  modified: Document[];
}

/**
 * SubscriptionServer processes subscription messages and routes
 * change events to affected subscriptions.
 *
 * It batches deltas within a configurable time window to reduce
 * message volume and network overhead.
 */
export class SubscriptionServer {
  private readonly registry: SubscriptionRegistry;
  private readonly deltaComputer: DeltaComputer;
  private readonly config: Required<SubscriptionManagerConfig>;
  private sendToClient: SendToClient | null = null;

  /** Pending deltas being batched, keyed by subscriptionId */
  private readonly pendingDeltas = new Map<string, PendingDelta>();
  /** Batch timer handles, keyed by subscriptionId */
  private readonly batchTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(config?: SubscriptionManagerConfig) {
    const defaultConfig: Required<SubscriptionManagerConfig> = {
      maxSubscriptionsPerClient: 50,
      batchIntervalMs: 50,
      maxBatchSize: 100,
    };
    this.config = { ...defaultConfig, ...config };
    this.registry = new SubscriptionRegistry(this.config);
    this.deltaComputer = new DeltaComputer();
  }

  /**
   * Set the callback used to send messages to clients.
   * This must be called before handling any messages.
   *
   * @param sender - Function that sends a message to a specific client
   */
  setSendToClient(sender: SendToClient): void {
    this.sendToClient = sender;
  }

  /**
   * Handle an incoming subscription protocol message from a client.
   *
   * @param clientId - The client that sent the message
   * @param message - The subscription message
   */
  handleMessage(clientId: string, message: SubscriptionMessage): void {
    switch (message.type) {
      case 'subscribe':
        this.handleSubscribe(clientId, message);
        break;

      case 'unsubscribe':
        this.handleUnsubscribe(message);
        break;

      default:
        // Other message types (delta, initial, error, ack) are server-to-client only
        break;
    }
  }

  /**
   * Process a document change event, routing it to all affected subscriptions.
   *
   * This is the main entry point for change propagation. When a document
   * changes in a collection, call this method to compute and deliver
   * deltas to all subscriptions watching that collection.
   *
   * @param collection - The collection where the change occurred
   * @param change - The change event
   */
  processChange(collection: string, change: ChangeEvent<Document>): void {
    const subscriptions = this.registry.getSubscriptionsForCollection(collection);

    for (const subscription of subscriptions) {
      const delta = this.deltaComputer.computeDelta(subscription, change);
      if (delta) {
        this.enqueueDelta(subscription.clientId, delta);
      }
    }
  }

  /**
   * Remove all subscriptions for a disconnected client.
   *
   * @param clientId - The client that disconnected
   */
  handleClientDisconnect(clientId: string): void {
    // Cancel any pending batch timers for this client's subscriptions
    const clientSubs = this.registry.getClientSubscriptions(clientId);
    for (const sub of clientSubs) {
      this.cancelBatchTimer(sub.id);
      this.pendingDeltas.delete(sub.id);
    }

    this.registry.unregisterClient(clientId);
  }

  /**
   * Get subscription statistics
   */
  getStats(): SubscriptionStats {
    return this.registry.getStats();
  }

  /**
   * Get the underlying registry (for testing or advanced use)
   */
  getRegistry(): SubscriptionRegistry {
    return this.registry;
  }

  /**
   * Shut down the server, cancelling all pending timers
   */
  shutdown(): void {
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();
    this.pendingDeltas.clear();
  }

  /**
   * Handle a subscribe message
   */
  private handleSubscribe(
    clientId: string,
    message: Extract<SubscriptionMessage, { type: 'subscribe' }>
  ): void {
    try {
      const state = this.registry.register(clientId, message.query);

      // Send ack
      this.send(clientId, {
        type: 'ack',
        subscriptionId: state.id,
      });
    } catch (error) {
      // Send error (e.g., subscription limit reached)
      this.send(clientId, {
        type: 'error',
        subscriptionId: message.query.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle an unsubscribe message
   */
  private handleUnsubscribe(
    message: Extract<SubscriptionMessage, { type: 'unsubscribe' }>
  ): void {
    const sub = this.registry.get(message.subscriptionId);
    if (sub) {
      this.cancelBatchTimer(message.subscriptionId);
      this.pendingDeltas.delete(message.subscriptionId);
    }
    this.registry.unregister(message.subscriptionId);
  }

  /**
   * Enqueue a delta for batching.
   *
   * If a delta is already pending for this subscription within the batch window,
   * the new delta is coalesced into the pending one. Otherwise, a new batch
   * window is started.
   */
  private enqueueDelta(clientId: string, delta: SubscriptionDelta): void {
    const subId = delta.subscriptionId;
    const existing = this.pendingDeltas.get(subId);

    if (existing) {
      // Coalesce into existing pending delta
      this.coalesceDelta(existing, delta);

      // Check if batch is full
      const totalSize =
        existing.added.length + existing.removed.length + existing.modified.length;
      if (totalSize >= this.config.maxBatchSize) {
        this.flushDelta(subId);
      }
    } else {
      // Start a new pending delta
      this.pendingDeltas.set(subId, {
        subscriptionId: subId,
        clientId,
        added: [...(delta.added as Document[])],
        removed: [...delta.removed],
        modified: [...(delta.modified as Document[])],
      });

      // Start batch timer
      if (this.config.batchIntervalMs > 0) {
        const timer = setTimeout(() => {
          this.flushDelta(subId);
        }, this.config.batchIntervalMs);
        this.batchTimers.set(subId, timer);
      } else {
        // No batching, flush immediately
        this.flushDelta(subId);
      }
    }
  }

  /**
   * Coalesce a new delta into an existing pending delta.
   *
   * - Added docs are appended (deduped against removed)
   * - Removed IDs are appended (deduped against added)
   * - Modified docs are appended or merged
   */
  private coalesceDelta(existing: PendingDelta, incoming: SubscriptionDelta): void {
    // Handle added documents
    for (const doc of incoming.added as Document[]) {
      const docId = (doc)._id;
      // If it was previously removed, remove from removed and add to modified
      const removedIdx = existing.removed.indexOf(docId);
      if (removedIdx >= 0) {
        existing.removed.splice(removedIdx, 1);
        existing.modified.push(doc);
      } else {
        existing.added.push(doc);
      }
    }

    // Handle removed documents
    for (const removedId of incoming.removed) {
      // If it was previously added, just remove from added
      const addedIdx = existing.added.findIndex((d) => d._id === removedId);
      if (addedIdx >= 0) {
        existing.added.splice(addedIdx, 1);
      } else {
        // Remove from modified if present
        const modIdx = existing.modified.findIndex((d) => d._id === removedId);
        if (modIdx >= 0) {
          existing.modified.splice(modIdx, 1);
        }
        existing.removed.push(removedId);
      }
    }

    // Handle modified documents
    for (const doc of incoming.modified as Document[]) {
      const docId = doc._id;
      // If already in modified, replace
      const modIdx = existing.modified.findIndex((d) => d._id === docId);
      if (modIdx >= 0) {
        existing.modified[modIdx] = doc;
      } else {
        // If in added, replace there
        const addedIdx = existing.added.findIndex((d) => d._id === docId);
        if (addedIdx >= 0) {
          existing.added[addedIdx] = doc;
        } else {
          existing.modified.push(doc);
        }
      }
    }
  }

  /**
   * Flush a pending delta: send it to the client and clean up
   */
  private flushDelta(subscriptionId: string): void {
    this.cancelBatchTimer(subscriptionId);

    const pending = this.pendingDeltas.get(subscriptionId);
    if (!pending) return;
    this.pendingDeltas.delete(subscriptionId);

    const totalSize = pending.added.length + pending.removed.length + pending.modified.length;
    if (totalSize === 0) return;

    const subscription = this.registry.get(subscriptionId);
    if (!subscription) return;

    const delta: SubscriptionDelta = {
      subscriptionId,
      type: 'delta',
      added: pending.added,
      removed: pending.removed,
      modified: pending.modified,
      sequence: subscription.sequence,
      timestamp: Date.now(),
    };

    this.send(pending.clientId, {
      type: 'delta',
      delta,
    });

    // Track stats
    this.registry.recordDeltaDelivered(totalSize, subscription.currentIds.size);
  }

  /**
   * Cancel a batch timer
   */
  private cancelBatchTimer(subscriptionId: string): void {
    const timer = this.batchTimers.get(subscriptionId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(subscriptionId);
    }
  }

  /**
   * Send a message to a client
   */
  private send(clientId: string, message: SubscriptionMessage): void {
    if (this.sendToClient) {
      this.sendToClient(clientId, message);
    }
  }
}

/**
 * Create a new SubscriptionServer
 */
export function createSubscriptionServer(config?: SubscriptionManagerConfig): SubscriptionServer {
  return new SubscriptionServer(config);
}
