/** Callback invoked when a subscribed collection changes. */
export type SubscriptionCallback = (event: SubscriptionEvent) => void;

/** Describes a change event delivered to subscribers. */
export interface SubscriptionEvent {
  collection: string;
  documentId?: string;
  operation: 'insert' | 'update' | 'delete';
  data?: unknown;
}

/** Metadata for an active subscription. */
export interface ActiveSubscription {
  id: string;
  collection: string;
  filter?: Record<string, unknown>;
  createdAt: number;
}

/**
 * Manages live-query subscriptions for the GraphQL gateway.
 */
export class SubscriptionManager {
  private subscriptions = new Map<string, {
    meta: ActiveSubscription;
    callback: SubscriptionCallback;
  }>();

  private nextId = 1;

  /**
   * Subscribe to changes on a collection.
   * @returns An unsubscribe function.
   */
  subscribe(
    collection: string,
    filter?: Record<string, unknown>,
    callback?: SubscriptionCallback,
  ): () => void {
    const id = `sub-${this.nextId++}`;
    const meta: ActiveSubscription = {
      id,
      collection,
      filter,
      createdAt: Date.now(),
    };

    this.subscriptions.set(id, {
      meta,
      callback: callback ?? (() => {}),
    });

    return () => {
      this.subscriptions.delete(id);
    };
  }

  /** Emit an event to all matching subscribers (used internally or for testing). */
  emit(event: SubscriptionEvent): void {
    for (const entry of this.subscriptions.values()) {
      if (entry.meta.collection === event.collection) {
        entry.callback(event);
      }
    }
  }

  /** Return metadata for all active subscriptions. */
  getActiveSubscriptions(): ActiveSubscription[] {
    return Array.from(this.subscriptions.values()).map((e) => e.meta);
  }

  /** Return the number of active subscriptions. */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /** Remove all subscriptions. */
  unsubscribeAll(): void {
    this.subscriptions.clear();
  }
}

/** Factory function to create a {@link SubscriptionManager}. */
export function createSubscriptionManager(): SubscriptionManager {
  return new SubscriptionManager();
}
