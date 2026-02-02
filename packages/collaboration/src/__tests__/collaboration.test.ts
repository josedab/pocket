import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CollabSession, createCollabSession } from '../collab-session.js';
import { MemoryTransportHub, createMemoryTransportHub } from '../memory-transport.js';
import { firstValueFrom, take, toArray, timeout } from 'rxjs';
import type { CollabEvent } from '../types.js';

describe('CollabSession', () => {
  let hub: MemoryTransportHub;
  let sessionA: CollabSession;
  let sessionB: CollabSession;

  beforeEach(async () => {
    hub = createMemoryTransportHub();

    sessionA = createCollabSession({
      sessionId: 'test-session',
      user: { id: 'alice', name: 'Alice' },
      transport: hub.createTransport(),
      heartbeatIntervalMs: 60000, // Long to avoid noise in tests
      inactivityTimeoutMs: 60000,
    });

    sessionB = createCollabSession({
      sessionId: 'test-session',
      user: { id: 'bob', name: 'Bob' },
      transport: hub.createTransport(),
      heartbeatIntervalMs: 60000,
      inactivityTimeoutMs: 60000,
    });
  });

  afterEach(() => {
    sessionA.dispose();
    sessionB.dispose();
  });

  it('should start in idle status', () => {
    expect(sessionA.status).toBe('idle');
  });

  it('should transition to connected on connect', async () => {
    await sessionA.connect();
    expect(sessionA.status).toBe('connected');
  });

  it('should notify when a user joins', async () => {
    await sessionA.connect();

    const eventPromise = firstValueFrom(
      sessionA.events$.pipe(
        take(1),
        timeout(1000),
      ),
    );

    await sessionB.connect();
    const event = await eventPromise;
    expect(event.type).toBe('user-joined');
    expect(event.userId).toBe('bob');
  });

  it('should broadcast cursor updates to other sessions', async () => {
    await sessionA.connect();
    await sessionB.connect();

    const received: unknown[] = [];
    const sub = sessionA.cursors$.subscribe((cursors) => {
      if (cursors.length > 0) received.push(cursors);
    });

    sessionB.updateCursor({ documentId: 'doc-1', offset: 42 });

    // Wait for throttle + delivery
    await new Promise((r) => setTimeout(r, 200));

    expect(received.length).toBeGreaterThan(0);
    const cursors = received[0] as Array<{ userId: string; offset: number }>;
    expect(cursors[0]!.userId).toBe('bob');
    expect(cursors[0]!.offset).toBe(42);

    sub.unsubscribe();
  });

  it('should broadcast document changes', async () => {
    await sessionA.connect();
    await sessionB.connect();

    const changePromise = firstValueFrom(
      sessionA.changes$.pipe(
        take(1),
        timeout(1000),
      ),
    );

    sessionB.broadcastChange({
      documentId: 'doc-1',
      collection: 'notes',
      operations: [{ type: 'set', path: 'title', value: 'Hello World' }],
    });

    const change = await changePromise;
    expect(change.documentId).toBe('doc-1');
    expect(change.operations[0]!.value).toBe('Hello World');
  });

  it('should remove user on disconnect', async () => {
    await sessionA.connect();
    await sessionB.connect();

    // Wait for join event
    await new Promise((r) => setTimeout(r, 50));

    const leavePromise = firstValueFrom(
      sessionA.events$.pipe(
        take(1),
        timeout(1000),
      ),
    );

    sessionB.disconnect();
    const event = await leavePromise;
    expect(event.type).toBe('user-left');
  });

  it('should not deliver messages after dispose', async () => {
    await sessionA.connect();
    sessionA.dispose();
    await expect(() => sessionA.connect()).rejects.toThrow('disposed');
  });

  it('should ignore messages from different sessions', async () => {
    const otherSession = createCollabSession({
      sessionId: 'other-session',
      user: { id: 'charlie', name: 'Charlie' },
      transport: hub.createTransport(),
      heartbeatIntervalMs: 60000,
      inactivityTimeoutMs: 60000,
    });

    await sessionA.connect();
    await otherSession.connect();

    // No events should appear since sessionIds don't match
    let eventReceived = false;
    const sub = sessionA.events$.subscribe(() => { eventReceived = true; });

    otherSession.broadcastChange({
      documentId: 'doc-1',
      collection: 'notes',
      operations: [{ type: 'set', path: 'x', value: 1 }],
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(eventReceived).toBe(false);

    sub.unsubscribe();
    otherSession.dispose();
  });
});

describe('MemoryTransportHub', () => {
  it('should deliver messages between transports', async () => {
    const hub = createMemoryTransportHub();
    const t1 = hub.createTransport();
    const t2 = hub.createTransport();

    const received: unknown[] = [];
    t2.onMessage((msg) => received.push(msg));

    await t1.connect();
    await t2.connect();

    t1.send({
      type: 'heartbeat',
      sessionId: 's1',
      userId: 'u1',
      payload: null,
      timestamp: Date.now(),
    });

    expect(received.length).toBe(1);
  });

  it('should not deliver messages to sender', async () => {
    const hub = createMemoryTransportHub();
    const t1 = hub.createTransport();

    const received: unknown[] = [];
    t1.onMessage((msg) => received.push(msg));

    await t1.connect();
    t1.send({
      type: 'heartbeat',
      sessionId: 's1',
      userId: 'u1',
      payload: null,
      timestamp: Date.now(),
    });

    expect(received.length).toBe(0);
  });

  it('should stop delivering after disconnect', async () => {
    const hub = createMemoryTransportHub();
    const t1 = hub.createTransport();
    const t2 = hub.createTransport();

    const received: unknown[] = [];
    t2.onMessage((msg) => received.push(msg));

    await t1.connect();
    await t2.connect();
    t2.disconnect();

    t1.send({
      type: 'heartbeat',
      sessionId: 's1',
      userId: 'u1',
      payload: null,
      timestamp: Date.now(),
    });

    expect(received.length).toBe(0);
  });
});
