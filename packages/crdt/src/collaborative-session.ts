import { Subject, type Observable, type Subscription } from 'rxjs';
import { AwarenessManager, type AwarenessUpdate } from './awareness.js';
import { createJSONCRDTDocument, type JSONCRDTDocument } from './document-crdt.js';
import type {
  AwarenessState,
  CollaborationEvent,
  CollaborationEventType,
  CollaborativeSession,
  CRDTSyncMessage,
  JSONCRDTOperation,
  NodeId,
  PeerState,
} from './types.js';

// ---------------------------------------------------------------------------
// Transport interfaces
// ---------------------------------------------------------------------------

/**
 * Message envelope sent over a CRDT transport.
 *
 * Wraps CRDT sync messages, awareness updates, and peer lifecycle
 * signals into a single discriminated union so transports only need
 * to deal with one message type.
 *
 * @example
 * ```typescript
 * const envelope: CRDTTransportMessage = {
 *   kind: 'sync',
 *   payload: {
 *     type: 'operation',
 *     from: 'node-1',
 *     documentId: 'doc-1',
 *     operations: [op],
 *   },
 * };
 * transport.send(envelope);
 * ```
 */
export type CRDTTransportMessage =
  | { kind: 'sync'; payload: CRDTSyncMessage }
  | { kind: 'awareness'; payload: AwarenessUpdate }
  | { kind: 'peer-join'; nodeId: NodeId; timestamp: number }
  | { kind: 'peer-leave'; nodeId: NodeId; timestamp: number };

/**
 * Transport interface for sending and receiving CRDT messages.
 *
 * Implementations deliver messages between collaborative session
 * participants.  Two built-in implementations are provided:
 * - {@link BroadcastChannelTransport} for same-origin cross-tab sync
 * - {@link WebSocketCRDTTransport} for network sync via WebSocket
 *
 * @example Custom transport
 * ```typescript
 * class MyTransport implements CRDTTransport {
 *   private handlers = new Set<(msg: CRDTTransportMessage) => void>();
 *
 *   send(message: CRDTTransportMessage): void {
 *     myChannel.postMessage(JSON.stringify(message));
 *   }
 *
 *   onMessage(handler: (message: CRDTTransportMessage) => void): () => void {
 *     this.handlers.add(handler);
 *     return () => this.handlers.delete(handler);
 *   }
 *
 *   connect(): void { myChannel.open(); }
 *   disconnect(): void { myChannel.close(); }
 * }
 * ```
 *
 * @see {@link BroadcastChannelTransport}
 * @see {@link WebSocketCRDTTransport}
 */
export interface CRDTTransport {
  /**
   * Send a message to all connected peers.
   *
   * @param message - The message to send
   */
  send(message: CRDTTransportMessage): void;

  /**
   * Register a handler that is invoked whenever a message arrives.
   *
   * @param handler - Callback receiving inbound messages
   * @returns A teardown function that removes the handler
   */
  onMessage(handler: (message: CRDTTransportMessage) => void): () => void;

  /**
   * Open the transport connection.
   *
   * Called by {@link CollaborativeSessionManager.start}.
   */
  connect(): void;

  /**
   * Close the transport connection.
   *
   * Called by {@link CollaborativeSessionManager.stop}.
   */
  disconnect(): void;
}

// ---------------------------------------------------------------------------
// BroadcastChannelTransport
// ---------------------------------------------------------------------------

/**
 * Configuration for {@link BroadcastChannelTransport}.
 */
export interface BroadcastChannelTransportConfig {
  /** Name of the BroadcastChannel. Defaults to `'pocket-crdt'`. */
  channelName?: string;
}

/**
 * CRDT transport that uses the browser BroadcastChannel API for
 * cross-tab communication within the same origin.
 *
 * Messages are serialised as structured-clone-compatible objects so
 * they can be posted directly to a {@link BroadcastChannel}.
 *
 * @example
 * ```typescript
 * const transport = createBroadcastChannelTransport({
 *   channelName: 'my-app-crdt',
 * });
 *
 * transport.connect();
 * transport.send({ kind: 'peer-join', nodeId: 'abc', timestamp: Date.now() });
 * ```
 *
 * @see {@link createBroadcastChannelTransport} - Factory function
 */
export class BroadcastChannelTransport implements CRDTTransport {
  private channel: BroadcastChannel | null = null;
  private readonly channelName: string;
  private readonly handlers = new Set<(msg: CRDTTransportMessage) => void>();

  constructor(config: BroadcastChannelTransportConfig = {}) {
    this.channelName = config.channelName ?? 'pocket-crdt';
  }

  /** @inheritdoc */
  send(message: CRDTTransportMessage): void {
    this.channel?.postMessage(message);
  }

  /** @inheritdoc */
  onMessage(handler: (message: CRDTTransportMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** @inheritdoc */
  connect(): void {
    if (this.channel) return;
    this.channel = new BroadcastChannel(this.channelName);
    this.channel.onmessage = (event: MessageEvent<CRDTTransportMessage>) => {
      for (const handler of this.handlers) {
        handler(event.data);
      }
    };
  }

  /** @inheritdoc */
  disconnect(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
}

/**
 * Create a BroadcastChannel-based CRDT transport.
 *
 * @param config - Optional configuration
 * @returns A new {@link BroadcastChannelTransport}
 *
 * @example
 * ```typescript
 * const transport = createBroadcastChannelTransport({ channelName: 'app-crdt' });
 * ```
 *
 * @see {@link BroadcastChannelTransport}
 */
export function createBroadcastChannelTransport(
  config?: BroadcastChannelTransportConfig,
): BroadcastChannelTransport {
  return new BroadcastChannelTransport(config);
}

// ---------------------------------------------------------------------------
// WebSocketCRDTTransport
// ---------------------------------------------------------------------------

/**
 * Configuration for {@link WebSocketCRDTTransport}.
 */
export interface WebSocketCRDTTransportConfig {
  /** WebSocket server URL (e.g. `'wss://example.com/crdt'`). */
  url: string;

  /**
   * Protocols to pass to the WebSocket constructor.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
   */
  protocols?: string | string[];

  /**
   * Whether to automatically reconnect on close/error.
   * Defaults to `true`.
   */
  autoReconnect?: boolean;

  /**
   * Base delay between reconnect attempts in milliseconds.
   * Exponential back-off is applied on top of this value.
   * Defaults to `1000`.
   */
  reconnectDelay?: number;

  /**
   * Maximum number of reconnect attempts before giving up.
   * Defaults to `10`.
   */
  maxReconnectAttempts?: number;
}

/**
 * CRDT transport over a WebSocket connection.
 *
 * Serialises messages as JSON and handles reconnection with
 * exponential back-off.
 *
 * @example
 * ```typescript
 * const transport = createWebSocketCRDTTransport({
 *   url: 'wss://collab.example.com/crdt',
 *   autoReconnect: true,
 *   reconnectDelay: 2000,
 * });
 *
 * const unsubscribe = transport.onMessage((msg) => {
 *   console.log('Received:', msg.kind);
 * });
 *
 * transport.connect();
 * ```
 *
 * @see {@link createWebSocketCRDTTransport} - Factory function
 */
export class WebSocketCRDTTransport implements CRDTTransport {
  private ws: WebSocket | null = null;
  private readonly config: Required<WebSocketCRDTTransportConfig>;
  private readonly handlers = new Set<(msg: CRDTTransportMessage) => void>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(config: WebSocketCRDTTransportConfig) {
    this.config = {
      url: config.url,
      protocols: config.protocols ?? [],
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelay: config.reconnectDelay ?? 1000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
    };
  }

  /** @inheritdoc */
  send(message: CRDTTransportMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /** @inheritdoc */
  onMessage(handler: (message: CRDTTransportMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** @inheritdoc */
  connect(): void {
    if (this.ws) return;
    this.intentionalClose = false;
    this.openSocket();
  }

  /** @inheritdoc */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Get the current WebSocket ready-state.
   *
   * @returns The ready-state number, or `-1` if no socket exists
   */
  getReadyState(): number {
    return this.ws ? this.ws.readyState : -1;
  }

  // -- internal helpers -----------------------------------------------------

  private openSocket(): void {
    const protocols = this.config.protocols;
    this.ws = new WebSocket(
      this.config.url,
      protocols.length > 0 ? protocols : undefined,
    );

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const message: CRDTTransportMessage = JSON.parse(event.data as string);
        for (const handler of this.handlers) {
          handler(message);
        }
      } catch {
        // Ignore unparseable messages
      }
    };

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (!this.intentionalClose && this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror; reconnect is handled there.
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      return;
    }
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/**
 * Create a WebSocket-based CRDT transport.
 *
 * @param config - WebSocket configuration (url is required)
 * @returns A new {@link WebSocketCRDTTransport}
 *
 * @example
 * ```typescript
 * const transport = createWebSocketCRDTTransport({
 *   url: 'wss://collab.example.com/crdt',
 * });
 * ```
 *
 * @see {@link WebSocketCRDTTransport}
 */
export function createWebSocketCRDTTransport(
  config: WebSocketCRDTTransportConfig,
): WebSocketCRDTTransport {
  return new WebSocketCRDTTransport(config);
}

// ---------------------------------------------------------------------------
// CollaborativeSessionManager
// ---------------------------------------------------------------------------

/**
 * Configuration for {@link CollaborativeSessionManager}.
 */
export interface CollaborativeSessionManagerConfig {
  /**
   * Transports used to communicate with peers.
   *
   * You can supply multiple transports (e.g. one BroadcastChannel for
   * cross-tab and one WebSocket for network) and messages will be
   * delivered over all of them.
   */
  transports?: CRDTTransport[];

  /**
   * Interval (ms) at which the local awareness state is re-broadcast.
   * Defaults to `3000`.
   */
  awarenessInterval?: number;

  /**
   * If `true`, the session manager will periodically announce itself
   * so that other tabs / peers discover it.  Defaults to `true`.
   */
  announcePresence?: boolean;

  /**
   * Interval (ms) between presence announcements.
   * Defaults to `5000`.
   */
  presenceInterval?: number;
}

/**
 * High-level manager for multi-tab / multi-peer real-time CRDT
 * collaboration.
 *
 * `CollaborativeSessionManager` wires together one or more
 * {@link JSONCRDTDocument} instances, an {@link AwarenessManager}, and
 * a set of {@link CRDTTransport}s so that document operations and
 * presence information flow automatically between all connected
 * participants.
 *
 * Key features:
 * - Manages multiple documents by id
 * - Cross-tab synchronisation via BroadcastChannel
 * - Network synchronisation via WebSocket (or any custom transport)
 * - Peer lifecycle tracking (join / leave / awareness updates)
 * - RxJS-based event stream for UI integration
 *
 * @example Basic cross-tab setup
 * ```typescript
 * const session = createCollaborativeSessionManager('node-1', {
 *   transports: [
 *     createBroadcastChannelTransport({ channelName: 'my-app' }),
 *   ],
 * });
 *
 * session.start();
 *
 * const doc = session.createDocument('doc-1', { title: 'Hello' });
 * doc.set(['title'], 'Updated title');
 *
 * session.events().subscribe((event) => {
 *   console.log(event.type, event);
 * });
 *
 * // Cleanup
 * session.dispose();
 * ```
 *
 * @example Network + cross-tab
 * ```typescript
 * const session = createCollaborativeSessionManager('node-1', {
 *   transports: [
 *     createBroadcastChannelTransport(),
 *     createWebSocketCRDTTransport({ url: 'wss://collab.example.com' }),
 *   ],
 * });
 *
 * session.start();
 * ```
 *
 * @see {@link createCollaborativeSessionManager} - Factory function
 * @see {@link CRDTTransport} - Transport interface
 * @see {@link JSONCRDTDocument} - Document CRDT
 */
export class CollaborativeSessionManager {
  private readonly nodeId: NodeId;
  private readonly config: Required<CollaborativeSessionManagerConfig>;
  private readonly awareness: AwarenessManager;
  private readonly documents = new Map<string, JSONCRDTDocument>();
  private readonly peers = new Map<NodeId, PeerState>();
  private readonly transports: CRDTTransport[];
  private readonly events$ = new Subject<CollaborationEvent>();

  private transportUnsubscribers: (() => void)[] = [];
  private documentSubscriptions = new Map<string, Subscription>();
  private awarenessSubscription: Subscription | null = null;
  private awarenessTimer: ReturnType<typeof setInterval> | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private disposed = false;

  /**
   * Create a new CollaborativeSessionManager.
   *
   * Prefer using the factory function {@link createCollaborativeSessionManager}.
   *
   * @param nodeId - Unique identifier for this node / tab
   * @param config - Optional configuration
   */
  constructor(nodeId: NodeId, config: CollaborativeSessionManagerConfig = {}) {
    this.nodeId = nodeId;
    this.config = {
      transports: config.transports ?? [],
      awarenessInterval: config.awarenessInterval ?? 3000,
      announcePresence: config.announcePresence ?? true,
      presenceInterval: config.presenceInterval ?? 5000,
    };
    this.transports = this.config.transports;
    this.awareness = new AwarenessManager(nodeId);
  }

  // -- lifecycle ------------------------------------------------------------

  /**
   * Start the session manager.
   *
   * Connects all transports, begins presence announcements, and starts
   * forwarding awareness updates over the transports.
   *
   * @example
   * ```typescript
   * const session = createCollaborativeSessionManager('node-1', { ... });
   * session.start();
   * ```
   */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;

    // Connect transports and register message handlers
    for (const transport of this.transports) {
      transport.connect();
      const unsub = transport.onMessage((msg) => this.handleTransportMessage(msg));
      this.transportUnsubscribers.push(unsub);
    }

    // Forward local awareness updates to transports
    this.awarenessSubscription = this.awareness.updatesObservable().subscribe((update) => {
      this.broadcast({ kind: 'awareness', payload: update });
    });

    // Periodically re-broadcast awareness to cover late joiners
    this.awarenessTimer = setInterval(() => {
      const local = this.awareness.getLocalState();
      if (local) {
        this.broadcast({
          kind: 'awareness',
          payload: { nodeId: this.nodeId, state: local, timestamp: Date.now() },
        });
      }
    }, this.config.awarenessInterval);

    // Announce presence
    if (this.config.announcePresence) {
      this.broadcast({ kind: 'peer-join', nodeId: this.nodeId, timestamp: Date.now() });
      this.presenceTimer = setInterval(() => {
        this.broadcast({ kind: 'peer-join', nodeId: this.nodeId, timestamp: Date.now() });
      }, this.config.presenceInterval);
    }
  }

  /**
   * Stop the session manager.
   *
   * Disconnects transports, stops timers, and broadcasts a peer-leave
   * message so other participants can update their peer lists.
   *
   * The session can be re-started by calling {@link start} again.
   *
   * @example
   * ```typescript
   * session.stop();
   * ```
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    // Announce departure
    this.broadcast({ kind: 'peer-leave', nodeId: this.nodeId, timestamp: Date.now() });

    // Tear down timers
    if (this.awarenessTimer !== null) {
      clearInterval(this.awarenessTimer);
      this.awarenessTimer = null;
    }
    if (this.presenceTimer !== null) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }

    // Unsubscribe awareness forwarding
    this.awarenessSubscription?.unsubscribe();
    this.awarenessSubscription = null;

    // Unregister transport handlers and disconnect
    for (const unsub of this.transportUnsubscribers) {
      unsub();
    }
    this.transportUnsubscribers = [];

    for (const transport of this.transports) {
      transport.disconnect();
    }
  }

  /**
   * Dispose the session manager and release all resources.
   *
   * After disposal the instance cannot be reused.
   *
   * @example
   * ```typescript
   * session.dispose();
   * ```
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();

    // Dispose documents
    for (const sub of this.documentSubscriptions.values()) {
      sub.unsubscribe();
    }
    this.documentSubscriptions.clear();

    for (const doc of this.documents.values()) {
      doc.dispose();
    }
    this.documents.clear();

    // Dispose awareness
    this.awareness.dispose();

    // Complete event stream
    this.events$.complete();
  }

  // -- document management --------------------------------------------------

  /**
   * Create a new collaborative document managed by this session.
   *
   * The document is automatically wired so that local operations are
   * broadcast to peers, and remote operations received over the
   * transports are applied to the document.
   *
   * @param documentId - Unique document identifier
   * @param initialValue - Optional initial content
   * @returns The created {@link JSONCRDTDocument}
   * @throws If a document with the same id already exists
   *
   * @example
   * ```typescript
   * const doc = session.createDocument('doc-1', {
   *   title: 'Meeting Notes',
   *   content: '',
   * });
   *
   * const op = doc.set(['title'], 'Updated Title');
   * // Operation is automatically broadcast to peers
   * ```
   */
  createDocument(documentId: string, initialValue?: Record<string, unknown>): JSONCRDTDocument {
    if (this.documents.has(documentId)) {
      throw new Error(`Document "${documentId}" already exists in this session`);
    }

    const doc = createJSONCRDTDocument(documentId, this.nodeId, initialValue);
    this.documents.set(documentId, doc);

    // Subscribe to local operations so they get broadcast
    const sub = doc.events().subscribe((event) => {
      if (event.type === 'operation:local' && event.operation) {
        const syncMsg: CRDTSyncMessage = {
          type: 'operation',
          from: this.nodeId,
          documentId,
          operations: [event.operation as JSONCRDTOperation],
          vclock: doc.getVectorClock(),
        };
        this.broadcast({ kind: 'sync', payload: syncMsg });
      }
    });
    this.documentSubscriptions.set(documentId, sub);

    return doc;
  }

  /**
   * Get an existing document by id.
   *
   * @param documentId - The document identifier
   * @returns The document, or `undefined` if not found
   *
   * @example
   * ```typescript
   * const doc = session.getDocument('doc-1');
   * if (doc) {
   *   console.log(doc.getValue());
   * }
   * ```
   */
  getDocument(documentId: string): JSONCRDTDocument | undefined {
    return this.documents.get(documentId);
  }

  /**
   * Remove a document from the session and dispose it.
   *
   * @param documentId - The document identifier
   * @returns `true` if the document was found and removed
   *
   * @example
   * ```typescript
   * session.removeDocument('doc-1');
   * ```
   */
  removeDocument(documentId: string): boolean {
    const doc = this.documents.get(documentId);
    if (!doc) return false;

    const sub = this.documentSubscriptions.get(documentId);
    sub?.unsubscribe();
    this.documentSubscriptions.delete(documentId);

    doc.dispose();
    this.documents.delete(documentId);
    return true;
  }

  /**
   * List all document ids managed by this session.
   *
   * @returns Array of document identifiers
   */
  getDocumentIds(): string[] {
    return Array.from(this.documents.keys());
  }

  // -- awareness / presence -------------------------------------------------

  /**
   * Get the underlying {@link AwarenessManager}.
   *
   * @returns The awareness manager
   */
  getAwareness(): AwarenessManager {
    return this.awareness;
  }

  /**
   * Convenience: set local awareness state.
   *
   * @param state - Partial awareness state to merge
   *
   * @example
   * ```typescript
   * session.setLocalAwareness({
   *   user: { name: 'Alice', color: '#ff0000' },
   *   cursor: { anchor: 10, head: 20 },
   * });
   * ```
   */
  setLocalAwareness(state: Partial<AwarenessState>): void {
    this.awareness.setLocalState(state);
  }

  /**
   * Get the map of connected peers.
   *
   * @returns Map of nodeId to {@link PeerState}
   */
  getPeers(): Map<NodeId, PeerState> {
    return new Map(this.peers);
  }

  /**
   * Get a snapshot of the session state.
   *
   * @returns A {@link CollaborativeSession} object
   */
  getSession(): CollaborativeSession {
    return {
      id: `session-${this.nodeId}`,
      documentId: this.getDocumentIds()[0] ?? '',
      peers: new Map(this.peers),
      localNodeId: this.nodeId,
      connected: this.started,
    };
  }

  // -- events ---------------------------------------------------------------

  /**
   * Subscribe to collaboration events.
   *
   * Emitted event types:
   * - `'peer:join'` - A peer connected
   * - `'peer:leave'` - A peer disconnected
   * - `'operation:remote'` - A remote CRDT operation was applied
   * - `'awareness:update'` - A peer's awareness state changed
   * - `'sync:complete'` - A full-state sync finished
   *
   * @returns Observable of {@link CollaborationEvent}
   *
   * @example
   * ```typescript
   * session.events().subscribe((event) => {
   *   switch (event.type) {
   *     case 'peer:join':
   *       console.log('Peer joined:', event.nodeId);
   *       break;
   *     case 'operation:remote':
   *       console.log('Remote op applied');
   *       break;
   *   }
   * });
   * ```
   */
  events(): Observable<CollaborationEvent> {
    return this.events$.asObservable();
  }

  /**
   * Get the local node id.
   *
   * @returns This node's unique identifier
   */
  getNodeId(): NodeId {
    return this.nodeId;
  }

  /**
   * Check whether the session manager is currently running.
   *
   * @returns `true` if started
   */
  isStarted(): boolean {
    return this.started;
  }

  /**
   * Request a full-state sync for a document from peers.
   *
   * Sends a `sync-request` message over all transports.  Peers that
   * hold the document should respond with a `sync-response` carrying
   * the full document state.
   *
   * @param documentId - The document to request sync for
   *
   * @example
   * ```typescript
   * session.requestSync('doc-1');
   * ```
   */
  requestSync(documentId: string): void {
    const doc = this.documents.get(documentId);
    const syncMsg: CRDTSyncMessage = {
      type: 'sync-request',
      from: this.nodeId,
      documentId,
      vclock: doc?.getVectorClock(),
    };
    this.broadcast({ kind: 'sync', payload: syncMsg });
  }

  // -- internal: transport message routing ----------------------------------

  /** @internal */
  private broadcast(message: CRDTTransportMessage): void {
    for (const transport of this.transports) {
      try {
        transport.send(message);
      } catch {
        // Transport errors are non-fatal; other transports may succeed.
      }
    }
  }

  /** @internal */
  private handleTransportMessage(message: CRDTTransportMessage): void {
    switch (message.kind) {
      case 'sync':
        this.handleSyncMessage(message.payload);
        break;
      case 'awareness':
        this.handleAwarenessMessage(message.payload);
        break;
      case 'peer-join':
        this.handlePeerJoin(message.nodeId, message.timestamp);
        break;
      case 'peer-leave':
        this.handlePeerLeave(message.nodeId, message.timestamp);
        break;
    }
  }

  /** @internal */
  private handleSyncMessage(msg: CRDTSyncMessage): void {
    // Ignore our own messages
    if (msg.from === this.nodeId) return;

    switch (msg.type) {
      case 'operation':
        this.handleRemoteOperations(msg);
        break;
      case 'sync-request':
        this.handleSyncRequest(msg);
        break;
      case 'sync-response':
        this.handleSyncResponse(msg);
        break;
      case 'state':
        this.handleStateMessage(msg);
        break;
    }
  }

  /** @internal */
  private handleRemoteOperations(msg: CRDTSyncMessage): void {
    const doc = this.documents.get(msg.documentId);
    if (!doc || !msg.operations) return;

    for (const op of msg.operations) {
      doc.applyRemote(op as JSONCRDTOperation);
    }

    this.emitEvent('operation:remote', msg.from, msg.operations[0] as JSONCRDTOperation | undefined);
  }

  /** @internal */
  private handleSyncRequest(msg: CRDTSyncMessage): void {
    const doc = this.documents.get(msg.documentId);
    if (!doc) return;

    // Respond with our full state
    const state = doc.getState();
    const responseMsg: CRDTSyncMessage = {
      type: 'sync-response',
      from: this.nodeId,
      documentId: msg.documentId,
      operations: state.operations,
      vclock: state.vclock,
    };
    this.broadcast({ kind: 'sync', payload: responseMsg });
  }

  /** @internal */
  private handleSyncResponse(msg: CRDTSyncMessage): void {
    const doc = this.documents.get(msg.documentId);
    if (!doc || !msg.operations) return;

    for (const op of msg.operations) {
      doc.applyRemote(op as JSONCRDTOperation);
    }

    if (msg.vclock) {
      // Merge vector clocks via the document's merge mechanism
      doc.merge({
        id: msg.documentId,
        value: {},
        vclock: msg.vclock,
        operations: [],
        fieldTimestamps: {},
      });
    }

    this.emitEvent('sync:complete', msg.from);
  }

  /** @internal */
  private handleStateMessage(msg: CRDTSyncMessage): void {
    if (!msg.state) return;

    let doc = this.documents.get(msg.documentId);
    if (!doc) {
      // Auto-create document from received state
      doc = createJSONCRDTDocument(msg.documentId, this.nodeId);
      this.documents.set(msg.documentId, doc);

      const sub = doc.events().subscribe((event) => {
        if (event.type === 'operation:local' && event.operation) {
          const syncOutMsg: CRDTSyncMessage = {
            type: 'operation',
            from: this.nodeId,
            documentId: msg.documentId,
            operations: [event.operation as JSONCRDTOperation],
            vclock: doc!.getVectorClock(),
          };
          this.broadcast({ kind: 'sync', payload: syncOutMsg });
        }
      });
      this.documentSubscriptions.set(msg.documentId, sub);
    }

    // Apply all operations from the state
    if (msg.state.pendingOps) {
      for (const op of msg.state.pendingOps) {
        doc.applyRemote(op as JSONCRDTOperation);
      }
    }

    this.emitEvent('sync:complete', msg.from);
  }

  /** @internal */
  private handleAwarenessMessage(update: AwarenessUpdate): void {
    if (update.nodeId === this.nodeId) return;

    this.awareness.applyRemoteUpdate(update);

    // Update peer state with awareness
    const existing = this.peers.get(update.nodeId);
    if (update.state === null) {
      // Peer is disconnecting awareness
      if (existing) {
        existing.awareness = undefined;
        existing.lastSeen = update.timestamp;
      }
    } else {
      if (existing) {
        existing.awareness = update.state;
        existing.lastSeen = update.timestamp;
        existing.online = true;
      } else {
        // Awareness from a peer we haven't seen a join for; create entry
        this.peers.set(update.nodeId, {
          nodeId: update.nodeId,
          awareness: update.state,
          lastSeen: update.timestamp,
          online: true,
        });
        this.emitEvent('peer:join', update.nodeId);
      }
    }

    this.emitEvent('awareness:update', update.nodeId, undefined, update.state ?? undefined);
  }

  /** @internal */
  private handlePeerJoin(peerNodeId: NodeId, timestamp: number): void {
    if (peerNodeId === this.nodeId) return;

    const existing = this.peers.get(peerNodeId);
    if (!existing) {
      this.peers.set(peerNodeId, {
        nodeId: peerNodeId,
        lastSeen: timestamp,
        online: true,
      });
      this.emitEvent('peer:join', peerNodeId);
    } else {
      existing.lastSeen = timestamp;
      existing.online = true;
    }
  }

  /** @internal */
  private handlePeerLeave(peerNodeId: NodeId, timestamp: number): void {
    if (peerNodeId === this.nodeId) return;

    const existing = this.peers.get(peerNodeId);
    if (existing) {
      existing.online = false;
      existing.lastSeen = timestamp;
      this.emitEvent('peer:leave', peerNodeId);
    }
  }

  // -- internal: helpers ----------------------------------------------------

  /** @internal */
  private emitEvent(
    type: CollaborationEventType,
    nodeId?: NodeId,
    operation?: JSONCRDTOperation,
    awareness?: AwarenessState,
  ): void {
    this.events$.next({
      type,
      nodeId,
      operation,
      awareness,
      timestamp: Date.now(),
    });
  }
}

/**
 * Create a new {@link CollaborativeSessionManager}.
 *
 * @param nodeId - Unique identifier for this node / tab
 * @param config - Optional configuration
 * @returns A new session manager instance
 *
 * @example Cross-tab only
 * ```typescript
 * const session = createCollaborativeSessionManager('node-1', {
 *   transports: [createBroadcastChannelTransport()],
 * });
 * session.start();
 * ```
 *
 * @example Cross-tab + WebSocket
 * ```typescript
 * const session = createCollaborativeSessionManager('node-1', {
 *   transports: [
 *     createBroadcastChannelTransport(),
 *     createWebSocketCRDTTransport({ url: 'wss://example.com/crdt' }),
 *   ],
 * });
 * session.start();
 * ```
 *
 * @see {@link CollaborativeSessionManager}
 */
export function createCollaborativeSessionManager(
  nodeId: NodeId,
  config?: CollaborativeSessionManagerConfig,
): CollaborativeSessionManager {
  return new CollaborativeSessionManager(nodeId, config);
}
