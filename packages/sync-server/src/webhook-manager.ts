/**
 * Webhook Manager for Pocket Sync Server
 *
 * Delivers sync events to external HTTP endpoints with HMAC signature
 * verification, automatic retries, and delivery history tracking.
 *
 * @module @pocket/sync-server
 */

import { createHmac } from 'crypto';

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Webhook event types emitted by the sync server
 */
export type WebhookEventType =
  | 'sync.push'
  | 'sync.pull'
  | 'sync.conflict'
  | 'client.connected'
  | 'client.disconnected'
  | 'collection.created'
  | 'collection.updated'
  | 'error.sync'
  | 'error.auth';

/**
 * Webhook registration configuration
 */
export interface WebhookConfig {
  /** Unique webhook identifier */
  id: string;
  /** Destination URL for event delivery */
  url: string;
  /** Event types this webhook subscribes to */
  events: WebhookEventType[];
  /** Secret for HMAC-SHA256 signature verification */
  secret?: string;
  /** Whether the webhook is active */
  enabled: boolean;
  /** Retry policy for failed deliveries */
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
    maxBackoffMs: number;
  };
  /** Additional headers to include in webhook requests */
  headers?: Record<string, string>;
  /** Filter events by collection or client */
  filter?: {
    collections?: string[];
    clientIds?: string[];
  };
}

/**
 * Record of a single webhook delivery attempt
 */
export interface WebhookDelivery {
  /** Unique delivery identifier */
  id: string;
  /** Associated webhook ID */
  webhookId: string;
  /** Event type that triggered this delivery */
  event: WebhookEventType;
  /** Event payload */
  payload: Record<string, unknown>;
  /** Current delivery status */
  status: 'pending' | 'delivered' | 'failed' | 'retrying';
  /** Number of delivery attempts */
  attempts: number;
  /** Timestamp of the last delivery attempt */
  lastAttemptAt?: number;
  /** HTTP response status from the last attempt */
  responseStatus?: number;
  /** Timestamp when the delivery was created */
  createdAt: number;
}

/**
 * Default retry policy for webhook deliveries
 */
const DEFAULT_RETRY_POLICY = {
  maxRetries: 3,
  backoffMs: 1000,
  maxBackoffMs: 30000,
};

/**
 * Maximum number of delivery records to retain
 */
const MAX_DELIVERY_HISTORY = 1000;

/**
 * Webhook manager for the Pocket sync server
 *
 * Manages webhook registrations, delivers events to registered endpoints,
 * and tracks delivery history with automatic retries.
 *
 * @example
 * ```typescript
 * import { createWebhookManager } from '@pocket/sync-server';
 *
 * const manager = createWebhookManager();
 *
 * // Register a webhook
 * const webhook = manager.registerWebhook({
 *   url: 'https://example.com/hooks/sync',
 *   events: ['sync.push', 'sync.conflict'],
 *   secret: 'my-secret',
 *   enabled: true,
 * });
 *
 * // Emit an event
 * await manager.emit('sync.push', {
 *   collection: 'todos',
 *   changes: 5,
 * });
 *
 * // Clean up
 * manager.dispose();
 * ```
 */
export class WebhookManager {
  private readonly webhooks = new Map<string, WebhookConfig>();
  private readonly deliveries: WebhookDelivery[] = [];
  private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * Register a new webhook
   *
   * @returns The registered webhook configuration including the generated ID
   */
  registerWebhook(config: Omit<WebhookConfig, 'id'>): WebhookConfig {
    const webhook: WebhookConfig = {
      ...config,
      id: generateId(),
      retryPolicy: config.retryPolicy ?? DEFAULT_RETRY_POLICY,
    };

    this.webhooks.set(webhook.id, webhook);
    return webhook;
  }

  /**
   * Remove a registered webhook
   *
   * @returns `true` if the webhook was found and removed
   */
  removeWebhook(id: string): boolean {
    return this.webhooks.delete(id);
  }

  /**
   * Get all registered webhooks
   */
  getWebhooks(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  /**
   * Emit an event to all matching webhooks
   *
   * Delivers the payload to every enabled webhook that subscribes to the given
   * event type and passes any configured filters.
   *
   * @returns Delivery records for each webhook that received the event
   */
  async emit(
    event: WebhookEventType,
    payload: Record<string, unknown>
  ): Promise<WebhookDelivery[]> {
    const deliveries: WebhookDelivery[] = [];

    for (const webhook of this.webhooks.values()) {
      if (!webhook.enabled) continue;
      if (!webhook.events.includes(event)) continue;

      // Apply filters
      if (webhook.filter) {
        const collection = payload.collection as string | undefined;
        const clientId = payload.clientId as string | undefined;

        if (
          webhook.filter.collections &&
          collection &&
          !webhook.filter.collections.includes(collection)
        ) {
          continue;
        }

        if (webhook.filter.clientIds && clientId && !webhook.filter.clientIds.includes(clientId)) {
          continue;
        }
      }

      const delivery: WebhookDelivery = {
        id: generateId(),
        webhookId: webhook.id,
        event,
        payload,
        status: 'pending',
        attempts: 0,
        createdAt: Date.now(),
      };

      this.deliveries.push(delivery);
      this.trimDeliveryHistory();

      const result = await this.deliverWithRetry(webhook, delivery);
      deliveries.push(result);
    }

    return deliveries;
  }

  /**
   * Get delivery history, optionally filtered by webhook ID
   */
  getDeliveryHistory(webhookId?: string): WebhookDelivery[] {
    if (webhookId) {
      return this.deliveries.filter((d) => d.webhookId === webhookId);
    }
    return [...this.deliveries];
  }

  /**
   * Retry a specific failed delivery
   *
   * @returns The updated delivery record
   */
  async retry(deliveryId: string): Promise<WebhookDelivery> {
    const delivery = this.deliveries.find((d) => d.id === deliveryId);
    if (!delivery) {
      throw new Error(`Delivery ${deliveryId} not found`);
    }

    const webhook = this.webhooks.get(delivery.webhookId);
    if (!webhook) {
      throw new Error(`Webhook ${delivery.webhookId} not found`);
    }

    delivery.status = 'retrying';
    return this.deliverWithRetry(webhook, delivery);
  }

  /**
   * Sign a payload string with HMAC-SHA256
   */
  private signPayload(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Deliver a webhook with retry logic
   */
  private async deliverWithRetry(
    webhook: WebhookConfig,
    delivery: WebhookDelivery
  ): Promise<WebhookDelivery> {
    const retryPolicy = webhook.retryPolicy ?? DEFAULT_RETRY_POLICY;
    const maxAttempts = retryPolicy.maxRetries + 1;

    while (delivery.attempts < maxAttempts) {
      delivery.attempts++;
      delivery.lastAttemptAt = Date.now();

      try {
        const bodyString = JSON.stringify({
          id: delivery.id,
          event: delivery.event,
          payload: delivery.payload,
          timestamp: Date.now(),
        });

        const headers: Record<string, string> = {
          'content-type': 'application/json',
          'x-pocket-event': delivery.event,
          'x-pocket-delivery': delivery.id,
          ...webhook.headers,
        };

        if (webhook.secret) {
          headers['x-pocket-signature'] = this.signPayload(bodyString, webhook.secret);
        }

        const response = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body: bodyString,
        });

        delivery.responseStatus = response.status;

        if (response.ok) {
          delivery.status = 'delivered';
          return delivery;
        }

        // Non-retryable status codes
        if (response.status >= 400 && response.status < 500) {
          delivery.status = 'failed';
          return delivery;
        }
      } catch {
        // Network error — will retry if attempts remain
      }

      // Wait before retrying
      if (delivery.attempts < maxAttempts) {
        delivery.status = 'retrying';
        const backoff = Math.min(
          retryPolicy.backoffMs * Math.pow(2, delivery.attempts - 1),
          retryPolicy.maxBackoffMs
        );
        await this.delay(backoff);
      }
    }

    delivery.status = 'failed';
    return delivery;
  }

  /**
   * Delay execution for the given number of milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        resolve();
      }, ms);
      this.pendingTimers.add(timer);
    });
  }

  /**
   * Trim delivery history to the maximum size
   */
  private trimDeliveryHistory(): void {
    if (this.deliveries.length > MAX_DELIVERY_HISTORY) {
      this.deliveries.splice(0, this.deliveries.length - MAX_DELIVERY_HISTORY);
    }
  }

  /**
   * Dispose of the webhook manager and cancel pending timers
   */
  dispose(): void {
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }
}

/**
 * Create a webhook manager
 *
 * @example
 * ```typescript
 * import { createWebhookManager } from '@pocket/sync-server';
 *
 * const manager = createWebhookManager();
 *
 * manager.registerWebhook({
 *   url: 'https://example.com/hooks',
 *   events: ['sync.push'],
 *   enabled: true,
 * });
 * ```
 */
export function createWebhookManager(): WebhookManager {
  return new WebhookManager();
}
