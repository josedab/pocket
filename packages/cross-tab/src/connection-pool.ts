/**
 * ConnectionPool - Shared sync connection management across browser tabs.
 *
 * Only the leader tab maintains the sync connection. Other tabs
 * route sync requests through the leader via BroadcastChannel.
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

export interface ConnectionPoolConfig {
  /** Channel name for connection coordination. @default 'pocket-connection-pool' */
  channelName?: string;
  /** Heartbeat interval in ms. @default 5000 */
  heartbeatIntervalMs?: number;
  /** Connection timeout in ms before failover. @default 10000 */
  connectionTimeoutMs?: number;
  /** Maximum queued messages when not leader. @default 1000 */
  maxQueueSize?: number;
}

export type ConnectionPoolStatus = 'idle' | 'leader' | 'follower' | 'failover';

export interface ConnectionPoolStats {
  status: ConnectionPoolStatus;
  tabId: string;
  leaderId: string | null;
  messagesRouted: number;
  messagesQueued: number;
  lastHeartbeat: number | null;
  connectionShared: boolean;
}

interface PoolMessage {
  type: 'heartbeat' | 'sync-request' | 'sync-response' | 'leader-change' | 'connection-status';
  senderId: string;
  leaderId?: string;
  payload?: unknown;
  timestamp: number;
}

export class ConnectionPool {
  private readonly config: Required<ConnectionPoolConfig>;
  private readonly tabId: string;
  private readonly destroy$ = new Subject<void>();
  private readonly status$ = new BehaviorSubject<ConnectionPoolStatus>('idle');
  private readonly stats$ = new BehaviorSubject<ConnectionPoolStats>({
    status: 'idle',
    tabId: '',
    leaderId: null,
    messagesRouted: 0,
    messagesQueued: 0,
    lastHeartbeat: null,
    connectionShared: false,
  });

  private channel: BroadcastChannel | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private leaderId: string | null = null;
  private isLeader = false;
  private messageQueue: PoolMessage[] = [];
  private messagesRouted = 0;

  constructor(config: ConnectionPoolConfig = {}) {
    this.tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.config = {
      channelName: config.channelName ?? 'pocket-connection-pool',
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 5_000,
      connectionTimeoutMs: config.connectionTimeoutMs ?? 10_000,
      maxQueueSize: config.maxQueueSize ?? 1_000,
    };
  }

  /**
   * Start the connection pool and begin coordination.
   */
  start(): void {
    if (typeof BroadcastChannel === 'undefined') {
      // Fallback: act as standalone leader
      this.isLeader = true;
      this.leaderId = this.tabId;
      this.status$.next('leader');
      this.updateStats();
      return;
    }

    this.channel = new BroadcastChannel(this.config.channelName);
    this.channel.onmessage = (event: MessageEvent<PoolMessage>) => {
      this.handleMessage(event.data);
    };

    // Announce presence and check for existing leader
    this.broadcast({
      type: 'heartbeat',
      senderId: this.tabId,
      timestamp: Date.now(),
    });

    // Wait briefly to see if a leader responds
    setTimeout(() => {
      if (!this.leaderId) {
        // No leader found, become leader
        this.becomeLeader();
      } else {
        this.status$.next('follower');
        this.updateStats();
      }
    }, 500);

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      if (this.isLeader) {
        this.broadcast({
          type: 'heartbeat',
          senderId: this.tabId,
          leaderId: this.tabId,
          timestamp: Date.now(),
        });
      }
      this.checkLeaderHealth();
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Stop the connection pool.
   */
  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.isLeader) {
      this.broadcast({
        type: 'leader-change',
        senderId: this.tabId,
        leaderId: undefined,
        timestamp: Date.now(),
      });
    }

    this.channel?.close();
    this.channel = null;
    this.isLeader = false;
    this.leaderId = null;
    this.status$.next('idle');
    this.updateStats();
  }

  /**
   * Route a sync request through the leader tab.
   */
  routeSyncRequest(request: unknown): void {
    if (this.isLeader) {
      // Process directly
      this.messagesRouted++;
      this.updateStats();
      return;
    }

    const message: PoolMessage = {
      type: 'sync-request',
      senderId: this.tabId,
      payload: request,
      timestamp: Date.now(),
    };

    if (this.messageQueue.length >= this.config.maxQueueSize) {
      this.messageQueue.shift();
    }

    this.messageQueue.push(message);
    this.broadcast(message);
    this.updateStats();
  }

  /**
   * Whether this tab is the leader.
   */
  getIsLeader(): boolean {
    return this.isLeader;
  }

  /**
   * Get the current tab ID.
   */
  getTabId(): string {
    return this.tabId;
  }

  /**
   * Get the leader tab ID.
   */
  getLeaderId(): string | null {
    return this.leaderId;
  }

  /**
   * Get status observable.
   */
  getStatus(): Observable<ConnectionPoolStatus> {
    return this.status$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get stats observable.
   */
  getStats(): Observable<ConnectionPoolStats> {
    return this.stats$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get current stats snapshot.
   */
  getCurrentStats(): ConnectionPoolStats {
    return this.stats$.getValue();
  }

  /**
   * Force this tab to become leader.
   */
  forceLeadership(): void {
    this.becomeLeader();
  }

  destroy(): void {
    this.stop();
    this.destroy$.next();
    this.destroy$.complete();
    this.status$.complete();
    this.stats$.complete();
  }

  private becomeLeader(): void {
    this.isLeader = true;
    this.leaderId = this.tabId;
    this.status$.next('leader');

    this.broadcast({
      type: 'leader-change',
      senderId: this.tabId,
      leaderId: this.tabId,
      timestamp: Date.now(),
    });

    // Process queued messages
    this.messagesRouted += this.messageQueue.length;
    this.messageQueue = [];
    this.updateStats();
  }

  private handleMessage(message: PoolMessage): void {
    if (message.senderId === this.tabId) return;

    switch (message.type) {
      case 'heartbeat':
        if (message.leaderId) {
          this.leaderId = message.leaderId;
          this.stats$.next({
            ...this.stats$.getValue(),
            leaderId: message.leaderId,
            lastHeartbeat: message.timestamp,
          });
        }
        break;

      case 'leader-change':
        if (message.leaderId) {
          this.leaderId = message.leaderId;
          if (message.leaderId !== this.tabId) {
            this.isLeader = false;
            this.status$.next('follower');
          }
        } else {
          // Leader left, try to become leader
          this.leaderId = null;
          this.status$.next('failover');
          setTimeout(() => {
            if (!this.leaderId) {
              this.becomeLeader();
            }
          }, Math.random() * 1000); // Random backoff to avoid split-brain
        }
        this.updateStats();
        break;

      case 'sync-request':
        if (this.isLeader) {
          this.messagesRouted++;
          this.broadcast({
            type: 'sync-response',
            senderId: this.tabId,
            payload: { requestFrom: message.senderId, processed: true },
            timestamp: Date.now(),
          });
          this.updateStats();
        }
        break;

      case 'sync-response':
        // Response from leader
        break;

      case 'connection-status':
        break;
    }
  }

  private checkLeaderHealth(): void {
    if (this.isLeader) return;

    const stats = this.stats$.getValue();
    if (stats.lastHeartbeat) {
      const elapsed = Date.now() - stats.lastHeartbeat;
      if (elapsed > this.config.connectionTimeoutMs) {
        // Leader seems dead, initiate failover
        this.leaderId = null;
        this.status$.next('failover');
        setTimeout(() => {
          if (!this.leaderId) {
            this.becomeLeader();
          }
        }, Math.random() * 2000);
      }
    }
  }

  private broadcast(message: PoolMessage): void {
    this.channel?.postMessage(message);
  }

  private updateStats(): void {
    this.stats$.next({
      status: this.status$.getValue(),
      tabId: this.tabId,
      leaderId: this.leaderId,
      messagesRouted: this.messagesRouted,
      messagesQueued: this.messageQueue.length,
      lastHeartbeat: this.stats$.getValue().lastHeartbeat,
      connectionShared: this.isLeader || this.leaderId !== null,
    });
  }
}

export function createConnectionPool(config?: ConnectionPoolConfig): ConnectionPool {
  return new ConnectionPool(config);
}
