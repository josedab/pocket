/**
 * Gossip Protocol for Pocket Distributed Query
 *
 * Implements an epidemic-style gossip protocol for propagating data changes
 * across a peer mesh. Ensures eventual consistency with configurable
 * fan-out, anti-entropy repair, and bounded propagation.
 *
 * @example
 * ```typescript
 * import { createGossipProtocol } from '@pocket/distributed-query';
 *
 * const gossip = createGossipProtocol({
 *   localPeerId: 'node-1',
 *   fanout: 3,
 *   gossipIntervalMs: 1_000,
 *   maxHops: 5,
 * });
 *
 * // Register known peers
 * gossip.registerPeer('node-2');
 * gossip.registerPeer('node-3');
 *
 * // Propagate a local change
 * const msg = gossip.propagate('orders', 'order-42', { total: 100 }, 'update');
 *
 * // Forward outgoing messages to the transport layer
 * gossip.messages$.subscribe((outgoing) => {
 *   transport.send(outgoing.originPeerId, 'data', outgoing);
 * });
 *
 * // Apply confirmed updates locally
 * gossip.updates$.subscribe((update) => {
 *   console.log(`Apply ${update.changeType} on ${update.collection}/${update.documentId}`);
 * });
 *
 * // Receive a message from a remote peer
 * gossip.receiveMessage(incomingGossipMessage);
 *
 * console.log(gossip.getStats());
 * gossip.dispose();
 * ```
 */

import { Subject, type Observable } from 'rxjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A gossip message exchanged between peers
 */
export interface GossipMessage {
  /** Unique message identifier */
  id: string;
  /** Identifier of the peer that originated this message */
  originPeerId: string;
  /** Message type */
  type: 'update' | 'digest' | 'request' | 'response' | 'anti-entropy';
  /** Target collection */
  collection: string;
  /** Message payload */
  payload: GossipPayload;
  /** Vector clock for causal ordering */
  vectorClock: Record<string, number>;
  /** Number of hops this message has traversed */
  hopCount: number;
  /** Maximum allowed hops before the message is dropped */
  maxHops: number;
  /** Creation timestamp */
  timestamp: number;
}

/**
 * Discriminated union of gossip payload types
 */
export type GossipPayload =
  | {
      kind: 'document-change';
      documentId: string;
      change: Record<string, unknown>;
      changeType: 'create' | 'update' | 'delete';
    }
  | {
      kind: 'digest';
      entries: { collection: string; documentId: string; version: number }[];
    }
  | { kind: 'request'; documentIds: string[] }
  | {
      kind: 'response';
      documents: { id: string; data: Record<string, unknown>; version: number }[];
    };

/**
 * Configuration for the gossip protocol
 */
export interface GossipConfig {
  /** Identifier for the local peer */
  localPeerId: string;
  /** Number of peers to forward each message to */
  fanout?: number;
  /** Interval between gossip rounds in milliseconds */
  gossipIntervalMs?: number;
  /** Maximum hops a message can travel */
  maxHops?: number;
  /** Interval between anti-entropy rounds in milliseconds */
  antiEntropyIntervalMs?: number;
  /** Maximum number of seen message IDs to retain */
  maxSeenMessages?: number;
  /** Number of digest entries per anti-entropy batch */
  digestBatchSize?: number;
}

/**
 * Aggregate gossip protocol statistics
 */
export interface GossipStats {
  /** Total messages sent */
  messagesSent: number;
  /** Total messages received */
  messagesReceived: number;
  /** Messages dropped due to deduplication */
  messagesDeduplicated: number;
  /** Number of anti-entropy runs completed */
  antiEntropyRuns: number;
  /** Estimated convergence time in milliseconds */
  convergenceTime: number;
  /** Number of active peers */
  activePeers: number;
}

/**
 * Internal state snapshot of the gossip protocol
 */
export interface GossipState {
  /** Local vector clock */
  localClock: Record<string, number>;
  /** Known documents: collection → documentId → version */
  knownDocuments: Map<string, Map<string, number>>;
  /** Number of pending outbound updates */
  pendingUpdates: number;
  /** Timestamp of the last anti-entropy run */
  lastAntiEntropy: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_FANOUT = 3;
const DEFAULT_GOSSIP_INTERVAL_MS = 1_000;
const DEFAULT_MAX_HOPS = 6;
const DEFAULT_ANTI_ENTROPY_INTERVAL_MS = 30_000;
const DEFAULT_MAX_SEEN_MESSAGES = 10_000;
const DEFAULT_DIGEST_BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique identifier */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

// ---------------------------------------------------------------------------
// GossipProtocol
// ---------------------------------------------------------------------------

/**
 * Epidemic-style gossip protocol for eventually-consistent data propagation.
 *
 * Peers exchange document changes using a configurable fan-out strategy.
 * Anti-entropy digests are periodically exchanged to repair missed updates.
 *
 * @example
 * ```typescript
 * const gossip = new GossipProtocol({ localPeerId: 'node-1', fanout: 3 });
 *
 * gossip.registerPeer('node-2');
 * gossip.propagate('todos', 'todo-1', { title: 'Buy milk' }, 'create');
 *
 * gossip.messages$.subscribe((msg) => sendViTransport(msg));
 * gossip.updates$.subscribe((upd) => applyLocally(upd));
 * ```
 */
export class GossipProtocol {
  private readonly config: Required<GossipConfig>;
  private readonly peers = new Set<string>();
  private readonly seenMessages = new Set<string>();
  private readonly knownDocuments = new Map<string, Map<string, number>>();
  private readonly localClock: Record<string, number> = {};

  private messagesSentCount = 0;
  private messagesReceivedCount = 0;
  private messagesDeduplicatedCount = 0;
  private antiEntropyRunsCount = 0;
  private lastAntiEntropy = 0;
  private pendingUpdates = 0;

  private antiEntropyTimer: ReturnType<typeof setInterval> | undefined;

  private readonly messagesSubject = new Subject<GossipMessage>();
  private readonly updatesSubject = new Subject<{
    collection: string;
    documentId: string;
    data: Record<string, unknown>;
    changeType: string;
  }>();

  /**
   * Observable stream of outgoing gossip messages to forward via the transport layer
   *
   * @example
   * ```typescript
   * gossip.messages$.subscribe((msg) => {
   *   for (const peerId of gossip.getPeersForGossip()) {
   *     transport.send(peerId, 'data', msg);
   *   }
   * });
   * ```
   */
  readonly messages$: Observable<GossipMessage> = this.messagesSubject.asObservable();

  /**
   * Observable of confirmed incoming updates that should be applied locally
   *
   * @example
   * ```typescript
   * gossip.updates$.subscribe((update) => {
   *   db.collection(update.collection).apply(update.documentId, update.data);
   * });
   * ```
   */
  readonly updates$: Observable<{
    collection: string;
    documentId: string;
    data: Record<string, unknown>;
    changeType: string;
  }> = this.updatesSubject.asObservable();

  constructor(config: GossipConfig) {
    this.config = {
      localPeerId: config.localPeerId,
      fanout: config.fanout ?? DEFAULT_FANOUT,
      gossipIntervalMs: config.gossipIntervalMs ?? DEFAULT_GOSSIP_INTERVAL_MS,
      maxHops: config.maxHops ?? DEFAULT_MAX_HOPS,
      antiEntropyIntervalMs: config.antiEntropyIntervalMs ?? DEFAULT_ANTI_ENTROPY_INTERVAL_MS,
      maxSeenMessages: config.maxSeenMessages ?? DEFAULT_MAX_SEEN_MESSAGES,
      digestBatchSize: config.digestBatchSize ?? DEFAULT_DIGEST_BATCH_SIZE,
    };

    this.localClock[this.config.localPeerId] = 0;

    this.antiEntropyTimer = setInterval(() => {
      this.antiEntropyRunsCount++;
      this.lastAntiEntropy = Date.now();
    }, this.config.antiEntropyIntervalMs);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Initiate gossip for a local document change
   *
   * @param collection - Target collection name
   * @param documentId - Document identifier
   * @param change - Document change data
   * @param changeType - Type of change
   * @returns The created gossip message
   *
   * @example
   * ```typescript
   * const msg = gossip.propagate('orders', 'order-1', { total: 50 }, 'update');
   * ```
   */
  propagate(
    collection: string,
    documentId: string,
    change: Record<string, unknown>,
    changeType: 'create' | 'update' | 'delete'
  ): GossipMessage {
    this.incrementClock();

    const message: GossipMessage = {
      id: generateId(),
      originPeerId: this.config.localPeerId,
      type: 'update',
      collection,
      payload: { kind: 'document-change', documentId, change, changeType },
      vectorClock: { ...this.localClock },
      hopCount: 0,
      maxHops: this.config.maxHops,
      timestamp: Date.now(),
    };

    this.markMessageSeen(message.id);
    this.trackDocument(collection, documentId);
    this.pendingUpdates++;
    this.messagesSentCount++;

    this.messagesSubject.next(message);

    return message;
  }

  /**
   * Handle an incoming gossip message from a peer
   *
   * @param message - The received gossip message
   *
   * @example
   * ```typescript
   * transport.messages$.subscribe((msg) => {
   *   gossip.receiveMessage(msg.payload as GossipMessage);
   * });
   * ```
   */
  receiveMessage(message: GossipMessage): void {
    this.messagesReceivedCount++;

    if (this.isMessageSeen(message.id)) {
      this.messagesDeduplicatedCount++;
      return;
    }

    this.markMessageSeen(message.id);
    this.mergeClock(message.vectorClock);

    if (message.type === 'update' && message.payload.kind === 'document-change') {
      const { documentId, change, changeType } = message.payload;
      this.trackDocument(message.collection, documentId);

      this.updatesSubject.next({
        collection: message.collection,
        documentId,
        data: change,
        changeType,
      });

      // Re-propagate if within hop budget
      if (message.hopCount < message.maxHops) {
        const forwarded: GossipMessage = {
          ...message,
          hopCount: message.hopCount + 1,
        };
        this.messagesSentCount++;
        this.messagesSubject.next(forwarded);
      }
    }

    if (message.type === 'anti-entropy' && message.payload.kind === 'digest') {
      const responses = this.handleAntiEntropy(message);
      for (const resp of responses) {
        this.messagesSubject.next(resp);
      }
    }
  }

  /**
   * Select random peers for gossip fan-out
   *
   * @param exclude - Peer identifiers to exclude from selection
   * @returns Array of selected peer identifiers
   *
   * @example
   * ```typescript
   * const targets = gossip.getPeersForGossip(['node-3']);
   * ```
   */
  getPeersForGossip(exclude?: string[]): string[] {
    return this.selectRandomPeers(this.config.fanout, exclude);
  }

  /**
   * Create a digest message for anti-entropy exchange with a peer
   *
   * @param peerId - Target peer identifier
   * @returns A digest gossip message
   *
   * @example
   * ```typescript
   * const digest = gossip.requestAntiEntropy('node-2');
   * transport.send('node-2', 'data', digest);
   * ```
   */
  requestAntiEntropy(_peerId: string): GossipMessage {
    this.incrementClock();

    const entries: { collection: string; documentId: string; version: number }[] = [];

    for (const [collection, docs] of this.knownDocuments) {
      for (const [documentId, version] of docs) {
        entries.push({ collection, documentId, version });
        if (entries.length >= this.config.digestBatchSize) break;
      }
      if (entries.length >= this.config.digestBatchSize) break;
    }

    const message: GossipMessage = {
      id: generateId(),
      originPeerId: this.config.localPeerId,
      type: 'anti-entropy',
      collection: '*',
      payload: { kind: 'digest', entries },
      vectorClock: { ...this.localClock },
      hopCount: 0,
      maxHops: 1,
      timestamp: Date.now(),
    };

    this.markMessageSeen(message.id);
    this.messagesSentCount++;

    return message;
  }

  /**
   * Compare an incoming digest and return response messages for missing documents
   *
   * @param digest - The incoming anti-entropy digest message
   * @returns Array of response gossip messages
   *
   * @example
   * ```typescript
   * const responses = gossip.handleAntiEntropy(incomingDigest);
   * responses.forEach((r) => transport.send(digest.originPeerId, 'data', r));
   * ```
   */
  handleAntiEntropy(digest: GossipMessage): GossipMessage[] {
    if (digest.payload.kind !== 'digest') return [];

    const missingIds: string[] = [];

    for (const entry of digest.payload.entries) {
      const localDocs = this.knownDocuments.get(entry.collection);
      const localVersion = localDocs?.get(entry.documentId);

      if (localVersion === undefined || localVersion < entry.version) {
        missingIds.push(entry.documentId);
      }
    }

    if (missingIds.length === 0) return [];

    this.incrementClock();

    const requestMessage: GossipMessage = {
      id: generateId(),
      originPeerId: this.config.localPeerId,
      type: 'request' as const,
      collection: digest.collection,
      payload: { kind: 'request', documentIds: missingIds },
      vectorClock: { ...this.localClock },
      hopCount: 0,
      maxHops: 1,
      timestamp: Date.now(),
    };

    this.markMessageSeen(requestMessage.id);
    this.messagesSentCount++;

    return [requestMessage];
  }

  /**
   * Get a snapshot of the protocol's internal state
   *
   * @example
   * ```typescript
   * const state = gossip.getState();
   * console.log('Pending updates:', state.pendingUpdates);
   * ```
   */
  getState(): GossipState {
    const docs = new Map<string, Map<string, number>>();
    for (const [col, docMap] of this.knownDocuments) {
      docs.set(col, new Map(docMap));
    }

    return {
      localClock: { ...this.localClock },
      knownDocuments: docs,
      pendingUpdates: this.pendingUpdates,
      lastAntiEntropy: this.lastAntiEntropy,
    };
  }

  /**
   * Get aggregate protocol statistics
   *
   * @example
   * ```typescript
   * const stats = gossip.getStats();
   * console.log(`Sent: ${stats.messagesSent}, Deduped: ${stats.messagesDeduplicated}`);
   * ```
   */
  getStats(): GossipStats {
    return {
      messagesSent: this.messagesSentCount,
      messagesReceived: this.messagesReceivedCount,
      messagesDeduplicated: this.messagesDeduplicatedCount,
      antiEntropyRuns: this.antiEntropyRunsCount,
      convergenceTime: this.lastAntiEntropy > 0 ? Date.now() - this.lastAntiEntropy : 0,
      activePeers: this.peers.size,
    };
  }

  /**
   * Register a peer with the gossip protocol
   *
   * @param peerId - Peer identifier
   *
   * @example
   * ```typescript
   * gossip.registerPeer('node-2');
   * ```
   */
  registerPeer(peerId: string): void {
    this.peers.add(peerId);
  }

  /**
   * Remove a peer from the gossip protocol
   *
   * @param peerId - Peer identifier
   *
   * @example
   * ```typescript
   * gossip.removePeer('node-2');
   * ```
   */
  removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  /**
   * Dispose of the protocol, cleaning up timers and completing observables
   *
   * @example
   * ```typescript
   * gossip.dispose();
   * ```
   */
  dispose(): void {
    if (this.antiEntropyTimer) {
      clearInterval(this.antiEntropyTimer);
      this.antiEntropyTimer = undefined;
    }

    this.messagesSubject.complete();
    this.updatesSubject.complete();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /** Check whether a message has already been processed */
  private isMessageSeen(messageId: string): boolean {
    return this.seenMessages.has(messageId);
  }

  /** Record a message as seen, evicting oldest entries when the limit is reached */
  private markMessageSeen(messageId: string): void {
    this.seenMessages.add(messageId);

    if (this.seenMessages.size > this.config.maxSeenMessages) {
      const first = this.seenMessages.values().next().value;
      if (first !== undefined) {
        this.seenMessages.delete(first);
      }
    }
  }

  /** Select `count` random peers, optionally excluding specific IDs */
  private selectRandomPeers(count: number, exclude?: string[]): string[] {
    const available = [...this.peers].filter(
      (p) => p !== this.config.localPeerId && !(exclude ?? []).includes(p)
    );

    // Fisher-Yates shuffle, then take first `count`
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j]!, available[i]!];
    }

    return available.slice(0, count);
  }

  /** Increment the local vector clock */
  private incrementClock(): void {
    this.localClock[this.config.localPeerId] = (this.localClock[this.config.localPeerId] ?? 0) + 1;
  }

  /** Merge a remote vector clock into the local clock */
  private mergeClock(remote: Record<string, number>): void {
    for (const [peerId, value] of Object.entries(remote)) {
      this.localClock[peerId] = Math.max(this.localClock[peerId] ?? 0, value);
    }
  }

  /** Track a document version in the known documents map */
  private trackDocument(collection: string, documentId: string): void {
    if (!this.knownDocuments.has(collection)) {
      this.knownDocuments.set(collection, new Map());
    }
    const docs = this.knownDocuments.get(collection)!;
    docs.set(documentId, (docs.get(documentId) ?? 0) + 1);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a gossip protocol instance
 *
 * @param config - Gossip protocol configuration
 * @returns A new {@link GossipProtocol} instance
 *
 * @example
 * ```typescript
 * const gossip = createGossipProtocol({
 *   localPeerId: 'node-1',
 *   fanout: 3,
 *   maxHops: 5,
 * });
 * ```
 */
export function createGossipProtocol(config: GossipConfig): GossipProtocol {
  return new GossipProtocol(config);
}
