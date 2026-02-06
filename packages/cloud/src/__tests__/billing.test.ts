import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import {
  createBillingManager,
  BillingManager,
  TIER_PRICING,
  type BillingEvent,
  type Subscription,
} from '../billing.js';

describe('BillingManager', () => {
  let billing: BillingManager;

  const defaultConfig = {
    stripeSecretKey: 'sk_test_xxx',
    webhookSecret: 'whsec_xxx',
  };

  beforeEach(() => {
    billing = createBillingManager(defaultConfig);
  });

  afterEach(() => {
    billing.destroy();
  });

  // ── Factory ─────────────────────────────────────────────────────────────

  describe('createBillingManager', () => {
    it('should create a BillingManager instance', () => {
      expect(billing).toBeInstanceOf(BillingManager);
    });

    it('should accept optional config values', () => {
      const custom = createBillingManager({
        ...defaultConfig,
        defaultCurrency: 'eur',
        defaultTrialDays: 30,
      });
      expect(custom).toBeInstanceOf(BillingManager);
      custom.destroy();
    });
  });

  // ── createSubscription ─────────────────────────────────────────────────

  describe('createSubscription', () => {
    it('should create a subscription with valid input', () => {
      const sub = billing.createSubscription({
        tenantId: 'tenant-a',
        tier: 'pro',
      });

      expect(sub.id).toBeDefined();
      expect(sub.tenantId).toBe('tenant-a');
      expect(sub.tier).toBe('pro');
      expect(sub.status).toBe('active');
      expect(sub.billingInterval).toBe('monthly');
      expect(sub.cancelAtPeriodEnd).toBe(false);
      expect(sub.trialEnd).toBeNull();
    });

    it('should default billingInterval to monthly', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'free' });
      expect(sub.billingInterval).toBe('monthly');
    });

    it('should support yearly billing interval', () => {
      const sub = billing.createSubscription({
        tenantId: 't',
        tier: 'pro',
        billingInterval: 'yearly',
      });
      expect(sub.billingInterval).toBe('yearly');
    });

    it('should set trialing status when trialDays > 0', () => {
      const sub = billing.createSubscription({
        tenantId: 't',
        tier: 'pro',
        trialDays: 14,
      });
      expect(sub.status).toBe('trialing');
      expect(sub.trialEnd).toBeGreaterThan(Date.now());
    });

    it('should set period start and end', () => {
      const before = Date.now();
      const sub = billing.createSubscription({ tenantId: 't', tier: 'pro' });
      expect(sub.currentPeriodStart).toBeGreaterThanOrEqual(before);
      expect(sub.currentPeriodEnd).toBeGreaterThan(sub.currentPeriodStart);
    });

    it('should make subscription retrievable', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'pro' });
      const retrieved = billing.getSubscription(sub.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(sub.id);
    });
  });

  // ── changeTier ─────────────────────────────────────────────────────────

  describe('changeTier', () => {
    it('should upgrade a subscription', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'free' });
      const updated = billing.changeTier(sub.id, 'pro');
      expect(updated.tier).toBe('pro');
    });

    it('should downgrade a subscription', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'enterprise' });
      const updated = billing.changeTier(sub.id, 'pro');
      expect(updated.tier).toBe('pro');
    });

    it('should update the updatedAt timestamp', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'free' });
      const updated = billing.changeTier(sub.id, 'pro');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(sub.updatedAt);
    });

    it('should throw for invalid subscription ID', () => {
      expect(() => billing.changeTier('nonexistent', 'pro')).toThrow(
        'Subscription not found: nonexistent',
      );
    });
  });

  // ── cancelSubscription ─────────────────────────────────────────────────

  describe('cancelSubscription', () => {
    it('should cancel at period end by default (deferred)', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'pro' });
      const canceled = billing.cancelSubscription(sub.id);
      expect(canceled.cancelAtPeriodEnd).toBe(true);
      expect(canceled.status).toBe('active');
    });

    it('should cancel immediately when immediate=true', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'pro' });
      const canceled = billing.cancelSubscription(sub.id, true);
      expect(canceled.status).toBe('canceled');
      expect(canceled.cancelAtPeriodEnd).toBe(false);
    });

    it('should throw for invalid subscription ID', () => {
      expect(() => billing.cancelSubscription('nonexistent')).toThrow(
        'Subscription not found: nonexistent',
      );
    });

    it('should allow canceling an already canceled subscription', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'pro' });
      billing.cancelSubscription(sub.id, true);
      // Canceling again should not throw
      const result = billing.cancelSubscription(sub.id, true);
      expect(result.status).toBe('canceled');
    });
  });

  // ── recordUsage ────────────────────────────────────────────────────────

  describe('recordUsage', () => {
    it('should record usage for a valid subscription', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'pro' });
      const record = billing.recordUsage(sub.id, 'sync_operations', 150);
      expect(record.id).toBeDefined();
      expect(record.subscriptionId).toBe(sub.id);
      expect(record.metric).toBe('sync_operations');
      expect(record.quantity).toBe(150);
      expect(record.timestamp).toBeDefined();
    });

    it('should record different metrics', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'pro' });
      const r1 = billing.recordUsage(sub.id, 'sync_operations', 100);
      const r2 = billing.recordUsage(sub.id, 'storage_bytes', 2048);
      expect(r1.metric).toBe('sync_operations');
      expect(r2.metric).toBe('storage_bytes');
    });

    it('should throw for invalid subscription ID', () => {
      expect(() => billing.recordUsage('nonexistent', 'sync_operations', 10)).toThrow(
        'Subscription not found: nonexistent',
      );
    });

    it('should aggregate usage in getUsageSummary', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'pro' });
      billing.recordUsage(sub.id, 'sync_operations', 100);
      billing.recordUsage(sub.id, 'sync_operations', 200);

      const summaries = billing.getUsageSummary(sub.id, sub.currentPeriodStart, sub.currentPeriodEnd);
      const syncSummary = summaries.find((s) => s.metric === 'sync_operations');
      expect(syncSummary).toBeDefined();
      expect(syncSummary!.totalQuantity).toBe(300);
      expect(syncSummary!.recordCount).toBe(2);
    });
  });

  // ── generateInvoice ────────────────────────────────────────────────────

  describe('generateInvoice', () => {
    it('should generate an invoice for a pro subscription', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'pro' });
      const invoice = billing.generateInvoice(sub.id);

      expect(invoice.id).toBeDefined();
      expect(invoice.subscriptionId).toBe(sub.id);
      expect(invoice.tenantId).toBe('t');
      expect(invoice.amountCents).toBe(TIER_PRICING.pro.monthly);
      expect(invoice.currency).toBe('usd');
      expect(invoice.lineItems.length).toBeGreaterThan(0);
      expect(invoice.status).toBe('open');
    });

    it('should generate a zero-amount invoice for free tier', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'free' });
      const invoice = billing.generateInvoice(sub.id);
      expect(invoice.amountCents).toBe(0);
      expect(invoice.status).toBe('paid');
      expect(invoice.paidAt).not.toBeNull();
    });

    it('should throw for invalid subscription ID', () => {
      expect(() => billing.generateInvoice('nonexistent')).toThrow(
        'Subscription not found: nonexistent',
      );
    });

    it('should store invoice in history', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'pro' });
      billing.generateInvoice(sub.id);
      const invoices = billing.getInvoices(sub.id);
      expect(invoices).toHaveLength(1);
    });
  });

  // ── addPaymentMethod ───────────────────────────────────────────────────

  describe('addPaymentMethod', () => {
    it('should add a card payment method', () => {
      const pm = billing.addPaymentMethod({
        tenantId: 't',
        type: 'card',
        token: 'tok_visa_4242',
      });

      expect(pm.id).toBeDefined();
      expect(pm.tenantId).toBe('t');
      expect(pm.type).toBe('card');
      expect(pm.last4).toBe('4242');
      expect(pm.isDefault).toBe(true); // first method is default
      expect(pm.expiryMonth).toBe(12);
      expect(pm.expiryYear).toBeGreaterThan(2024);
    });

    it('should set as default when setDefault=true', () => {
      billing.addPaymentMethod({ tenantId: 't', type: 'card', token: 'tok_1111' });
      const pm2 = billing.addPaymentMethod({
        tenantId: 't',
        type: 'card',
        token: 'tok_2222',
        setDefault: true,
      });

      expect(pm2.isDefault).toBe(true);
      const methods = billing.getPaymentMethods('t');
      const oldDefault = methods.find((m) => m.id !== pm2.id);
      expect(oldDefault!.isDefault).toBe(false);
    });

    it('should add bank_account payment method with null expiry', () => {
      const pm = billing.addPaymentMethod({
        tenantId: 't',
        type: 'bank_account',
        token: 'ba_test1234',
      });
      expect(pm.type).toBe('bank_account');
      expect(pm.expiryMonth).toBeNull();
      expect(pm.expiryYear).toBeNull();
    });
  });

  // ── handleWebhookEvent ─────────────────────────────────────────────────

  describe('handleWebhookEvent', () => {
    it('should process invoice.paid event', () => {
      const event = billing.handleWebhookEvent('invoice.paid', {
        tenantId: 'tenant-a',
        invoiceId: 'inv_123',
        amountCents: 2999,
      });

      expect(event.id).toBeDefined();
      expect(event.type).toBe('invoice.paid');
      expect(event.tenantId).toBe('tenant-a');
      expect(event.data).toHaveProperty('invoiceId', 'inv_123');
      expect(event.timestamp).toBeDefined();
    });

    it('should process subscription.created event', () => {
      const event = billing.handleWebhookEvent('subscription.created', {
        tenantId: 'tenant-b',
        tier: 'pro',
      });
      expect(event.type).toBe('subscription.created');
      expect(event.tenantId).toBe('tenant-b');
    });

    it('should process payment_method.attached event', () => {
      const event = billing.handleWebhookEvent('payment_method.attached', {
        tenantId: 'tenant-c',
        paymentMethodId: 'pm_123',
      });
      expect(event.type).toBe('payment_method.attached');
    });
  });

  // ── Observables ────────────────────────────────────────────────────────

  describe('getEvents$', () => {
    it('should emit events on subscription changes', async () => {
      const eventPromise = firstValueFrom(billing.getEvents$().pipe(take(1)));
      billing.createSubscription({ tenantId: 't', tier: 'pro' });
      const event = await eventPromise;
      expect(event.type).toBe('subscription.created');
    });

    it('should emit events for different operations', async () => {
      const eventsPromise = firstValueFrom(billing.getEvents$().pipe(take(3), toArray()));

      const sub = billing.createSubscription({ tenantId: 't', tier: 'free' });
      billing.changeTier(sub.id, 'pro');
      billing.cancelSubscription(sub.id, true);

      const events = await eventsPromise;
      expect(events).toHaveLength(3);
      expect(events[0]!.type).toBe('subscription.created');
      expect(events[1]!.type).toBe('subscription.updated');
      expect(events[2]!.type).toBe('subscription.canceled');
    });
  });

  describe('getSubscriptions$', () => {
    it('should emit initial empty map', async () => {
      const subs = await firstValueFrom(billing.getSubscriptions$().pipe(take(1)));
      expect(subs.size).toBe(0);
    });

    it('should track subscription additions', async () => {
      const subsPromise = firstValueFrom(billing.getSubscriptions$().pipe(take(2), toArray()));
      billing.createSubscription({ tenantId: 't', tier: 'pro' });
      const emissions = await subsPromise;
      expect(emissions[1]!.size).toBe(1);
    });
  });

  // ── destroy ────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('should complete event observable', async () => {
      let completed = false;
      billing.getEvents$().subscribe({ complete: () => { completed = true; } });
      billing.destroy();
      expect(completed).toBe(true);
    });

    it('should complete subscriptions observable', async () => {
      let completed = false;
      billing.getSubscriptions$().subscribe({ complete: () => { completed = true; } });
      billing.destroy();
      expect(completed).toBe(true);
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should allow multiple subscriptions per tenant', () => {
      billing.createSubscription({ tenantId: 't', tier: 'free' });
      billing.createSubscription({ tenantId: 't', tier: 'pro' });
      const subs = billing.getSubscriptionsByTenant('t');
      expect(subs).toHaveLength(2);
    });

    it('should return null for nonexistent subscription', () => {
      expect(billing.getSubscription('nonexistent')).toBeNull();
    });

    it('should return empty array for tenant with no subscriptions', () => {
      expect(billing.getSubscriptionsByTenant('nobody')).toHaveLength(0);
    });

    it('should return empty invoices for subscription with none', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'pro' });
      expect(billing.getInvoices(sub.id)).toHaveLength(0);
    });

    it('should return empty usage summary when no usage recorded', () => {
      const sub = billing.createSubscription({ tenantId: 't', tier: 'pro' });
      const summaries = billing.getUsageSummary(sub.id, 0, Date.now() + 100000);
      expect(summaries).toHaveLength(0);
    });
  });
});
