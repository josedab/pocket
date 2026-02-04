/**
 * SubscriptionRegistry - manages server-side subscription state
 *
 * Maintains a registry of all active subscriptions, indexed by collection
 * for efficient O(1) lookup when changes arrive. Tracks per-client
 * subscription limits and provides aggregate statistics.
 */

import type {
  ServerSubscriptionState,
  SubscriptionManagerConfig,
  SubscriptionQuery,
  SubscriptionStats,
} from '../types.js';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<SubscriptionManagerConfig> = {
  maxSubscriptionsPerClient: 50,
  batchIntervalMs: 50,
  maxBatchSize: 100,
};

/**
 * Generate a unique subscription ID
 */
function generateSubscriptionId(): string {
  return `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * SubscriptionRegistry manages all active subscriptions on the server.
 *
 * Subscriptions are indexed by collection name for O(1) lookup when
 * changes arrive, and by client ID for efficient cleanup on disconnect.
 */
export class SubscriptionRegistry {
  /** All subscriptions indexed by subscription ID */
  private readonly subscriptions = new Map<string, ServerSubscriptionState>();
  /** Subscriptions indexed by collection for fast change routing */
  private readonly byCollection = new Map<string, Set<string>>();
  /** Subscriptions indexed by client ID for fast cleanup */
  private readonly byClient = new Map<string, Set<string>>();
  /** Configuration */
  private readonly config: Required<SubscriptionManagerConfig>;
  /** Stats tracking */
  private deltasDelivered = 0;
  private totalDeltaSize = 0;
  private bandwidthSavedBytes = 0;

  constructor(config?: SubscriptionManagerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a new subscription for a client.
   *
   * @param clientId - The client registering the subscription
   * @param query - The subscription query definition
   * @returns The created server subscription state
   * @throws Error if client has reached the maximum subscription limit
   */
  register(clientId: string, query: SubscriptionQuery): ServerSubscriptionState {
    // Check subscription limit for client
    const clientSubs = this.byClient.get(clientId);
    if (clientSubs && clientSubs.size >= this.config.maxSubscriptionsPerClient) {
      throw new Error(
        `Client ${clientId} has reached the maximum of ${this.config.maxSubscriptionsPerClient} subscriptions`
      );
    }

    const id = query.id || generateSubscriptionId();

    const state: ServerSubscriptionState = {
      id,
      clientId,
      query: { ...query, id },
      currentIds: new Set(),
      sequence: 0,
      createdAt: Date.now(),
    };

    // Store subscription
    this.subscriptions.set(id, state);

    // Index by collection
    const collection = query.collection;
    if (!this.byCollection.has(collection)) {
      this.byCollection.set(collection, new Set());
    }
    this.byCollection.get(collection)!.add(id);

    // Index by client
    if (!this.byClient.has(clientId)) {
      this.byClient.set(clientId, new Set());
    }
    this.byClient.get(clientId)!.add(id);

    return state;
  }

  /**
   * Unregister a single subscription by ID
   *
   * @param subscriptionId - The subscription to remove
   */
  unregister(subscriptionId: string): void {
    const state = this.subscriptions.get(subscriptionId);
    if (!state) return;

    // Remove from collection index
    const collectionSubs = this.byCollection.get(state.query.collection);
    if (collectionSubs) {
      collectionSubs.delete(subscriptionId);
      if (collectionSubs.size === 0) {
        this.byCollection.delete(state.query.collection);
      }
    }

    // Remove from client index
    const clientSubs = this.byClient.get(state.clientId);
    if (clientSubs) {
      clientSubs.delete(subscriptionId);
      if (clientSubs.size === 0) {
        this.byClient.delete(state.clientId);
      }
    }

    // Remove subscription
    this.subscriptions.delete(subscriptionId);
  }

  /**
   * Remove all subscriptions for a client (e.g., on disconnect)
   *
   * @param clientId - The client whose subscriptions should be removed
   */
  unregisterClient(clientId: string): void {
    const clientSubs = this.byClient.get(clientId);
    if (!clientSubs) return;

    // Copy the set to avoid modification during iteration
    const subIds = [...clientSubs];
    for (const subId of subIds) {
      this.unregister(subId);
    }
  }

  /**
   * Get all subscriptions watching a specific collection.
   * Used to determine which subscriptions may be affected by a change.
   *
   * @param collection - The collection name
   * @returns Array of subscription states for that collection
   */
  getSubscriptionsForCollection(collection: string): ServerSubscriptionState[] {
    const subIds = this.byCollection.get(collection);
    if (!subIds) return [];

    const result: ServerSubscriptionState[] = [];
    for (const id of subIds) {
      const state = this.subscriptions.get(id);
      if (state) {
        result.push(state);
      }
    }
    return result;
  }

  /**
   * Get all subscriptions for a specific client
   *
   * @param clientId - The client ID
   * @returns Array of subscription states for that client
   */
  getClientSubscriptions(clientId: string): ServerSubscriptionState[] {
    const subIds = this.byClient.get(clientId);
    if (!subIds) return [];

    const result: ServerSubscriptionState[] = [];
    for (const id of subIds) {
      const state = this.subscriptions.get(id);
      if (state) {
        result.push(state);
      }
    }
    return result;
  }

  /**
   * Get a specific subscription by ID
   *
   * @param subscriptionId - The subscription ID
   * @returns The subscription state, or undefined if not found
   */
  get(subscriptionId: string): ServerSubscriptionState | undefined {
    return this.subscriptions.get(subscriptionId);
  }

  /**
   * Record that a delta was delivered (for stats tracking)
   *
   * @param deltaSize - Number of changes in the delta
   * @param fullResultSize - Size of the full result set (for bandwidth savings)
   */
  recordDeltaDelivered(deltaSize: number, fullResultSize: number): void {
    this.deltasDelivered++;
    this.totalDeltaSize += deltaSize;
    // Estimate bandwidth saved: full result size minus delta size
    // Assume ~100 bytes average per document as a rough estimate
    const estimatedFullBytes = fullResultSize * 100;
    const estimatedDeltaBytes = deltaSize * 100;
    this.bandwidthSavedBytes += Math.max(0, estimatedFullBytes - estimatedDeltaBytes);
  }

  /**
   * Get aggregate statistics about the subscription system
   */
  getStats(): SubscriptionStats {
    return {
      totalSubscriptions: this.subscriptions.size,
      activeClients: this.byClient.size,
      deltasDelivered: this.deltasDelivered,
      avgDeltaSize: this.deltasDelivered > 0 ? this.totalDeltaSize / this.deltasDelivered : 0,
      bandwidthSavedBytes: this.bandwidthSavedBytes,
    };
  }

  /**
   * Get the configuration
   */
  getConfig(): Required<SubscriptionManagerConfig> {
    return { ...this.config };
  }
}

/**
 * Create a new SubscriptionRegistry
 */
export function createSubscriptionRegistry(
  config?: SubscriptionManagerConfig
): SubscriptionRegistry {
  return new SubscriptionRegistry(config);
}
