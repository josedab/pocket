import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeClientConnection, RealtimeProtocolMessage } from '../realtime-adapter.js';
import { createRealtimeAdapter, RealtimeAdapter } from '../realtime-adapter.js';
import { createRealtimeEngine } from '../realtime.js';
import type { RealtimeEvent } from '../realtime.js';

function mockConnection(id: string): RealtimeClientConnection & { messages: unknown[] } {
  const messages: unknown[] = [];
  return {
    id,
    messages,
    send: (data: unknown) => messages.push(data),
    close: vi.fn(),
  };
}

describe('RealtimeAdapter', () => {
  let adapter: RealtimeAdapter;

  afterEach(() => {
    adapter?.dispose();
  });

  // -----------------------------------------------------------------------
  // Connection / disconnect
  // -----------------------------------------------------------------------

  it('handle connection and disconnect', () => {
    adapter = createRealtimeAdapter({ pingIntervalMs: 0 });
    const conn = mockConnection('c1');
    adapter.handleConnection('c1', conn);

    expect(adapter.getConnectedClients()).toEqual(['c1']);

    adapter.handleDisconnect('c1');
    expect(adapter.getConnectedClients()).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Subscribe via protocol message
  // -----------------------------------------------------------------------

  it('subscribe via protocol message', () => {
    adapter = createRealtimeAdapter({ pingIntervalMs: 0 });
    const conn = mockConnection('c1');
    adapter.handleConnection('c1', conn);

    adapter.handleMessage('c1', JSON.stringify({ type: 'subscribe', collection: 'todos', requestId: 'r1' }));

    expect(conn.messages).toHaveLength(1);
    const ack = conn.messages[0] as RealtimeProtocolMessage;
    expect(ack.type).toBe('ack');
    expect((ack as { requestId: string }).requestId).toBe('r1');
    expect((ack as { subscriptionId?: string }).subscriptionId).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Receive change notification on matching subscription
  // -----------------------------------------------------------------------

  it('receive change notification on matching subscription', () => {
    adapter = createRealtimeAdapter({ pingIntervalMs: 0 });
    const conn = mockConnection('c1');
    adapter.handleConnection('c1', conn);

    adapter.handleMessage('c1', JSON.stringify({ type: 'subscribe', collection: 'todos', requestId: 'r1' }));
    conn.messages.length = 0; // clear ack

    const event: RealtimeEvent = {
      type: 'insert',
      collection: 'todos',
      documentId: 'doc-1',
      data: { title: 'Test' },
      timestamp: Date.now(),
    };
    adapter.broadcastChange(event);

    expect(conn.messages).toHaveLength(1);
    const change = conn.messages[0] as RealtimeProtocolMessage;
    expect(change.type).toBe('change');
    expect((change as { event: RealtimeEvent }).event).toBe(event);
  });

  // -----------------------------------------------------------------------
  // Unsubscribe stops notifications
  // -----------------------------------------------------------------------

  it('unsubscribe stops notifications', () => {
    adapter = createRealtimeAdapter({ pingIntervalMs: 0 });
    const conn = mockConnection('c1');
    adapter.handleConnection('c1', conn);

    adapter.handleMessage('c1', JSON.stringify({ type: 'subscribe', collection: 'todos', requestId: 'r1' }));
    const ack = conn.messages[0] as { subscriptionId: string };
    conn.messages.length = 0;

    adapter.handleMessage(
      'c1',
      JSON.stringify({ type: 'unsubscribe', subscriptionId: ack.subscriptionId, requestId: 'r2' }),
    );
    conn.messages.length = 0;

    adapter.broadcastChange({
      type: 'insert',
      collection: 'todos',
      documentId: 'doc-2',
      data: {},
      timestamp: Date.now(),
    });

    expect(conn.messages).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Unsubscribe-all cleans up
  // -----------------------------------------------------------------------

  it('unsubscribe-all cleans up', () => {
    adapter = createRealtimeAdapter({ pingIntervalMs: 0 });
    const conn = mockConnection('c1');
    adapter.handleConnection('c1', conn);

    adapter.handleMessage('c1', JSON.stringify({ type: 'subscribe', collection: 'a', requestId: 'r1' }));
    adapter.handleMessage('c1', JSON.stringify({ type: 'subscribe', collection: 'b', requestId: 'r2' }));
    conn.messages.length = 0;

    adapter.handleMessage('c1', JSON.stringify({ type: 'unsubscribe-all', requestId: 'r3' }));
    const ack = conn.messages[0] as RealtimeProtocolMessage;
    expect(ack.type).toBe('ack');
    conn.messages.length = 0;

    adapter.broadcastChange({
      type: 'insert',
      collection: 'a',
      documentId: 'd1',
      data: {},
      timestamp: Date.now(),
    });
    expect(conn.messages).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Ping / pong
  // -----------------------------------------------------------------------

  it('ping/pong exchange', () => {
    vi.useFakeTimers();
    try {
      adapter = createRealtimeAdapter({ pingIntervalMs: 1000 });
      const conn = mockConnection('c1');
      adapter.handleConnection('c1', conn);

      vi.advanceTimersByTime(1000);
      expect(conn.messages).toHaveLength(1);
      expect((conn.messages[0] as RealtimeProtocolMessage).type).toBe('ping');

      // Client responds with pong — no error
      adapter.handleMessage('c1', JSON.stringify({ type: 'pong' }));
      // Only the original ping in messages — pong is handled silently
      expect(conn.messages).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // -----------------------------------------------------------------------
  // Invalid message returns error
  // -----------------------------------------------------------------------

  it('invalid JSON returns error', () => {
    adapter = createRealtimeAdapter({ pingIntervalMs: 0 });
    const conn = mockConnection('c1');
    adapter.handleConnection('c1', conn);

    adapter.handleMessage('c1', 'not json');

    expect(conn.messages).toHaveLength(1);
    const errMsg = conn.messages[0] as RealtimeProtocolMessage;
    expect(errMsg.type).toBe('error');
    expect((errMsg as { message: string }).message).toBe('Invalid JSON');
  });

  it('missing type returns error', () => {
    adapter = createRealtimeAdapter({ pingIntervalMs: 0 });
    const conn = mockConnection('c1');
    adapter.handleConnection('c1', conn);

    adapter.handleMessage('c1', JSON.stringify({ foo: 'bar' }));

    expect(conn.messages).toHaveLength(1);
    expect((conn.messages[0] as { type: string }).type).toBe('error');
  });

  it('unknown type returns error', () => {
    adapter = createRealtimeAdapter({ pingIntervalMs: 0 });
    const conn = mockConnection('c1');
    adapter.handleConnection('c1', conn);

    adapter.handleMessage('c1', JSON.stringify({ type: 'unknown-type', requestId: 'r1' }));

    const errMsg = conn.messages[0] as { type: string; message: string };
    expect(errMsg.type).toBe('error');
    expect(errMsg.message).toContain('Unknown message type');
  });

  // -----------------------------------------------------------------------
  // Stats tracking
  // -----------------------------------------------------------------------

  it('stats tracking', () => {
    adapter = createRealtimeAdapter({ pingIntervalMs: 0 });
    const conn = mockConnection('c1');
    adapter.handleConnection('c1', conn);

    adapter.handleMessage('c1', JSON.stringify({ type: 'subscribe', collection: 'todos', requestId: 'r1' }));

    const stats = adapter.getStats();
    expect(stats.connectedClients).toBe(1);
    expect(stats.totalSubscriptions).toBe(1);
    expect(stats.messagesProcessed).toBe(1);
  });

  // -----------------------------------------------------------------------
  // broadcastChange routes to correct clients
  // -----------------------------------------------------------------------

  it('broadcastChange routes to correct clients', () => {
    adapter = createRealtimeAdapter({ pingIntervalMs: 0 });
    const conn1 = mockConnection('c1');
    const conn2 = mockConnection('c2');
    adapter.handleConnection('c1', conn1);
    adapter.handleConnection('c2', conn2);

    // c1 subscribes to 'todos', c2 subscribes to 'notes'
    adapter.handleMessage('c1', JSON.stringify({ type: 'subscribe', collection: 'todos', requestId: 'r1' }));
    adapter.handleMessage('c2', JSON.stringify({ type: 'subscribe', collection: 'notes', requestId: 'r2' }));
    conn1.messages.length = 0;
    conn2.messages.length = 0;

    adapter.broadcastChange({
      type: 'insert',
      collection: 'todos',
      documentId: 'doc-1',
      data: { title: 'Hello' },
      timestamp: Date.now(),
    });

    // c1 should receive the change, c2 should not
    expect(conn1.messages).toHaveLength(1);
    expect((conn1.messages[0] as RealtimeProtocolMessage).type).toBe('change');
    expect(conn2.messages).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Factory with custom engine
  // -----------------------------------------------------------------------

  it('accepts a custom engine', () => {
    const engine = createRealtimeEngine();
    adapter = createRealtimeAdapter({ engine, pingIntervalMs: 0 });
    const conn = mockConnection('c1');
    adapter.handleConnection('c1', conn);

    adapter.handleMessage('c1', JSON.stringify({ type: 'subscribe', collection: 'x', requestId: 'r1' }));

    // Engine should have the subscription
    expect(engine.getSubscriptions('c1')).toHaveLength(1);
  });
});
