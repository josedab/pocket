/**
 * Collection-Level Event Bus — publish/subscribe system for collection
 * change events with webhook integration, filtering, retry logic,
 * and dead-letter queue support.
 *
 * @example
 * ```ts
 * import { createEventBus } from '@pocket/triggers';
 *
 * const bus = createEventBus();
 *
 * // Subscribe to collection events
 * const unsub = bus.on('users', ['insert', 'update'], (event) => {
 *   console.log(`User ${event.operation}:`, event.document);
 * });
 *
 * // Register a webhook
 * bus.registerWebhook({
 *   id: 'notify-service',
 *   url: 'https://api.example.com/webhooks/users',
 *   collections: ['users'],
 *   operations: ['insert', 'update', 'delete'],
 *   retries: 3,
 *   retryDelayMs: 1000,
 * });
 *
 * // Emit an event
 * await bus.emit({
 *   collection: 'users',
 *   operation: 'insert',
 *   document: { _id: 'u1', name: 'Alice' },
 *   timestamp: Date.now(),
 * });
 * ```
 *
 * @module @pocket/triggers
 */

import { Subject } from 'rxjs';
import type { TriggerOperation } from './types.js';

// ── Types ─────────────────────────────────────────────────

export interface CollectionEvent {
  collection: string;
  operation: TriggerOperation;
  document: Record<string, unknown> | null;
  previousDocument?: Record<string, unknown> | null;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface EventFilter {
  collections?: string[];
  operations?: TriggerOperation[];
  condition?: (event: CollectionEvent) => boolean;
}

export type EventHandler = (event: CollectionEvent) => void | Promise<void>;

export interface EventSubscription {
  id: string;
  filter: EventFilter;
  handler: EventHandler;
  enabled: boolean;
}

export interface WebhookRegistration {
  id: string;
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  collections: string[];
  operations: TriggerOperation[];
  condition?: (event: CollectionEvent) => boolean;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  enabled?: boolean;
}

export interface DeadLetterEntry {
  id: string;
  webhookId: string;
  event: CollectionEvent;
  error: string;
  attempts: number;
  firstFailedAt: number;
  lastFailedAt: number;
}

export interface EventBusConfig {
  /** Maximum entries in the dead-letter queue (default: 100) */
  maxDeadLetterSize?: number;
  /** Default retry count for webhooks (default: 3) */
  defaultRetries?: number;
  /** Default retry delay in ms (default: 1000) */
  defaultRetryDelayMs?: number;
  /** Default webhook timeout in ms (default: 10000) */
  defaultTimeoutMs?: number;
  /** Enable event logging (default: false) */
  enableLogging?: boolean;
  /** Maximum event log size (default: 1000) */
  maxLogSize?: number;
  /** Custom fetch implementation (for testing) */
  fetchFn?: typeof fetch;
}

export interface EventLog {
  event: CollectionEvent;
  subscribersNotified: number;
  webhooksTriggered: number;
  errors: string[];
  timestamp: number;
}

export type EventBusEvent =
  | { type: 'event_emitted'; collection: string; operation: TriggerOperation }
  | { type: 'subscriber_notified'; subscriptionId: string }
  | { type: 'subscriber_error'; subscriptionId: string; error: string }
  | { type: 'webhook_success'; webhookId: string; statusCode: number }
  | { type: 'webhook_error'; webhookId: string; error: string; attempt: number }
  | { type: 'dead_letter'; webhookId: string; eventCollection: string };

// ── Event Bus ─────────────────────────────────────────────

let subIdCounter = 0;

export class EventBus {
  private readonly config: Required<EventBusConfig>;
  private readonly subscriptions = new Map<string, EventSubscription>();
  private readonly webhooks = new Map<string, WebhookRegistration>();
  private readonly deadLetterQueue: DeadLetterEntry[] = [];
  private readonly eventLog: EventLog[] = [];
  private readonly events$$ = new Subject<EventBusEvent>();
  private readonly fetchFn: typeof fetch;
  private destroyed = false;
  private dlIdCounter = 0;

  readonly events$ = this.events$$.asObservable();

  constructor(config: EventBusConfig = {}) {
    this.config = {
      maxDeadLetterSize: config.maxDeadLetterSize ?? 100,
      defaultRetries: config.defaultRetries ?? 3,
      defaultRetryDelayMs: config.defaultRetryDelayMs ?? 1000,
      defaultTimeoutMs: config.defaultTimeoutMs ?? 10_000,
      enableLogging: config.enableLogging ?? false,
      maxLogSize: config.maxLogSize ?? 1000,
      fetchFn: config.fetchFn ?? globalThis.fetch?.bind(globalThis),
    };
    this.fetchFn = this.config.fetchFn;
  }

  /**
   * Subscribe to collection events.
   * Returns an unsubscribe function.
   */
  on(
    collections: string | string[],
    operations: TriggerOperation | TriggerOperation[],
    handler: EventHandler,
    condition?: (event: CollectionEvent) => boolean
  ): () => void {
    this.ensureNotDestroyed();

    const id = `sub_${++subIdCounter}`;
    const filter: EventFilter = {
      collections: Array.isArray(collections) ? collections : [collections],
      operations: Array.isArray(operations) ? operations : [operations],
      condition,
    };

    this.subscriptions.set(id, { id, filter, handler, enabled: true });

    return () => {
      this.subscriptions.delete(id);
    };
  }

  /** Subscribe to all events on all collections */
  onAny(handler: EventHandler): () => void {
    return this.on([], [], handler);
  }

  /** Register an HTTP webhook */
  registerWebhook(registration: WebhookRegistration): string {
    this.ensureNotDestroyed();

    if (!registration.url) {
      throw new Error('Webhook URL is required');
    }

    const webhook: WebhookRegistration = {
      ...registration,
      method: registration.method ?? 'POST',
      retries: registration.retries ?? this.config.defaultRetries,
      retryDelayMs: registration.retryDelayMs ?? this.config.defaultRetryDelayMs,
      timeoutMs: registration.timeoutMs ?? this.config.defaultTimeoutMs,
      enabled: registration.enabled ?? true,
    };

    this.webhooks.set(webhook.id, webhook);
    return webhook.id;
  }

  /** Remove a webhook */
  removeWebhook(webhookId: string): void {
    this.webhooks.delete(webhookId);
  }

  /** Enable/disable a webhook */
  setWebhookEnabled(webhookId: string, enabled: boolean): void {
    const webhook = this.webhooks.get(webhookId);
    if (webhook) webhook.enabled = enabled;
  }

  /**
   * Emit a collection event. Notifies all matching subscribers
   * and triggers matching webhooks.
   */
  async emit(event: CollectionEvent): Promise<void> {
    this.ensureNotDestroyed();

    const log: EventLog = {
      event,
      subscribersNotified: 0,
      webhooksTriggered: 0,
      errors: [],
      timestamp: Date.now(),
    };

    this.events$$.next({
      type: 'event_emitted',
      collection: event.collection,
      operation: event.operation,
    });

    // Notify local subscribers
    for (const sub of this.subscriptions.values()) {
      if (!sub.enabled) continue;
      if (!this.matchesFilter(event, sub.filter)) continue;

      try {
        await sub.handler(event);
        log.subscribersNotified++;
        this.events$$.next({ type: 'subscriber_notified', subscriptionId: sub.id });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log.errors.push(`Subscriber ${sub.id}: ${error}`);
        this.events$$.next({ type: 'subscriber_error', subscriptionId: sub.id, error });
      }
    }

    // Trigger webhooks
    const webhookPromises: Promise<void>[] = [];
    for (const webhook of this.webhooks.values()) {
      if (!webhook.enabled) continue;
      if (!this.matchesWebhook(event, webhook)) continue;

      webhookPromises.push(this.executeWebhook(webhook, event, log));
      log.webhooksTriggered++;
    }

    await Promise.allSettled(webhookPromises);

    if (this.config.enableLogging) {
      this.eventLog.push(log);
      if (this.eventLog.length > this.config.maxLogSize) {
        this.eventLog.shift();
      }
    }
  }

  /** Get the dead-letter queue */
  getDeadLetterQueue(): DeadLetterEntry[] {
    return [...this.deadLetterQueue];
  }

  /** Retry a dead-letter entry */
  async retryDeadLetter(entryId: string): Promise<boolean> {
    const idx = this.deadLetterQueue.findIndex((e) => e.id === entryId);
    if (idx < 0) return false;

    const entry = this.deadLetterQueue[idx]!;
    const webhook = this.webhooks.get(entry.webhookId);
    if (!webhook) return false;

    try {
      await this.sendWebhookRequest(webhook, entry.event);
      this.deadLetterQueue.splice(idx, 1);
      return true;
    } catch {
      entry.attempts++;
      entry.lastFailedAt = Date.now();
      return false;
    }
  }

  /** Clear the dead-letter queue */
  clearDeadLetterQueue(): void {
    this.deadLetterQueue.length = 0;
  }

  /** Get event log */
  getEventLog(): EventLog[] {
    return [...this.eventLog];
  }

  /** Get all registered webhooks */
  getWebhooks(): WebhookRegistration[] {
    return Array.from(this.webhooks.values());
  }

  /** Get all active subscriptions count */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /** Destroy the event bus */
  destroy(): void {
    this.destroyed = true;
    this.subscriptions.clear();
    this.webhooks.clear();
    this.events$$.complete();
  }

  // ── Internals ─────────────────────────────────────────

  private matchesFilter(event: CollectionEvent, filter: EventFilter): boolean {
    if (
      filter.collections &&
      filter.collections.length > 0 &&
      !filter.collections.includes(event.collection)
    ) {
      return false;
    }
    if (
      filter.operations &&
      filter.operations.length > 0 &&
      !filter.operations.includes(event.operation)
    ) {
      return false;
    }
    if (filter.condition && !filter.condition(event)) {
      return false;
    }
    return true;
  }

  private matchesWebhook(event: CollectionEvent, webhook: WebhookRegistration): boolean {
    if (webhook.collections.length > 0 && !webhook.collections.includes(event.collection)) {
      return false;
    }
    if (webhook.operations.length > 0 && !webhook.operations.includes(event.operation)) {
      return false;
    }
    if (webhook.condition && !webhook.condition(event)) {
      return false;
    }
    return true;
  }

  private async executeWebhook(
    webhook: WebhookRegistration,
    event: CollectionEvent,
    log: EventLog
  ): Promise<void> {
    const maxRetries = webhook.retries ?? this.config.defaultRetries;
    const retryDelay = webhook.retryDelayMs ?? this.config.defaultRetryDelayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const statusCode = await this.sendWebhookRequest(webhook, event);
        this.events$$.next({ type: 'webhook_success', webhookId: webhook.id, statusCode });
        return;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.events$$.next({ type: 'webhook_error', webhookId: webhook.id, error, attempt });

        if (attempt < maxRetries) {
          await this.sleep(retryDelay * Math.pow(2, attempt));
        } else {
          // Add to dead-letter queue
          log.errors.push(`Webhook ${webhook.id}: ${error} (all retries exhausted)`);
          this.addToDeadLetter(webhook.id, event, error, attempt + 1);
        }
      }
    }
  }

  private async sendWebhookRequest(
    webhook: WebhookRegistration,
    event: CollectionEvent
  ): Promise<number> {
    if (!this.fetchFn) {
      throw new Error('fetch is not available');
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      webhook.timeoutMs ?? this.config.defaultTimeoutMs
    );

    try {
      const response = await this.fetchFn(webhook.url, {
        method: webhook.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...webhook.headers,
        },
        body: JSON.stringify({
          event: event.operation,
          collection: event.collection,
          document: event.document,
          previousDocument: event.previousDocument,
          timestamp: event.timestamp,
          metadata: event.metadata,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.status;
    } finally {
      clearTimeout(timeout);
    }
  }

  private addToDeadLetter(
    webhookId: string,
    event: CollectionEvent,
    error: string,
    attempts: number
  ): void {
    const entry: DeadLetterEntry = {
      id: `dl_${++this.dlIdCounter}`,
      webhookId,
      event,
      error,
      attempts,
      firstFailedAt: Date.now(),
      lastFailedAt: Date.now(),
    };

    this.deadLetterQueue.push(entry);
    this.events$$.next({ type: 'dead_letter', webhookId, eventCollection: event.collection });

    // Enforce max size
    while (this.deadLetterQueue.length > this.config.maxDeadLetterSize) {
      this.deadLetterQueue.shift();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private ensureNotDestroyed(): void {
    if (this.destroyed) throw new Error('EventBus has been destroyed');
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create a collection-level event bus */
export function createEventBus(config?: EventBusConfig): EventBus {
  return new EventBus(config);
}
