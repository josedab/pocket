/**
 * BillingManager - Stripe-based billing and subscription management.
 *
 * Handles subscription lifecycle, usage-based metering, invoice generation,
 * payment method management, and webhook event processing for Pocket Cloud.
 *
 * @module billing
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';
import type { CloudTier } from './types.js';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Subscription status lifecycle states.
 */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';

/**
 * Billing interval for subscriptions.
 */
export type BillingInterval = 'monthly' | 'yearly';

/**
 * Supported payment method types.
 */
export type PaymentMethodType = 'card' | 'bank_account' | 'invoice';

/**
 * Invoice status.
 */
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

/**
 * Type of billing event received via webhook.
 */
export type BillingEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'payment_method.attached'
  | 'payment_method.detached'
  | 'trial.ending'
  | 'usage.threshold_reached';

/**
 * A subscription record.
 *
 * @example
 * ```typescript
 * const sub: Subscription = {
 *   id: 'sub_abc123',
 *   tenantId: 'tenant-a',
 *   tier: 'pro',
 *   status: 'active',
 *   billingInterval: 'monthly',
 *   currentPeriodStart: Date.now(),
 *   currentPeriodEnd: Date.now() + 30 * 86_400_000,
 *   cancelAtPeriodEnd: false,
 *   trialEnd: null,
 *   createdAt: Date.now(),
 *   updatedAt: Date.now(),
 * };
 * ```
 *
 * @see {@link BillingManager.createSubscription}
 */
export interface Subscription {
  /** Unique subscription identifier */
  id: string;

  /** Tenant that owns this subscription */
  tenantId: string;

  /** Associated cloud tier */
  tier: CloudTier;

  /** Current subscription status */
  status: SubscriptionStatus;

  /** Billing interval */
  billingInterval: BillingInterval;

  /** Start of the current billing period */
  currentPeriodStart: number;

  /** End of the current billing period */
  currentPeriodEnd: number;

  /** Whether the subscription will cancel at the end of the current period */
  cancelAtPeriodEnd: boolean;

  /** Trial end timestamp, or null if no trial */
  trialEnd: number | null;

  /** When the subscription was created */
  createdAt: number;

  /** When the subscription was last updated */
  updatedAt: number;
}

/**
 * Input for creating a subscription.
 *
 * @see {@link BillingManager.createSubscription}
 */
export interface CreateSubscriptionInput {
  /** Tenant identifier */
  tenantId: string;

  /** Desired cloud tier */
  tier: CloudTier;

  /** Billing interval. @default 'monthly' */
  billingInterval?: BillingInterval;

  /** Trial period in days. @default 0 */
  trialDays?: number;

  /** Payment method ID to use */
  paymentMethodId?: string;
}

/**
 * A usage metering record.
 *
 * @see {@link BillingManager.recordUsage}
 */
export interface UsageRecord {
  /** Unique usage record identifier */
  id: string;

  /** Subscription this usage belongs to */
  subscriptionId: string;

  /** Metric name (e.g. 'sync_operations', 'storage_bytes') */
  metric: string;

  /** Quantity consumed */
  quantity: number;

  /** Timestamp of the usage event */
  timestamp: number;
}

/**
 * Aggregated usage summary for a subscription metric.
 *
 * @see {@link BillingManager.getUsageSummary}
 */
export interface UsageSummary {
  /** Metric name */
  metric: string;

  /** Total quantity in the period */
  totalQuantity: number;

  /** Number of individual usage records */
  recordCount: number;

  /** Period start timestamp */
  periodStart: number;

  /** Period end timestamp */
  periodEnd: number;
}

/**
 * An invoice record.
 *
 * @see {@link BillingManager.getInvoices}
 */
export interface Invoice {
  /** Unique invoice identifier */
  id: string;

  /** Subscription associated with this invoice */
  subscriptionId: string;

  /** Tenant identifier */
  tenantId: string;

  /** Invoice status */
  status: InvoiceStatus;

  /** Total amount in cents */
  amountCents: number;

  /** Currency code */
  currency: string;

  /** Invoice line items */
  lineItems: InvoiceLineItem[];

  /** Period start */
  periodStart: number;

  /** Period end */
  periodEnd: number;

  /** When the invoice was created */
  createdAt: number;

  /** When the invoice was paid, or null */
  paidAt: number | null;
}

/**
 * A single line item on an invoice.
 */
export interface InvoiceLineItem {
  /** Description of the line item */
  description: string;

  /** Quantity */
  quantity: number;

  /** Unit price in cents */
  unitPriceCents: number;

  /** Total amount in cents */
  amountCents: number;
}

/**
 * A stored payment method.
 *
 * @see {@link BillingManager.addPaymentMethod}
 */
export interface PaymentMethod {
  /** Unique payment method identifier */
  id: string;

  /** Tenant identifier */
  tenantId: string;

  /** Payment method type */
  type: PaymentMethodType;

  /** Whether this is the default payment method */
  isDefault: boolean;

  /** Last four digits (card) or account number */
  last4: string;

  /** Expiration month (card only) */
  expiryMonth: number | null;

  /** Expiration year (card only) */
  expiryYear: number | null;

  /** When the payment method was added */
  createdAt: number;
}

/**
 * Input for adding a payment method.
 *
 * @see {@link BillingManager.addPaymentMethod}
 */
export interface AddPaymentMethodInput {
  /** Tenant identifier */
  tenantId: string;

  /** Payment method type */
  type: PaymentMethodType;

  /** Token from payment processor (e.g. Stripe token) */
  token: string;

  /** Set as default payment method. @default false */
  setDefault?: boolean;
}

/**
 * A billing event from the webhook system.
 *
 * @see {@link BillingManager.handleWebhookEvent}
 */
export interface BillingEvent {
  /** Unique event identifier */
  id: string;

  /** Event type */
  type: BillingEventType;

  /** Tenant identifier */
  tenantId: string;

  /** Event payload data */
  data: Record<string, unknown>;

  /** When the event occurred */
  timestamp: number;
}

/**
 * Configuration for the billing manager.
 *
 * @example
 * ```typescript
 * const config: BillingConfig = {
 *   stripeSecretKey: 'sk_test_xxx',
 *   webhookSecret: 'whsec_xxx',
 *   defaultCurrency: 'usd',
 *   defaultTrialDays: 14,
 * };
 * ```
 *
 * @see {@link BillingManager}
 */
export interface BillingConfig {
  /** Stripe secret API key */
  stripeSecretKey: string;

  /** Stripe webhook signing secret */
  webhookSecret: string;

  /** Default currency code. @default 'usd' */
  defaultCurrency?: string;

  /** Default trial period in days. @default 14 */
  defaultTrialDays?: number;
}

/**
 * Tier pricing in cents per billing interval.
 */
export const TIER_PRICING: Record<CloudTier, Record<BillingInterval, number>> = {
  free: { monthly: 0, yearly: 0 },
  pro: { monthly: 2_999, yearly: 29_990 },
  enterprise: { monthly: 9_999, yearly: 99_990 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

// ── BillingManager ───────────────────────────────────────────────────────────

/**
 * Stripe-based billing and subscription management for Pocket Cloud.
 *
 * BillingManager provides:
 * - Subscription lifecycle (create, upgrade, downgrade, cancel)
 * - Usage-based metering with aggregation
 * - Invoice generation and history
 * - Payment method management
 * - Webhook event handling
 * - Trial period management
 *
 * @example Basic usage
 * ```typescript
 * import { createBillingManager } from '@pocket/cloud';
 *
 * const billing = createBillingManager({
 *   stripeSecretKey: 'sk_test_xxx',
 *   webhookSecret: 'whsec_xxx',
 * });
 *
 * // Create a subscription with a trial
 * const sub = billing.createSubscription({
 *   tenantId: 'tenant-a',
 *   tier: 'pro',
 *   trialDays: 14,
 * });
 *
 * // Record usage
 * billing.recordUsage(sub.id, 'sync_operations', 150);
 *
 * // Generate invoice
 * const invoice = billing.generateInvoice(sub.id);
 *
 * billing.destroy();
 * ```
 *
 * @see {@link createBillingManager}
 * @see {@link BillingConfig}
 */
export class BillingManager {
  private readonly config: Required<BillingConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly events$ = new Subject<BillingEvent>();
  private readonly subscriptions$ = new BehaviorSubject<Map<string, Subscription>>(new Map());

  private readonly subscriptions = new Map<string, Subscription>();
  private readonly usageRecords = new Map<string, UsageRecord[]>();
  private readonly invoices = new Map<string, Invoice[]>();
  private readonly paymentMethods = new Map<string, PaymentMethod[]>();

  constructor(config: BillingConfig) {
    this.config = {
      stripeSecretKey: config.stripeSecretKey,
      webhookSecret: config.webhookSecret,
      defaultCurrency: config.defaultCurrency ?? 'usd',
      defaultTrialDays: config.defaultTrialDays ?? 14,
    };
  }

  // ── Subscription Lifecycle ─────────────────────────────────────────────

  /**
   * Create a new subscription for a tenant.
   *
   * @param input - Subscription creation input
   * @returns The created subscription
   *
   * @example
   * ```typescript
   * const sub = billing.createSubscription({
   *   tenantId: 'tenant-a',
   *   tier: 'pro',
   *   billingInterval: 'monthly',
   *   trialDays: 14,
   * });
   * ```
   */
  createSubscription(input: CreateSubscriptionInput): Subscription {
    const now = Date.now();
    const trialDays = input.trialDays ?? 0;
    const billingInterval = input.billingInterval ?? 'monthly';
    const periodMs = billingInterval === 'monthly' ? 30 * 86_400_000 : 365 * 86_400_000;

    const subscription: Subscription = {
      id: generateId('sub'),
      tenantId: input.tenantId,
      tier: input.tier,
      status: trialDays > 0 ? 'trialing' : 'active',
      billingInterval,
      currentPeriodStart: now,
      currentPeriodEnd: now + periodMs,
      cancelAtPeriodEnd: false,
      trialEnd: trialDays > 0 ? now + trialDays * 86_400_000 : null,
      createdAt: now,
      updatedAt: now,
    };

    this.subscriptions.set(subscription.id, subscription);
    this.publishSubscriptions();
    this.emitEvent('subscription.created', subscription.tenantId, { subscriptionId: subscription.id, tier: subscription.tier });

    return subscription;
  }

  /**
   * Upgrade or downgrade a subscription to a different tier.
   *
   * @param subscriptionId - The subscription to change
   * @param newTier - The target tier
   * @returns The updated subscription
   * @throws Error if subscription not found
   *
   * @example
   * ```typescript
   * const updated = billing.changeTier('sub_abc123', 'enterprise');
   * ```
   */
  changeTier(subscriptionId: string, newTier: CloudTier): Subscription {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    const previousTier = sub.tier;
    sub.tier = newTier;
    sub.updatedAt = Date.now();
    this.publishSubscriptions();
    this.emitEvent('subscription.updated', sub.tenantId, { subscriptionId, previousTier, newTier });

    return { ...sub };
  }

  /**
   * Cancel a subscription. By default cancels at the end of the current period.
   *
   * @param subscriptionId - The subscription to cancel
   * @param immediate - Whether to cancel immediately. @default false
   * @returns The updated subscription
   * @throws Error if subscription not found
   *
   * @example
   * ```typescript
   * // Cancel at period end
   * billing.cancelSubscription('sub_abc123');
   *
   * // Cancel immediately
   * billing.cancelSubscription('sub_abc123', true);
   * ```
   */
  cancelSubscription(subscriptionId: string, immediate = false): Subscription {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    if (immediate) {
      sub.status = 'canceled';
      sub.cancelAtPeriodEnd = false;
    } else {
      sub.cancelAtPeriodEnd = true;
    }
    sub.updatedAt = Date.now();

    this.publishSubscriptions();
    this.emitEvent('subscription.canceled', sub.tenantId, { subscriptionId, immediate });

    return { ...sub };
  }

  /**
   * Get a subscription by ID.
   *
   * @param subscriptionId - The subscription identifier
   * @returns The subscription or null if not found
   */
  getSubscription(subscriptionId: string): Subscription | null {
    const sub = this.subscriptions.get(subscriptionId);
    return sub ? { ...sub } : null;
  }

  /**
   * Get all subscriptions for a tenant.
   *
   * @param tenantId - The tenant identifier
   * @returns Array of subscriptions for the tenant
   *
   * @example
   * ```typescript
   * const subs = billing.getSubscriptionsByTenant('tenant-a');
   * ```
   */
  getSubscriptionsByTenant(tenantId: string): Subscription[] {
    return Array.from(this.subscriptions.values())
      .filter((s) => s.tenantId === tenantId)
      .map((s) => ({ ...s }));
  }

  // ── Usage Metering ─────────────────────────────────────────────────────

  /**
   * Record a usage event for metered billing.
   *
   * @param subscriptionId - The subscription to record usage for
   * @param metric - The metric name (e.g. 'sync_operations')
   * @param quantity - The quantity consumed
   * @returns The created usage record
   * @throws Error if subscription not found
   *
   * @example
   * ```typescript
   * billing.recordUsage('sub_abc123', 'sync_operations', 150);
   * billing.recordUsage('sub_abc123', 'storage_bytes', 1024 * 1024);
   * ```
   */
  recordUsage(subscriptionId: string, metric: string, quantity: number): UsageRecord {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    const record: UsageRecord = {
      id: generateId('usage'),
      subscriptionId,
      metric,
      quantity,
      timestamp: Date.now(),
    };

    const records = this.usageRecords.get(subscriptionId) ?? [];
    records.push(record);
    this.usageRecords.set(subscriptionId, records);

    return record;
  }

  /**
   * Get aggregated usage summary for a subscription.
   *
   * @param subscriptionId - The subscription identifier
   * @param periodStart - Start of the period to summarize
   * @param periodEnd - End of the period to summarize
   * @returns Array of usage summaries per metric
   *
   * @example
   * ```typescript
   * const summaries = billing.getUsageSummary(
   *   'sub_abc123',
   *   Date.now() - 30 * 86_400_000,
   *   Date.now(),
   * );
   * ```
   */
  getUsageSummary(subscriptionId: string, periodStart: number, periodEnd: number): UsageSummary[] {
    const records = (this.usageRecords.get(subscriptionId) ?? []).filter(
      (r) => r.timestamp >= periodStart && r.timestamp <= periodEnd,
    );

    const grouped = new Map<string, { total: number; count: number }>();
    for (const record of records) {
      const existing = grouped.get(record.metric) ?? { total: 0, count: 0 };
      existing.total += record.quantity;
      existing.count++;
      grouped.set(record.metric, existing);
    }

    return Array.from(grouped.entries()).map(([metric, data]) => ({
      metric,
      totalQuantity: data.total,
      recordCount: data.count,
      periodStart,
      periodEnd,
    }));
  }

  // ── Invoices ───────────────────────────────────────────────────────────

  /**
   * Generate an invoice for the current billing period.
   *
   * @param subscriptionId - The subscription to generate an invoice for
   * @returns The generated invoice
   * @throws Error if subscription not found
   *
   * @example
   * ```typescript
   * const invoice = billing.generateInvoice('sub_abc123');
   * console.log(`Invoice total: $${invoice.amountCents / 100}`);
   * ```
   */
  generateInvoice(subscriptionId: string): Invoice {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    const lineItems: InvoiceLineItem[] = [];

    // Base subscription fee
    const basePrice = TIER_PRICING[sub.tier][sub.billingInterval];
    if (basePrice > 0) {
      lineItems.push({
        description: `Pocket Cloud ${sub.tier} plan (${sub.billingInterval})`,
        quantity: 1,
        unitPriceCents: basePrice,
        amountCents: basePrice,
      });
    }

    // Usage-based line items
    const usageSummaries = this.getUsageSummary(subscriptionId, sub.currentPeriodStart, sub.currentPeriodEnd);
    for (const summary of usageSummaries) {
      const overage = this.calculateOverage(sub.tier, summary);
      if (overage > 0) {
        lineItems.push({
          description: `${summary.metric} overage (${summary.totalQuantity} units)`,
          quantity: overage,
          unitPriceCents: 1,
          amountCents: overage,
        });
      }
    }

    const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);

    const invoice: Invoice = {
      id: generateId('inv'),
      subscriptionId,
      tenantId: sub.tenantId,
      status: totalCents > 0 ? 'open' : 'paid',
      amountCents: totalCents,
      currency: this.config.defaultCurrency,
      lineItems,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      createdAt: Date.now(),
      paidAt: totalCents === 0 ? Date.now() : null,
    };

    const existing = this.invoices.get(subscriptionId) ?? [];
    existing.push(invoice);
    this.invoices.set(subscriptionId, existing);

    return invoice;
  }

  /**
   * Get invoice history for a subscription.
   *
   * @param subscriptionId - The subscription identifier
   * @returns Array of invoices
   *
   * @example
   * ```typescript
   * const invoices = billing.getInvoices('sub_abc123');
   * ```
   */
  getInvoices(subscriptionId: string): Invoice[] {
    return (this.invoices.get(subscriptionId) ?? []).map((inv) => ({ ...inv }));
  }

  /**
   * Mark an invoice as paid.
   *
   * @param invoiceId - The invoice identifier
   * @param subscriptionId - The subscription identifier
   * @returns The updated invoice or null if not found
   *
   * @example
   * ```typescript
   * billing.markInvoicePaid('inv_abc123', 'sub_abc123');
   * ```
   */
  markInvoicePaid(invoiceId: string, subscriptionId: string): Invoice | null {
    const invoiceList = this.invoices.get(subscriptionId);
    if (!invoiceList) return null;

    const invoice = invoiceList.find((inv) => inv.id === invoiceId);
    if (!invoice) return null;

    invoice.status = 'paid';
    invoice.paidAt = Date.now();

    this.emitEvent('invoice.paid', invoice.tenantId, { invoiceId, amountCents: invoice.amountCents });

    return { ...invoice };
  }

  // ── Payment Methods ────────────────────────────────────────────────────

  /**
   * Add a payment method for a tenant.
   *
   * @param input - Payment method input
   * @returns The created payment method
   *
   * @example
   * ```typescript
   * const pm = billing.addPaymentMethod({
   *   tenantId: 'tenant-a',
   *   type: 'card',
   *   token: 'tok_visa',
   *   setDefault: true,
   * });
   * ```
   */
  addPaymentMethod(input: AddPaymentMethodInput): PaymentMethod {
    const methods = this.paymentMethods.get(input.tenantId) ?? [];

    if (input.setDefault) {
      for (const m of methods) {
        m.isDefault = false;
      }
    }

    const method: PaymentMethod = {
      id: generateId('pm'),
      tenantId: input.tenantId,
      type: input.type,
      isDefault: input.setDefault ?? methods.length === 0,
      last4: input.token.slice(-4),
      expiryMonth: input.type === 'card' ? 12 : null,
      expiryYear: input.type === 'card' ? new Date().getFullYear() + 3 : null,
      createdAt: Date.now(),
    };

    methods.push(method);
    this.paymentMethods.set(input.tenantId, methods);

    this.emitEvent('payment_method.attached', input.tenantId, { paymentMethodId: method.id, type: method.type });

    return method;
  }

  /**
   * Remove a payment method.
   *
   * @param tenantId - The tenant identifier
   * @param paymentMethodId - The payment method to remove
   * @returns Whether the payment method was removed
   *
   * @example
   * ```typescript
   * billing.removePaymentMethod('tenant-a', 'pm_abc123');
   * ```
   */
  removePaymentMethod(tenantId: string, paymentMethodId: string): boolean {
    const methods = this.paymentMethods.get(tenantId);
    if (!methods) return false;

    const index = methods.findIndex((m) => m.id === paymentMethodId);
    if (index === -1) return false;

    methods.splice(index, 1);

    this.emitEvent('payment_method.detached', tenantId, { paymentMethodId });

    return true;
  }

  /**
   * Get all payment methods for a tenant.
   *
   * @param tenantId - The tenant identifier
   * @returns Array of payment methods
   *
   * @example
   * ```typescript
   * const methods = billing.getPaymentMethods('tenant-a');
   * ```
   */
  getPaymentMethods(tenantId: string): PaymentMethod[] {
    return (this.paymentMethods.get(tenantId) ?? []).map((m) => ({ ...m }));
  }

  // ── Webhook Events ─────────────────────────────────────────────────────

  /**
   * Handle a webhook event from the payment processor.
   *
   * @param eventType - The type of billing event
   * @param payload - The event payload
   * @returns The processed billing event
   *
   * @example
   * ```typescript
   * const event = billing.handleWebhookEvent('invoice.paid', {
   *   tenantId: 'tenant-a',
   *   invoiceId: 'inv_abc123',
   *   amountCents: 2999,
   * });
   * ```
   */
  handleWebhookEvent(
    eventType: BillingEventType,
    payload: Record<string, unknown> & { tenantId: string },
  ): BillingEvent {
    const event: BillingEvent = {
      id: generateId('evt'),
      type: eventType,
      tenantId: payload.tenantId,
      data: payload,
      timestamp: Date.now(),
    };

    this.events$.next(event);
    return event;
  }

  // ── Observables ────────────────────────────────────────────────────────

  /**
   * Get an observable stream of billing events.
   *
   * @returns Observable that emits billing events
   *
   * @example
   * ```typescript
   * billing.getEvents$().subscribe(event => {
   *   console.log('Billing event:', event.type);
   * });
   * ```
   */
  getEvents$(): Observable<BillingEvent> {
    return this.events$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get an observable of subscription state changes.
   *
   * @returns Observable that emits the full subscription map on each change
   *
   * @example
   * ```typescript
   * billing.getSubscriptions$().subscribe(subs => {
   *   console.log('Total subscriptions:', subs.size);
   * });
   * ```
   */
  getSubscriptions$(): Observable<Map<string, Subscription>> {
    return this.subscriptions$.asObservable().pipe(takeUntil(this.destroy$));
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  /**
   * Permanently destroy the billing manager and release all resources.
   *
   * Completes all observables. After calling destroy(), the manager
   * cannot be reused.
   *
   * @example
   * ```typescript
   * billing.destroy();
   * ```
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.events$.complete();
    this.subscriptions$.complete();
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private publishSubscriptions(): void {
    this.subscriptions$.next(new Map(this.subscriptions));
  }

  private emitEvent(type: BillingEventType, tenantId: string, data: Record<string, unknown>): void {
    const event: BillingEvent = {
      id: generateId('evt'),
      type,
      tenantId,
      data,
      timestamp: Date.now(),
    };
    this.events$.next(event);
  }

  private calculateOverage(tier: CloudTier, summary: UsageSummary): number {
    const limits: Record<CloudTier, Record<string, number>> = {
      free: { sync_operations: 10_000, storage_bytes: 100 * 1024 * 1024 },
      pro: { sync_operations: 1_000_000, storage_bytes: 10 * 1024 * 1024 * 1024 },
      enterprise: { sync_operations: Infinity, storage_bytes: Infinity },
    };

    const limit = limits[tier][summary.metric] ?? Infinity;
    return Math.max(0, summary.totalQuantity - limit);
  }
}

/**
 * Create a billing manager instance.
 *
 * Factory function that creates a configured {@link BillingManager}.
 *
 * @param config - Billing configuration
 * @returns A new BillingManager instance
 *
 * @example
 * ```typescript
 * import { createBillingManager } from '@pocket/cloud';
 *
 * const billing = createBillingManager({
 *   stripeSecretKey: 'sk_test_xxx',
 *   webhookSecret: 'whsec_xxx',
 *   defaultTrialDays: 14,
 * });
 * ```
 *
 * @see {@link BillingManager}
 * @see {@link BillingConfig}
 */
export function createBillingManager(config: BillingConfig): BillingManager {
  return new BillingManager(config);
}
