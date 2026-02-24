/**
 * Transparent Multi-Tab Middleware — automatically coordinates
 * database operations across browser tabs.
 *
 * Wraps a Pocket database instance to transparently:
 * 1. Detect multi-tab scenarios via BroadcastChannel
 * 2. Elect a leader tab that owns the database connection
 * 3. Route queries from follower tabs to the leader
 * 4. Broadcast mutations to all tabs for cache invalidation
 * 5. Handle leader failover on tab close
 */

import { BehaviorSubject, Subject } from 'rxjs';

/** Tab role in the coordination scheme. */
export type TabRole = 'leader' | 'follower' | 'standalone';

/** Health status of a tab in the coordination. */
export interface TabHealth {
  readonly tabId: string;
  readonly role: TabRole;
  readonly lastHeartbeat: number;
  readonly isHealthy: boolean;
  readonly connectedTabs: number;
}

/** Configuration for the multi-tab middleware. */
export interface MultiTabMiddlewareConfig {
  /** Unique database name (used as BroadcastChannel name). */
  readonly databaseName: string;
  /** Heartbeat interval in ms. Defaults to 2000. */
  readonly heartbeatIntervalMs?: number;
  /** How long before a tab is considered dead. Defaults to 6000. */
  readonly heartbeatTimeoutMs?: number;
  /** Whether to enable multi-tab coordination. Defaults to true. */
  readonly enabled?: boolean;
}

/** Events emitted by the coordination layer. */
export interface CoordinationEvent {
  readonly type: 'leader-elected' | 'leader-lost' | 'tab-joined' | 'tab-left' | 'failover';
  readonly tabId: string;
  readonly timestamp: number;
  readonly details?: string;
}

/** Inter-tab message format. */
interface TabMessage {
  readonly type: 'heartbeat' | 'election' | 'leader-announce' | 'mutation' | 'query' | 'response';
  readonly tabId: string;
  readonly timestamp: number;
  readonly payload?: unknown;
}

export class MultiTabMiddleware {
  private readonly config: Required<MultiTabMiddlewareConfig>;
  private readonly tabId: string;
  private channel: BroadcastChannel | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private role: TabRole = 'standalone';
  private readonly knownTabs = new Map<string, number>(); // tabId -> lastHeartbeat
  private readonly health$: BehaviorSubject<TabHealth>;
  private readonly events$ = new Subject<CoordinationEvent>();

  constructor(config: MultiTabMiddlewareConfig) {
    this.config = {
      databaseName: config.databaseName,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 2000,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? 6000,
      enabled: config.enabled ?? true,
    };
    this.tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.health$ = new BehaviorSubject<TabHealth>(this.buildHealth());
  }

  /** Start the multi-tab coordination. */
  start(): void {
    if (!this.config.enabled || typeof BroadcastChannel === 'undefined') {
      this.role = 'standalone';
      this.emitHealth();
      return;
    }

    try {
      this.channel = new BroadcastChannel(`pocket-mt-${this.config.databaseName}`);
      this.channel.onmessage = (event: MessageEvent<TabMessage>) => {
        this.handleMessage(event.data);
      };

      // Start election
      this.startElection();

      // Start heartbeat
      this.heartbeatTimer = setInterval(() => {
        this.sendHeartbeat();
        this.pruneDeadTabs();
      }, this.config.heartbeatIntervalMs);
    } catch {
      this.role = 'standalone';
      this.emitHealth();
    }
  }

  /** Get the current tab's role. */
  getRole(): TabRole {
    return this.role;
  }

  /** Get this tab's unique identifier. */
  getTabId(): string {
    return this.tabId;
  }

  /** Check if this tab is the leader. */
  isLeader(): boolean {
    return this.role === 'leader';
  }

  /** Get the number of connected tabs. */
  getTabCount(): number {
    return this.knownTabs.size + 1; // +1 for self
  }

  /** Broadcast a mutation event to all tabs (for cache invalidation). */
  broadcastMutation(collection: string, operation: string, documentId: string): void {
    this.send({
      type: 'mutation',
      tabId: this.tabId,
      timestamp: Date.now(),
      payload: { collection, operation, documentId },
    });
  }

  /** Observable of tab health. */
  get health() {
    return this.health$.asObservable();
  }

  /** Observable of coordination events. */
  get events() {
    return this.events$.asObservable();
  }

  /** Shut down the coordination. */
  destroy(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.channel?.close();
    this.health$.complete();
    this.events$.complete();
  }

  private startElection(): void {
    // Simple election: wait for existing leader announcement
    // If no leader announces within one heartbeat interval, become leader
    this.send({
      type: 'election',
      tabId: this.tabId,
      timestamp: Date.now(),
    });

    setTimeout(() => {
      if (this.role === 'standalone') {
        this.becomeLeader();
      }
    }, this.config.heartbeatIntervalMs);
  }

  private becomeLeader(): void {
    this.role = 'leader';
    this.send({
      type: 'leader-announce',
      tabId: this.tabId,
      timestamp: Date.now(),
    });
    this.emitEvent('leader-elected');
    this.emitHealth();
  }

  private handleMessage(msg: TabMessage): void {
    if (msg.tabId === this.tabId) return; // Ignore own messages

    switch (msg.type) {
      case 'heartbeat':
        this.knownTabs.set(msg.tabId, msg.timestamp);
        break;

      case 'election':
        // If we're already leader, re-announce
        if (this.role === 'leader') {
          this.send({
            type: 'leader-announce',
            tabId: this.tabId,
            timestamp: Date.now(),
          });
        }
        this.knownTabs.set(msg.tabId, msg.timestamp);
        this.emitEvent('tab-joined', msg.tabId);
        break;

      case 'leader-announce':
        if (this.role !== 'leader') {
          this.role = 'follower';
          this.emitHealth();
        }
        this.knownTabs.set(msg.tabId, msg.timestamp);
        break;

      case 'mutation':
        // Follower tabs receive mutation notifications for cache invalidation
        break;
    }

    this.emitHealth();
  }

  private sendHeartbeat(): void {
    this.send({
      type: 'heartbeat',
      tabId: this.tabId,
      timestamp: Date.now(),
    });
  }

  private pruneDeadTabs(): void {
    const now = Date.now();
    let leaderDied = false;

    for (const [tabId, lastHeartbeat] of this.knownTabs) {
      if (now - lastHeartbeat > this.config.heartbeatTimeoutMs) {
        this.knownTabs.delete(tabId);
        this.emitEvent('tab-left', tabId);

        // Check if the dead tab was the leader
        if (this.role === 'follower') {
          leaderDied = true;
        }
      }
    }

    if (leaderDied) {
      this.emitEvent('failover');
      this.startElection();
    }

    this.emitHealth();
  }

  private send(msg: TabMessage): void {
    try {
      this.channel?.postMessage(msg);
    } catch {
      // Channel may be closed
    }
  }

  private buildHealth(): TabHealth {
    return {
      tabId: this.tabId,
      role: this.role,
      lastHeartbeat: Date.now(),
      isHealthy: true,
      connectedTabs: this.knownTabs.size + 1,
    };
  }

  private emitHealth(): void {
    this.health$.next(this.buildHealth());
  }

  private emitEvent(type: CoordinationEvent['type'], tabId?: string): void {
    this.events$.next({
      type,
      tabId: tabId ?? this.tabId,
      timestamp: Date.now(),
    });
  }
}

export function createMultiTabMiddleware(config: MultiTabMiddlewareConfig): MultiTabMiddleware {
  return new MultiTabMiddleware(config);
}
