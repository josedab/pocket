/**
 * Cross-Tab Sync - Synchronize data across browser tabs
 */

import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import { type TabManager } from './tab-manager.js';
import type {
  ChangePayload,
  CollectionSyncState,
  CrossTabConfig,
  CrossTabEvent,
  CrossTabMessage,
  SyncRequestPayload,
  SyncResponsePayload,
} from './types.js';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<CrossTabConfig> = {
  channelPrefix: 'pocket',
  heartbeatInterval: 1000,
  leaderTimeout: 3000,
  lockExpiry: 30000,
  deduplicationWindow: 5000,
  debug: false,
};

/**
 * Generate unique message ID
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Synchronizes data across browser tabs
 */
export class CrossTabSync {
  private readonly config: Required<CrossTabConfig>;
  private readonly tabManager: TabManager;
  private readonly events$ = new Subject<CrossTabEvent>();
  private readonly syncState$ = new BehaviorSubject<Map<string, CollectionSyncState>>(new Map());
  private channels = new Map<string, BroadcastChannel>();
  private handlers = new Map<string, Set<(message: CrossTabMessage) => void>>();
  private messageCache = new Map<string, number>();
  private destroyed = false;

  constructor(tabManager: TabManager, config: CrossTabConfig = {}) {
    this.tabManager = tabManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize cross-tab sync
   */
  async initialize(): Promise<void> {
    // Start cleanup timer for message deduplication cache
    setInterval(() => {
      this.cleanupMessageCache();
    }, this.config.deduplicationWindow);

    this.log('Cross-tab sync initialized');
  }

  /**
   * Destroy cross-tab sync
   */
  destroy(): void {
    this.destroyed = true;

    for (const channel of this.channels.values()) {
      channel.close();
    }
    this.channels.clear();
    this.handlers.clear();
    this.messageCache.clear();

    this.events$.complete();
    this.syncState$.complete();
  }

  /**
   * Subscribe to a collection channel
   */
  subscribe(collection: string, handler: (message: CrossTabMessage) => void): () => void {
    if (typeof BroadcastChannel === 'undefined') {
      return () => {};
    }

    const channelName = `${this.config.channelPrefix}_${collection}`;

    // Create channel if not exists
    if (!this.channels.has(channelName)) {
      const channel = new BroadcastChannel(channelName);
      channel.onmessage = (event: MessageEvent<CrossTabMessage>) => {
        this.handleMessage(collection, event.data);
      };
      this.channels.set(channelName, channel);
    }

    // Add handler
    if (!this.handlers.has(collection)) {
      this.handlers.set(collection, new Set());
    }
    this.handlers.get(collection)!.add(handler);

    // Initialize sync state for collection
    if (!this.syncState$.value.has(collection)) {
      const state = new Map(this.syncState$.value);
      state.set(collection, {
        collection,
        lastSyncAt: 0,
        pendingChanges: 0,
        syncing: false,
      });
      this.syncState$.next(state);
    }

    return () => {
      const handlerSet = this.handlers.get(collection);
      if (handlerSet) {
        handlerSet.delete(handler);
        if (handlerSet.size === 0) {
          this.handlers.delete(collection);
          const channel = this.channels.get(channelName);
          if (channel) {
            channel.close();
            this.channels.delete(channelName);
          }
        }
      }
    };
  }

  /**
   * Broadcast a change to other tabs
   */
  broadcastChange(
    collection: string,
    id: string,
    data: Record<string, unknown>,
    version?: number
  ): void {
    this.broadcast(collection, {
      type: 'change',
      channel: collection,
      senderId: this.tabManager.getTabId(),
      payload: {
        id,
        data,
        timestamp: Date.now(),
        version,
      } as ChangePayload,
      timestamp: Date.now(),
      messageId: generateMessageId(),
    });

    this.emitEvent('message-received', undefined, { type: 'change', collection, id });
  }

  /**
   * Broadcast a delete to other tabs
   */
  broadcastDelete(collection: string, id: string): void {
    this.broadcast(collection, {
      type: 'delete',
      channel: collection,
      senderId: this.tabManager.getTabId(),
      payload: { id, timestamp: Date.now() } as ChangePayload,
      timestamp: Date.now(),
      messageId: generateMessageId(),
    });

    this.emitEvent('message-received', undefined, { type: 'delete', collection, id });
  }

  /**
   * Broadcast a clear to other tabs
   */
  broadcastClear(collection: string): void {
    this.broadcast(collection, {
      type: 'clear',
      channel: collection,
      senderId: this.tabManager.getTabId(),
      payload: { timestamp: Date.now() },
      timestamp: Date.now(),
      messageId: generateMessageId(),
    });

    this.emitEvent('message-received', undefined, { type: 'clear', collection });
  }

  /**
   * Request sync from other tabs
   */
  requestSync(collection: string, since?: number): void {
    this.broadcast(collection, {
      type: 'sync-request',
      channel: collection,
      senderId: this.tabManager.getTabId(),
      payload: {
        collection,
        since,
      } as SyncRequestPayload,
      timestamp: Date.now(),
      messageId: generateMessageId(),
    });

    // Update sync state
    const state = new Map(this.syncState$.value);
    const collectionState = state.get(collection);
    if (collectionState) {
      state.set(collection, {
        ...collectionState,
        syncing: true,
      });
      this.syncState$.next(state);
    }
  }

  /**
   * Respond to sync request
   */
  respondToSync(
    collection: string,
    requesterId: string,
    documents: { id: string; data: Record<string, unknown>; timestamp: number }[]
  ): void {
    this.broadcast(
      collection,
      {
        type: 'sync-response',
        channel: collection,
        senderId: this.tabManager.getTabId(),
        payload: {
          collection,
          documents,
          total: documents.length,
        } as SyncResponsePayload,
        timestamp: Date.now(),
        messageId: generateMessageId(),
      },
      requesterId
    );
  }

  /**
   * Get events observable
   */
  get events(): Observable<CrossTabEvent> {
    return this.events$.asObservable();
  }

  /**
   * Get sync state observable
   */
  get syncState(): Observable<Map<string, CollectionSyncState>> {
    return this.syncState$.asObservable();
  }

  /**
   * Get sync state for a collection
   */
  getCollectionSyncState(collection: string): CollectionSyncState | undefined {
    return this.syncState$.value.get(collection);
  }

  /**
   * Handle incoming message
   */
  private handleMessage(collection: string, message: CrossTabMessage): void {
    if (!message || message.senderId === this.tabManager.getTabId()) return;

    // Deduplicate messages
    if (this.messageCache.has(message.messageId)) return;
    this.messageCache.set(message.messageId, Date.now());

    this.log('Received message', message.type, collection);

    // Notify handlers
    const handlerSet = this.handlers.get(collection);
    if (handlerSet) {
      for (const handler of handlerSet) {
        try {
          handler(message);
        } catch (error) {
          this.log('Handler error', error);
        }
      }
    }

    // Update sync state
    if (message.type === 'sync-response') {
      const state = new Map(this.syncState$.value);
      const collectionState = state.get(collection);
      if (collectionState) {
        state.set(collection, {
          ...collectionState,
          lastSyncAt: Date.now(),
          syncing: false,
        });
        this.syncState$.next(state);
        this.emitEvent('sync-complete', undefined, { collection });
      }
    }
  }

  /**
   * Broadcast a message
   */
  private broadcast(collection: string, message: CrossTabMessage, _targetTabId?: string): void {
    if (this.destroyed) return;

    const channelName = `${this.config.channelPrefix}_${collection}`;
    let channel = this.channels.get(channelName);

    // Create channel if not exists
    if (!channel && typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = (event: MessageEvent<CrossTabMessage>) => {
        this.handleMessage(collection, event.data);
      };
      this.channels.set(channelName, channel);
    }

    if (channel) {
      try {
        channel.postMessage(message);
      } catch (error) {
        this.log('Failed to broadcast', error);
      }
    }
  }

  /**
   * Clean up message cache
   */
  private cleanupMessageCache(): void {
    const now = Date.now();
    const cutoff = now - this.config.deduplicationWindow;

    for (const [messageId, timestamp] of this.messageCache) {
      if (timestamp < cutoff) {
        this.messageCache.delete(messageId);
      }
    }
  }

  /**
   * Emit an event
   */
  private emitEvent(type: CrossTabEvent['type'], tabId?: string, data?: unknown): void {
    this.events$.next({
      type,
      tabId,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Log debug message
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[CrossTabSync]', ...args);
    }
  }
}

/**
 * Create a cross-tab sync instance
 */
export function createCrossTabSync(tabManager: TabManager, config?: CrossTabConfig): CrossTabSync {
  return new CrossTabSync(tabManager, config);
}
