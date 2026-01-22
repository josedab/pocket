/**
 * Tab Manager - Tracks and manages browser tabs
 */

import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import type { CrossTabConfig, CrossTabEvent, TabInfo } from './types.js';

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
 * Generate unique tab ID
 */
function generateTabId(): string {
  return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Manages browser tabs and provides tab discovery
 */
export class TabManager {
  private readonly config: Required<CrossTabConfig>;
  private readonly tabId: string;
  private readonly tabs$ = new BehaviorSubject<Map<string, TabInfo>>(new Map());
  private readonly events$ = new Subject<CrossTabEvent>();
  private channel: BroadcastChannel | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(config: CrossTabConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tabId = generateTabId();
  }

  /**
   * Initialize tab manager
   */
  async initialize(): Promise<void> {
    if (typeof BroadcastChannel === 'undefined') {
      this.log('BroadcastChannel not available');
      return;
    }

    this.channel = new BroadcastChannel(`${this.config.channelPrefix}_tabs`);
    this.channel.onmessage = this.handleMessage.bind(this);

    // Register this tab
    this.registerTab();

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);

    // Start cleanup of stale tabs
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleTabs();
    }, this.config.leaderTimeout);

    // Announce presence
    this.broadcast({
      type: 'tab-joined',
      tabId: this.tabId,
      data: this.getThisTabInfo(),
      timestamp: Date.now(),
    });

    this.emitEvent('connected');
    this.log('Tab manager initialized', this.tabId);
  }

  /**
   * Destroy tab manager
   */
  destroy(): void {
    this.destroyed = true;

    // Announce departure
    if (this.channel) {
      this.broadcast({
        type: 'tab-left',
        tabId: this.tabId,
        timestamp: Date.now(),
      });

      this.channel.close();
      this.channel = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.emitEvent('disconnected');
    this.tabs$.complete();
    this.events$.complete();
  }

  /**
   * Get this tab's ID
   */
  getTabId(): string {
    return this.tabId;
  }

  /**
   * Get all known tabs
   */
  getTabs(): TabInfo[] {
    return Array.from(this.tabs$.value.values());
  }

  /**
   * Get tabs observable
   */
  get tabs(): Observable<Map<string, TabInfo>> {
    return this.tabs$.asObservable();
  }

  /**
   * Get events observable
   */
  get events(): Observable<CrossTabEvent> {
    return this.events$.asObservable();
  }

  /**
   * Get this tab's info
   */
  getThisTabInfo(): TabInfo {
    const tabs = this.tabs$.value;
    return (
      tabs.get(this.tabId) ?? {
        id: this.tabId,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        isLeader: false,
      }
    );
  }

  /**
   * Update this tab's metadata
   */
  updateMetadata(metadata: Record<string, unknown>): void {
    const tabs = new Map(this.tabs$.value);
    const tabInfo = tabs.get(this.tabId);

    if (tabInfo) {
      tabs.set(this.tabId, {
        ...tabInfo,
        metadata: { ...tabInfo.metadata, ...metadata },
        lastActiveAt: Date.now(),
      });
      this.tabs$.next(tabs);
    }
  }

  /**
   * Broadcast a message to all tabs
   */
  broadcast(event: CrossTabEvent): void {
    if (!this.channel || this.destroyed) return;

    try {
      this.channel.postMessage(event);
    } catch (error) {
      this.log('Failed to broadcast message', error);
    }
  }

  /**
   * Register this tab
   */
  private registerTab(): void {
    const tabs = new Map(this.tabs$.value);
    tabs.set(this.tabId, {
      id: this.tabId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      isLeader: false,
    });
    this.tabs$.next(tabs);
  }

  /**
   * Send heartbeat to other tabs
   */
  private sendHeartbeat(): void {
    if (this.destroyed) return;

    const tabs = new Map(this.tabs$.value);
    const tabInfo = tabs.get(this.tabId);

    if (tabInfo) {
      tabs.set(this.tabId, {
        ...tabInfo,
        lastActiveAt: Date.now(),
      });
      this.tabs$.next(tabs);
    }

    this.broadcast({
      type: 'tab-joined',
      tabId: this.tabId,
      data: this.getThisTabInfo(),
      timestamp: Date.now(),
    });
  }

  /**
   * Clean up stale tabs
   */
  private cleanupStaleTabs(): void {
    const now = Date.now();
    const tabs = new Map(this.tabs$.value);
    let changed = false;

    for (const [tabId, tabInfo] of tabs) {
      if (tabId === this.tabId) continue;

      if (now - tabInfo.lastActiveAt > this.config.leaderTimeout * 2) {
        tabs.delete(tabId);
        changed = true;
        this.emitEvent('tab-left', tabId);
        this.log('Removed stale tab', tabId);
      }
    }

    if (changed) {
      this.tabs$.next(tabs);
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(event: MessageEvent<CrossTabEvent>): void {
    const message = event.data;

    if (!message || message.tabId === this.tabId) return;

    switch (message.type) {
      case 'tab-joined': {
        const tabInfo = message.data as TabInfo;
        if (tabInfo) {
          const tabs = new Map(this.tabs$.value);
          const isNew = !tabs.has(tabInfo.id);
          tabs.set(tabInfo.id, tabInfo);
          this.tabs$.next(tabs);

          if (isNew) {
            this.emitEvent('tab-joined', tabInfo.id, tabInfo);
          }
        }
        break;
      }

      case 'tab-left': {
        const tabs = new Map(this.tabs$.value);
        if (tabs.has(message.tabId!)) {
          tabs.delete(message.tabId!);
          this.tabs$.next(tabs);
          this.emitEvent('tab-left', message.tabId);
        }
        break;
      }

      default:
        this.emitEvent('message-received', message.tabId, message);
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
      console.log('[TabManager]', ...args);
    }
  }
}

/**
 * Create a tab manager
 */
export function createTabManager(config?: CrossTabConfig): TabManager {
  return new TabManager(config);
}
