import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import {
  createWebhookNotifier,
  WebhookManager,
  type WebhookConfig,
  type WebhookEvent,
  type WebhookSender,
} from '../webhooks.js';

function makeConfig(overrides?: Partial<WebhookConfig>): WebhookConfig {
  return {
    url: 'https://example.com/hook',
    secret: 'test-secret',
    events: ['document.created'] as WebhookEvent[],
    active: true,
    ...overrides,
  };
}

function mockSender(status = 200): WebhookSender {
  return vi.fn().mockResolvedValue({ status });
}

describe('WebhookManager', () => {
  let manager: WebhookManager;
  let sender: WebhookSender;

  beforeEach(() => {
    sender = mockSender();
    manager = createWebhookNotifier(undefined, sender);
  });

  afterEach(() => {
    manager.dispose();
  });

  // -----------------------------------------------------------------------
  // Register & list
  // -----------------------------------------------------------------------
  describe('register and list', () => {
    it('should register and list webhooks', () => {
      const { id } = manager.register(makeConfig());

      const list = manager.list();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(id);
      expect(list[0].url).toBe('https://example.com/hook');
    });

    it('should unregister a webhook', () => {
      const { id } = manager.register(makeConfig());
      manager.unregister(id);
      expect(manager.list()).toHaveLength(0);
    });

    it('should update a webhook', () => {
      const { id } = manager.register(makeConfig());
      manager.update(id, { url: 'https://new.com/hook' });

      const list = manager.list();
      expect(list[0].url).toBe('https://new.com/hook');
    });
  });

  // -----------------------------------------------------------------------
  // Trigger matching webhooks
  // -----------------------------------------------------------------------
  describe('trigger matching webhooks', () => {
    it('should deliver to matching webhooks', async () => {
      manager.register(makeConfig());

      const deliveries = await manager.trigger('document.created', {
        collection: 'todos',
        documentId: 'doc-1',
        document: { title: 'Buy milk' },
      });

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].status).toBe('delivered');
      expect(sender).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // HMAC signature verification
  // -----------------------------------------------------------------------
  describe('HMAC signature verification', () => {
    it('should generate a valid HMAC-SHA256 signature', async () => {
      const secret = 'my-secret';
      manager.register(makeConfig({ secret }));

      const deliveries = await manager.trigger('document.created', {
        collection: 'todos',
        documentId: 'doc-1',
      });

      const payload = deliveries[0].payload;
      // Rebuild the unsigned payload to verify the signature
      const unsigned = {
        id: payload.id,
        event: payload.event,
        collection: payload.collection,
        documentId: payload.documentId,
        data: payload.data,
        timestamp: payload.timestamp,
      };
      const expected = createHmac('sha256', secret)
        .update(JSON.stringify(unsigned))
        .digest('hex');

      expect(payload.signature).toBe(expected);
    });
  });

  // -----------------------------------------------------------------------
  // Event filtering
  // -----------------------------------------------------------------------
  describe('event filtering', () => {
    it('should only trigger for matching events', async () => {
      manager.register(makeConfig({ events: ['document.deleted'] }));

      const deliveries = await manager.trigger('document.created', {
        collection: 'todos',
      });

      expect(deliveries).toHaveLength(0);
      expect(sender).not.toHaveBeenCalled();
    });

    it('should trigger when event matches', async () => {
      manager.register(makeConfig({ events: ['document.created', 'document.updated'] }));

      const deliveries = await manager.trigger('document.updated', {
        collection: 'todos',
      });

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].status).toBe('delivered');
    });
  });

  // -----------------------------------------------------------------------
  // Collection filtering
  // -----------------------------------------------------------------------
  describe('collection filtering', () => {
    it('should only trigger for matching collections', async () => {
      manager.register(makeConfig({ collections: ['users'] }));

      const deliveries = await manager.trigger('document.created', {
        collection: 'todos',
      });

      expect(deliveries).toHaveLength(0);
    });

    it('should trigger when collection matches', async () => {
      manager.register(makeConfig({ collections: ['todos', 'users'] }));

      const deliveries = await manager.trigger('document.created', {
        collection: 'todos',
      });

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].status).toBe('delivered');
    });

    it('should trigger for any collection when no filter is set', async () => {
      manager.register(makeConfig({ collections: undefined }));

      const deliveries = await manager.trigger('document.created', {
        collection: 'anything',
      });

      expect(deliveries).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Delivery tracking
  // -----------------------------------------------------------------------
  describe('delivery tracking', () => {
    it('should track deliveries', async () => {
      const { id } = manager.register(makeConfig());

      await manager.trigger('document.created', { collection: 'todos' });

      const deliveries = manager.getDeliveries(id);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].webhookId).toBe(id);
      expect(deliveries[0].status).toBe('delivered');
      expect(deliveries[0].attempts).toBe(1);
    });

    it('should support limit parameter', async () => {
      manager.register(makeConfig());
      await manager.trigger('document.created', { collection: 'a' });
      await manager.trigger('document.created', { collection: 'b' });
      await manager.trigger('document.created', { collection: 'c' });

      const deliveries = manager.getDeliveries(undefined, 2);
      expect(deliveries).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Retry on failure
  // -----------------------------------------------------------------------
  describe('retry on failure', () => {
    it('should retry and eventually fail after max retries', async () => {
      const failSender = vi.fn().mockResolvedValue({ status: 500 });
      const m = createWebhookNotifier(undefined, failSender);

      m.register(
        makeConfig({
          retryPolicy: { maxRetries: 2, backoffMs: 1, backoffMultiplier: 1 },
        }),
      );

      const deliveries = await m.trigger('document.created', {
        collection: 'todos',
      });

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].status).toBe('failed');
      // 1 initial + 2 retries = 3 total attempts
      expect(deliveries[0].attempts).toBe(3);
      expect(failSender).toHaveBeenCalledTimes(3);
      m.dispose();
    });

    it('should succeed on retry after initial failure', async () => {
      const flakySender = vi
        .fn()
        .mockResolvedValueOnce({ status: 500 })
        .mockResolvedValueOnce({ status: 200 });
      const m = createWebhookNotifier(undefined, flakySender);

      m.register(
        makeConfig({
          retryPolicy: { maxRetries: 2, backoffMs: 1, backoffMultiplier: 1 },
        }),
      );

      const deliveries = await m.trigger('document.created', {
        collection: 'todos',
      });

      expect(deliveries[0].status).toBe('delivered');
      expect(deliveries[0].attempts).toBe(2);
      m.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Test webhook ping
  // -----------------------------------------------------------------------
  describe('test webhook ping', () => {
    it('should send a test ping', async () => {
      const { id } = manager.register(makeConfig());

      const delivery = await manager.testWebhook(id);

      expect(delivery.status).toBe('delivered');
      expect(delivery.payload.collection).toBe('_test');
      expect(delivery.payload.documentId).toBe('ping');
    });

    it('should throw for unknown webhook', async () => {
      await expect(manager.testWebhook('nonexistent')).rejects.toThrow('not found');
    });
  });

  // -----------------------------------------------------------------------
  // Stats tracking
  // -----------------------------------------------------------------------
  describe('stats tracking', () => {
    it('should track aggregate statistics', async () => {
      manager.register(makeConfig());
      await manager.trigger('document.created', { collection: 'a' });
      await manager.trigger('document.created', { collection: 'b' });

      const stats = manager.getStats();
      expect(stats.totalWebhooks).toBe(1);
      expect(stats.totalDeliveries).toBe(2);
      expect(stats.successRate).toBe(1);
      expect(stats.failedDeliveries).toBe(0);
      expect(stats.pendingDeliveries).toBe(0);
    });

    it('should track failed deliveries in stats', async () => {
      const failSender = vi.fn().mockResolvedValue({ status: 400 });
      const m = createWebhookNotifier(undefined, failSender);
      m.register(makeConfig());

      await m.trigger('document.created', { collection: 'a' });

      const stats = m.getStats();
      expect(stats.failedDeliveries).toBe(1);
      expect(stats.successRate).toBe(0);
      m.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Inactive webhook not triggered
  // -----------------------------------------------------------------------
  describe('inactive webhook not triggered', () => {
    it('should not trigger inactive webhooks', async () => {
      manager.register(makeConfig({ active: false }));

      const deliveries = await manager.trigger('document.created', {
        collection: 'todos',
      });

      expect(deliveries).toHaveLength(0);
      expect(sender).not.toHaveBeenCalled();
    });

    it('should not trigger after deactivation via update', async () => {
      const { id } = manager.register(makeConfig({ active: true }));
      manager.update(id, { active: false });

      const deliveries = await manager.trigger('document.created', {
        collection: 'todos',
      });

      expect(deliveries).toHaveLength(0);
    });
  });
});
