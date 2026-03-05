import { Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';
import type { SubscriptionEvent } from '../subscription-bridge.js';
import { createSubscriptionBridge } from '../subscription-bridge.js';

describe('SubscriptionBridge', () => {
  function createMockFactory() {
    const subjects = new Map<string, Subject<SubscriptionEvent>>();
    const factory = (collection: string) => {
      let subject = subjects.get(collection);
      if (!subject) {
        subject = new Subject<SubscriptionEvent>();
        subjects.set(collection, subject);
      }
      return subject.asObservable();
    };
    return { factory, subjects };
  }

  it('should subscribe and receive events', () => {
    const { factory, subjects } = createMockFactory();
    const bridge = createSubscriptionBridge(factory);

    const events: SubscriptionEvent[] = [];
    bridge.subscribe('client-1', 'sub-1', 'users', '*');
    bridge.getClientEvents$('client-1').subscribe((e) => events.push(e));

    subjects.get('users')!.next({
      type: 'created',
      collection: 'users',
      data: { name: 'Alice' },
      timestamp: Date.now(),
    });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('created');
    bridge.destroy();
  });

  it('should filter by event type', () => {
    const { factory, subjects } = createMockFactory();
    const bridge = createSubscriptionBridge(factory);

    const events: SubscriptionEvent[] = [];
    bridge.subscribe('client-1', 'sub-1', 'users', 'created');
    bridge.getClientEvents$('client-1').subscribe((e) => events.push(e));

    subjects
      .get('users')!
      .next({ type: 'created', collection: 'users', data: {}, timestamp: Date.now() });
    subjects
      .get('users')!
      .next({ type: 'updated', collection: 'users', data: {}, timestamp: Date.now() });

    expect(events.length).toBe(1);
    bridge.destroy();
  });

  it('should enforce max subscriptions per client', () => {
    const { factory } = createMockFactory();
    const bridge = createSubscriptionBridge(factory, { maxSubscriptionsPerClient: 2 });

    expect(bridge.subscribe('c1', 's1', 'a', '*')).toBe(true);
    expect(bridge.subscribe('c1', 's2', 'b', '*')).toBe(true);
    expect(bridge.subscribe('c1', 's3', 'c', '*')).toBe(false);
    bridge.destroy();
  });

  it('should unsubscribe specific subscription', () => {
    const { factory } = createMockFactory();
    const bridge = createSubscriptionBridge(factory);

    bridge.subscribe('c1', 's1', 'users', '*');
    expect(bridge.getActiveSubscriptions().length).toBe(1);

    bridge.unsubscribe('s1');
    expect(bridge.getActiveSubscriptions().length).toBe(0);
    bridge.destroy();
  });

  it('should unsubscribe all for a client', () => {
    const { factory } = createMockFactory();
    const bridge = createSubscriptionBridge(factory);

    bridge.subscribe('c1', 's1', 'users', '*');
    bridge.subscribe('c1', 's2', 'posts', '*');
    bridge.subscribe('c2', 's3', 'users', '*');

    bridge.unsubscribeClient('c1');
    expect(bridge.getActiveSubscriptions().length).toBe(1);
    expect(bridge.getActiveSubscriptions()[0].clientId).toBe('c2');
    bridge.destroy();
  });

  it('should track subscription count', () => {
    const { factory } = createMockFactory();
    const bridge = createSubscriptionBridge(factory);

    bridge.subscribe('c1', 's1', 'a', '*');
    bridge.subscribe('c1', 's2', 'b', '*');
    expect(bridge.getClientSubscriptionCount('c1')).toBe(2);
    expect(bridge.getClientSubscriptionCount('c2')).toBe(0);
    bridge.destroy();
  });
});
