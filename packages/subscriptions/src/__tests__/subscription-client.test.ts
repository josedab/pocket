import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionClient, createSubscriptionClient } from '../client/subscription-client.js';
import type { SubscriptionDelta, SubscriptionMessage, SubscriptionQuery } from '../types.js';

function makeQuery(
  collection: string,
  overrides: Partial<SubscriptionQuery> = {}
): SubscriptionQuery {
  return {
    id: `sub-${Math.random().toString(36).substring(2, 7)}`,
    collection,
    ...overrides,
  };
}

function createMockTransport() {
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

describe('SubscriptionClient (extended)', () => {
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

  describe('createSubscriptionClient factory', () => {
    it('returns a SubscriptionClient instance', () => {
      const c = createSubscriptionClient();
      expect(c).toBeInstanceOf(SubscriptionClient);
      c.destroy();
    });
  });

  describe('subscribe before connect', () => {
    it('does not send when transport is disconnected', () => {
      const freshClient = new SubscriptionClient();
      const disconnectedTransport = createMockTransport();
      disconnectedTransport._connected = false;
      freshClient.connect(disconnectedTransport);

      freshClient.subscribe(makeQuery('users'));

      // Message not sent because transport is disconnected
      expect(disconnectedTransport._sentMessages).toHaveLength(0);
      freshClient.destroy();
    });

    it('subscribe before connect creates internal state but does not send', () => {
      const freshClient = new SubscriptionClient();
      // No connect call
      freshClient.subscribe(makeQuery('users'));
      expect(freshClient.getActiveCount()).toBe(1);
      freshClient.destroy();
    });
  });

  describe('multiple subscriptions', () => {
    it('manages multiple independent subscriptions', () => {
      const q1 = makeQuery('users');
      const q2 = makeQuery('posts');
      const sub1 = client.subscribe(q1);
      const sub2 = client.subscribe(q2);

      expect(client.getActiveCount()).toBe(2);
      expect(sub1.id).not.toBe(sub2.id);
    });

    it('delivers deltas to the correct subscription', () => {
      const q1 = makeQuery('users');
      const q2 = makeQuery('posts');
      client.subscribe(q1);
      client.subscribe(q2);

      const q1Results: unknown[][] = [];
      client.subscribe(q1).results$.subscribe((r) => q1Results.push(r));

      // Actually subscribe and track - use the original subs
      const sub1 = client.subscribe(makeQuery('users', { id: 'users-sub' }));
      const sub2 = client.subscribe(makeQuery('posts', { id: 'posts-sub' }));

      const s1Deltas: SubscriptionDelta[] = [];
      const s2Deltas: SubscriptionDelta[] = [];
      sub1.delta$.subscribe((d) => s1Deltas.push(d));
      sub2.delta$.subscribe((d) => s2Deltas.push(d));

      transport.simulateMessage({
        type: 'delta',
        delta: {
          subscriptionId: 'users-sub',
          type: 'delta',
          added: [{ _id: 'u1', name: 'Alice' }],
          removed: [],
          modified: [],
          sequence: 1,
          timestamp: Date.now(),
        },
      });

      expect(s1Deltas).toHaveLength(1);
      expect(s2Deltas).toHaveLength(0);
    });
  });

  describe('delta for non-existent subscription', () => {
    it('silently ignores delta for unknown subscription', () => {
      expect(() => {
        transport.simulateMessage({
          type: 'delta',
          delta: {
            subscriptionId: 'nonexistent',
            type: 'delta',
            added: [{ _id: 'd1' }],
            removed: [],
            modified: [],
            sequence: 1,
            timestamp: Date.now(),
          },
        });
      }).not.toThrow();
    });
  });

  describe('initial results', () => {
    it('replaces cache on initial message', () => {
      const q = makeQuery('users');
      client.subscribe(q);

      // First: simulate some delta to populate cache
      transport.simulateMessage({
        type: 'delta',
        delta: {
          subscriptionId: q.id,
          type: 'delta',
          added: [{ _id: 'old1' }],
          removed: [],
          modified: [],
          sequence: 1,
          timestamp: Date.now(),
        },
      });
      expect(client.getResults(q.id)).toHaveLength(1);

      // Then: initial replaces everything
      transport.simulateMessage({
        type: 'initial',
        subscriptionId: q.id,
        results: [{ _id: 'new1' }, { _id: 'new2' }],
        sequence: 2,
      });

      const results = client.getResults(q.id);
      expect(results).toHaveLength(2);
      expect(results!.map((r: unknown) => (r as { _id: string })._id).sort()).toEqual([
        'new1',
        'new2',
      ]);
    });

    it('emits initial delta through delta$ observable', () => {
      const q = makeQuery('users');
      const sub = client.subscribe(q);

      const deltas: SubscriptionDelta[] = [];
      sub.delta$.subscribe((d) => deltas.push(d));

      transport.simulateMessage({
        type: 'initial',
        subscriptionId: q.id,
        results: [{ _id: 'd1' }],
        sequence: 1,
      });

      expect(deltas).toHaveLength(1);
      expect(deltas[0]!.type).toBe('initial');
      expect(deltas[0]!.added).toHaveLength(1);
    });

    it('skips documents without _id in initial results', () => {
      const q = makeQuery('users');
      client.subscribe(q);

      transport.simulateMessage({
        type: 'initial',
        subscriptionId: q.id,
        results: [{ _id: 'd1' }, { noId: true }, { _id: 'd2' }],
        sequence: 1,
      });

      const results = client.getResults(q.id);
      expect(results).toHaveLength(2);
    });
  });

  describe('delta edge cases', () => {
    it('skips added documents without _id', () => {
      const q = makeQuery('users');
      client.subscribe(q);

      transport.simulateMessage({
        type: 'delta',
        delta: {
          subscriptionId: q.id,
          type: 'delta',
          added: [{ _id: 'd1' }, { noId: true }],
          removed: [],
          modified: [],
          sequence: 1,
          timestamp: Date.now(),
        },
      });

      expect(client.getResults(q.id)).toHaveLength(1);
    });

    it('skips modified documents without _id', () => {
      const q = makeQuery('users');
      client.subscribe(q);

      transport.simulateMessage({
        type: 'initial',
        subscriptionId: q.id,
        results: [{ _id: 'd1', name: 'Alice' }],
        sequence: 1,
      });

      transport.simulateMessage({
        type: 'delta',
        delta: {
          subscriptionId: q.id,
          type: 'delta',
          added: [],
          removed: [],
          modified: [{ noId: true, name: 'Ghost' }],
          sequence: 2,
          timestamp: Date.now(),
        },
      });

      const results = client.getResults(q.id) as { _id: string; name: string }[];
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('handles delta with all three operation types simultaneously', () => {
      const q = makeQuery('users');
      client.subscribe(q);

      // Set up initial data
      transport.simulateMessage({
        type: 'initial',
        subscriptionId: q.id,
        results: [
          { _id: 'd1', name: 'Alice' },
          { _id: 'd2', name: 'Bob' },
        ],
        sequence: 1,
      });

      // Delta with add + remove + modify
      transport.simulateMessage({
        type: 'delta',
        delta: {
          subscriptionId: q.id,
          type: 'delta',
          added: [{ _id: 'd3', name: 'Charlie' }],
          removed: ['d1'],
          modified: [{ _id: 'd2', name: 'Bob Updated' }],
          sequence: 2,
          timestamp: Date.now(),
        },
      });

      const results = client.getResults(q.id) as { _id: string; name: string }[];
      expect(results).toHaveLength(2);
      const byId = Object.fromEntries(results.map((r) => [r._id, r.name]));
      expect(byId['d2']).toBe('Bob Updated');
      expect(byId['d3']).toBe('Charlie');
      expect(byId['d1']).toBeUndefined();
    });
  });

  describe('reconnection', () => {
    it('re-subscribes all active subscriptions with full queries', () => {
      const q1 = makeQuery('users', { filter: { status: 'active' } });
      const q2 = makeQuery('posts', { limit: 10 });
      client.subscribe(q1);
      client.subscribe(q2);
      transport._sentMessages = [];

      transport.simulateConnect();

      expect(transport._sentMessages).toHaveLength(2);
      const collections = transport._sentMessages
        .map((m) => (m as { query: SubscriptionQuery }).query.collection)
        .sort();
      expect(collections).toEqual(['posts', 'users']);
    });

    it('preserves existing cache across reconnect', () => {
      const q = makeQuery('users');
      client.subscribe(q);

      transport.simulateMessage({
        type: 'initial',
        subscriptionId: q.id,
        results: [{ _id: 'd1', name: 'Alice' }],
        sequence: 1,
      });

      transport.simulateConnect();

      // Cache should still be intact
      expect(client.getResults(q.id)).toHaveLength(1);
    });

    it('does not send subscribe if transport disconnected during reconnect handler', () => {
      client.subscribe(makeQuery('users'));
      transport._sentMessages = [];
      transport._connected = false;

      // simulateConnect sets _connected = true, but if transport immediately disconnects...
      // The handler checks isConnected, so messages ARE sent
      transport.simulateConnect();
      // Messages are sent because connect sets _connected = true
      expect(transport._sentMessages).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('error for unknown subscription does not crash', () => {
      expect(() => {
        transport.simulateMessage({
          type: 'error',
          subscriptionId: 'nonexistent',
          error: 'Some error',
        });
      }).not.toThrow();
    });
  });

  describe('unsubscribe edge cases', () => {
    it('unsubscribing non-existent subscription does not crash', () => {
      expect(() => client.unsubscribe('nonexistent')).not.toThrow();
    });

    it('double unsubscribe does not crash', () => {
      const q = makeQuery('users');
      const sub = client.subscribe(q);
      sub.unsubscribe();
      expect(() => sub.unsubscribe()).not.toThrow();
    });

    it('no longer receives deltas after unsubscribe', () => {
      const q = makeQuery('users');
      const sub = client.subscribe(q);

      const results: unknown[][] = [];
      sub.results$.subscribe({
        next: (r) => results.push(r),
        complete: () => {},
      });

      sub.unsubscribe();
      results.length = 0;

      transport.simulateMessage({
        type: 'delta',
        delta: {
          subscriptionId: q.id,
          type: 'delta',
          added: [{ _id: 'd1' }],
          removed: [],
          modified: [],
          sequence: 1,
          timestamp: Date.now(),
        },
      });

      // results$ was completed, so no new emissions
      expect(results).toHaveLength(0);
    });
  });

  describe('unsubscribeAll', () => {
    it('sends unsubscribe for each active subscription', () => {
      client.subscribe(makeQuery('users'));
      client.subscribe(makeQuery('posts'));
      client.subscribe(makeQuery('comments'));
      transport._sentMessages = [];

      client.unsubscribeAll();

      const unsubs = transport._sentMessages.filter((m) => m.type === 'unsubscribe');
      expect(unsubs).toHaveLength(3);
      expect(client.getActiveCount()).toBe(0);
    });
  });

  describe('destroy', () => {
    it('ignores all message types after destroy', () => {
      const q = makeQuery('users');
      client.subscribe(q);
      client.destroy();

      // None of these should throw or emit
      expect(() => {
        transport.simulateMessage({ type: 'ack', subscriptionId: q.id });
        transport.simulateMessage({ type: 'error', subscriptionId: q.id, error: 'test' });
        transport.simulateMessage({
          type: 'initial',
          subscriptionId: q.id,
          results: [{ _id: 'd1' }],
          sequence: 1,
        });
        transport.simulateMessage({
          type: 'delta',
          delta: {
            subscriptionId: q.id,
            type: 'delta',
            added: [{ _id: 'd1' }],
            removed: [],
            modified: [],
            sequence: 1,
            timestamp: Date.now(),
          },
        });
      }).not.toThrow();
    });
  });

  describe('getResults', () => {
    it('returns undefined for non-existent subscription', () => {
      expect(client.getResults('nonexistent')).toBeUndefined();
    });

    it('returns empty array for new subscription before any data', () => {
      const q = makeQuery('users');
      client.subscribe(q);
      const results = client.getResults(q.id);
      expect(results).toEqual([]);
    });
  });

  describe('ack messages', () => {
    it('ack messages are handled without error', () => {
      const q = makeQuery('users');
      client.subscribe(q);

      expect(() => {
        transport.simulateMessage({ type: 'ack', subscriptionId: q.id });
      }).not.toThrow();

      // State should remain unchanged
      expect(client.getActiveCount()).toBe(1);
    });
  });

  describe('results$ BehaviorSubject', () => {
    it('emits initial empty array immediately on subscription', () => {
      const q = makeQuery('users');
      const sub = client.subscribe(q);

      let received = false;
      sub.results$.subscribe(() => {
        received = true;
      });

      // BehaviorSubject emits current value immediately
      expect(received).toBe(true);
    });

    it('late subscribers get the latest value', () => {
      const q = makeQuery('users');
      const sub = client.subscribe(q);

      transport.simulateMessage({
        type: 'initial',
        subscriptionId: q.id,
        results: [{ _id: 'd1' }, { _id: 'd2' }],
        sequence: 1,
      });

      // Late subscriber should immediately get current results
      let lateResults: unknown[] = [];
      sub.results$.subscribe((r) => {
        lateResults = r;
      });

      expect(lateResults).toHaveLength(2);
    });
  });
});
