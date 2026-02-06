/**
 * WebhookHandler - Outbound webhook delivery system for cloud events.
 *
 * Provides webhook endpoint registration, event dispatch with signature
 * verification, retry logic with exponential backoff, and delivery tracking.
 *
 * @module webhook-handler
 */

import { Subject, takeUntil, type Observable } from 'rxjs';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Categories of webhook events.
 */
export type WebhookEventCategory = 'sync' | 'auth' | 'billing' | 'health';

/**
 * Specific webhook event types.
 */
export type WebhookEventType =
  | 'sync.started'
  | 'sync.completed'
  | 'sync.failed'
  | 'sync.conflict'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.token_refreshed'
  | 'auth.permission_denied'
  | 'billing.subscription_created'
  | 'billing.subscription_canceled'
  | 'billing.invoice_paid'
  | 'billing.payment_failed'
  | 'health.degraded'
  | 'health.restored'
  | 'health.endpoint_down';

/**
 * Delivery status of a webhook attempt.
 */
export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'retrying';

/**
 * A registered webhook endpoint.
 *
 * @example
 * ```typescript
 * const endpoint: WebhookEndpoint = {
 *   id: 'wh_abc123',
 *   url: 'https://api.example.com/webhooks',
 *   secret: 'whsec_xxx',
 *   events: ['sync.completed', 'billing.invoice_paid'],
 *   active: true,
 *   createdAt: Date.now(),
 * };
 * ```
 *
 * @see {@link WebhookHandler.registerEndpoint}
 */
export interface WebhookEndpoint {
  /** Unique endpoint identifier */
  id: string;

  /** URL to deliver webhook payloads to */
  url: string;

  /** Secret used for HMAC-SHA256 signature verification */
  secret: string;

  /** Event types this endpoint subscribes to */
  events: WebhookEventType[];

  /** Whether the endpoint is active */
  active: boolean;

  /** Optional description */
  description?: string;

  /** When the endpoint was registered */
  createdAt: number;
}

/**
 * Input for registering a webhook endpoint.
 *
 * @see {@link WebhookHandler.registerEndpoint}
 */
export interface RegisterEndpointInput {
  /** URL to deliver webhook payloads to */
  url: string;

  /** Event types to subscribe to */
  events: WebhookEventType[];

  /** Optional description */
  description?: string;
}

/**
 * A webhook event payload.
 *
 * @see {@link WebhookHandler.dispatch}
 */
export interface WebhookEvent {
  /** Unique event identifier */
  id: string;

  /** Event type */
  type: WebhookEventType;

  /** Event payload data */
  data: Record<string, unknown>;

  /** When the event occurred */
  timestamp: number;
}

/**
 * Record of a webhook delivery attempt.
 *
 * @see {@link WebhookHandler.getDeliveryHistory}
 */
export interface DeliveryRecord {
  /** Unique delivery identifier */
  id: string;

  /** Event that was delivered */
  eventId: string;

  /** Endpoint the event was delivered to */
  endpointId: string;

  /** Delivery status */
  status: DeliveryStatus;

  /** HTTP status code of the response, or null */
  statusCode: number | null;

  /** Number of delivery attempts */
  attemptCount: number;

  /** Maximum number of retry attempts */
  maxAttempts: number;

  /** When the next retry will occur, or null */
  nextRetryAt: number | null;

  /** When the delivery was first attempted */
  createdAt: number;

  /** When the delivery was last attempted */
  lastAttemptAt: number;

  /** Error message if delivery failed */
  error: string | null;
}

/**
 * Configuration for the webhook handler.
 *
 * @example
 * ```typescript
 * const config: WebhookHandlerConfig = {
 *   maxRetries: 5,
 *   initialRetryDelayMs: 1000,
 *   maxRetryDelayMs: 300_000,
 *   timeoutMs: 30_000,
 * };
 * ```
 *
 * @see {@link WebhookHandler}
 */
export interface WebhookHandlerConfig {
  /** Maximum number of retry attempts. @default 5 */
  maxRetries?: number;

  /** Initial retry delay in ms (doubles with each attempt). @default 1000 */
  initialRetryDelayMs?: number;

  /** Maximum retry delay in ms. @default 300000 */
  maxRetryDelayMs?: number;

  /** Request timeout in ms. @default 30000 */
  timeoutMs?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

function generateSecret(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'whsec_';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Compute HMAC-SHA256 signature for a payload.
 *
 * Uses the Web Crypto API when available, otherwise falls back to
 * a hex-encoded hash of the secret + payload for environments without
 * native crypto support.
 *
 * @param payload - The payload string to sign
 * @param secret - The signing secret
 * @returns Hex-encoded HMAC-SHA256 signature
 */
async function computeSignature(payload: string, secret: string): Promise<string> {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Fallback: deterministic hash for environments without Web Crypto
  let hash = 0;
  const combined = secret + payload;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

/**
 * Verify the HMAC-SHA256 signature of a webhook payload.
 *
 * @param payload - The raw payload string
 * @param signature - The signature to verify
 * @param secret - The webhook secret
 * @returns Whether the signature is valid
 *
 * @example
 * ```typescript
 * const isValid = await verifyWebhookSignature(body, sig, 'whsec_xxx');
 * if (!isValid) throw new Error('Invalid signature');
 * ```
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const expected = await computeSignature(payload, secret);
  return expected === signature;
}

// ── WebhookHandler ───────────────────────────────────────────────────────────

/**
 * Webhook delivery system for Pocket Cloud events.
 *
 * WebhookHandler provides:
 * - Endpoint registration with auto-generated secrets
 * - Event dispatch to matching endpoints
 * - HMAC-SHA256 signature verification
 * - Retry logic with exponential backoff
 * - Delivery tracking and history
 *
 * @example Basic usage
 * ```typescript
 * import { createWebhookHandler } from '@pocket/cloud';
 *
 * const webhooks = createWebhookHandler({ maxRetries: 3 });
 *
 * // Register an endpoint
 * const endpoint = webhooks.registerEndpoint({
 *   url: 'https://api.example.com/webhooks',
 *   events: ['sync.completed', 'billing.invoice_paid'],
 * });
 *
 * // Dispatch an event
 * await webhooks.dispatch('sync.completed', {
 *   projectId: 'proj_abc123',
 *   documentCount: 42,
 * });
 *
 * // Check delivery history
 * const history = webhooks.getDeliveryHistory(endpoint.id);
 *
 * webhooks.destroy();
 * ```
 *
 * @see {@link createWebhookHandler}
 * @see {@link WebhookHandlerConfig}
 */
export class WebhookHandler {
  private readonly config: Required<WebhookHandlerConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly deliveries$ = new Subject<DeliveryRecord>();

  private readonly endpoints = new Map<string, WebhookEndpoint>();
  private readonly deliveryRecords: DeliveryRecord[] = [];
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(config: WebhookHandlerConfig = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 5,
      initialRetryDelayMs: config.initialRetryDelayMs ?? 1_000,
      maxRetryDelayMs: config.maxRetryDelayMs ?? 300_000,
      timeoutMs: config.timeoutMs ?? 30_000,
    };
  }

  // ── Endpoint Management ────────────────────────────────────────────────

  /**
   * Register a new webhook endpoint.
   *
   * Generates a unique signing secret for the endpoint that is used
   * to sign all delivered payloads with HMAC-SHA256.
   *
   * @param input - Endpoint registration input
   * @returns The registered endpoint with generated secret
   *
   * @example
   * ```typescript
   * const endpoint = webhooks.registerEndpoint({
   *   url: 'https://api.example.com/webhooks',
   *   events: ['sync.completed', 'health.degraded'],
   *   description: 'Production webhook',
   * });
   * console.log('Signing secret:', endpoint.secret);
   * ```
   */
  registerEndpoint(input: RegisterEndpointInput): WebhookEndpoint {
    const endpoint: WebhookEndpoint = {
      id: generateId('wh'),
      url: input.url,
      secret: generateSecret(),
      events: [...input.events],
      active: true,
      description: input.description,
      createdAt: Date.now(),
    };

    this.endpoints.set(endpoint.id, endpoint);
    return endpoint;
  }

  /**
   * Unregister a webhook endpoint.
   *
   * @param endpointId - The endpoint to unregister
   * @returns Whether the endpoint was found and removed
   *
   * @example
   * ```typescript
   * webhooks.unregisterEndpoint('wh_abc123');
   * ```
   */
  unregisterEndpoint(endpointId: string): boolean {
    return this.endpoints.delete(endpointId);
  }

  /**
   * Enable or disable a webhook endpoint.
   *
   * @param endpointId - The endpoint identifier
   * @param active - Whether the endpoint should be active
   * @returns The updated endpoint or null if not found
   */
  setEndpointActive(endpointId: string, active: boolean): WebhookEndpoint | null {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) return null;

    endpoint.active = active;
    return { ...endpoint };
  }

  /**
   * Get a registered endpoint by ID.
   *
   * @param endpointId - The endpoint identifier
   * @returns The endpoint or null if not found
   */
  getEndpoint(endpointId: string): WebhookEndpoint | null {
    const endpoint = this.endpoints.get(endpointId);
    return endpoint ? { ...endpoint } : null;
  }

  /**
   * List all registered webhook endpoints.
   *
   * @returns Array of registered endpoints
   *
   * @example
   * ```typescript
   * const endpoints = webhooks.listEndpoints();
   * ```
   */
  listEndpoints(): WebhookEndpoint[] {
    return Array.from(this.endpoints.values()).map((ep) => ({ ...ep }));
  }

  // ── Event Dispatch ─────────────────────────────────────────────────────

  /**
   * Dispatch an event to all matching active endpoints.
   *
   * Delivers the event payload to each endpoint subscribed to the event type.
   * Failed deliveries are automatically retried with exponential backoff.
   *
   * @param eventType - The webhook event type
   * @param data - The event payload data
   * @returns Array of delivery records for each targeted endpoint
   *
   * @example
   * ```typescript
   * const deliveries = await webhooks.dispatch('sync.completed', {
   *   projectId: 'proj_abc123',
   *   documentCount: 42,
   * });
   * ```
   */
  async dispatch(
    eventType: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<DeliveryRecord[]> {
    const event: WebhookEvent = {
      id: generateId('evt'),
      type: eventType,
      data,
      timestamp: Date.now(),
    };

    const matchingEndpoints = Array.from(this.endpoints.values()).filter(
      (ep) => ep.active && ep.events.includes(eventType),
    );

    const deliveries: DeliveryRecord[] = [];

    for (const endpoint of matchingEndpoints) {
      const delivery = await this.deliverToEndpoint(event, endpoint);
      deliveries.push(delivery);
    }

    return deliveries;
  }

  // ── Delivery Tracking ──────────────────────────────────────────────────

  /**
   * Get delivery history for an endpoint.
   *
   * @param endpointId - The endpoint identifier
   * @returns Array of delivery records for the endpoint
   *
   * @example
   * ```typescript
   * const history = webhooks.getDeliveryHistory('wh_abc123');
   * const failed = history.filter(d => d.status === 'failed');
   * ```
   */
  getDeliveryHistory(endpointId: string): DeliveryRecord[] {
    return this.deliveryRecords
      .filter((d) => d.endpointId === endpointId)
      .map((d) => ({ ...d }));
  }

  /**
   * Get all delivery records.
   *
   * @returns Array of all delivery records
   */
  getAllDeliveries(): DeliveryRecord[] {
    return this.deliveryRecords.map((d) => ({ ...d }));
  }

  /**
   * Get an observable stream of delivery events.
   *
   * @returns Observable that emits delivery records as they are created/updated
   *
   * @example
   * ```typescript
   * webhooks.getDeliveries$().subscribe(delivery => {
   *   console.log(`Delivery ${delivery.id}: ${delivery.status}`);
   * });
   * ```
   */
  getDeliveries$(): Observable<DeliveryRecord> {
    return this.deliveries$.asObservable().pipe(takeUntil(this.destroy$));
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  /**
   * Permanently destroy the webhook handler and release all resources.
   *
   * Cancels all pending retries and completes all observables.
   * After calling destroy(), the handler cannot be reused.
   *
   * @example
   * ```typescript
   * webhooks.destroy();
   * ```
   */
  destroy(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.destroy$.next();
    this.destroy$.complete();
    this.deliveries$.complete();
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private async deliverToEndpoint(
    event: WebhookEvent,
    endpoint: WebhookEndpoint,
  ): Promise<DeliveryRecord> {
    const delivery: DeliveryRecord = {
      id: generateId('dlv'),
      eventId: event.id,
      endpointId: endpoint.id,
      status: 'pending',
      statusCode: null,
      attemptCount: 0,
      maxAttempts: this.config.maxRetries + 1,
      nextRetryAt: null,
      createdAt: Date.now(),
      lastAttemptAt: Date.now(),
      error: null,
    };

    this.deliveryRecords.push(delivery);
    await this.attemptDelivery(delivery, event, endpoint);
    return delivery;
  }

  private async attemptDelivery(
    delivery: DeliveryRecord,
    event: WebhookEvent,
    endpoint: WebhookEndpoint,
  ): Promise<void> {
    delivery.attemptCount++;
    delivery.lastAttemptAt = Date.now();

    const payload = JSON.stringify(event);
    const signature = await computeSignature(payload, endpoint.secret);

    try {
      const response = await globalThis.fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pocket-Signature': signature,
          'X-Pocket-Event': event.type,
          'X-Pocket-Delivery': delivery.id,
        },
        body: payload,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      delivery.statusCode = response.status;

      if (response.ok) {
        delivery.status = 'delivered';
        delivery.error = null;
      } else {
        delivery.error = `HTTP ${response.status} ${response.statusText}`;
        this.scheduleRetry(delivery, event, endpoint);
      }
    } catch (error) {
      delivery.error = error instanceof Error ? error.message : String(error);
      this.scheduleRetry(delivery, event, endpoint);
    }

    this.deliveries$.next({ ...delivery });
  }

  private scheduleRetry(
    delivery: DeliveryRecord,
    event: WebhookEvent,
    endpoint: WebhookEndpoint,
  ): void {
    if (delivery.attemptCount >= delivery.maxAttempts) {
      delivery.status = 'failed';
      delivery.nextRetryAt = null;
      return;
    }

    delivery.status = 'retrying';
    const delayMs = Math.min(
      this.config.initialRetryDelayMs * Math.pow(2, delivery.attemptCount - 1),
      this.config.maxRetryDelayMs,
    );
    delivery.nextRetryAt = Date.now() + delayMs;

    const timer = setTimeout(() => {
      this.retryTimers.delete(delivery.id);
      void this.attemptDelivery(delivery, event, endpoint);
    }, delayMs);

    this.retryTimers.set(delivery.id, timer);
  }
}

/**
 * Create a webhook handler instance.
 *
 * Factory function that creates a configured {@link WebhookHandler}.
 *
 * @param config - Optional webhook handler configuration
 * @returns A new WebhookHandler instance
 *
 * @example
 * ```typescript
 * import { createWebhookHandler } from '@pocket/cloud';
 *
 * const webhooks = createWebhookHandler({ maxRetries: 3 });
 *
 * const endpoint = webhooks.registerEndpoint({
 *   url: 'https://api.example.com/webhooks',
 *   events: ['sync.completed'],
 * });
 * ```
 *
 * @see {@link WebhookHandler}
 * @see {@link WebhookHandlerConfig}
 */
export function createWebhookHandler(config?: WebhookHandlerConfig): WebhookHandler {
  return new WebhookHandler(config);
}
