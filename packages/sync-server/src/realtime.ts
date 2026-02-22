/**
 * Realtime Engine for Pocket Sync Server
 *
 * WebSocket-based live query subscription service that evaluates document
 * change events against registered subscriptions and pushes matches to
 * interested clients.
 *
 * @module @pocket/sync-server
 */

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A registered live query subscription
 */
export interface RealtimeSubscription {
  /** Unique subscription identifier */
  id: string;
  /** Client that owns this subscription */
  clientId: string;
  /** Collection being observed */
  collection: string;
  /** Optional filter for matching documents */
  filter?: Record<string, unknown>;
  /** Optional query string */
  query?: string;
  /** Timestamp when the subscription was created */
  createdAt: number;
}

/**
 * A document change event
 */
export interface RealtimeEvent {
  /** Kind of change */
  type: 'insert' | 'update' | 'delete';
  /** Collection the change occurred in */
  collection: string;
  /** Identifier of the affected document */
  documentId: string;
  /** Document data (absent on delete) */
  data?: Record<string, unknown>;
  /** Epoch timestamp of the event */
  timestamp: number;
}

/**
 * Configuration for the realtime engine
 */
export interface RealtimeConfig {
  /** Maximum subscriptions allowed per client */
  maxSubscriptionsPerClient?: number;
  /** Heartbeat interval in milliseconds */
  heartbeatIntervalMs?: number;
  /** Subscription time-to-live in milliseconds */
  subscriptionTTLMs?: number;
}

/**
 * A match between a subscription and a change event
 */
export interface SubscriptionMatch {
  /** ID of the matching subscription */
  subscriptionId: string;
  /** Client that should receive the match */
  clientId: string;
  /** The change event that matched */
  event: RealtimeEvent;
}

// ---------------------------------------------------------------------------
// Lightweight Observable
// ---------------------------------------------------------------------------

/** Teardown function returned by subscribe */
export interface Unsubscribable {
  unsubscribe(): void;
}

/**
 * Minimal Observable interface (no rxjs dependency)
 */
export interface Observable<T> {
  subscribe(observer: (value: T) => void): Unsubscribable;
}

// ---------------------------------------------------------------------------
// Filter matching
// ---------------------------------------------------------------------------

type FilterValue = unknown;
type ComparisonOperator = '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$nin';

function isComparisonObject(v: unknown): v is Record<ComparisonOperator, FilterValue> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.keys(v as object).some((k) => k.startsWith('$'));
}

function compareValues(docValue: unknown, operator: ComparisonOperator, target: unknown): boolean {
  switch (operator) {
    case '$eq':
      return docValue === target;
    case '$ne':
      return docValue !== target;
    case '$gt':
      return (docValue as number) > (target as number);
    case '$gte':
      return (docValue as number) >= (target as number);
    case '$lt':
      return (docValue as number) < (target as number);
    case '$lte':
      return (docValue as number) <= (target as number);
    case '$in':
      return Array.isArray(target) && target.includes(docValue);
    case '$nin':
      return Array.isArray(target) && !target.includes(docValue);
    default:
      return false;
  }
}

/**
 * Evaluate whether a document's data matches a subscription filter.
 *
 * Supports basic equality (`{ status: 'active' }`) and comparison operators
 * (`{ age: { $gt: 18 } }`).
 */
function matchesFilter(data: Record<string, unknown> | undefined, filter: Record<string, unknown>): boolean {
  if (!data) return false;
  for (const [field, condition] of Object.entries(filter)) {
    const docValue = data[field];
    if (isComparisonObject(condition)) {
      for (const [op, target] of Object.entries(condition)) {
        if (!compareValues(docValue, op as ComparisonOperator, target)) return false;
      }
    } else {
      // Equality check
      if (docValue !== condition) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_REALTIME_CONFIG: Required<RealtimeConfig> = {
  maxSubscriptionsPerClient: 100,
  heartbeatIntervalMs: 30_000,
  subscriptionTTLMs: 3_600_000,
};

// ---------------------------------------------------------------------------
// RealtimeEngine
// ---------------------------------------------------------------------------

/**
 * Live query subscription engine
 *
 * Manages client subscriptions and evaluates incoming change events against
 * registered filters, emitting matches to observers.
 *
 * @example
 * ```typescript
 * import { createRealtimeEngine } from '@pocket/sync-server';
 *
 * const engine = createRealtimeEngine();
 *
 * // Subscribe a client
 * const sub = engine.subscribe('client-1', 'todos', { status: 'active' });
 *
 * // Listen to matches
 * engine.matches$.subscribe((match) => {
 *   console.log(match.clientId, match.event);
 * });
 *
 * // Process a change
 * engine.processChange({
 *   type: 'insert',
 *   collection: 'todos',
 *   documentId: 'doc-1',
 *   data: { status: 'active' },
 *   timestamp: Date.now(),
 * });
 *
 * engine.dispose();
 * ```
 */
export class RealtimeEngine {
  private readonly config: Required<RealtimeConfig>;
  private readonly subscriptions = new Map<string, RealtimeSubscription>();
  private readonly clientSubscriptions = new Map<string, Set<string>>();
  private readonly observers = new Set<(value: SubscriptionMatch) => void>();
  private disposed = false;

  // Stats
  private eventsProcessed = 0;
  private matchesFound = 0;

  /** Unique engine instance ID */
  readonly id = generateId();

  constructor(config?: RealtimeConfig) {
    this.config = {
      maxSubscriptionsPerClient: config?.maxSubscriptionsPerClient ?? DEFAULT_REALTIME_CONFIG.maxSubscriptionsPerClient,
      heartbeatIntervalMs: config?.heartbeatIntervalMs ?? DEFAULT_REALTIME_CONFIG.heartbeatIntervalMs,
      subscriptionTTLMs: config?.subscriptionTTLMs ?? DEFAULT_REALTIME_CONFIG.subscriptionTTLMs,
    };
  }

  // -----------------------------------------------------------------------
  // Observable stream
  // -----------------------------------------------------------------------

  /**
   * Observable that emits every subscription match produced by
   * {@link processChange}.
   */
  readonly matches$: Observable<SubscriptionMatch> = {
    subscribe: (observer: (value: SubscriptionMatch) => void): Unsubscribable => {
      this.observers.add(observer);
      return {
        unsubscribe: () => {
          this.observers.delete(observer);
        },
      };
    },
  };

  // -----------------------------------------------------------------------
  // Subscription management
  // -----------------------------------------------------------------------

  /**
   * Register a live query subscription for a client.
   *
   * @param clientId - Owner of the subscription
   * @param collection - Collection to observe
   * @param filter - Optional document filter
   * @returns The created subscription
   */
  subscribe(
    clientId: string,
    collection: string,
    filter?: Record<string, unknown>,
  ): RealtimeSubscription {
    const clientSubs = this.clientSubscriptions.get(clientId);
    if (clientSubs && clientSubs.size >= this.config.maxSubscriptionsPerClient) {
      throw new Error(
        `Client ${clientId} has reached the maximum number of subscriptions (${this.config.maxSubscriptionsPerClient})`,
      );
    }

    const subscription: RealtimeSubscription = {
      id: generateId(),
      clientId,
      collection,
      filter,
      createdAt: Date.now(),
    };

    this.subscriptions.set(subscription.id, subscription);

    if (!this.clientSubscriptions.has(clientId)) {
      this.clientSubscriptions.set(clientId, new Set());
    }
    this.clientSubscriptions.get(clientId)!.add(subscription.id);

    return subscription;
  }

  /**
   * Remove a single subscription by ID.
   *
   * @returns `true` if the subscription existed and was removed
   */
  unsubscribe(subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;

    this.subscriptions.delete(subscriptionId);
    const clientSubs = this.clientSubscriptions.get(sub.clientId);
    if (clientSubs) {
      clientSubs.delete(subscriptionId);
      if (clientSubs.size === 0) {
        this.clientSubscriptions.delete(sub.clientId);
      }
    }
    return true;
  }

  /**
   * Remove all subscriptions belonging to a client.
   */
  unsubscribeClient(clientId: string): void {
    const clientSubs = this.clientSubscriptions.get(clientId);
    if (!clientSubs) return;

    for (const subId of clientSubs) {
      this.subscriptions.delete(subId);
    }
    this.clientSubscriptions.delete(clientId);
  }

  // -----------------------------------------------------------------------
  // Change processing
  // -----------------------------------------------------------------------

  /**
   * Evaluate a change event against all active subscriptions.
   *
   * @returns Array of matches (subscription + event pairs)
   */
  processChange(event: RealtimeEvent): SubscriptionMatch[] {
    this.eventsProcessed++;
    const matches: SubscriptionMatch[] = [];

    for (const sub of this.subscriptions.values()) {
      if (sub.collection !== event.collection) continue;

      // When a filter is set, verify the document data satisfies it
      if (sub.filter) {
        if (event.type === 'delete') {
          // Deletes without data cannot be matched against a filter
          if (!event.data) continue;
        }
        if (!matchesFilter(event.data, sub.filter)) continue;
      }

      const match: SubscriptionMatch = {
        subscriptionId: sub.id,
        clientId: sub.clientId,
        event,
      };
      matches.push(match);
    }

    this.matchesFound += matches.length;

    // Emit to observers
    for (const match of matches) {
      for (const observer of this.observers) {
        observer(match);
      }
    }

    return matches;
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * List active subscriptions, optionally filtered by client.
   */
  getSubscriptions(clientId?: string): RealtimeSubscription[] {
    if (clientId) {
      const clientSubs = this.clientSubscriptions.get(clientId);
      if (!clientSubs) return [];
      return Array.from(clientSubs)
        .map((id) => this.subscriptions.get(id))
        .filter((s): s is RealtimeSubscription => s !== undefined);
    }
    return Array.from(this.subscriptions.values());
  }

  /**
   * Return aggregate statistics for this engine instance.
   */
  getStats(): {
    totalSubscriptions: number;
    activeClients: number;
    eventsProcessed: number;
    matchesFound: number;
  } {
    return {
      totalSubscriptions: this.subscriptions.size,
      activeClients: this.clientSubscriptions.size,
      eventsProcessed: this.eventsProcessed,
      matchesFound: this.matchesFound,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Dispose of the realtime engine, clearing all subscriptions and observers.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.subscriptions.clear();
    this.clientSubscriptions.clear();
    this.observers.clear();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a realtime engine
 *
 * @example
 * ```typescript
 * import { createRealtimeEngine } from '@pocket/sync-server';
 *
 * const engine = createRealtimeEngine({
 *   maxSubscriptionsPerClient: 50,
 * });
 * ```
 */
export function createRealtimeEngine(config?: RealtimeConfig): RealtimeEngine {
  return new RealtimeEngine(config);
}
