import { describe, it, expect, afterEach } from 'vitest';
import {
  SubscriptionManager,
  createSubscriptionManager,
} from '../subscription-manager.js';
import type { SubscriptionEvent } from '../subscription-manager.js';

/* ================================================================== */
/*  SubscriptionManager                                                */
/* ================================================================== */

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;

  afterEach(() => {
    manager?.unsubscribeAll();
  });

  it('should subscribe and receive callback on emit', () => {
    manager = createSubscriptionManager();
    const events: SubscriptionEvent[] = [];

    manager.subscribe('todos', undefined, (event) => {
      events.push(event);
    });

    manager.emit({ collection: 'todos', operation: 'insert', data: { id: '1' } });

    expect(events).toHaveLength(1);
    expect(events[0].collection).toBe('todos');
    expect(events[0].operation).toBe('insert');
  });

  it('should unsubscribe and stop receiving callbacks', () => {
    manager = createSubscriptionManager();
    const events: SubscriptionEvent[] = [];

    const unsub = manager.subscribe('todos', undefined, (event) => {
      events.push(event);
    });

    manager.emit({ collection: 'todos', operation: 'insert' });
    expect(events).toHaveLength(1);

    unsub();

    manager.emit({ collection: 'todos', operation: 'update' });
    expect(events).toHaveLength(1); // no new events
  });

  it('should unsubscribeAll and clean up', () => {
    manager = createSubscriptionManager();

    manager.subscribe('todos');
    manager.subscribe('users');
    manager.subscribe('posts');

    expect(manager.getSubscriptionCount()).toBe(3);

    manager.unsubscribeAll();

    expect(manager.getSubscriptionCount()).toBe(0);
    expect(manager.getActiveSubscriptions()).toHaveLength(0);
  });

  it('should track subscription count', () => {
    manager = createSubscriptionManager();

    expect(manager.getSubscriptionCount()).toBe(0);

    const unsub1 = manager.subscribe('todos');
    expect(manager.getSubscriptionCount()).toBe(1);

    const unsub2 = manager.subscribe('users');
    expect(manager.getSubscriptionCount()).toBe(2);

    unsub1();
    expect(manager.getSubscriptionCount()).toBe(1);

    unsub2();
    expect(manager.getSubscriptionCount()).toBe(0);
  });

  it('should support multiple subscriptions to the same collection', () => {
    manager = createSubscriptionManager();
    const events1: SubscriptionEvent[] = [];
    const events2: SubscriptionEvent[] = [];

    manager.subscribe('todos', undefined, (e) => events1.push(e));
    manager.subscribe('todos', undefined, (e) => events2.push(e));

    manager.emit({ collection: 'todos', operation: 'insert', data: { id: '1' } });

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
  });

  it('should only deliver events to matching collection subscribers', () => {
    manager = createSubscriptionManager();
    const todoEvents: SubscriptionEvent[] = [];
    const userEvents: SubscriptionEvent[] = [];

    manager.subscribe('todos', undefined, (e) => todoEvents.push(e));
    manager.subscribe('users', undefined, (e) => userEvents.push(e));

    manager.emit({ collection: 'todos', operation: 'insert' });

    expect(todoEvents).toHaveLength(1);
    expect(userEvents).toHaveLength(0);
  });

  it('should list active subscriptions with metadata', () => {
    manager = createSubscriptionManager();

    manager.subscribe('todos', { completed: true });
    manager.subscribe('users');

    const active = manager.getActiveSubscriptions();
    expect(active).toHaveLength(2);
    expect(active[0].collection).toBe('todos');
    expect(active[0].filter).toEqual({ completed: true });
    expect(active[1].collection).toBe('users');
  });
});
