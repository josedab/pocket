/**
 * Subscription bridge that wires Pocket's reactive find$() queries
 * to GraphQL subscriptions over WebSocket.
 */
import { Subject, type Observable, type Subscription } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export interface SubscriptionBridgeConfig {
  heartbeatInterval?: number;
  maxSubscriptionsPerClient?: number;
}

export interface SubscriptionEvent<T = unknown> {
  type: 'created' | 'updated' | 'deleted' | 'initial';
  collection: string;
  documentId?: string;
  data: T;
  timestamp: number;
}

export interface ClientSubscription {
  id: string;
  clientId: string;
  collection: string;
  event: string;
  filter?: Record<string, unknown>;
  createdAt: number;
}

export type DataSourceFactory = (
  collection: string,
  filter?: Record<string, unknown>
) => Observable<SubscriptionEvent>;

/**
 * Bridges Pocket's reactive queries to GraphQL subscription events.
 */
export class SubscriptionBridge {
  private readonly config: Required<SubscriptionBridgeConfig>;
  private readonly subscriptions = new Map<
    string,
    { sub: Subscription; clientSub: ClientSubscription }
  >();
  private readonly events$ = new Subject<{ clientId: string; event: SubscriptionEvent }>();
  private readonly dataSourceFactory: DataSourceFactory;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dataSourceFactory: DataSourceFactory, config?: SubscriptionBridgeConfig) {
    this.dataSourceFactory = dataSourceFactory;
    this.config = {
      heartbeatInterval: config?.heartbeatInterval ?? 30000,
      maxSubscriptionsPerClient: config?.maxSubscriptionsPerClient ?? 50,
    };
  }

  /** Subscribe a client to collection changes */
  subscribe(
    clientId: string,
    subscriptionId: string,
    collection: string,
    event: string,
    subFilter?: Record<string, unknown>
  ): boolean {
    const clientCount = this.getClientSubscriptionCount(clientId);
    if (clientCount >= this.config.maxSubscriptionsPerClient) {
      return false;
    }

    const source$ = this.dataSourceFactory(collection, subFilter);

    const filteredSource$ = source$.pipe(
      filter((evt: SubscriptionEvent) => event === '*' || evt.type === event),
      map((evt: SubscriptionEvent) => ({ clientId, event: evt }))
    );

    const sub = filteredSource$.subscribe({
      next: (value) => this.events$.next(value),
      error: () => {
        this.unsubscribe(subscriptionId);
      },
    });

    this.subscriptions.set(subscriptionId, {
      sub,
      clientSub: {
        id: subscriptionId,
        clientId,
        collection,
        event,
        filter: subFilter,
        createdAt: Date.now(),
      },
    });

    return true;
  }

  /** Unsubscribe from a specific subscription */
  unsubscribe(subscriptionId: string): void {
    const entry = this.subscriptions.get(subscriptionId);
    if (entry) {
      entry.sub.unsubscribe();
      this.subscriptions.delete(subscriptionId);
    }
  }

  /** Unsubscribe all subscriptions for a client */
  unsubscribeClient(clientId: string): void {
    for (const [id, entry] of this.subscriptions) {
      if (entry.clientSub.clientId === clientId) {
        entry.sub.unsubscribe();
        this.subscriptions.delete(id);
      }
    }
  }

  /** Get observable of events for a specific client */
  getClientEvents$(clientId: string): Observable<SubscriptionEvent> {
    return this.events$.pipe(
      filter((e) => e.clientId === clientId),
      map((e) => e.event)
    );
  }

  /** Get all events */
  get events(): Observable<{ clientId: string; event: SubscriptionEvent }> {
    return this.events$.asObservable();
  }

  /** Get active subscription count for a client */
  getClientSubscriptionCount(clientId: string): number {
    let count = 0;
    for (const entry of this.subscriptions.values()) {
      if (entry.clientSub.clientId === clientId) count++;
    }
    return count;
  }

  /** Get all active subscriptions */
  getActiveSubscriptions(): ClientSubscription[] {
    return Array.from(this.subscriptions.values()).map((e) => e.clientSub);
  }

  /** Start heartbeat for keep-alive */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const clientIds = new Set<string>();
      for (const entry of this.subscriptions.values()) {
        clientIds.add(entry.clientSub.clientId);
      }
      for (const clientId of clientIds) {
        this.events$.next({
          clientId,
          event: {
            type: 'initial',
            collection: '__heartbeat',
            data: { timestamp: Date.now() },
            timestamp: Date.now(),
          },
        });
      }
    }, this.config.heartbeatInterval);
  }

  /** Stop heartbeat */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Destroy the bridge and clean up all subscriptions */
  destroy(): void {
    this.stopHeartbeat();
    for (const [, entry] of this.subscriptions) {
      entry.sub.unsubscribe();
    }
    this.subscriptions.clear();
    this.events$.complete();
  }
}

export function createSubscriptionBridge(
  dataSourceFactory: DataSourceFactory,
  config?: SubscriptionBridgeConfig
): SubscriptionBridge {
  return new SubscriptionBridge(dataSourceFactory, config);
}
