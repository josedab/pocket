/**
 * Types for query subscriptions with server push
 */

import type { ChangeEvent, Document } from '@pocket/core';
import type { Observable } from 'rxjs';

/**
 * Query that defines what documents a subscription tracks
 */
export interface SubscriptionQuery {
  /** Unique subscription ID */
  id: string;
  /** Collection to subscribe to */
  collection: string;
  /** Optional filter conditions */
  filter?: Record<string, unknown>;
  /** Optional sort specification */
  sort?: Record<string, 'asc' | 'desc'>;
  /** Optional result limit */
  limit?: number;
  /** Optional field projection (1 = include, 0 = exclude) */
  projection?: Record<string, 0 | 1>;
}

/**
 * Delta describing changes to a subscription's result set
 */
export interface SubscriptionDelta<T = unknown> {
  /** ID of the subscription this delta belongs to */
  subscriptionId: string;
  /** Whether this is the initial result set or an incremental delta */
  type: 'initial' | 'delta';
  /** Documents added to the result set */
  added: T[];
  /** Document IDs removed from the result set */
  removed: string[];
  /** Documents modified within the result set */
  modified: T[];
  /** Monotonically increasing sequence number */
  sequence: number;
  /** Timestamp of when the delta was computed */
  timestamp: number;
}

/**
 * Protocol messages exchanged between subscription client and server
 */
export type SubscriptionMessage =
  | { type: 'subscribe'; query: SubscriptionQuery }
  | { type: 'unsubscribe'; subscriptionId: string }
  | { type: 'delta'; delta: SubscriptionDelta }
  | { type: 'initial'; subscriptionId: string; results: unknown[]; sequence: number }
  | { type: 'error'; subscriptionId: string; error: string }
  | { type: 'ack'; subscriptionId: string };

/**
 * Configuration for the subscription manager
 */
export interface SubscriptionManagerConfig {
  /** Maximum subscriptions allowed per client (default: 50) */
  maxSubscriptionsPerClient?: number;
  /** Coalesce deltas within this window in milliseconds (default: 50) */
  batchIntervalMs?: number;
  /** Maximum changes per delta message (default: 100) */
  maxBatchSize?: number;
}

/**
 * Client-side subscription handle
 */
export interface ClientSubscription<T = unknown> {
  /** Subscription ID */
  id: string;
  /** The query this subscription is based on */
  query: SubscriptionQuery;
  /** Observable emitting the full result set after each delta */
  results$: Observable<T[]>;
  /** Observable emitting raw delta messages */
  delta$: Observable<SubscriptionDelta<T>>;
  /** Unsubscribe and clean up */
  unsubscribe(): void;
}

/**
 * Server-side state for a single subscription
 */
export interface ServerSubscriptionState {
  /** Subscription ID */
  id: string;
  /** Client that owns this subscription */
  clientId: string;
  /** The query defining the subscription */
  query: SubscriptionQuery;
  /** Set of document IDs currently in the result set */
  currentIds: Set<string>;
  /** Current sequence number for delta ordering */
  sequence: number;
  /** When the subscription was created */
  createdAt: number;
}

/**
 * Statistics about the subscription system
 */
export interface SubscriptionStats {
  /** Total number of active subscriptions */
  totalSubscriptions: number;
  /** Number of clients with active subscriptions */
  activeClients: number;
  /** Total number of deltas delivered */
  deltasDelivered: number;
  /** Average number of changes per delta */
  avgDeltaSize: number;
  /** Estimated bandwidth saved by sending deltas instead of full results */
  bandwidthSavedBytes: number;
}

/**
 * Change event used internally for routing changes to subscriptions.
 * Re-exports the core ChangeEvent for convenience.
 */
export type { ChangeEvent, Document };
