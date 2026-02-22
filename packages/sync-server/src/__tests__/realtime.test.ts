import { afterEach, describe, expect, it } from 'vitest';
import { createRealtimeEngine, RealtimeEngine } from '../realtime.js';
import type { RealtimeEvent, SubscriptionMatch } from '../realtime.js';

describe('RealtimeEngine', () => {
  let engine: RealtimeEngine;

  afterEach(() => {
    engine?.dispose();
  });

  // -----------------------------------------------------------------------
  // Subscribe and receive matching events
  // -----------------------------------------------------------------------

  it('subscribe and receive matching events', () => {
    engine = createRealtimeEngine();

    const sub = engine.subscribe('client-1', 'todos');
    expect(sub.id).toBeDefined();
    expect(sub.clientId).toBe('client-1');
    expect(sub.collection).toBe('todos');

    const event: RealtimeEvent = {
      type: 'insert',
      collection: 'todos',
      documentId: 'doc-1',
      data: { title: 'Buy milk' },
      timestamp: Date.now(),
    };

    const matches = engine.processChange(event);
    expect(matches).toHaveLength(1);
    expect(matches[0].subscriptionId).toBe(sub.id);
    expect(matches[0].clientId).toBe('client-1');
    expect(matches[0].event).toBe(event);
  });

  // -----------------------------------------------------------------------
  // Filter-based subscription matching
  // -----------------------------------------------------------------------

  describe('filter-based subscription matching', () => {
    it('matches with equality filter', () => {
      engine = createRealtimeEngine();

      engine.subscribe('c1', 'todos', { status: 'active' });

      const match = engine.processChange({
        type: 'insert',
        collection: 'todos',
        documentId: 'd1',
        data: { status: 'active', title: 'test' },
        timestamp: Date.now(),
      });

      expect(match).toHaveLength(1);
    });

    it('rejects with non-matching equality filter', () => {
      engine = createRealtimeEngine();

      engine.subscribe('c1', 'todos', { status: 'done' });

      const matches = engine.processChange({
        type: 'insert',
        collection: 'todos',
        documentId: 'd1',
        data: { status: 'active' },
        timestamp: Date.now(),
      });

      expect(matches).toHaveLength(0);
    });

    it('matches with $gt comparison operator', () => {
      engine = createRealtimeEngine();

      engine.subscribe('c1', 'scores', { points: { $gt: 50 } });

      const matches = engine.processChange({
        type: 'update',
        collection: 'scores',
        documentId: 'd1',
        data: { points: 75 },
        timestamp: Date.now(),
      });

      expect(matches).toHaveLength(1);
    });

    it('matches with $lte comparison operator', () => {
      engine = createRealtimeEngine();

      engine.subscribe('c1', 'scores', { points: { $lte: 50 } });

      expect(
        engine.processChange({
          type: 'update',
          collection: 'scores',
          documentId: 'd1',
          data: { points: 50 },
          timestamp: Date.now(),
        }),
      ).toHaveLength(1);

      expect(
        engine.processChange({
          type: 'update',
          collection: 'scores',
          documentId: 'd2',
          data: { points: 51 },
          timestamp: Date.now(),
        }),
      ).toHaveLength(0);
    });

    it('matches with $in operator', () => {
      engine = createRealtimeEngine();

      engine.subscribe('c1', 'tasks', { priority: { $in: ['high', 'critical'] } });

      expect(
        engine.processChange({
          type: 'insert',
          collection: 'tasks',
          documentId: 'd1',
          data: { priority: 'high' },
          timestamp: Date.now(),
        }),
      ).toHaveLength(1);

      expect(
        engine.processChange({
          type: 'insert',
          collection: 'tasks',
          documentId: 'd2',
          data: { priority: 'low' },
          timestamp: Date.now(),
        }),
      ).toHaveLength(0);
    });

    it('matches with $ne operator', () => {
      engine = createRealtimeEngine();

      engine.subscribe('c1', 'items', { deleted: { $ne: true } });

      expect(
        engine.processChange({
          type: 'insert',
          collection: 'items',
          documentId: 'd1',
          data: { deleted: false },
          timestamp: Date.now(),
        }),
      ).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Unsubscribe stops matches
  // -----------------------------------------------------------------------

  it('unsubscribe stops matches', () => {
    engine = createRealtimeEngine();

    const sub = engine.subscribe('c1', 'todos');
    expect(engine.unsubscribe(sub.id)).toBe(true);

    const matches = engine.processChange({
      type: 'insert',
      collection: 'todos',
      documentId: 'd1',
      data: {},
      timestamp: Date.now(),
    });

    expect(matches).toHaveLength(0);
    // Second unsubscribe returns false
    expect(engine.unsubscribe(sub.id)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Client cleanup removes all subscriptions
  // -----------------------------------------------------------------------

  it('client cleanup removes all subscriptions', () => {
    engine = createRealtimeEngine();

    engine.subscribe('c1', 'todos');
    engine.subscribe('c1', 'notes');
    engine.subscribe('c2', 'todos');

    expect(engine.getSubscriptions('c1')).toHaveLength(2);

    engine.unsubscribeClient('c1');

    expect(engine.getSubscriptions('c1')).toHaveLength(0);
    expect(engine.getSubscriptions('c2')).toHaveLength(1);
    expect(engine.getStats().totalSubscriptions).toBe(1);
    expect(engine.getStats().activeClients).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Stats tracking
  // -----------------------------------------------------------------------

  it('stats tracking', () => {
    engine = createRealtimeEngine();

    engine.subscribe('c1', 'todos');
    engine.subscribe('c2', 'notes');

    engine.processChange({
      type: 'insert',
      collection: 'todos',
      documentId: 'd1',
      data: {},
      timestamp: Date.now(),
    });

    engine.processChange({
      type: 'update',
      collection: 'notes',
      documentId: 'd2',
      data: {},
      timestamp: Date.now(),
    });

    const stats = engine.getStats();
    expect(stats.totalSubscriptions).toBe(2);
    expect(stats.activeClients).toBe(2);
    expect(stats.eventsProcessed).toBe(2);
    expect(stats.matchesFound).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Observable emission
  // -----------------------------------------------------------------------

  it('observable emission', () => {
    engine = createRealtimeEngine();

    engine.subscribe('c1', 'todos');

    const received: SubscriptionMatch[] = [];
    const handle = engine.matches$.subscribe((m) => received.push(m));

    engine.processChange({
      type: 'insert',
      collection: 'todos',
      documentId: 'd1',
      data: { title: 'test' },
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].clientId).toBe('c1');

    // Unsubscribe stops emissions
    handle.unsubscribe();

    engine.processChange({
      type: 'insert',
      collection: 'todos',
      documentId: 'd2',
      data: {},
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Non-matching events are filtered out
  // -----------------------------------------------------------------------

  it('non-matching events are filtered out', () => {
    engine = createRealtimeEngine();

    engine.subscribe('c1', 'todos');

    // Different collection
    const matches = engine.processChange({
      type: 'insert',
      collection: 'notes',
      documentId: 'd1',
      data: {},
      timestamp: Date.now(),
    });

    expect(matches).toHaveLength(0);
  });

  it('delete without data skipped when filter is set', () => {
    engine = createRealtimeEngine();

    engine.subscribe('c1', 'todos', { status: 'active' });

    const matches = engine.processChange({
      type: 'delete',
      collection: 'todos',
      documentId: 'd1',
      timestamp: Date.now(),
    });

    expect(matches).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Multiple subscriptions on same collection
  // -----------------------------------------------------------------------

  it('multiple subscriptions on same collection', () => {
    engine = createRealtimeEngine();

    const sub1 = engine.subscribe('c1', 'todos');
    const sub2 = engine.subscribe('c2', 'todos');
    engine.subscribe('c3', 'notes');

    const event: RealtimeEvent = {
      type: 'insert',
      collection: 'todos',
      documentId: 'd1',
      data: {},
      timestamp: Date.now(),
    };

    const matches = engine.processChange(event);

    expect(matches).toHaveLength(2);
    const ids = matches.map((m) => m.subscriptionId);
    expect(ids).toContain(sub1.id);
    expect(ids).toContain(sub2.id);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it('getSubscriptions returns all when no clientId given', () => {
    engine = createRealtimeEngine();

    engine.subscribe('c1', 'todos');
    engine.subscribe('c2', 'notes');

    expect(engine.getSubscriptions()).toHaveLength(2);
  });

  it('unsubscribeClient for unknown client is a no-op', () => {
    engine = createRealtimeEngine();

    engine.unsubscribeClient('unknown');
    expect(engine.getStats().totalSubscriptions).toBe(0);
  });

  it('factory createRealtimeEngine returns a RealtimeEngine', () => {
    engine = createRealtimeEngine({ maxSubscriptionsPerClient: 5 });
    expect(engine).toBeInstanceOf(RealtimeEngine);
  });

  it('respects maxSubscriptionsPerClient', () => {
    engine = createRealtimeEngine({ maxSubscriptionsPerClient: 2 });

    engine.subscribe('c1', 'a');
    engine.subscribe('c1', 'b');

    expect(() => engine.subscribe('c1', 'c')).toThrow(/maximum/);
  });
});
