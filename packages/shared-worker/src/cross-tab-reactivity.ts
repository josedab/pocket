/**
 * Cross-Tab Reactive Queries
 *
 * Provides BroadcastChannel-based cross-tab reactivity for find$() queries.
 * When one tab modifies data, all other tabs with active find$() subscriptions
 * receive real-time updates through BroadcastChannel.
 *
 * @module @pocket/shared-worker/cross-tab-reactivity
 */

import type { Observable } from 'rxjs';
import { BehaviorSubject, Subject, filter, share } from 'rxjs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrossTabReactivityConfig {
  /** BroadcastChannel name for change notifications. */
  readonly channelName?: string;
  /** Debounce ms for batching change notifications. */
  readonly debounceMs?: number;
  /** Maximum subscriptions per tab. */
  readonly maxSubscriptions?: number;
}

export interface ChangeNotification {
  readonly tabId: string;
  readonly collection: string;
  readonly operation: 'insert' | 'update' | 'delete' | 'bulk';
  readonly documentIds: readonly string[];
  readonly timestamp: number;
}

export interface ReactiveSubscription {
  readonly id: string;
  readonly collection: string;
  readonly tabId: string;
  readonly createdAt: number;
}

export interface CrossTabReactivityState {
  readonly tabId: string;
  readonly activeSubscriptions: number;
  readonly changesSent: number;
  readonly changesReceived: number;
  readonly connectedTabs: number;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class CrossTabReactivity {
  private readonly config: Required<CrossTabReactivityConfig>;
  private readonly tabId: string;
  private channel: BroadcastChannel | null = null;
  private readonly subscriptions = new Map<string, ReactiveSubscription>();
  private readonly changeSubject = new Subject<ChangeNotification>();
  private readonly stateSubject: BehaviorSubject<CrossTabReactivityState>;
  private changesSent = 0;
  private changesReceived = 0;
  private subCounter = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingNotifications: ChangeNotification[] = [];

  constructor(config?: CrossTabReactivityConfig) {
    this.config = {
      channelName: config?.channelName ?? 'pocket-cross-tab-reactivity',
      debounceMs: config?.debounceMs ?? 50,
      maxSubscriptions: config?.maxSubscriptions ?? 100,
    };

    this.tabId = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    this.stateSubject = new BehaviorSubject<CrossTabReactivityState>({
      tabId: this.tabId,
      activeSubscriptions: 0,
      changesSent: 0,
      changesReceived: 0,
      connectedTabs: 0,
    });

    this.initChannel();
  }

  private initChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return;

    try {
      this.channel = new BroadcastChannel(this.config.channelName);
      this.channel.onmessage = (event: MessageEvent) => {
        const data = event.data as { type: string; payload: unknown };
        if (data.type === 'change') {
          const notification = data.payload as ChangeNotification;
          // Ignore own changes
          if (notification.tabId === this.tabId) return;

          this.changesReceived++;
          this.changeSubject.next(notification);
          this.updateState();
        }
      };
    } catch {
      // BroadcastChannel not available
    }
  }

  private updateState(): void {
    this.stateSubject.next({
      tabId: this.tabId,
      activeSubscriptions: this.subscriptions.size,
      changesSent: this.changesSent,
      changesReceived: this.changesReceived,
      connectedTabs: 0, // Updated via heartbeat
    });
  }

  /** Observable of state changes. */
  get state$(): Observable<CrossTabReactivityState> {
    return this.stateSubject.asObservable();
  }

  /** Current state snapshot. */
  get state(): CrossTabReactivityState {
    return this.stateSubject.getValue();
  }

  /**
   * Subscribe to changes for a specific collection.
   * Returns an observable that emits when other tabs modify data in this collection.
   */
  find$(collection: string): Observable<ChangeNotification> {
    const subId = `sub-${++this.subCounter}`;
    const subscription: ReactiveSubscription = {
      id: subId,
      collection,
      tabId: this.tabId,
      createdAt: Date.now(),
    };

    if (this.subscriptions.size >= this.config.maxSubscriptions) {
      // Remove oldest subscription
      const oldest = Array.from(this.subscriptions.entries()).sort(
        ([, a], [, b]) => a.createdAt - b.createdAt
      )[0];
      if (oldest) {
        this.subscriptions.delete(oldest[0]);
      }
    }

    this.subscriptions.set(subId, subscription);
    this.updateState();

    return this.changeSubject.pipe(
      filter((change) => change.collection === collection),
      share()
    );
  }

  /**
   * Notify other tabs about a data change.
   */
  notifyChange(
    collection: string,
    operation: ChangeNotification['operation'],
    documentIds: string[]
  ): void {
    const notification: ChangeNotification = {
      tabId: this.tabId,
      collection,
      operation,
      documentIds,
      timestamp: Date.now(),
    };

    // Debounce notifications
    this.pendingNotifications.push(notification);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flushNotifications();
    }, this.config.debounceMs);
  }

  private flushNotifications(): void {
    if (!this.channel || this.pendingNotifications.length === 0) return;

    // Merge notifications by collection
    const byCollection = new Map<string, ChangeNotification>();
    for (const n of this.pendingNotifications) {
      const existing = byCollection.get(n.collection);
      if (existing) {
        byCollection.set(n.collection, {
          ...existing,
          operation: 'bulk',
          documentIds: [...existing.documentIds, ...n.documentIds],
        });
      } else {
        byCollection.set(n.collection, n);
      }
    }

    for (const notification of byCollection.values()) {
      try {
        this.channel.postMessage({ type: 'change', payload: notification });
        this.changesSent++;
      } catch {
        // Channel closed
      }
    }

    this.pendingNotifications = [];
    this.updateState();
  }

  /** Remove a subscription. */
  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
    this.updateState();
  }

  /** Clean up all resources. */
  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.channel?.close();
    this.subscriptions.clear();
    this.stateSubject.complete();
    this.changeSubject.complete();
  }
}

export function createCrossTabReactivity(config?: CrossTabReactivityConfig): CrossTabReactivity {
  return new CrossTabReactivity(config);
}
