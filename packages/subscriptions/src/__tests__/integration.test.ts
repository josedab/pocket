import type { Document } from '@pocket/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionClient } from '../client/subscription-client.js';
import { SubscriptionServer } from '../server/subscription-server.js';
import type { SubscriptionDelta, SubscriptionMessage, SubscriptionQuery } from '../types.js';

/**
 * Wire a SubscriptionServer and SubscriptionClient together using an
 * in-memory transport. This simulates a real WebSocket connection for
 * end-to-end integration testing.
 */
function createWiredPair(serverConfig?: {
  batchIntervalMs?: number;
  maxSubscriptionsPerClient?: number;
}) {
  const server = new SubscriptionServer({ batchIntervalMs: 0, ...serverConfig });
  const client = new SubscriptionClient();

  let messageHandler: ((msg: SubscriptionMessage) => void) | null = null;
  let connectHandler: (() => void) | null = null;
  let disconnectHandler: (() => void) | null = null;
  let connected = true;

  // Server sends to client through transport
  server.setSendToClient((_clientId, message) => {
    if (connected && messageHandler) {
      messageHandler(message);
    }
  });

  const transport = {
    send(message: SubscriptionMessage): void {
      if (connected) {
        // Client sends to server
        server.handleMessage('test-client', message);
      }
    },
    onMessage(handler: (message: SubscriptionMessage) => void): void {
      messageHandler = handler;
    },
    onConnect(handler: () => void): void {
      connectHandler = handler;
    },
    onDisconnect(handler: () => void): void {
      disconnectHandler = handler;
    },
    isConnected(): boolean {
      return connected;
    },
  };

  client.connect(transport);

  return {
    server,
    client,
    disconnect() {
      connected = false;
      if (disconnectHandler) disconnectHandler();
    },
    reconnect() {
      connected = true;
      if (connectHandler) connectHandler();
    },
    shutdown() {
      client.destroy();
      server.shutdown();
    },
  };
}

function makeDoc(id: string, fields: Record<string, unknown> = {}): Document {
  return { _id: id, ...fields } as Document;
}

function makeChange(
  operation: 'insert' | 'update' | 'delete',
  documentId: string,
  doc: Document | null = null
) {
  return {
    operation,
    documentId,
    document: doc,
    previousDocument: undefined,
    isFromSync: false,
    timestamp: Date.now(),
    sequence: 0,
  };
}

describe('Integration: Server + Client', () => {
  let pair: ReturnType<typeof createWiredPair>;

  afterEach(() => {
    pair?.shutdown();
  });

  describe('subscribe and receive deltas end-to-end', () => {
    it('client receives inserted document', () => {
      pair = createWiredPair();
      const { server, client } = pair;

      const query: SubscriptionQuery = { id: 'users-sub', collection: 'users' };
      const sub = client.subscribe(query);

      const results: unknown[][] = [];
      sub.results$.subscribe((r) => results.push(r));

      // Server processes an insert
      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1', { name: 'Alice' })));

      // With batchIntervalMs: 0, delta is sent immediately
      // Client should have received it
      const latest = results[results.length - 1]!;
      expect(latest).toHaveLength(1);
      expect((latest[0] as { _id: string; name: string }).name).toBe('Alice');
    });

    it('client receives updates to tracked documents', () => {
      pair = createWiredPair();
      const { server, client } = pair;

      const query: SubscriptionQuery = { id: 'users-sub', collection: 'users' };
      const sub = client.subscribe(query);

      const results: unknown[][] = [];
      sub.results$.subscribe((r) => results.push(r));

      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1', { name: 'Alice' })));
      server.processChange(
        'users',
        makeChange('update', 'd1', makeDoc('d1', { name: 'Alice Updated' }))
      );

      const latest = results[results.length - 1]!;
      expect(latest).toHaveLength(1);
      expect((latest[0] as { name: string }).name).toBe('Alice Updated');
    });

    it('client reflects deletions', () => {
      pair = createWiredPair();
      const { server, client } = pair;

      const query: SubscriptionQuery = { id: 'users-sub', collection: 'users' };
      const sub = client.subscribe(query);

      const results: unknown[][] = [];
      sub.results$.subscribe((r) => results.push(r));

      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1', { name: 'Alice' })));
      server.processChange('users', makeChange('insert', 'd2', makeDoc('d2', { name: 'Bob' })));
      server.processChange('users', makeChange('delete', 'd1', null));

      const latest = results[results.length - 1]!;
      expect(latest).toHaveLength(1);
      expect((latest[0] as { _id: string })._id).toBe('d2');
    });
  });

  describe('filtered subscriptions', () => {
    it('only receives documents matching the filter', () => {
      pair = createWiredPair();
      const { server, client } = pair;

      const query: SubscriptionQuery = {
        id: 'active-users',
        collection: 'users',
        filter: { status: 'active' },
      };
      const sub = client.subscribe(query);

      const deltas: SubscriptionDelta[] = [];
      sub.delta$.subscribe((d) => deltas.push(d));

      // Matching doc
      server.processChange(
        'users',
        makeChange('insert', 'd1', makeDoc('d1', { status: 'active' }))
      );
      // Non-matching doc
      server.processChange(
        'users',
        makeChange('insert', 'd2', makeDoc('d2', { status: 'inactive' }))
      );

      expect(deltas).toHaveLength(1);
      expect(client.getResults('active-users')).toHaveLength(1);
    });

    it('removes document from results when it no longer matches filter', () => {
      pair = createWiredPair();
      const { server, client } = pair;

      const query: SubscriptionQuery = {
        id: 'active-users',
        collection: 'users',
        filter: { status: 'active' },
      };
      client.subscribe(query);

      server.processChange(
        'users',
        makeChange('insert', 'd1', makeDoc('d1', { status: 'active', name: 'Alice' }))
      );
      expect(client.getResults('active-users')).toHaveLength(1);

      server.processChange(
        'users',
        makeChange('update', 'd1', makeDoc('d1', { status: 'inactive', name: 'Alice' }))
      );
      expect(client.getResults('active-users')).toHaveLength(0);
    });

    it('adds document to results when update makes it match', () => {
      pair = createWiredPair();
      const { server, client } = pair;

      const query: SubscriptionQuery = {
        id: 'active-users',
        collection: 'users',
        filter: { status: 'active' },
      };
      client.subscribe(query);

      // Insert non-matching doc
      server.processChange(
        'users',
        makeChange('insert', 'd1', makeDoc('d1', { status: 'inactive' }))
      );
      expect(client.getResults('active-users')).toHaveLength(0);

      // Update makes it match
      server.processChange(
        'users',
        makeChange('update', 'd1', makeDoc('d1', { status: 'active' }))
      );
      expect(client.getResults('active-users')).toHaveLength(1);
    });
  });

  describe('multiple subscriptions on same collection', () => {
    it('each subscription receives its own filtered view', () => {
      pair = createWiredPair();
      const { server, client } = pair;

      const _sub1 = client.subscribe({
        id: 'active',
        collection: 'users',
        filter: { status: 'active' },
      });
      const _sub2 = client.subscribe({
        id: 'admins',
        collection: 'users',
        filter: { role: 'admin' },
      });

      // Active non-admin
      server.processChange(
        'users',
        makeChange('insert', 'd1', makeDoc('d1', { status: 'active', role: 'user' }))
      );
      // Inactive admin
      server.processChange(
        'users',
        makeChange('insert', 'd2', makeDoc('d2', { status: 'inactive', role: 'admin' }))
      );
      // Active admin
      server.processChange(
        'users',
        makeChange('insert', 'd3', makeDoc('d3', { status: 'active', role: 'admin' }))
      );

      expect(client.getResults('active')).toHaveLength(2); // d1, d3
      expect(client.getResults('admins')).toHaveLength(2); // d2, d3
    });
  });

  describe('unsubscribe stops deltas', () => {
    it('no more deltas after unsubscribe', () => {
      pair = createWiredPair();
      const { server, client } = pair;

      const sub = client.subscribe({ id: 'users-sub', collection: 'users' });

      const deltas: SubscriptionDelta[] = [];
      sub.delta$.subscribe({
        next: (d) => deltas.push(d),
        complete: () => {},
      });

      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1')));
      expect(deltas).toHaveLength(1);

      sub.unsubscribe();

      server.processChange('users', makeChange('insert', 'd2', makeDoc('d2')));
      // No new delta
      expect(deltas).toHaveLength(1);
    });
  });

  describe('reconnection flow', () => {
    it('re-establishes subscription after reconnect', () => {
      pair = createWiredPair();
      const { server, client } = pair;

      const _sub = client.subscribe({ id: 'users-sub', collection: 'users' });

      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1')));
      expect(client.getResults('users-sub')).toHaveLength(1);

      // Simulate disconnect and server-side cleanup
      pair.disconnect();
      server.handleClientDisconnect('test-client');

      // Reconnect re-subscribes
      pair.reconnect();

      // After reconnect, subscription is re-registered on server
      const subs = server.getRegistry().getSubscriptionsForCollection('users');
      expect(subs).toHaveLength(1);

      // New changes after reconnect should be delivered
      server.processChange('users', makeChange('insert', 'd2', makeDoc('d2')));

      // Client still has cached d1 from before, plus new d2
      const results = client.getResults('users-sub')!;
      const ids = results.map((r: unknown) => (r as { _id: string })._id);
      expect(ids).toContain('d2');
    });
  });

  describe('subscription limit enforcement', () => {
    it('server rejects subscription beyond limit', () => {
      pair = createWiredPair({ maxSubscriptionsPerClient: 2 });
      const { client } = pair;

      const _sub1 = client.subscribe({ id: 's1', collection: 'a' });
      const _sub2 = client.subscribe({ id: 's2', collection: 'b' });

      // Third should get error from server
      const sub3 = client.subscribe({ id: 's3', collection: 'c' });

      let errorReceived = false;
      sub3.delta$.subscribe({
        error: () => {
          errorReceived = true;
        },
      });

      expect(errorReceived).toBe(true);
    });
  });

  describe('server stats reflect actual usage', () => {
    it('tracks deltas delivered through integration', () => {
      pair = createWiredPair();
      const { server, client } = pair;

      client.subscribe({ id: 'users-sub', collection: 'users' });

      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1')));
      server.processChange('users', makeChange('insert', 'd2', makeDoc('d2')));

      const stats = server.getStats();
      expect(stats.deltasDelivered).toBeGreaterThanOrEqual(2);
      expect(stats.totalSubscriptions).toBe(1);
      expect(stats.activeClients).toBe(1);
    });
  });

  describe('batching integration', () => {
    it('batched server coalesces deltas before sending to client', () => {
      vi.useFakeTimers();
      pair = createWiredPair({ batchIntervalMs: 100 });
      const { server, client } = pair;

      const sub = client.subscribe({ id: 'users-sub', collection: 'users' });

      const results: unknown[][] = [];
      sub.results$.subscribe((r) => results.push(r));

      // Multiple changes within batch window
      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1', { v: 1 })));
      server.processChange('users', makeChange('insert', 'd2', makeDoc('d2', { v: 2 })));
      server.processChange('users', makeChange('insert', 'd3', makeDoc('d3', { v: 3 })));

      // Before flush: only BehaviorSubject initial empty emission
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveLength(0);

      // Flush
      vi.advanceTimersByTime(150);

      // Should get one batched result
      const latest = results[results.length - 1]!;
      expect(latest).toHaveLength(3);

      vi.useRealTimers();
    });
  });

  describe('complex filter integration', () => {
    it('handles $or filter across changes', () => {
      pair = createWiredPair();
      const { server, client } = pair;

      client.subscribe({
        id: 'priority-items',
        collection: 'items',
        filter: { $or: [{ priority: 'high' }, { priority: 'critical' }] },
      });

      server.processChange(
        'items',
        makeChange('insert', 'i1', makeDoc('i1', { priority: 'high' }))
      );
      server.processChange('items', makeChange('insert', 'i2', makeDoc('i2', { priority: 'low' })));
      server.processChange(
        'items',
        makeChange('insert', 'i3', makeDoc('i3', { priority: 'critical' }))
      );
      server.processChange(
        'items',
        makeChange('insert', 'i4', makeDoc('i4', { priority: 'medium' }))
      );

      const results = client.getResults('priority-items')!;
      expect(results).toHaveLength(2);
      const ids = results.map((r: unknown) => (r as { _id: string })._id).sort();
      expect(ids).toEqual(['i1', 'i3']);
    });
  });
});
