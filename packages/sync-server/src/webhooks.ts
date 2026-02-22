/**
 * HTTP Webhook Notifications for Pocket Sync Server
 *
 * Delivers database change events to external HTTP endpoints with HMAC
 * signature verification, automatic retries with exponential backoff,
 * and delivery history tracking.
 *
 * @module @pocket/sync-server
 */

import { createHmac } from 'crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Events emitted by the sync server for webhook delivery. */
export type WebhookEvent =
  | 'document.created'
  | 'document.updated'
  | 'document.deleted'
  | 'sync.completed'
  | 'conflict.resolved';

/** Retry policy for failed webhook deliveries. */
export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
}

/** Registration configuration for a single webhook endpoint. */
export interface WebhookConfig {
  url: string;
  secret: string;
  events: WebhookEvent[];
  collections?: string[];
  active: boolean;
  retryPolicy?: RetryPolicy;
}

/** Signed payload delivered to a webhook endpoint. */
export interface WebhookPayload {
  id: string;
  event: WebhookEvent;
  collection: string;
  documentId?: string;
  data?: Record<string, unknown>;
  timestamp: number;
  signature: string;
}

/** Record of a single webhook delivery attempt. */
export interface WebhookDelivery {
  id: string;
  webhookId: string;
  payload: WebhookPayload;
  status: 'pending' | 'delivered' | 'failed' | 'retrying';
  attempts: number;
  lastAttemptAt?: number;
  responseStatus?: number;
  error?: string;
}

/** Configuration for the {@link WebhookManager}. */
export interface WebhookManagerConfig {
  maxWebhooks?: number;
  deliveryTimeoutMs?: number;
  maxRetries?: number;
}

/** Aggregate statistics for a webhook manager instance. */
export interface WebhookStats {
  totalWebhooks: number;
  totalDeliveries: number;
  successRate: number;
  failedDeliveries: number;
  pendingDeliveries: number;
}

/** HTTP sender function signature (injectable for testing). */
export type WebhookSender = (
  url: string,
  payload: object,
  headers: Record<string, string>,
) => Promise<{ status: number }>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
};

const DEFAULT_MAX_WEBHOOKS = 100;

// ---------------------------------------------------------------------------
// Default HTTP sender (uses global fetch)
// ---------------------------------------------------------------------------

const defaultSender: WebhookSender = async (url, payload, headers) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  return { status: response.status };
};

// ---------------------------------------------------------------------------
// WebhookManager
// ---------------------------------------------------------------------------

/**
 * Manages webhook registrations, delivers events to registered endpoints,
 * and tracks delivery history with automatic retries.
 *
 * @example
 * ```typescript
 * import { createWebhookNotifier } from '@pocket/sync-server';
 *
 * const manager = createWebhookNotifier();
 *
 * const { id } = manager.register({
 *   url: 'https://example.com/hooks',
 *   secret: 'my-secret',
 *   events: ['document.created'],
 *   active: true,
 * });
 *
 * await manager.trigger('document.created', {
 *   collection: 'todos',
 *   documentId: 'doc-1',
 *   document: { title: 'Buy milk' },
 * });
 *
 * manager.dispose();
 * ```
 */
export class WebhookManager {
  private readonly webhooks = new Map<string, WebhookConfig & { id: string }>();
  private readonly deliveries: WebhookDelivery[] = [];
  private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly sender: WebhookSender;
  private readonly maxWebhooks: number;
  private readonly maxRetries: number;

  constructor(
    config?: WebhookManagerConfig,
    sender?: WebhookSender,
  ) {
    this.sender = sender ?? defaultSender;
    this.maxWebhooks = config?.maxWebhooks ?? DEFAULT_MAX_WEBHOOKS;
    this.maxRetries = config?.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries;
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /** Register a new webhook endpoint. */
  register(config: WebhookConfig): { id: string } {
    if (this.webhooks.size >= this.maxWebhooks) {
      throw new Error(`Maximum number of webhooks (${this.maxWebhooks}) reached`);
    }

    const id = generateId();
    this.webhooks.set(id, { ...config, id });
    return { id };
  }

  /** Remove a registered webhook. */
  unregister(id: string): void {
    this.webhooks.delete(id);
  }

  /** Update an existing webhook configuration. */
  update(id: string, updates: Partial<WebhookConfig>): void {
    const existing = this.webhooks.get(id);
    if (!existing) {
      throw new Error(`Webhook ${id} not found`);
    }
    this.webhooks.set(id, { ...existing, ...updates, id });
  }

  /** List all registered webhooks. */
  list(): Array<WebhookConfig & { id: string }> {
    return Array.from(this.webhooks.values());
  }

  // -----------------------------------------------------------------------
  // Event delivery
  // -----------------------------------------------------------------------

  /**
   * Trigger an event and deliver to all matching webhooks.
   *
   * @returns Delivery records for each webhook that received the event
   */
  async trigger(
    event: WebhookEvent,
    data: {
      collection: string;
      documentId?: string;
      document?: Record<string, unknown>;
      previousDocument?: Record<string, unknown>;
    },
  ): Promise<WebhookDelivery[]> {
    const results: WebhookDelivery[] = [];

    for (const webhook of this.webhooks.values()) {
      if (!webhook.active) continue;
      if (!webhook.events.includes(event)) continue;

      // Collection filter
      if (
        webhook.collections &&
        webhook.collections.length > 0 &&
        !webhook.collections.includes(data.collection)
      ) {
        continue;
      }

      const delivery = await this.deliver(webhook, event, data);
      results.push(delivery);
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Delivery history
  // -----------------------------------------------------------------------

  /** Get delivery history, optionally filtered by webhook ID and limited. */
  getDeliveries(webhookId?: string, limit?: number): WebhookDelivery[] {
    let result = webhookId
      ? this.deliveries.filter((d) => d.webhookId === webhookId)
      : [...this.deliveries];

    if (limit !== undefined) {
      result = result.slice(-limit);
    }
    return result;
  }

  /** Retry a specific failed delivery. */
  async retryDelivery(deliveryId: string): Promise<WebhookDelivery> {
    const delivery = this.deliveries.find((d) => d.id === deliveryId);
    if (!delivery) {
      throw new Error(`Delivery ${deliveryId} not found`);
    }

    const webhook = this.webhooks.get(delivery.webhookId);
    if (!webhook) {
      throw new Error(`Webhook ${delivery.webhookId} not found`);
    }

    delivery.status = 'retrying';
    return this.attemptDelivery(webhook, delivery);
  }

  /** Send a test ping to a registered webhook. */
  async testWebhook(id: string): Promise<WebhookDelivery> {
    const webhook = this.webhooks.get(id);
    if (!webhook) {
      throw new Error(`Webhook ${id} not found`);
    }

    return this.deliver(webhook, 'sync.completed', {
      collection: '_test',
      documentId: 'ping',
      document: { test: true },
    });
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  /** Return aggregate statistics. */
  getStats(): WebhookStats {
    const total = this.deliveries.length;
    const failed = this.deliveries.filter((d) => d.status === 'failed').length;
    const pending = this.deliveries.filter(
      (d) => d.status === 'pending' || d.status === 'retrying',
    ).length;
    const delivered = this.deliveries.filter((d) => d.status === 'delivered').length;

    return {
      totalWebhooks: this.webhooks.size,
      totalDeliveries: total,
      successRate: total > 0 ? delivered / total : 0,
      failedDeliveries: failed,
      pendingDeliveries: pending,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Dispose of the webhook manager and cancel pending timers. */
  dispose(): void {
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private buildPayload(
    webhook: WebhookConfig & { id: string },
    event: WebhookEvent,
    data: {
      collection: string;
      documentId?: string;
      document?: Record<string, unknown>;
    },
  ): WebhookPayload {
    const unsigned: Omit<WebhookPayload, 'signature'> = {
      id: generateId(),
      event,
      collection: data.collection,
      documentId: data.documentId,
      data: data.document,
      timestamp: Date.now(),
    };

    const signature = createHmac('sha256', webhook.secret)
      .update(JSON.stringify(unsigned))
      .digest('hex');

    return { ...unsigned, signature };
  }

  private async deliver(
    webhook: WebhookConfig & { id: string },
    event: WebhookEvent,
    data: {
      collection: string;
      documentId?: string;
      document?: Record<string, unknown>;
    },
  ): Promise<WebhookDelivery> {
    const payload = this.buildPayload(webhook, event, data);

    const delivery: WebhookDelivery = {
      id: generateId(),
      webhookId: webhook.id,
      payload,
      status: 'pending',
      attempts: 0,
    };

    this.deliveries.push(delivery);
    return this.attemptDelivery(webhook, delivery);
  }

  private async attemptDelivery(
    webhook: WebhookConfig & { id: string },
    delivery: WebhookDelivery,
  ): Promise<WebhookDelivery> {
    const retryPolicy = webhook.retryPolicy ?? {
      maxRetries: this.maxRetries,
      backoffMs: DEFAULT_RETRY_POLICY.backoffMs,
      backoffMultiplier: DEFAULT_RETRY_POLICY.backoffMultiplier,
    };
    const maxAttempts = retryPolicy.maxRetries + 1;

    while (delivery.attempts < maxAttempts) {
      delivery.attempts++;
      delivery.lastAttemptAt = Date.now();

      try {
        const headers: Record<string, string> = {
          'x-pocket-event': delivery.payload.event,
          'x-pocket-delivery': delivery.id,
          'x-pocket-signature': delivery.payload.signature,
        };

        const result = await this.sender(webhook.url, delivery.payload, headers);
        delivery.responseStatus = result.status;

        if (result.status >= 200 && result.status < 300) {
          delivery.status = 'delivered';
          return delivery;
        }

        // 4xx are not retryable
        if (result.status >= 400 && result.status < 500) {
          delivery.status = 'failed';
          delivery.error = `HTTP ${result.status}`;
          return delivery;
        }
      } catch (err: unknown) {
        delivery.error = err instanceof Error ? err.message : String(err);
      }

      // Retry with backoff
      if (delivery.attempts < maxAttempts) {
        delivery.status = 'retrying';
        const backoff =
          retryPolicy.backoffMs *
          Math.pow(retryPolicy.backoffMultiplier, delivery.attempts - 1);
        await this.delay(backoff);
      }
    }

    delivery.status = 'failed';
    return delivery;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        resolve();
      }, ms);
      this.pendingTimers.add(timer);
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a webhook manager.
 *
 * @param config - Optional manager configuration
 * @param sender - Optional injectable HTTP sender (useful for testing)
 *
 * @example
 * ```typescript
 * import { createWebhookNotifier } from '@pocket/sync-server';
 *
 * const manager = createWebhookNotifier();
 * ```
 */
export function createWebhookNotifier(
  config?: WebhookManagerConfig,
  sender?: WebhookSender,
): WebhookManager {
  return new WebhookManager(config, sender);
}
