import { describe, expect, it } from 'vitest';
import {
  SubscriptionRegistry,
  createSubscriptionRegistry,
} from '../server/subscription-registry.js';
import type { SubscriptionQuery } from '../types.js';

function makeQuery(
  collection: string,
  overrides: Partial<SubscriptionQuery> = {}
): SubscriptionQuery {
  return {
    id: `q-${Math.random().toString(36).substring(2, 7)}`,
    collection,
    ...overrides,
  };
}

describe('SubscriptionRegistry (extended)', () => {
  describe('createSubscriptionRegistry factory', () => {
    it('returns a SubscriptionRegistry instance', () => {
      const reg = createSubscriptionRegistry();
      expect(reg).toBeInstanceOf(SubscriptionRegistry);
    });

    it('accepts config overrides', () => {
      const reg = createSubscriptionRegistry({ maxSubscriptionsPerClient: 5 });
      const config = reg.getConfig();
      expect(config.maxSubscriptionsPerClient).toBe(5);
    });
  });

  describe('getConfig', () => {
    it('returns default config when none provided', () => {
      const reg = new SubscriptionRegistry();
      const config = reg.getConfig();
      expect(config.maxSubscriptionsPerClient).toBe(50);
      expect(config.batchIntervalMs).toBe(50);
      expect(config.maxBatchSize).toBe(100);
    });

    it('returns a copy that cannot mutate internals', () => {
      const reg = new SubscriptionRegistry();
      const config1 = reg.getConfig();
      config1.maxSubscriptionsPerClient = 999;
      const config2 = reg.getConfig();
      expect(config2.maxSubscriptionsPerClient).toBe(50);
    });

    it('merges partial config with defaults', () => {
      const reg = new SubscriptionRegistry({ batchIntervalMs: 200 });
      const config = reg.getConfig();
      expect(config.batchIntervalMs).toBe(200);
      expect(config.maxSubscriptionsPerClient).toBe(50); // default
      expect(config.maxBatchSize).toBe(100); // default
    });
  });

  describe('register edge cases', () => {
    it('uses query.id when provided', () => {
      const reg = new SubscriptionRegistry();
      const state = reg.register('c1', makeQuery('users', { id: 'my-custom-id' }));
      expect(state.id).toBe('my-custom-id');
      expect(reg.get('my-custom-id')).toBe(state);
    });

    it('generates id when query.id is empty string', () => {
      const reg = new SubscriptionRegistry();
      const state = reg.register('c1', { id: '', collection: 'users' });
      expect(state.id).toBeTruthy();
      expect(state.id.startsWith('sub_')).toBe(true);
    });

    it('copies query to prevent external mutation', () => {
      const reg = new SubscriptionRegistry();
      const query = makeQuery('users', { filter: { x: 1 } });
      const state = reg.register('c1', query);

      // Mutate the original
      query.collection = 'mutated';
      expect(state.query.collection).toBe('users');
    });

    it('initializes state with empty currentIds and zero sequence', () => {
      const reg = new SubscriptionRegistry();
      const state = reg.register('c1', makeQuery('users'));
      expect(state.currentIds.size).toBe(0);
      expect(state.sequence).toBe(0);
      expect(typeof state.createdAt).toBe('number');
    });

    it('allows different clients to subscribe independently', () => {
      const reg = new SubscriptionRegistry({ maxSubscriptionsPerClient: 1 });
      reg.register('c1', makeQuery('users'));
      // Should not throw - different client
      expect(() => reg.register('c2', makeQuery('users'))).not.toThrow();
    });

    it('allows same client to subscribe to multiple collections', () => {
      const reg = new SubscriptionRegistry({ maxSubscriptionsPerClient: 10 });
      reg.register('c1', makeQuery('users'));
      reg.register('c1', makeQuery('posts'));
      reg.register('c1', makeQuery('comments'));

      expect(reg.getClientSubscriptions('c1')).toHaveLength(3);
    });

    it('subscription limit is exactly enforced', () => {
      const reg = new SubscriptionRegistry({ maxSubscriptionsPerClient: 2 });
      reg.register('c1', makeQuery('a'));
      reg.register('c1', makeQuery('b'));
      expect(() => reg.register('c1', makeQuery('c'))).toThrow(/maximum of 2/);
    });
  });

  describe('unregister edge cases', () => {
    it('unregistering is idempotent', () => {
      const reg = new SubscriptionRegistry();
      const state = reg.register('c1', makeQuery('users'));
      reg.unregister(state.id);
      reg.unregister(state.id); // second call should not throw
      expect(reg.get(state.id)).toBeUndefined();
    });

    it('frees up subscription count after unregister', () => {
      const reg = new SubscriptionRegistry({ maxSubscriptionsPerClient: 1 });
      const state = reg.register('c1', makeQuery('users'));
      reg.unregister(state.id);
      // Should be able to register again
      expect(() => reg.register('c1', makeQuery('posts'))).not.toThrow();
    });

    it('cleans up collection index when last sub for collection is removed', () => {
      const reg = new SubscriptionRegistry();
      const s1 = reg.register('c1', makeQuery('users'));
      const s2 = reg.register('c2', makeQuery('users'));

      reg.unregister(s1.id);
      expect(reg.getSubscriptionsForCollection('users')).toHaveLength(1);

      reg.unregister(s2.id);
      expect(reg.getSubscriptionsForCollection('users')).toHaveLength(0);
    });

    it('cleans up client index when last sub for client is removed', () => {
      const reg = new SubscriptionRegistry();
      const s1 = reg.register('c1', makeQuery('users'));
      const s2 = reg.register('c1', makeQuery('posts'));

      reg.unregister(s1.id);
      expect(reg.getClientSubscriptions('c1')).toHaveLength(1);

      reg.unregister(s2.id);
      expect(reg.getClientSubscriptions('c1')).toHaveLength(0);
    });
  });

  describe('unregisterClient edge cases', () => {
    it('cleans up all indexes for the client', () => {
      const reg = new SubscriptionRegistry();
      reg.register('c1', makeQuery('users'));
      reg.register('c1', makeQuery('posts'));

      reg.unregisterClient('c1');

      expect(reg.getClientSubscriptions('c1')).toHaveLength(0);
      expect(reg.getStats().totalSubscriptions).toBe(0);
      expect(reg.getStats().activeClients).toBe(0);
    });

    it('does not affect other clients', () => {
      const reg = new SubscriptionRegistry();
      reg.register('c1', makeQuery('users'));
      reg.register('c2', makeQuery('users'));

      reg.unregisterClient('c1');

      expect(reg.getClientSubscriptions('c2')).toHaveLength(1);
      expect(reg.getSubscriptionsForCollection('users')).toHaveLength(1);
    });
  });

  describe('get', () => {
    it('returns subscription state by id', () => {
      const reg = new SubscriptionRegistry();
      const state = reg.register('c1', makeQuery('users'));
      expect(reg.get(state.id)).toBe(state);
    });

    it('returns undefined for non-existent id', () => {
      const reg = new SubscriptionRegistry();
      expect(reg.get('does-not-exist')).toBeUndefined();
    });
  });

  describe('getSubscriptionsForCollection', () => {
    it('returns subscriptions from multiple clients', () => {
      const reg = new SubscriptionRegistry();
      reg.register('c1', makeQuery('users'));
      reg.register('c2', makeQuery('users'));
      reg.register('c3', makeQuery('users'));

      const subs = reg.getSubscriptionsForCollection('users');
      expect(subs).toHaveLength(3);
      const clientIds = subs.map((s) => s.clientId).sort();
      expect(clientIds).toEqual(['c1', 'c2', 'c3']);
    });
  });

  describe('stats tracking', () => {
    it('bandwidth saved is always non-negative', () => {
      const reg = new SubscriptionRegistry();
      // Delta larger than full result - bandwidth saved should be 0
      reg.recordDeltaDelivered(200, 1);
      const stats = reg.getStats();
      expect(stats.bandwidthSavedBytes).toBe(0);
    });

    it('accumulates stats across multiple deliveries', () => {
      const reg = new SubscriptionRegistry();
      reg.recordDeltaDelivered(2, 100);
      reg.recordDeltaDelivered(4, 100);
      reg.recordDeltaDelivered(6, 100);

      const stats = reg.getStats();
      expect(stats.deltasDelivered).toBe(3);
      expect(stats.avgDeltaSize).toBe(4); // (2+4+6)/3
    });

    it('avgDeltaSize is 0 when no deltas delivered', () => {
      const reg = new SubscriptionRegistry();
      expect(reg.getStats().avgDeltaSize).toBe(0);
    });
  });
});
