import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent, Document } from '@pocket/core';
import { FilterMatcher } from '../filter-matcher.js';
import { DeltaComputer } from '../server/delta-computer.js';
import { SubscriptionRegistry } from '../server/subscription-registry.js';
import { SubscriptionServer } from '../server/subscription-server.js';
import { SubscriptionClient, type SubscriptionTransport } from '../client/subscription-client.js';
import type { SubscriptionMessage, SubscriptionQuery, ServerSubscriptionState } from '../types.js';

// ============================================================================
// Test Helpers
// ============================================================================

function makeDoc(id: string, fields: Record<string, unknown> = {}): Document {
  return { _id: id, ...fields } as Document;
}

function makeChange(
  operation: 'insert' | 'update' | 'delete',
  documentId: string,
  doc: Document | null = null,
  previousDocument?: Document
): ChangeEvent<Document> {
  return {
    operation,
    documentId,
    document: doc,
    previousDocument,
    isFromSync: false,
    timestamp: Date.now(),
    sequence: 0,
  };
}

function makeQuery(
  collection: string,
  overrides: Partial<SubscriptionQuery> = {}
): SubscriptionQuery {
  return {
    id: `test-sub-${Math.random().toString(36).substring(2, 7)}`,
    collection,
    ...overrides,
  };
}

/**
 * Create a mock transport for testing the subscription client
 */
function createMockTransport(): SubscriptionTransport & {
  _messageHandler: ((msg: SubscriptionMessage) => void) | null;
  _connectHandler: (() => void) | null;
  _disconnectHandler: (() => void) | null;
  _sentMessages: SubscriptionMessage[];
  _connected: boolean;
  simulateMessage: (msg: SubscriptionMessage) => void;
  simulateConnect: () => void;
  simulateDisconnect: () => void;
} {
  const transport = {
    _messageHandler: null as ((msg: SubscriptionMessage) => void) | null,
    _connectHandler: null as (() => void) | null,
    _disconnectHandler: null as (() => void) | null,
    _sentMessages: [] as SubscriptionMessage[],
    _connected: true,

    send(message: SubscriptionMessage): void {
      transport._sentMessages.push(message);
    },
    onMessage(handler: (message: SubscriptionMessage) => void): void {
      transport._messageHandler = handler;
    },
    onConnect(handler: () => void): void {
      transport._connectHandler = handler;
    },
    onDisconnect(handler: () => void): void {
      transport._disconnectHandler = handler;
    },
    isConnected(): boolean {
      return transport._connected;
    },
    simulateMessage(msg: SubscriptionMessage): void {
      if (transport._messageHandler) {
        transport._messageHandler(msg);
      }
    },
    simulateConnect(): void {
      transport._connected = true;
      if (transport._connectHandler) {
        transport._connectHandler();
      }
    },
    simulateDisconnect(): void {
      transport._connected = false;
      if (transport._disconnectHandler) {
        transport._disconnectHandler();
      }
    },
  };
  return transport;
}

// ============================================================================
// FilterMatcher Tests
// ============================================================================

describe('FilterMatcher', () => {
  let matcher: FilterMatcher;

  beforeEach(() => {
    matcher = new FilterMatcher();
  });

  describe('basic matching', () => {
    it('matches when filter is empty', () => {
      expect(matcher.matches({ _id: '1', name: 'Alice' }, {})).toBe(true);
    });

    it('matches with implicit $eq', () => {
      expect(matcher.matches({ _id: '1', name: 'Alice' }, { name: 'Alice' })).toBe(true);
      expect(matcher.matches({ _id: '1', name: 'Bob' }, { name: 'Alice' })).toBe(false);
    });

    it('matches numeric values', () => {
      expect(matcher.matches({ _id: '1', age: 25 }, { age: 25 })).toBe(true);
      expect(matcher.matches({ _id: '1', age: 30 }, { age: 25 })).toBe(false);
    });

    it('matches boolean values', () => {
      expect(matcher.matches({ _id: '1', active: true }, { active: true })).toBe(true);
      expect(matcher.matches({ _id: '1', active: false }, { active: true })).toBe(false);
    });

    it('matches null values', () => {
      expect(matcher.matches({ _id: '1', data: null }, { data: null })).toBe(true);
    });
  });

  describe('$eq operator', () => {
    it('matches equal values', () => {
      expect(matcher.matches({ _id: '1', x: 5 }, { x: { $eq: 5 } })).toBe(true);
      expect(matcher.matches({ _id: '1', x: 6 }, { x: { $eq: 5 } })).toBe(false);
    });
  });

  describe('$ne operator', () => {
    it('matches not-equal values', () => {
      expect(matcher.matches({ _id: '1', x: 5 }, { x: { $ne: 3 } })).toBe(true);
      expect(matcher.matches({ _id: '1', x: 5 }, { x: { $ne: 5 } })).toBe(false);
    });
  });

  describe('$gt / $gte / $lt / $lte operators', () => {
    it('matches $gt', () => {
      expect(matcher.matches({ _id: '1', x: 10 }, { x: { $gt: 5 } })).toBe(true);
      expect(matcher.matches({ _id: '1', x: 5 }, { x: { $gt: 5 } })).toBe(false);
      expect(matcher.matches({ _id: '1', x: 3 }, { x: { $gt: 5 } })).toBe(false);
    });

    it('matches $gte', () => {
      expect(matcher.matches({ _id: '1', x: 10 }, { x: { $gte: 5 } })).toBe(true);
      expect(matcher.matches({ _id: '1', x: 5 }, { x: { $gte: 5 } })).toBe(true);
      expect(matcher.matches({ _id: '1', x: 3 }, { x: { $gte: 5 } })).toBe(false);
    });

    it('matches $lt', () => {
      expect(matcher.matches({ _id: '1', x: 3 }, { x: { $lt: 5 } })).toBe(true);
      expect(matcher.matches({ _id: '1', x: 5 }, { x: { $lt: 5 } })).toBe(false);
      expect(matcher.matches({ _id: '1', x: 10 }, { x: { $lt: 5 } })).toBe(false);
    });

    it('matches $lte', () => {
      expect(matcher.matches({ _id: '1', x: 3 }, { x: { $lte: 5 } })).toBe(true);
      expect(matcher.matches({ _id: '1', x: 5 }, { x: { $lte: 5 } })).toBe(true);
      expect(matcher.matches({ _id: '1', x: 10 }, { x: { $lte: 5 } })).toBe(false);
    });

    it('handles string comparison', () => {
      expect(matcher.matches({ _id: '1', name: 'b' }, { name: { $gt: 'a' } })).toBe(true);
      expect(matcher.matches({ _id: '1', name: 'a' }, { name: { $gt: 'b' } })).toBe(false);
    });
  });

  describe('$in / $nin operators', () => {
    it('matches $in', () => {
      expect(
        matcher.matches({ _id: '1', status: 'active' }, { status: { $in: ['active', 'pending'] } })
      ).toBe(true);
      expect(
        matcher.matches(
          { _id: '1', status: 'deleted' },
          { status: { $in: ['active', 'pending'] } }
        )
      ).toBe(false);
    });

    it('matches $nin', () => {
      expect(
        matcher.matches(
          { _id: '1', status: 'deleted' },
          { status: { $nin: ['active', 'pending'] } }
        )
      ).toBe(true);
      expect(
        matcher.matches(
          { _id: '1', status: 'active' },
          { status: { $nin: ['active', 'pending'] } }
        )
      ).toBe(false);
    });
  });

  describe('$exists operator', () => {
    it('matches when field exists', () => {
      expect(matcher.matches({ _id: '1', name: 'Alice' }, { name: { $exists: true } })).toBe(
        true
      );
      expect(matcher.matches({ _id: '1' }, { name: { $exists: true } })).toBe(false);
    });

    it('matches when field does not exist', () => {
      expect(matcher.matches({ _id: '1' }, { name: { $exists: false } })).toBe(true);
      expect(matcher.matches({ _id: '1', name: 'Alice' }, { name: { $exists: false } })).toBe(
        false
      );
    });
  });

  describe('$and operator', () => {
    it('matches when all conditions are true', () => {
      expect(
        matcher.matches({ _id: '1', age: 25, name: 'Alice' }, { $and: [{ age: 25 }, { name: 'Alice' }] })
      ).toBe(true);
    });

    it('fails when any condition is false', () => {
      expect(
        matcher.matches({ _id: '1', age: 25, name: 'Bob' }, { $and: [{ age: 25 }, { name: 'Alice' }] })
      ).toBe(false);
    });
  });

  describe('$or operator', () => {
    it('matches when any condition is true', () => {
      expect(
        matcher.matches({ _id: '1', status: 'active' }, { $or: [{ status: 'active' }, { status: 'pending' }] })
      ).toBe(true);
    });

    it('fails when no conditions are true', () => {
      expect(
        matcher.matches({ _id: '1', status: 'deleted' }, { $or: [{ status: 'active' }, { status: 'pending' }] })
      ).toBe(false);
    });
  });

  describe('$not operator', () => {
    it('inverts the condition', () => {
      expect(
        matcher.matches({ _id: '1', status: 'deleted' }, { $not: { status: 'active' } })
      ).toBe(true);
      expect(
        matcher.matches({ _id: '1', status: 'active' }, { $not: { status: 'active' } })
      ).toBe(false);
    });
  });

  describe('combined operators', () => {
    it('handles multiple field conditions', () => {
      const filter = {
        age: { $gte: 18, $lte: 65 },
        status: 'active',
      };

      expect(matcher.matches({ _id: '1', age: 25, status: 'active' }, filter)).toBe(true);
      expect(matcher.matches({ _id: '1', age: 10, status: 'active' }, filter)).toBe(false);
      expect(matcher.matches({ _id: '1', age: 25, status: 'inactive' }, filter)).toBe(false);
    });

    it('handles nested field paths', () => {
      const doc = { _id: '1', address: { city: 'NYC', zip: '10001' } };
      expect(matcher.matches(doc, { 'address.city': 'NYC' })).toBe(true);
      expect(matcher.matches(doc, { 'address.city': 'LA' })).toBe(false);
    });
  });
});

// ============================================================================
// DeltaComputer Tests
// ============================================================================

describe('DeltaComputer', () => {
  let computer: DeltaComputer;

  beforeEach(() => {
    computer = new DeltaComputer();
  });

  function makeSubscription(
    collection: string,
    filter?: Record<string, unknown>,
    currentIds?: string[],
    limit?: number
  ): ServerSubscriptionState {
    return {
      id: 'test-sub',
      clientId: 'client-1',
      query: makeQuery(collection, { filter, limit }),
      currentIds: new Set(currentIds ?? []),
      sequence: 0,
      createdAt: Date.now(),
    };
  }

  describe('insert operations', () => {
    it('adds document to subscription when it matches filter', () => {
      const sub = makeSubscription('users', { status: 'active' });
      const doc = makeDoc('doc1', { status: 'active', name: 'Alice' });
      const change = makeChange('insert', 'doc1', doc);

      const delta = computer.computeDelta(sub, change);

      expect(delta).not.toBeNull();
      expect(delta!.type).toBe('delta');
      expect(delta!.added).toHaveLength(1);
      expect((delta!.added[0] as Document)._id).toBe('doc1');
      expect(delta!.removed).toHaveLength(0);
      expect(delta!.modified).toHaveLength(0);
      expect(sub.currentIds.has('doc1')).toBe(true);
    });

    it('ignores insert when document does not match filter', () => {
      const sub = makeSubscription('users', { status: 'active' });
      const doc = makeDoc('doc1', { status: 'inactive', name: 'Bob' });
      const change = makeChange('insert', 'doc1', doc);

      const delta = computer.computeDelta(sub, change);

      expect(delta).toBeNull();
      expect(sub.currentIds.has('doc1')).toBe(false);
    });

    it('adds document when no filter is set', () => {
      const sub = makeSubscription('users');
      const doc = makeDoc('doc1', { name: 'Alice' });
      const change = makeChange('insert', 'doc1', doc);

      const delta = computer.computeDelta(sub, change);

      expect(delta).not.toBeNull();
      expect(delta!.added).toHaveLength(1);
    });

    it('returns null for insert with null document', () => {
      const sub = makeSubscription('users');
      const change = makeChange('insert', 'doc1', null);

      const delta = computer.computeDelta(sub, change);

      expect(delta).toBeNull();
    });
  });

  describe('update operations', () => {
    it('reports modification when document stays in result set', () => {
      const sub = makeSubscription('users', { status: 'active' }, ['doc1']);
      const doc = makeDoc('doc1', { status: 'active', name: 'Alice Updated' });
      const change = makeChange('update', 'doc1', doc);

      const delta = computer.computeDelta(sub, change);

      expect(delta).not.toBeNull();
      expect(delta!.modified).toHaveLength(1);
      expect(delta!.added).toHaveLength(0);
      expect(delta!.removed).toHaveLength(0);
    });

    it('adds document when update makes it match filter', () => {
      const sub = makeSubscription('users', { status: 'active' });
      const doc = makeDoc('doc1', { status: 'active', name: 'Alice' });
      const change = makeChange('update', 'doc1', doc);

      const delta = computer.computeDelta(sub, change);

      expect(delta).not.toBeNull();
      expect(delta!.added).toHaveLength(1);
      expect(sub.currentIds.has('doc1')).toBe(true);
    });

    it('removes document when update makes it no longer match filter', () => {
      const sub = makeSubscription('users', { status: 'active' }, ['doc1']);
      const doc = makeDoc('doc1', { status: 'inactive', name: 'Alice' });
      const change = makeChange('update', 'doc1', doc);

      const delta = computer.computeDelta(sub, change);

      expect(delta).not.toBeNull();
      expect(delta!.removed).toHaveLength(1);
      expect(delta!.removed[0]).toBe('doc1');
      expect(sub.currentIds.has('doc1')).toBe(false);
    });

    it('returns null when document was not and still is not in result set', () => {
      const sub = makeSubscription('users', { status: 'active' });
      const doc = makeDoc('doc1', { status: 'inactive' });
      const change = makeChange('update', 'doc1', doc);

      const delta = computer.computeDelta(sub, change);

      expect(delta).toBeNull();
    });
  });

  describe('delete operations', () => {
    it('removes document from subscription result set', () => {
      const sub = makeSubscription('users', {}, ['doc1', 'doc2']);
      const change = makeChange('delete', 'doc1', null);

      const delta = computer.computeDelta(sub, change);

      expect(delta).not.toBeNull();
      expect(delta!.removed).toHaveLength(1);
      expect(delta!.removed[0]).toBe('doc1');
      expect(sub.currentIds.has('doc1')).toBe(false);
      expect(sub.currentIds.has('doc2')).toBe(true);
    });

    it('returns null when deleted document was not in result set', () => {
      const sub = makeSubscription('users', {}, ['doc2']);
      const change = makeChange('delete', 'doc1', null);

      const delta = computer.computeDelta(sub, change);

      expect(delta).toBeNull();
    });
  });

  describe('sequence tracking', () => {
    it('increments sequence with each delta', () => {
      const sub = makeSubscription('users');

      const change1 = makeChange('insert', 'doc1', makeDoc('doc1'));
      const delta1 = computer.computeDelta(sub, change1);
      expect(delta1!.sequence).toBe(1);

      const change2 = makeChange('insert', 'doc2', makeDoc('doc2'));
      const delta2 = computer.computeDelta(sub, change2);
      expect(delta2!.sequence).toBe(2);
    });
  });
});

// ============================================================================
// SubscriptionRegistry Tests
// ============================================================================

describe('SubscriptionRegistry', () => {
  let registry: SubscriptionRegistry;

  beforeEach(() => {
    registry = new SubscriptionRegistry();
  });

  describe('register', () => {
    it('registers a subscription and returns state', () => {
      const query = makeQuery('users');
      const state = registry.register('client-1', query);

      expect(state.id).toBe(query.id);
      expect(state.clientId).toBe('client-1');
      expect(state.query.collection).toBe('users');
      expect(state.currentIds.size).toBe(0);
      expect(state.sequence).toBe(0);
    });

    it('generates an ID if query has no ID', () => {
      const query: SubscriptionQuery = { id: '', collection: 'users' };
      const state = registry.register('client-1', query);

      expect(state.id).toBeTruthy();
      expect(state.id.startsWith('sub_')).toBe(true);
    });

    it('indexes subscription by collection', () => {
      const query = makeQuery('users');
      registry.register('client-1', query);

      const subs = registry.getSubscriptionsForCollection('users');
      expect(subs).toHaveLength(1);
      expect(subs[0]!.query.collection).toBe('users');
    });

    it('indexes subscription by client', () => {
      const query = makeQuery('users');
      registry.register('client-1', query);

      const subs = registry.getClientSubscriptions('client-1');
      expect(subs).toHaveLength(1);
    });

    it('enforces max subscriptions per client', () => {
      const reg = new SubscriptionRegistry({ maxSubscriptionsPerClient: 2 });
      reg.register('client-1', makeQuery('users'));
      reg.register('client-1', makeQuery('posts'));

      expect(() => {
        reg.register('client-1', makeQuery('comments'));
      }).toThrow(/maximum of 2 subscriptions/);
    });
  });

  describe('unregister', () => {
    it('removes a subscription', () => {
      const query = makeQuery('users');
      const state = registry.register('client-1', query);

      registry.unregister(state.id);

      expect(registry.getSubscriptionsForCollection('users')).toHaveLength(0);
      expect(registry.getClientSubscriptions('client-1')).toHaveLength(0);
      expect(registry.get(state.id)).toBeUndefined();
    });

    it('handles unregistering non-existent subscription', () => {
      expect(() => registry.unregister('nonexistent')).not.toThrow();
    });

    it('cleans up empty collection index', () => {
      const query = makeQuery('users');
      const state = registry.register('client-1', query);
      registry.unregister(state.id);

      expect(registry.getSubscriptionsForCollection('users')).toHaveLength(0);
    });
  });

  describe('unregisterClient', () => {
    it('removes all subscriptions for a client', () => {
      registry.register('client-1', makeQuery('users'));
      registry.register('client-1', makeQuery('posts'));
      registry.register('client-2', makeQuery('users'));

      registry.unregisterClient('client-1');

      expect(registry.getClientSubscriptions('client-1')).toHaveLength(0);
      // client-2's subscription should remain
      expect(registry.getSubscriptionsForCollection('users')).toHaveLength(1);
    });

    it('handles unregistering non-existent client', () => {
      expect(() => registry.unregisterClient('nonexistent')).not.toThrow();
    });
  });

  describe('getSubscriptionsForCollection', () => {
    it('returns all subscriptions for a collection', () => {
      registry.register('client-1', makeQuery('users'));
      registry.register('client-2', makeQuery('users'));
      registry.register('client-1', makeQuery('posts'));

      const userSubs = registry.getSubscriptionsForCollection('users');
      expect(userSubs).toHaveLength(2);

      const postSubs = registry.getSubscriptionsForCollection('posts');
      expect(postSubs).toHaveLength(1);
    });

    it('returns empty array for unknown collection', () => {
      expect(registry.getSubscriptionsForCollection('unknown')).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('returns correct subscription count', () => {
      registry.register('client-1', makeQuery('users'));
      registry.register('client-2', makeQuery('posts'));

      const stats = registry.getStats();
      expect(stats.totalSubscriptions).toBe(2);
      expect(stats.activeClients).toBe(2);
    });

    it('tracks delta delivery stats', () => {
      registry.recordDeltaDelivered(5, 100);
      registry.recordDeltaDelivered(3, 100);

      const stats = registry.getStats();
      expect(stats.deltasDelivered).toBe(2);
      expect(stats.avgDeltaSize).toBe(4); // (5 + 3) / 2
    });
  });
});

// ============================================================================
// SubscriptionServer Tests
// ============================================================================

describe('SubscriptionServer', () => {
  let server: SubscriptionServer;
  let sentMessages: Array<{ clientId: string; message: SubscriptionMessage }>;

  beforeEach(() => {
    vi.useFakeTimers();
    sentMessages = [];
    server = new SubscriptionServer({ batchIntervalMs: 50, maxBatchSize: 100 });
    server.setSendToClient((clientId, message) => {
      sentMessages.push({ clientId, message });
    });
  });

  afterEach(() => {
    server.shutdown();
    vi.useRealTimers();
  });

  describe('handleMessage - subscribe', () => {
    it('registers subscription and sends ack', () => {
      const query = makeQuery('users');
      server.handleMessage('client-1', { type: 'subscribe', query });

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]!.message.type).toBe('ack');
      expect((sentMessages[0]!.message as { subscriptionId: string }).subscriptionId).toBe(
        query.id
      );
    });

    it('sends error when subscription limit exceeded', () => {
      const limitServer = new SubscriptionServer({
        maxSubscriptionsPerClient: 1,
        batchIntervalMs: 50,
      });
      limitServer.setSendToClient((clientId, message) => {
        sentMessages.push({ clientId, message });
      });

      limitServer.handleMessage('client-1', {
        type: 'subscribe',
        query: makeQuery('users'),
      });
      sentMessages = [];

      limitServer.handleMessage('client-1', {
        type: 'subscribe',
        query: makeQuery('posts'),
      });

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]!.message.type).toBe('error');
      limitServer.shutdown();
    });
  });

  describe('handleMessage - unsubscribe', () => {
    it('unregisters subscription', () => {
      const query = makeQuery('users');
      server.handleMessage('client-1', { type: 'subscribe', query });

      server.handleMessage('client-1', {
        type: 'unsubscribe',
        subscriptionId: query.id,
      });

      const subs = server.getRegistry().getClientSubscriptions('client-1');
      expect(subs).toHaveLength(0);
    });
  });

  describe('processChange', () => {
    it('delivers delta when change matches subscription', () => {
      const query = makeQuery('users', { filter: { status: 'active' } });
      server.handleMessage('client-1', { type: 'subscribe', query });
      sentMessages = [];

      const doc = makeDoc('doc1', { status: 'active', name: 'Alice' });
      const change = makeChange('insert', 'doc1', doc);
      server.processChange('users', change);

      // Delta should be batched
      expect(sentMessages).toHaveLength(0);

      // Flush batch timer
      vi.advanceTimersByTime(60);

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]!.message.type).toBe('delta');
      const deltaMsg = sentMessages[0]!.message as { type: 'delta'; delta: { added: unknown[] } };
      expect(deltaMsg.delta.added).toHaveLength(1);
    });

    it('does not deliver delta when change does not match subscription', () => {
      const query = makeQuery('users', { filter: { status: 'active' } });
      server.handleMessage('client-1', { type: 'subscribe', query });
      sentMessages = [];

      const doc = makeDoc('doc1', { status: 'inactive', name: 'Bob' });
      const change = makeChange('insert', 'doc1', doc);
      server.processChange('users', change);

      vi.advanceTimersByTime(60);

      expect(sentMessages).toHaveLength(0);
    });

    it('does not deliver delta for unrelated collection', () => {
      const query = makeQuery('users');
      server.handleMessage('client-1', { type: 'subscribe', query });
      sentMessages = [];

      const doc = makeDoc('doc1', { title: 'Post 1' });
      const change = makeChange('insert', 'doc1', doc);
      server.processChange('posts', change);

      vi.advanceTimersByTime(60);

      expect(sentMessages).toHaveLength(0);
    });
  });

  describe('batching and coalescing', () => {
    it('coalesces multiple changes within batch window', () => {
      const query = makeQuery('users');
      server.handleMessage('client-1', { type: 'subscribe', query });
      sentMessages = [];

      // Two inserts within the batch window
      server.processChange('users', makeChange('insert', 'doc1', makeDoc('doc1', { name: 'A' })));
      server.processChange('users', makeChange('insert', 'doc2', makeDoc('doc2', { name: 'B' })));

      // No messages sent yet (still in batch window)
      expect(sentMessages).toHaveLength(0);

      // Flush
      vi.advanceTimersByTime(60);

      // Should be a single coalesced delta
      expect(sentMessages).toHaveLength(1);
      const deltaMsg = sentMessages[0]!.message as { type: 'delta'; delta: { added: unknown[] } };
      expect(deltaMsg.delta.added).toHaveLength(2);
    });

    it('flushes immediately when batch size is reached', () => {
      const smallBatchServer = new SubscriptionServer({
        batchIntervalMs: 1000,
        maxBatchSize: 2,
      });
      const smallSentMessages: Array<{ clientId: string; message: SubscriptionMessage }> = [];
      smallBatchServer.setSendToClient((clientId, message) => {
        smallSentMessages.push({ clientId, message });
      });

      const query = makeQuery('users');
      smallBatchServer.handleMessage('client-1', { type: 'subscribe', query });
      smallSentMessages.length = 0;

      // Insert two docs to hit batch size
      smallBatchServer.processChange(
        'users',
        makeChange('insert', 'doc1', makeDoc('doc1'))
      );
      smallBatchServer.processChange(
        'users',
        makeChange('insert', 'doc2', makeDoc('doc2'))
      );

      // Should flush immediately due to batch size
      expect(smallSentMessages).toHaveLength(1);
      smallBatchServer.shutdown();
    });

    it('coalesces add followed by remove into nothing', () => {
      const query = makeQuery('users');
      server.handleMessage('client-1', { type: 'subscribe', query });
      sentMessages = [];

      // Insert then delete within batch window
      server.processChange('users', makeChange('insert', 'doc1', makeDoc('doc1')));
      // Need to add doc1 to currentIds for delete to work
      server.processChange('users', makeChange('delete', 'doc1', null));

      vi.advanceTimersByTime(60);

      // The add and remove should cancel out
      // Note: The delta may still be sent if there were other changes,
      // but added and removed for doc1 should be empty
      if (sentMessages.length > 0) {
        const deltaMsg = sentMessages[0]!.message as {
          type: 'delta';
          delta: { added: Document[]; removed: string[] };
        };
        // doc1 should not appear in either added or removed
        const addedIds = deltaMsg.delta.added.map((d) => d._id);
        expect(addedIds).not.toContain('doc1');
        expect(deltaMsg.delta.removed).not.toContain('doc1');
      }
    });

    it('sends immediately when batchIntervalMs is 0', () => {
      const noBatchServer = new SubscriptionServer({ batchIntervalMs: 0 });
      const immediateSent: Array<{ clientId: string; message: SubscriptionMessage }> = [];
      noBatchServer.setSendToClient((clientId, message) => {
        immediateSent.push({ clientId, message });
      });

      const query = makeQuery('users');
      noBatchServer.handleMessage('client-1', { type: 'subscribe', query });
      immediateSent.length = 0;

      noBatchServer.processChange(
        'users',
        makeChange('insert', 'doc1', makeDoc('doc1'))
      );

      // Should be sent immediately
      expect(immediateSent).toHaveLength(1);
      noBatchServer.shutdown();
    });
  });

  describe('handleClientDisconnect', () => {
    it('removes all subscriptions for disconnected client', () => {
      server.handleMessage('client-1', {
        type: 'subscribe',
        query: makeQuery('users'),
      });
      server.handleMessage('client-1', {
        type: 'subscribe',
        query: makeQuery('posts'),
      });

      server.handleClientDisconnect('client-1');

      expect(server.getRegistry().getClientSubscriptions('client-1')).toHaveLength(0);
      expect(server.getRegistry().getSubscriptionsForCollection('users')).toHaveLength(0);
      expect(server.getRegistry().getSubscriptionsForCollection('posts')).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('returns stats about subscriptions', () => {
      server.handleMessage('client-1', {
        type: 'subscribe',
        query: makeQuery('users'),
      });
      server.handleMessage('client-2', {
        type: 'subscribe',
        query: makeQuery('users'),
      });

      const stats = server.getStats();
      expect(stats.totalSubscriptions).toBe(2);
      expect(stats.activeClients).toBe(2);
    });
  });
});

// ============================================================================
// SubscriptionClient Tests
// ============================================================================

describe('SubscriptionClient', () => {
  let client: SubscriptionClient;
  let transport: ReturnType<typeof createMockTransport>;

  beforeEach(() => {
    client = new SubscriptionClient();
    transport = createMockTransport();
    client.connect(transport);
  });

  afterEach(() => {
    client.destroy();
  });

  describe('subscribe', () => {
    it('sends subscribe message to server', () => {
      const query = makeQuery('users');
      client.subscribe(query);

      expect(transport._sentMessages).toHaveLength(1);
      expect(transport._sentMessages[0]!.type).toBe('subscribe');
      expect((transport._sentMessages[0] as { query: SubscriptionQuery }).query.collection).toBe(
        'users'
      );
    });

    it('returns a ClientSubscription handle', () => {
      const query = makeQuery('users');
      const sub = client.subscribe(query);

      expect(sub.id).toBe(query.id);
      expect(sub.query.collection).toBe('users');
      expect(sub.results$).toBeDefined();
      expect(sub.delta$).toBeDefined();
      expect(typeof sub.unsubscribe).toBe('function');
    });

    it('generates client-side ID when query has no ID', () => {
      const sub = client.subscribe({ id: '', collection: 'users' });
      expect(sub.id).toBeTruthy();
      expect(sub.id.startsWith('csub_')).toBe(true);
    });
  });

  describe('delta application', () => {
    it('applies initial results to cache', () => {
      const query = makeQuery('users');
      const sub = client.subscribe(query);

      const results: unknown[][] = [];
      sub.results$.subscribe((r) => results.push(r));

      // Simulate server sending initial results
      transport.simulateMessage({
        type: 'initial',
        subscriptionId: query.id,
        results: [
          { _id: 'doc1', name: 'Alice' },
          { _id: 'doc2', name: 'Bob' },
        ],
        sequence: 1,
      });

      expect(results).toHaveLength(2); // initial empty + after initial data
      expect(results[1]).toHaveLength(2);
    });

    it('applies delta with added documents', () => {
      const query = makeQuery('users');
      const sub = client.subscribe(query);

      const allResults: unknown[][] = [];
      sub.results$.subscribe((r) => allResults.push(r));

      // Simulate initial
      transport.simulateMessage({
        type: 'initial',
        subscriptionId: query.id,
        results: [{ _id: 'doc1', name: 'Alice' }],
        sequence: 1,
      });

      // Simulate delta
      transport.simulateMessage({
        type: 'delta',
        delta: {
          subscriptionId: query.id,
          type: 'delta',
          added: [{ _id: 'doc2', name: 'Bob' }],
          removed: [],
          modified: [],
          sequence: 2,
          timestamp: Date.now(),
        },
      });

      const latestResults = allResults[allResults.length - 1]!;
      expect(latestResults).toHaveLength(2);
    });

    it('applies delta with removed documents', () => {
      const query = makeQuery('users');
      const sub = client.subscribe(query);

      const allResults: unknown[][] = [];
      sub.results$.subscribe((r) => allResults.push(r));

      // Initial
      transport.simulateMessage({
        type: 'initial',
        subscriptionId: query.id,
        results: [
          { _id: 'doc1', name: 'Alice' },
          { _id: 'doc2', name: 'Bob' },
        ],
        sequence: 1,
      });

      // Delta removing doc1
      transport.simulateMessage({
        type: 'delta',
        delta: {
          subscriptionId: query.id,
          type: 'delta',
          added: [],
          removed: ['doc1'],
          modified: [],
          sequence: 2,
          timestamp: Date.now(),
        },
      });

      const latestResults = allResults[allResults.length - 1]!;
      expect(latestResults).toHaveLength(1);
      expect((latestResults[0] as { _id: string })._id).toBe('doc2');
    });

    it('applies delta with modified documents', () => {
      const query = makeQuery('users');
      const sub = client.subscribe(query);

      const allResults: unknown[][] = [];
      sub.results$.subscribe((r) => allResults.push(r));

      // Initial
      transport.simulateMessage({
        type: 'initial',
        subscriptionId: query.id,
        results: [{ _id: 'doc1', name: 'Alice' }],
        sequence: 1,
      });

      // Delta modifying doc1
      transport.simulateMessage({
        type: 'delta',
        delta: {
          subscriptionId: query.id,
          type: 'delta',
          added: [],
          removed: [],
          modified: [{ _id: 'doc1', name: 'Alice Updated' }],
          sequence: 2,
          timestamp: Date.now(),
        },
      });

      const latestResults = allResults[allResults.length - 1]!;
      expect(latestResults).toHaveLength(1);
      expect((latestResults[0] as { _id: string; name: string }).name).toBe('Alice Updated');
    });

    it('emits deltas through delta$ observable', () => {
      const query = makeQuery('users');
      const sub = client.subscribe(query);

      const deltas: unknown[] = [];
      sub.delta$.subscribe((d) => deltas.push(d));

      transport.simulateMessage({
        type: 'delta',
        delta: {
          subscriptionId: query.id,
          type: 'delta',
          added: [{ _id: 'doc1' }],
          removed: [],
          modified: [],
          sequence: 1,
          timestamp: Date.now(),
        },
      });

      expect(deltas).toHaveLength(1);
    });
  });

  describe('unsubscribe', () => {
    it('sends unsubscribe message to server', () => {
      const query = makeQuery('users');
      const sub = client.subscribe(query);
      transport._sentMessages = [];

      sub.unsubscribe();

      expect(transport._sentMessages).toHaveLength(1);
      expect(transport._sentMessages[0]!.type).toBe('unsubscribe');
    });

    it('completes observables on unsubscribe', () => {
      const query = makeQuery('users');
      const sub = client.subscribe(query);

      let resultsCompleted = false;
      let deltasCompleted = false;

      sub.results$.subscribe({
        complete: () => {
          resultsCompleted = true;
        },
      });
      sub.delta$.subscribe({
        complete: () => {
          deltasCompleted = true;
        },
      });

      sub.unsubscribe();

      expect(resultsCompleted).toBe(true);
      expect(deltasCompleted).toBe(true);
    });

    it('cleans up internal state', () => {
      const query = makeQuery('users');
      const sub = client.subscribe(query);
      sub.unsubscribe();

      expect(client.getActiveCount()).toBe(0);
      expect(client.getResults(query.id)).toBeUndefined();
    });
  });

  describe('reconnection', () => {
    it('re-subscribes all active subscriptions on reconnect', () => {
      client.subscribe(makeQuery('users'));
      client.subscribe(makeQuery('posts'));
      transport._sentMessages = [];

      transport.simulateConnect();

      expect(transport._sentMessages).toHaveLength(2);
      expect(transport._sentMessages.every((m) => m.type === 'subscribe')).toBe(true);
    });

    it('does not re-subscribe unsubscribed subscriptions', () => {
      const sub = client.subscribe(makeQuery('users'));
      sub.unsubscribe();
      transport._sentMessages = [];

      transport.simulateConnect();

      expect(transport._sentMessages).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('emits error through delta$ when server sends error', () => {
      const query = makeQuery('users');
      const sub = client.subscribe(query);

      let receivedError: Error | null = null;
      sub.delta$.subscribe({
        error: (err) => {
          receivedError = err as Error;
        },
      });

      transport.simulateMessage({
        type: 'error',
        subscriptionId: query.id,
        error: 'Subscription failed',
      });

      expect(receivedError).not.toBeNull();
      expect(receivedError!.message).toBe('Subscription failed');
    });
  });

  describe('getResults', () => {
    it('returns current cached results', () => {
      const query = makeQuery('users');
      client.subscribe(query);

      transport.simulateMessage({
        type: 'initial',
        subscriptionId: query.id,
        results: [{ _id: 'doc1', name: 'Alice' }],
        sequence: 1,
      });

      const results = client.getResults(query.id);
      expect(results).toHaveLength(1);
    });
  });

  describe('unsubscribeAll', () => {
    it('unsubscribes from all active subscriptions', () => {
      client.subscribe(makeQuery('users'));
      client.subscribe(makeQuery('posts'));

      expect(client.getActiveCount()).toBe(2);

      client.unsubscribeAll();

      expect(client.getActiveCount()).toBe(0);
    });
  });

  describe('destroy', () => {
    it('cleans up everything', () => {
      client.subscribe(makeQuery('users'));
      client.subscribe(makeQuery('posts'));

      client.destroy();

      expect(client.getActiveCount()).toBe(0);
    });

    it('ignores messages after destroy', () => {
      const query = makeQuery('users');
      const sub = client.subscribe(query);

      const results: unknown[][] = [];
      sub.results$.subscribe((r) => results.push(r));

      client.destroy();

      // Should not throw or emit
      transport.simulateMessage({
        type: 'delta',
        delta: {
          subscriptionId: query.id,
          type: 'delta',
          added: [{ _id: 'doc1' }],
          removed: [],
          modified: [],
          sequence: 1,
          timestamp: Date.now(),
        },
      });

      // Only the initial empty emission from BehaviorSubject
      expect(results).toHaveLength(1);
    });
  });
});
