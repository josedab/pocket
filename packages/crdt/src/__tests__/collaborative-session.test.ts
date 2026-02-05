import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  BroadcastChannelTransport,
  CollaborativeSessionManager,
  createBroadcastChannelTransport,
  createCollaborativeSessionManager,
  createWebSocketCRDTTransport,
  WebSocketCRDTTransport,
  type CRDTTransport,
  type CRDTTransportMessage,
} from '../collaborative-session.js';
import type {
  CollaborationEvent,
  CRDTSyncMessage,
  JSONCRDTOperation,
  NodeId,
} from '../types.js';
import type { AwarenessUpdate } from '../awareness.js';

// ---------------------------------------------------------------------------
// Mock transport: a simple in-memory transport for deterministic tests
// ---------------------------------------------------------------------------

class MockTransport implements CRDTTransport {
  readonly sent: CRDTTransportMessage[] = [];
  private readonly handlers = new Set<(msg: CRDTTransportMessage) => void>();
  connected = false;

  send(message: CRDTTransportMessage): void {
    this.sent.push(message);
  }

  onMessage(handler: (message: CRDTTransportMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  connect(): void {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  /** Simulate receiving a message from a remote peer. */
  receive(message: CRDTTransportMessage): void {
    for (const handler of this.handlers) {
      handler(message);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper to link two mock transports so messages sent by one arrive at the other
// ---------------------------------------------------------------------------

function linkTransports(a: MockTransport, b: MockTransport): void {
  const origSendA = a.send.bind(a);
  const origSendB = b.send.bind(b);

  a.send = (msg) => {
    origSendA(msg);
    b.receive(msg);
  };

  b.send = (msg) => {
    origSendB(msg);
    a.receive(msg);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CollaborativeSessionManager', () => {
  let transport: MockTransport;
  let session: CollaborativeSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = new MockTransport();
    session = createCollaborativeSessionManager('node-1', {
      transports: [transport],
      announcePresence: false,
    });
  });

  afterEach(() => {
    session.dispose();
    vi.useRealTimers();
  });

  // -- factory function ---------------------------------------------------

  describe('createCollaborativeSessionManager', () => {
    it('should create an instance with the given nodeId', () => {
      expect(session.getNodeId()).toBe('node-1');
    });

    it('should not be started initially', () => {
      expect(session.isStarted()).toBe(false);
    });
  });

  // -- lifecycle ----------------------------------------------------------

  describe('start / stop', () => {
    it('should connect the transport on start', () => {
      session.start();
      expect(transport.connected).toBe(true);
    });

    it('should disconnect the transport on stop', () => {
      session.start();
      session.stop();
      expect(transport.connected).toBe(false);
    });

    it('should toggle isStarted', () => {
      session.start();
      expect(session.isStarted()).toBe(true);
      session.stop();
      expect(session.isStarted()).toBe(false);
    });

    it('should be idempotent for multiple start calls', () => {
      session.start();
      session.start();
      expect(session.isStarted()).toBe(true);
    });

    it('should broadcast peer-leave on stop', () => {
      session.start();
      transport.sent.length = 0; // clear initial messages
      session.stop();

      const leave = transport.sent.find((m) => m.kind === 'peer-leave');
      expect(leave).toBeDefined();
      if (leave && leave.kind === 'peer-leave') {
        expect(leave.nodeId).toBe('node-1');
      }
    });

    it('should broadcast peer-join on start when announcePresence is true', () => {
      const t = new MockTransport();
      const s = createCollaborativeSessionManager('node-a', {
        transports: [t],
        announcePresence: true,
      });
      s.start();
      const join = t.sent.find((m) => m.kind === 'peer-join');
      expect(join).toBeDefined();
      s.dispose();
    });
  });

  // -- document management ------------------------------------------------

  describe('document management', () => {
    it('should create a document', () => {
      const doc = session.createDocument('doc-1', { title: 'Hello' });
      expect(doc).toBeDefined();
      expect(doc.getId()).toBe('doc-1');
      expect(doc.getValue()).toEqual({ title: 'Hello' });
    });

    it('should retrieve a document by id', () => {
      session.createDocument('doc-1');
      const doc = session.getDocument('doc-1');
      expect(doc).toBeDefined();
    });

    it('should return undefined for unknown document ids', () => {
      expect(session.getDocument('unknown')).toBeUndefined();
    });

    it('should throw when creating a document with duplicate id', () => {
      session.createDocument('doc-1');
      expect(() => session.createDocument('doc-1')).toThrow(/already exists/);
    });

    it('should list document ids', () => {
      session.createDocument('a');
      session.createDocument('b');
      expect(session.getDocumentIds()).toEqual(['a', 'b']);
    });

    it('should remove a document', () => {
      session.createDocument('doc-1');
      const removed = session.removeDocument('doc-1');
      expect(removed).toBe(true);
      expect(session.getDocument('doc-1')).toBeUndefined();
    });

    it('should return false when removing a non-existent document', () => {
      expect(session.removeDocument('nope')).toBe(false);
    });
  });

  // -- local operation broadcasting ----------------------------------------

  describe('local operation broadcasting', () => {
    it('should broadcast operations to the transport when a document is edited', () => {
      session.start();
      const doc = session.createDocument('doc-1', { title: '' });

      transport.sent.length = 0;
      doc.set(['title'], 'Updated');

      const syncMsg = transport.sent.find(
        (m) => m.kind === 'sync' && (m as { kind: 'sync'; payload: CRDTSyncMessage }).payload.type === 'operation',
      );
      expect(syncMsg).toBeDefined();
      if (syncMsg && syncMsg.kind === 'sync') {
        expect(syncMsg.payload.documentId).toBe('doc-1');
        expect(syncMsg.payload.operations).toHaveLength(1);
      }
    });
  });

  // -- remote operation handling ------------------------------------------

  describe('remote operations', () => {
    it('should apply remote operations to the correct document', () => {
      session.start();
      const doc = session.createDocument('doc-1', { title: 'Old' });

      const remoteOp: JSONCRDTOperation = {
        id: 'node-2:1',
        type: 'update',
        timestamp: { counter: 100, nodeId: 'node-2' },
        origin: 'node-2',
        path: ['title'],
        value: 'Remote Value',
      };

      const syncMsg: CRDTSyncMessage = {
        type: 'operation',
        from: 'node-2',
        documentId: 'doc-1',
        operations: [remoteOp],
        vclock: { 'node-2': 1 },
      };

      transport.receive({ kind: 'sync', payload: syncMsg });

      expect(doc.getValue()).toEqual({ title: 'Remote Value' });
    });

    it('should emit operation:remote event for remote operations', () => {
      session.start();
      session.createDocument('doc-1', { title: '' });

      const events: CollaborationEvent[] = [];
      session.events().subscribe((e) => events.push(e));

      const remoteOp: JSONCRDTOperation = {
        id: 'node-2:1',
        type: 'update',
        timestamp: { counter: 100, nodeId: 'node-2' },
        origin: 'node-2',
        path: ['title'],
        value: 'New',
      };

      transport.receive({
        kind: 'sync',
        payload: {
          type: 'operation',
          from: 'node-2',
          documentId: 'doc-1',
          operations: [remoteOp],
        },
      });

      const opEvent = events.find((e) => e.type === 'operation:remote');
      expect(opEvent).toBeDefined();
      expect(opEvent?.nodeId).toBe('node-2');
    });

    it('should ignore operations from self', () => {
      session.start();
      const doc = session.createDocument('doc-1', { title: 'Keep' });

      transport.receive({
        kind: 'sync',
        payload: {
          type: 'operation',
          from: 'node-1', // self
          documentId: 'doc-1',
          operations: [
            {
              id: 'node-1:999',
              type: 'update',
              timestamp: { counter: 999, nodeId: 'node-1' },
              origin: 'node-1',
              path: ['title'],
              value: 'Should be ignored',
            },
          ],
        },
      });

      // Value should not change because we ignore our own echoed messages
      expect(doc.getValue()).toEqual({ title: 'Keep' });
    });
  });

  // -- sync request / response --------------------------------------------

  describe('sync request / response', () => {
    it('should send a sync-request message via requestSync', () => {
      session.start();
      session.createDocument('doc-1', { title: 'Local' });
      transport.sent.length = 0;

      session.requestSync('doc-1');

      const req = transport.sent.find(
        (m) => m.kind === 'sync' && (m as { kind: 'sync'; payload: CRDTSyncMessage }).payload.type === 'sync-request',
      );
      expect(req).toBeDefined();
    });

    it('should respond to sync-request with document state', () => {
      session.start();
      const doc = session.createDocument('doc-1', { title: 'State' });

      transport.sent.length = 0;

      transport.receive({
        kind: 'sync',
        payload: {
          type: 'sync-request',
          from: 'node-2',
          documentId: 'doc-1',
          vclock: {},
        },
      });

      const resp = transport.sent.find(
        (m) => m.kind === 'sync' && (m as { kind: 'sync'; payload: CRDTSyncMessage }).payload.type === 'sync-response',
      );
      expect(resp).toBeDefined();
      if (resp && resp.kind === 'sync') {
        expect(resp.payload.from).toBe('node-1');
        expect(resp.payload.documentId).toBe('doc-1');
        expect(resp.payload.operations).toBeDefined();
      }
    });

    it('should apply sync-response operations and emit sync:complete', () => {
      session.start();
      const doc = session.createDocument('doc-1', { title: 'Local' });

      const events: CollaborationEvent[] = [];
      session.events().subscribe((e) => events.push(e));

      const remoteOp: JSONCRDTOperation = {
        id: 'node-2:1',
        type: 'update',
        timestamp: { counter: 200, nodeId: 'node-2' },
        origin: 'node-2',
        path: ['title'],
        value: 'Synced',
      };

      transport.receive({
        kind: 'sync',
        payload: {
          type: 'sync-response',
          from: 'node-2',
          documentId: 'doc-1',
          operations: [remoteOp],
          vclock: { 'node-2': 1 },
        },
      });

      expect(doc.getValue()).toEqual({ title: 'Synced' });
      expect(events.some((e) => e.type === 'sync:complete')).toBe(true);
    });
  });

  // -- peer management ----------------------------------------------------

  describe('peer management', () => {
    it('should track a peer on peer-join', () => {
      session.start();

      transport.receive({ kind: 'peer-join', nodeId: 'node-2', timestamp: Date.now() });

      const peers = session.getPeers();
      expect(peers.size).toBe(1);
      expect(peers.get('node-2')).toBeDefined();
      expect(peers.get('node-2')?.online).toBe(true);
    });

    it('should emit peer:join event', () => {
      session.start();
      const events: CollaborationEvent[] = [];
      session.events().subscribe((e) => events.push(e));

      transport.receive({ kind: 'peer-join', nodeId: 'node-2', timestamp: Date.now() });

      const joinEvent = events.find((e) => e.type === 'peer:join');
      expect(joinEvent).toBeDefined();
      expect(joinEvent?.nodeId).toBe('node-2');
    });

    it('should mark a peer offline on peer-leave', () => {
      session.start();

      transport.receive({ kind: 'peer-join', nodeId: 'node-2', timestamp: Date.now() });
      transport.receive({ kind: 'peer-leave', nodeId: 'node-2', timestamp: Date.now() });

      const peer = session.getPeers().get('node-2');
      expect(peer?.online).toBe(false);
    });

    it('should emit peer:leave event', () => {
      session.start();
      transport.receive({ kind: 'peer-join', nodeId: 'node-2', timestamp: Date.now() });

      const events: CollaborationEvent[] = [];
      session.events().subscribe((e) => events.push(e));

      transport.receive({ kind: 'peer-leave', nodeId: 'node-2', timestamp: Date.now() });

      expect(events.some((e) => e.type === 'peer:leave')).toBe(true);
    });

    it('should ignore peer-join from self', () => {
      session.start();

      transport.receive({ kind: 'peer-join', nodeId: 'node-1', timestamp: Date.now() });

      expect(session.getPeers().size).toBe(0);
    });

    it('should ignore peer-leave from self', () => {
      session.start();
      const events: CollaborationEvent[] = [];
      session.events().subscribe((e) => events.push(e));

      transport.receive({ kind: 'peer-leave', nodeId: 'node-1', timestamp: Date.now() });

      expect(events.filter((e) => e.type === 'peer:leave')).toHaveLength(0);
    });
  });

  // -- awareness ----------------------------------------------------------

  describe('awareness', () => {
    it('should forward local awareness updates to the transport', () => {
      session.start();
      transport.sent.length = 0;

      session.setLocalAwareness({
        user: { name: 'Alice', color: '#f00' },
        cursor: { anchor: 10, head: 10 },
      });

      const awarenessMsg = transport.sent.find((m) => m.kind === 'awareness');
      expect(awarenessMsg).toBeDefined();
      if (awarenessMsg && awarenessMsg.kind === 'awareness') {
        expect(awarenessMsg.payload.nodeId).toBe('node-1');
        expect(awarenessMsg.payload.state?.user?.name).toBe('Alice');
      }
    });

    it('should apply remote awareness updates and emit awareness:update', () => {
      session.start();
      const events: CollaborationEvent[] = [];
      session.events().subscribe((e) => events.push(e));

      const awarenessUpdate: AwarenessUpdate = {
        nodeId: 'node-2',
        state: {
          user: { name: 'Bob', color: '#0f0' },
          cursor: { anchor: 5, head: 5 },
          lastUpdated: Date.now(),
        },
        timestamp: Date.now(),
      };

      transport.receive({ kind: 'awareness', payload: awarenessUpdate });

      const awarenessEvent = events.find((e) => e.type === 'awareness:update');
      expect(awarenessEvent).toBeDefined();
      expect(awarenessEvent?.nodeId).toBe('node-2');
      expect(awarenessEvent?.awareness?.user?.name).toBe('Bob');
    });

    it('should track a new peer when awareness arrives before peer-join', () => {
      session.start();

      transport.receive({
        kind: 'awareness',
        payload: {
          nodeId: 'node-3',
          state: { user: { name: 'Charlie' }, lastUpdated: Date.now() },
          timestamp: Date.now(),
        },
      });

      const peers = session.getPeers();
      expect(peers.get('node-3')).toBeDefined();
      expect(peers.get('node-3')?.online).toBe(true);
    });

    it('should ignore awareness updates from self', () => {
      session.start();
      const events: CollaborationEvent[] = [];
      session.events().subscribe((e) => events.push(e));

      transport.receive({
        kind: 'awareness',
        payload: {
          nodeId: 'node-1',
          state: { user: { name: 'Self' }, lastUpdated: Date.now() },
          timestamp: Date.now(),
        },
      });

      expect(events.filter((e) => e.type === 'awareness:update')).toHaveLength(0);
    });

    it('should periodically re-broadcast awareness state', () => {
      session.setLocalAwareness({ user: { name: 'Alice' } });
      session.start();
      transport.sent.length = 0;

      vi.advanceTimersByTime(3500); // default awarenessInterval is 3000

      const re = transport.sent.filter((m) => m.kind === 'awareness');
      expect(re.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -- getSession ---------------------------------------------------------

  describe('getSession', () => {
    it('should return a session snapshot', () => {
      session.start();
      session.createDocument('doc-x');
      transport.receive({ kind: 'peer-join', nodeId: 'node-2', timestamp: Date.now() });

      const snap = session.getSession();
      expect(snap.localNodeId).toBe('node-1');
      expect(snap.connected).toBe(true);
      expect(snap.peers.size).toBe(1);
      expect(snap.documentId).toBe('doc-x');
    });
  });

  // -- dispose ------------------------------------------------------------

  describe('dispose', () => {
    it('should complete the events observable', () => {
      let completed = false;
      session.events().subscribe({ complete: () => { completed = true; } });

      session.dispose();
      expect(completed).toBe(true);
    });

    it('should stop the session if running', () => {
      session.start();
      session.dispose();
      expect(session.isStarted()).toBe(false);
    });

    it('should clean up all documents', () => {
      session.createDocument('a');
      session.createDocument('b');
      session.dispose();
      expect(session.getDocumentIds()).toEqual([]);
    });

    it('should be idempotent', () => {
      session.dispose();
      expect(() => session.dispose()).not.toThrow();
    });
  });

  // -- multi-peer end-to-end scenario -------------------------------------

  describe('multi-peer end-to-end', () => {
    it('should converge two sessions editing the same document', () => {
      const tA = new MockTransport();
      const tB = new MockTransport();
      linkTransports(tA, tB);

      const sessionA = createCollaborativeSessionManager('node-a', {
        transports: [tA],
        announcePresence: false,
      });
      const sessionB = createCollaborativeSessionManager('node-b', {
        transports: [tB],
        announcePresence: false,
      });

      sessionA.start();
      sessionB.start();

      const docA = sessionA.createDocument('shared', { counter: 0 });
      const docB = sessionB.createDocument('shared', { counter: 0 });

      // A edits
      docA.set(['counter'], 1);

      // B should have received the operation via transport link
      expect(docB.getValue()).toEqual({ counter: 1 });

      // B edits
      docB.set(['counter'], 2);

      // A should see the update
      expect(docA.getValue()).toEqual({ counter: 2 });

      sessionA.dispose();
      sessionB.dispose();
    });

    it('should converge on concurrent edits to different fields', () => {
      const tA = new MockTransport();
      const tB = new MockTransport();
      linkTransports(tA, tB);

      const sessionA = createCollaborativeSessionManager('node-a', {
        transports: [tA],
        announcePresence: false,
      });
      const sessionB = createCollaborativeSessionManager('node-b', {
        transports: [tB],
        announcePresence: false,
      });

      sessionA.start();
      sessionB.start();

      const docA = sessionA.createDocument('doc', { x: 0, y: 0 });
      const docB = sessionB.createDocument('doc', { x: 0, y: 0 });

      // Both edit different fields
      docA.set(['x'], 10);
      docB.set(['y'], 20);

      // Both documents should converge
      expect(docA.getValue()).toEqual({ x: 10, y: 20 });
      expect(docB.getValue()).toEqual({ x: 10, y: 20 });

      sessionA.dispose();
      sessionB.dispose();
    });
  });

  // -- multiple transports ------------------------------------------------

  describe('multiple transports', () => {
    it('should broadcast over all transports', () => {
      const t1 = new MockTransport();
      const t2 = new MockTransport();
      const s = createCollaborativeSessionManager('node-m', {
        transports: [t1, t2],
        announcePresence: false,
      });
      s.start();
      const doc = s.createDocument('doc-1', { v: 0 });

      t1.sent.length = 0;
      t2.sent.length = 0;

      doc.set(['v'], 1);

      expect(t1.sent.length).toBeGreaterThan(0);
      expect(t2.sent.length).toBeGreaterThan(0);

      s.dispose();
    });
  });
});

// ---------------------------------------------------------------------------
// BroadcastChannelTransport
// ---------------------------------------------------------------------------

describe('BroadcastChannelTransport', () => {
  // BroadcastChannel is not available in Node, so we mock it.
  let mockChannelInstances: MockBroadcastChannel[];

  class MockBroadcastChannel {
    name: string;
    onmessage: ((event: MessageEvent) => void) | null = null;
    closed = false;

    constructor(name: string) {
      this.name = name;
      mockChannelInstances.push(this);
    }

    postMessage(data: unknown): void {
      // Deliver to all OTHER channels with the same name
      for (const ch of mockChannelInstances) {
        if (ch !== this && ch.name === this.name && !ch.closed && ch.onmessage) {
          ch.onmessage(new MessageEvent('message', { data }));
        }
      }
    }

    close(): void {
      this.closed = true;
    }
  }

  beforeEach(() => {
    mockChannelInstances = [];
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should create with default channel name', () => {
    const t = createBroadcastChannelTransport();
    expect(t).toBeInstanceOf(BroadcastChannelTransport);
  });

  it('should connect and create a BroadcastChannel', () => {
    const t = createBroadcastChannelTransport({ channelName: 'test-ch' });
    t.connect();

    expect(mockChannelInstances).toHaveLength(1);
    expect(mockChannelInstances[0]!.name).toBe('test-ch');
  });

  it('should be idempotent on connect', () => {
    const t = createBroadcastChannelTransport();
    t.connect();
    t.connect();
    expect(mockChannelInstances).toHaveLength(1);
  });

  it('should send messages via BroadcastChannel.postMessage', () => {
    const t = createBroadcastChannelTransport({ channelName: 'ch' });
    t.connect();

    const spy = vi.spyOn(mockChannelInstances[0]!, 'postMessage');

    const msg: CRDTTransportMessage = { kind: 'peer-join', nodeId: 'x', timestamp: 1 };
    t.send(msg);

    expect(spy).toHaveBeenCalledWith(msg);
  });

  it('should deliver received messages to handlers', () => {
    const t1 = createBroadcastChannelTransport({ channelName: 'ch' });
    const t2 = createBroadcastChannelTransport({ channelName: 'ch' });

    const received: CRDTTransportMessage[] = [];
    t2.onMessage((m) => received.push(m));

    t1.connect();
    t2.connect();

    const msg: CRDTTransportMessage = { kind: 'peer-join', nodeId: 'a', timestamp: 1 };
    t1.send(msg);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(msg);
  });

  it('should unsubscribe handlers', () => {
    const t = createBroadcastChannelTransport({ channelName: 'ch' });
    t.connect();

    const received: CRDTTransportMessage[] = [];
    const unsub = t.onMessage((m) => received.push(m));
    unsub();

    // Simulate incoming message directly
    const ch = mockChannelInstances[0]!;
    ch.onmessage?.(new MessageEvent('message', {
      data: { kind: 'peer-join', nodeId: 'z', timestamp: 1 },
    }));

    expect(received).toHaveLength(0);
  });

  it('should disconnect and close the channel', () => {
    const t = createBroadcastChannelTransport({ channelName: 'ch' });
    t.connect();
    t.disconnect();

    expect(mockChannelInstances[0]!.closed).toBe(true);
  });

  it('should allow reconnect after disconnect', () => {
    const t = createBroadcastChannelTransport({ channelName: 'ch' });
    t.connect();
    t.disconnect();
    t.connect();

    // A new channel should have been created
    expect(mockChannelInstances).toHaveLength(2);
    expect(mockChannelInstances[1]!.closed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WebSocketCRDTTransport
// ---------------------------------------------------------------------------

describe('WebSocketCRDTTransport', () => {
  let mockSocket: {
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onopen: (() => void) | null;
    onclose: (() => void) | null;
    onerror: (() => void) | null;
    onmessage: ((event: { data: string }) => void) | null;
  };

  beforeEach(() => {
    vi.useFakeTimers();

    mockSocket = {
      readyState: 1, // WebSocket.OPEN
      send: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
    };

    vi.stubGlobal('WebSocket', class {
      static readonly OPEN = 1;
      readyState: number;
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string, _protocols?: string | string[]) {
        this.readyState = 1;
        this.send = mockSocket.send;
        this.close = mockSocket.close;

        // Wire mock so test can trigger callbacks
        Object.defineProperty(this, 'onopen', {
          get: () => mockSocket.onopen,
          set: (v) => { mockSocket.onopen = v; },
        });
        Object.defineProperty(this, 'onclose', {
          get: () => mockSocket.onclose,
          set: (v) => { mockSocket.onclose = v; },
        });
        Object.defineProperty(this, 'onerror', {
          get: () => mockSocket.onerror,
          set: (v) => { mockSocket.onerror = v; },
        });
        Object.defineProperty(this, 'onmessage', {
          get: () => mockSocket.onmessage,
          set: (v) => { mockSocket.onmessage = v; },
        });

        // Simulate async open
        Promise.resolve().then(() => {
          mockSocket.onopen?.();
        });
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('should create via factory function', () => {
    const t = createWebSocketCRDTTransport({ url: 'wss://example.com' });
    expect(t).toBeInstanceOf(WebSocketCRDTTransport);
  });

  it('should send JSON-serialised messages', () => {
    const t = createWebSocketCRDTTransport({ url: 'wss://example.com' });
    t.connect();

    const msg: CRDTTransportMessage = { kind: 'peer-join', nodeId: 'n', timestamp: 1 };
    t.send(msg);

    expect(mockSocket.send).toHaveBeenCalledWith(JSON.stringify(msg));
  });

  it('should deliver parsed messages to handlers', async () => {
    const t = createWebSocketCRDTTransport({ url: 'wss://example.com' });
    const received: CRDTTransportMessage[] = [];
    t.onMessage((m) => received.push(m));
    t.connect();

    // Wait for mock async open
    await vi.runAllTimersAsync();

    const msg: CRDTTransportMessage = { kind: 'peer-leave', nodeId: 'x', timestamp: 2 };
    mockSocket.onmessage?.({ data: JSON.stringify(msg) });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(msg);
  });

  it('should ignore unparseable messages', async () => {
    const t = createWebSocketCRDTTransport({ url: 'wss://example.com' });
    const received: CRDTTransportMessage[] = [];
    t.onMessage((m) => received.push(m));
    t.connect();

    await vi.runAllTimersAsync();

    mockSocket.onmessage?.({ data: 'not json!!' });

    expect(received).toHaveLength(0);
  });

  it('should disconnect and close the socket', () => {
    const t = createWebSocketCRDTTransport({ url: 'wss://example.com' });
    t.connect();
    t.disconnect();

    expect(mockSocket.close).toHaveBeenCalled();
  });

  it('should return readyState -1 when no socket exists', () => {
    const t = createWebSocketCRDTTransport({ url: 'wss://example.com' });
    expect(t.getReadyState()).toBe(-1);
  });

  it('should unsubscribe handlers', async () => {
    const t = createWebSocketCRDTTransport({ url: 'wss://example.com' });
    const received: CRDTTransportMessage[] = [];
    const unsub = t.onMessage((m) => received.push(m));
    t.connect();

    await vi.runAllTimersAsync();

    unsub();

    mockSocket.onmessage?.({ data: JSON.stringify({ kind: 'peer-join', nodeId: 'z', timestamp: 1 }) });

    expect(received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Factory function exports
// ---------------------------------------------------------------------------

describe('factory functions', () => {
  it('createCollaborativeSessionManager returns a CollaborativeSessionManager', () => {
    const s = createCollaborativeSessionManager('node-factory');
    expect(s).toBeInstanceOf(CollaborativeSessionManager);
    s.dispose();
  });

  it('createBroadcastChannelTransport returns a BroadcastChannelTransport', () => {
    const t = createBroadcastChannelTransport();
    expect(t).toBeInstanceOf(BroadcastChannelTransport);
  });

  it('createWebSocketCRDTTransport returns a WebSocketCRDTTransport', () => {
    const t = createWebSocketCRDTTransport({ url: 'wss://example.com' });
    expect(t).toBeInstanceOf(WebSocketCRDTTransport);
  });
});
