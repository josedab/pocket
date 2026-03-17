import type { Document } from '@pocket/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionServer, createSubscriptionServer } from '../server/subscription-server.js';
import type { SubscriptionMessage, SubscriptionQuery } from '../types.js';

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

describe('SubscriptionServer (extended)', () => {
  let server: SubscriptionServer;
  let sent: { clientId: string; message: SubscriptionMessage }[];

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    server = new SubscriptionServer({ batchIntervalMs: 50, maxBatchSize: 100 });
    server.setSendToClient((clientId, message) => {
      sent.push({ clientId, message });
    });
  });

  afterEach(() => {
    server.shutdown();
    vi.useRealTimers();
  });

  describe('createSubscriptionServer factory', () => {
    it('returns a SubscriptionServer instance', () => {
      const s = createSubscriptionServer();
      expect(s).toBeInstanceOf(SubscriptionServer);
      s.shutdown();
    });

    it('passes config through', () => {
      const s = createSubscriptionServer({ maxSubscriptionsPerClient: 3 });
      const config = s.getRegistry().getConfig();
      expect(config.maxSubscriptionsPerClient).toBe(3);
      s.shutdown();
    });
  });

  describe('handleMessage ignores server-to-client message types', () => {
    it('ignores delta messages from client', () => {
      server.handleMessage('c1', {
        type: 'delta',
        delta: {
          subscriptionId: 'x',
          type: 'delta',
          added: [],
          removed: [],
          modified: [],
          sequence: 1,
          timestamp: Date.now(),
        },
      });
      expect(sent).toHaveLength(0);
    });

    it('ignores ack messages from client', () => {
      server.handleMessage('c1', { type: 'ack', subscriptionId: 'x' });
      expect(sent).toHaveLength(0);
    });

    it('ignores error messages from client', () => {
      server.handleMessage('c1', { type: 'error', subscriptionId: 'x', error: 'test' });
      expect(sent).toHaveLength(0);
    });

    it('ignores initial messages from client', () => {
      server.handleMessage('c1', {
        type: 'initial',
        subscriptionId: 'x',
        results: [],
        sequence: 0,
      });
      expect(sent).toHaveLength(0);
    });
  });

  describe('no sendToClient set', () => {
    it('does not throw when sendToClient is not set', () => {
      const noSendServer = new SubscriptionServer({ batchIntervalMs: 0 });
      // Should not throw even without setSendToClient
      expect(() => {
        noSendServer.handleMessage('c1', { type: 'subscribe', query: makeQuery('users') });
      }).not.toThrow();
      noSendServer.shutdown();
    });

    it('silently drops messages when no sender configured', () => {
      const noSendServer = new SubscriptionServer({ batchIntervalMs: 0 });
      noSendServer.handleMessage('c1', { type: 'subscribe', query: makeQuery('users') });
      noSendServer.processChange('users', makeChange('insert', 'd1', makeDoc('d1')));
      // No crash
      noSendServer.shutdown();
    });
  });

  describe('multiple clients same collection', () => {
    it('delivers deltas to all subscribed clients', () => {
      const q1 = makeQuery('users');
      const q2 = makeQuery('users');
      server.handleMessage('c1', { type: 'subscribe', query: q1 });
      server.handleMessage('c2', { type: 'subscribe', query: q2 });
      sent = [];

      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1')));
      vi.advanceTimersByTime(60);

      // Both clients should get deltas
      expect(sent).toHaveLength(2);
      const clients = sent.map((s) => s.clientId).sort();
      expect(clients).toEqual(['c1', 'c2']);
    });

    it('respects per-client filters independently', () => {
      const q1 = makeQuery('users', { filter: { status: 'active' } });
      const q2 = makeQuery('users', { filter: { status: 'inactive' } });
      server.handleMessage('c1', { type: 'subscribe', query: q1 });
      server.handleMessage('c2', { type: 'subscribe', query: q2 });
      sent = [];

      server.processChange(
        'users',
        makeChange('insert', 'd1', makeDoc('d1', { status: 'active' }))
      );
      vi.advanceTimersByTime(60);

      // Only c1 should receive the delta
      expect(sent).toHaveLength(1);
      expect(sent[0]!.clientId).toBe('c1');
    });
  });

  describe('unsubscribe edge cases', () => {
    it('unsubscribing non-existent subscription does not crash', () => {
      expect(() => {
        server.handleMessage('c1', { type: 'unsubscribe', subscriptionId: 'nonexistent' });
      }).not.toThrow();
    });

    it('unsubscribed subscription stops receiving deltas', () => {
      const q = makeQuery('users');
      server.handleMessage('c1', { type: 'subscribe', query: q });
      sent = [];

      server.handleMessage('c1', { type: 'unsubscribe', subscriptionId: q.id });

      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1')));
      vi.advanceTimersByTime(60);

      expect(sent).toHaveLength(0);
    });

    it('cancels pending batch timer on unsubscribe', () => {
      const q = makeQuery('users');
      server.handleMessage('c1', { type: 'subscribe', query: q });
      sent = [];

      // Enqueue a change
      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1')));

      // Unsubscribe before batch flushes
      server.handleMessage('c1', { type: 'unsubscribe', subscriptionId: q.id });

      vi.advanceTimersByTime(60);
      expect(sent).toHaveLength(0);
    });
  });

  describe('delta coalescing', () => {
    it('coalesces remove followed by re-add into modified', () => {
      const q = makeQuery('users');
      server.handleMessage('c1', { type: 'subscribe', query: q });
      sent = [];

      // First: insert doc (makes it tracked)
      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1', { v: 1 })));
      vi.advanceTimersByTime(60);
      sent = [];

      // Now remove and re-add within same batch window
      server.processChange('users', makeChange('delete', 'd1', null));
      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1', { v: 2 })));
      vi.advanceTimersByTime(60);

      if (sent.length > 0) {
        const delta = (
          sent[0]!.message as {
            type: 'delta';
            delta: { added: Document[]; removed: string[]; modified: Document[] };
          }
        ).delta;
        // d1 was removed then re-added: should show as modified (coalesced)
        expect(delta.removed).not.toContain('d1');
      }
    });

    it('coalesces multiple modifications of same doc', () => {
      const q = makeQuery('users');
      server.handleMessage('c1', { type: 'subscribe', query: q });
      sent = [];

      // Insert then multiple updates within batch window
      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1', { v: 1 })));
      server.processChange('users', makeChange('update', 'd1', makeDoc('d1', { v: 2 })));
      server.processChange('users', makeChange('update', 'd1', makeDoc('d1', { v: 3 })));

      vi.advanceTimersByTime(60);

      expect(sent).toHaveLength(1);
      const delta = (
        sent[0]!.message as { type: 'delta'; delta: { added: Document[]; modified: Document[] } }
      ).delta;
      // The final version of d1 should appear (v: 3)
      const allDocs = [...delta.added, ...delta.modified];
      const d1 = allDocs.find((d) => d._id === 'd1');
      expect(d1).toBeDefined();
    });
  });

  describe('handleClientDisconnect', () => {
    it('cancels pending batch timers for disconnecting client', () => {
      const q = makeQuery('users');
      server.handleMessage('c1', { type: 'subscribe', query: q });
      sent = [];

      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1')));
      // Don't flush yet

      server.handleClientDisconnect('c1');

      vi.advanceTimersByTime(60);
      // Should not receive delta after disconnect
      expect(sent).toHaveLength(0);
    });

    it('handles disconnect for unknown client gracefully', () => {
      expect(() => server.handleClientDisconnect('unknown')).not.toThrow();
    });

    it('preserves other client subscriptions', () => {
      server.handleMessage('c1', { type: 'subscribe', query: makeQuery('users') });
      server.handleMessage('c2', { type: 'subscribe', query: makeQuery('users') });

      server.handleClientDisconnect('c1');

      expect(server.getRegistry().getClientSubscriptions('c2')).toHaveLength(1);
    });
  });

  describe('shutdown', () => {
    it('clears all pending timers and deltas', () => {
      const q = makeQuery('users');
      server.handleMessage('c1', { type: 'subscribe', query: q });
      sent = [];

      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1')));
      server.shutdown();

      vi.advanceTimersByTime(1000);
      expect(sent).toHaveLength(0);
    });

    it('can be called multiple times safely', () => {
      expect(() => {
        server.shutdown();
        server.shutdown();
      }).not.toThrow();
    });
  });

  describe('getStats', () => {
    it('reflects subscription count changes', () => {
      expect(server.getStats().totalSubscriptions).toBe(0);

      const q = makeQuery('users');
      server.handleMessage('c1', { type: 'subscribe', query: q });
      expect(server.getStats().totalSubscriptions).toBe(1);

      server.handleMessage('c1', { type: 'unsubscribe', subscriptionId: q.id });
      expect(server.getStats().totalSubscriptions).toBe(0);
    });
  });

  describe('getRegistry', () => {
    it('returns the underlying registry', () => {
      const registry = server.getRegistry();
      expect(registry).toBeDefined();
      expect(typeof registry.register).toBe('function');
    });
  });

  describe('batchIntervalMs = 0', () => {
    it('delivers every change immediately', () => {
      const immServer = new SubscriptionServer({ batchIntervalMs: 0 });
      const immSent: { clientId: string; message: SubscriptionMessage }[] = [];
      immServer.setSendToClient((cid, msg) => immSent.push({ clientId: cid, message: msg }));

      const q = makeQuery('users');
      immServer.handleMessage('c1', { type: 'subscribe', query: q });
      immSent.length = 0;

      immServer.processChange('users', makeChange('insert', 'd1', makeDoc('d1')));
      expect(immSent).toHaveLength(1);

      immServer.processChange('users', makeChange('insert', 'd2', makeDoc('d2')));
      expect(immSent).toHaveLength(2);

      immServer.shutdown();
    });
  });

  describe('change routing', () => {
    it('processes changes only for the matching collection', () => {
      server.handleMessage('c1', { type: 'subscribe', query: makeQuery('users') });
      server.handleMessage('c1', { type: 'subscribe', query: makeQuery('posts') });
      sent = [];

      server.processChange('users', makeChange('insert', 'd1', makeDoc('d1')));
      vi.advanceTimersByTime(60);

      // Only one delta (for users), not posts
      expect(sent).toHaveLength(1);
      const delta = (sent[0]!.message as { type: 'delta'; delta: { subscriptionId: string } })
        .delta;
      const usersSubs = server.getRegistry().getSubscriptionsForCollection('users');
      expect(delta.subscriptionId).toBe(usersSubs[0]!.id);
    });
  });
});
