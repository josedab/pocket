/**
 * Leader Election - Elect a single leader tab
 */

import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import { type TabManager } from './tab-manager.js';
import type { CrossTabConfig, CrossTabEvent, LeaderState } from './types.js';

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
 * Leader election message types
 */
interface LeaderMessage {
  type: 'election' | 'heartbeat' | 'abdicate';
  tabId: string;
  priority: number;
  timestamp: number;
}

/**
 * Manages leader election across browser tabs
 */
export class LeaderElection {
  private readonly config: Required<CrossTabConfig>;
  private readonly tabManager: TabManager;
  private readonly state$ = new BehaviorSubject<LeaderState>({
    leaderId: null,
    electedAt: null,
    lastHeartbeat: null,
    isLeader: false,
  });
  private readonly events$ = new Subject<CrossTabEvent>();
  private channel: BroadcastChannel | null = null;
  private electionTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private electionInProgress = false;
  private destroyed = false;

  constructor(tabManager: TabManager, config: CrossTabConfig = {}) {
    this.tabManager = tabManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize leader election
   */
  async initialize(): Promise<void> {
    if (typeof BroadcastChannel === 'undefined') {
      // Single tab, become leader immediately
      this.becomeLeader();
      return;
    }

    this.channel = new BroadcastChannel(`${this.config.channelPrefix}_leader`);
    this.channel.onmessage = this.handleMessage.bind(this);

    // Start checking for leader timeout
    this.checkTimer = setInterval(() => {
      this.checkLeaderTimeout();
    }, this.config.heartbeatInterval);

    // Start election
    this.startElection();

    this.log('Leader election initialized');
  }

  /**
   * Destroy leader election
   */
  destroy(): void {
    this.destroyed = true;

    // Abdicate if leader
    if (this.state$.value.isLeader) {
      this.abdicate();
    }

    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }

    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    this.state$.complete();
    this.events$.complete();
  }

  /**
   * Get current leader state
   */
  getState(): LeaderState {
    return this.state$.value;
  }

  /**
   * Get leader state observable
   */
  get state(): Observable<LeaderState> {
    return this.state$.asObservable();
  }

  /**
   * Get events observable
   */
  get events(): Observable<CrossTabEvent> {
    return this.events$.asObservable();
  }

  /**
   * Check if this tab is the leader
   */
  isLeader(): boolean {
    return this.state$.value.isLeader;
  }

  /**
   * Get the leader tab ID
   */
  getLeaderId(): string | null {
    return this.state$.value.leaderId;
  }

  /**
   * Request leadership (force election)
   */
  requestLeadership(): void {
    this.startElection();
  }

  /**
   * Voluntarily give up leadership
   */
  abdicate(): void {
    if (!this.state$.value.isLeader) return;

    this.broadcast({
      type: 'abdicate',
      tabId: this.tabManager.getTabId(),
      priority: 0,
      timestamp: Date.now(),
    });

    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.updateState({
      leaderId: null,
      electedAt: null,
      lastHeartbeat: null,
      isLeader: false,
    });

    // Start new election after short delay
    setTimeout(() => {
      if (!this.destroyed) {
        this.startElection();
      }
    }, 100);
  }

  /**
   * Start leader election
   */
  private startElection(): void {
    if (this.electionInProgress || this.destroyed) return;

    this.electionInProgress = true;
    this.log('Starting election');

    // Calculate priority (older tabs have higher priority)
    const tabInfo = this.tabManager.getThisTabInfo();
    const priority = Number.MAX_SAFE_INTEGER - tabInfo.createdAt;

    this.broadcast({
      type: 'election',
      tabId: this.tabManager.getTabId(),
      priority,
      timestamp: Date.now(),
    });

    // Wait for other tabs to respond
    this.electionTimer = setTimeout(() => {
      this.electionInProgress = false;
      this.becomeLeader();
    }, this.config.heartbeatInterval * 2);
  }

  /**
   * Become the leader
   */
  private becomeLeader(): void {
    const now = Date.now();

    this.updateState({
      leaderId: this.tabManager.getTabId(),
      electedAt: now,
      lastHeartbeat: now,
      isLeader: true,
    });

    // Start sending heartbeats
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);

    this.emitEvent('leader-changed', this.tabManager.getTabId());
    this.log('Became leader');
  }

  /**
   * Send leader heartbeat
   */
  private sendHeartbeat(): void {
    if (!this.state$.value.isLeader || this.destroyed) return;

    this.broadcast({
      type: 'heartbeat',
      tabId: this.tabManager.getTabId(),
      priority: 0,
      timestamp: Date.now(),
    });

    this.updateState({
      lastHeartbeat: Date.now(),
    });
  }

  /**
   * Check if leader has timed out
   */
  private checkLeaderTimeout(): void {
    const state = this.state$.value;

    if (state.isLeader || !state.leaderId) return;

    const now = Date.now();
    const timeSinceHeartbeat = now - (state.lastHeartbeat ?? 0);

    if (timeSinceHeartbeat > this.config.leaderTimeout) {
      this.log('Leader timeout, starting election');
      this.updateState({
        leaderId: null,
        electedAt: null,
        lastHeartbeat: null,
        isLeader: false,
      });
      this.startElection();
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(event: MessageEvent<LeaderMessage>): void {
    const message = event.data;
    const myTabId = this.tabManager.getTabId();

    if (!message || message.tabId === myTabId) return;

    switch (message.type) {
      case 'election': {
        // Check if other tab has higher priority
        const myTabInfo = this.tabManager.getThisTabInfo();
        const myPriority = Number.MAX_SAFE_INTEGER - myTabInfo.createdAt;

        if (message.priority > myPriority) {
          // Other tab has higher priority, stand down
          if (this.electionTimer) {
            clearTimeout(this.electionTimer);
            this.electionTimer = null;
          }
          this.electionInProgress = false;

          if (this.state$.value.isLeader) {
            // Stop being leader
            if (this.heartbeatTimer) {
              clearInterval(this.heartbeatTimer);
              this.heartbeatTimer = null;
            }
            this.updateState({
              isLeader: false,
            });
          }
        } else if (!this.electionInProgress) {
          // We have higher priority, start our own election
          this.startElection();
        }
        break;
      }

      case 'heartbeat': {
        // Received heartbeat from leader
        if (this.electionTimer) {
          clearTimeout(this.electionTimer);
          this.electionTimer = null;
        }
        this.electionInProgress = false;

        const wasLeader = this.state$.value.isLeader;
        const leaderChanged = this.state$.value.leaderId !== message.tabId;

        if (wasLeader && message.tabId !== myTabId) {
          // Stop being leader
          if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
          }
        }

        this.updateState({
          leaderId: message.tabId,
          lastHeartbeat: message.timestamp,
          isLeader: false,
        });

        if (leaderChanged) {
          this.emitEvent('leader-changed', message.tabId);
        }
        break;
      }

      case 'abdicate': {
        if (this.state$.value.leaderId === message.tabId) {
          this.updateState({
            leaderId: null,
            electedAt: null,
            lastHeartbeat: null,
            isLeader: false,
          });
          // Start election
          setTimeout(() => {
            if (!this.destroyed) {
              this.startElection();
            }
          }, Math.random() * 500);
        }
        break;
      }
    }
  }

  /**
   * Broadcast a message
   */
  private broadcast(message: LeaderMessage): void {
    if (!this.channel || this.destroyed) return;

    try {
      this.channel.postMessage(message);
    } catch (error) {
      this.log('Failed to broadcast', error);
    }
  }

  /**
   * Update state
   */
  private updateState(partial: Partial<LeaderState>): void {
    this.state$.next({
      ...this.state$.value,
      ...partial,
    });
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
      console.log('[LeaderElection]', ...args);
    }
  }
}

/**
 * Create a leader election instance
 */
export function createLeaderElection(
  tabManager: TabManager,
  config?: CrossTabConfig
): LeaderElection {
  return new LeaderElection(tabManager, config);
}
