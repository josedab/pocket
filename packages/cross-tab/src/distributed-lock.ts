/**
 * Distributed Lock - Coordinate access across tabs
 */

import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import { type TabManager } from './tab-manager.js';
import type { CrossTabConfig, CrossTabEvent, DistributedLock } from './types.js';

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
 * Lock message types
 */
interface LockMessage {
  type: 'request' | 'acquired' | 'released' | 'rejected';
  resource: string;
  tabId: string;
  priority: number;
  timestamp: number;
  expiresAt?: number;
}

/**
 * Lock request state
 */
interface LockRequest {
  resource: string;
  resolve: (acquired: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Manages distributed locks across browser tabs
 */
export class DistributedLockManager {
  private readonly config: Required<CrossTabConfig>;
  private readonly tabManager: TabManager;
  private readonly locks$ = new BehaviorSubject<Map<string, DistributedLock>>(new Map());
  private readonly events$ = new Subject<CrossTabEvent>();
  private channel: BroadcastChannel | null = null;
  private pendingRequests = new Map<string, LockRequest>();
  private destroyed = false;

  constructor(tabManager: TabManager, config: CrossTabConfig = {}) {
    this.tabManager = tabManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize lock manager
   */
  async initialize(): Promise<void> {
    if (typeof BroadcastChannel === 'undefined') {
      this.log('BroadcastChannel not available');
      return;
    }

    this.channel = new BroadcastChannel(`${this.config.channelPrefix}_locks`);
    this.channel.onmessage = this.handleMessage.bind(this);

    // Start cleanup timer for expired locks
    setInterval(() => {
      this.cleanupExpiredLocks();
    }, this.config.heartbeatInterval);

    this.log('Lock manager initialized');
  }

  /**
   * Destroy lock manager
   */
  destroy(): void {
    this.destroyed = true;

    // Release all held locks
    const myTabId = this.tabManager.getTabId();
    for (const lock of this.locks$.value.values()) {
      if (lock.holderId === myTabId) {
        this.release(lock.resource);
      }
    }

    // Cancel pending requests
    for (const request of this.pendingRequests.values()) {
      clearTimeout(request.timeout);
      request.resolve(false);
    }
    this.pendingRequests.clear();

    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }

    this.locks$.complete();
    this.events$.complete();
  }

  /**
   * Acquire a lock
   */
  async acquire(resource: string, timeout: number = this.config.lockExpiry): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const myTabId = this.tabManager.getTabId();
      const locks = this.locks$.value;

      // Check if already held
      const existingLock = locks.get(resource);
      if (existingLock) {
        if (existingLock.holderId === myTabId) {
          // Already own it, extend
          this.extendLock(resource);
          resolve(true);
          return;
        }

        // Check if expired
        if (Date.now() > existingLock.expiresAt) {
          // Expired, try to acquire
        } else {
          resolve(false);
          return;
        }
      }

      const now = Date.now();
      const expiresAt = now + timeout;
      const priority = Number.MAX_SAFE_INTEGER - now;

      // Store pending request
      const requestTimeout = setTimeout(() => {
        this.pendingRequests.delete(resource);
        resolve(false);
      }, this.config.heartbeatInterval * 3);

      this.pendingRequests.set(resource, {
        resource,
        resolve,
        timeout: requestTimeout,
      });

      // Broadcast acquisition request
      this.broadcast({
        type: 'request',
        resource,
        tabId: myTabId,
        priority,
        timestamp: now,
        expiresAt,
      });

      // If no BroadcastChannel, acquire immediately
      if (!this.channel) {
        clearTimeout(requestTimeout);
        this.pendingRequests.delete(resource);
        this.acquireLock(resource, expiresAt);
        resolve(true);
      }
    });
  }

  /**
   * Release a lock
   */
  release(resource: string): void {
    const myTabId = this.tabManager.getTabId();
    const locks = new Map<string, DistributedLock>(this.locks$.value);
    const lock = locks.get(resource);

    if (lock?.holderId !== myTabId) {
      return;
    }

    locks.delete(resource);
    this.locks$.next(locks);

    this.broadcast({
      type: 'released',
      resource,
      tabId: myTabId,
      priority: 0,
      timestamp: Date.now(),
    });

    this.emitEvent('lock-released', myTabId, { resource });
    this.log('Released lock', resource);
  }

  /**
   * Check if a lock is held
   */
  isLocked(resource: string): boolean {
    const lock = this.locks$.value.get(resource);
    if (!lock) return false;
    return Date.now() < lock.expiresAt;
  }

  /**
   * Check if this tab holds a lock
   */
  isHeldByMe(resource: string): boolean {
    const lock = this.locks$.value.get(resource);
    if (!lock) return false;
    return lock.holderId === this.tabManager.getTabId() && Date.now() < lock.expiresAt;
  }

  /**
   * Get lock info
   */
  getLock(resource: string): DistributedLock | undefined {
    return this.locks$.value.get(resource);
  }

  /**
   * Get all locks observable
   */
  get locks(): Observable<Map<string, DistributedLock>> {
    return this.locks$.asObservable();
  }

  /**
   * Get events observable
   */
  get events(): Observable<CrossTabEvent> {
    return this.events$.asObservable();
  }

  /**
   * Execute with lock
   */
  async withLock<T>(resource: string, fn: () => Promise<T>, timeout?: number): Promise<T | null> {
    const acquired = await this.acquire(resource, timeout);
    if (!acquired) {
      return null;
    }

    try {
      return await fn();
    } finally {
      this.release(resource);
    }
  }

  /**
   * Extend lock expiry
   */
  private extendLock(resource: string): void {
    const myTabId = this.tabManager.getTabId();
    const locks = new Map<string, DistributedLock>(this.locks$.value);
    const lock = locks.get(resource);

    if (lock?.holderId === myTabId) {
      const newExpiresAt = Date.now() + this.config.lockExpiry;
      locks.set(resource, {
        ...lock,
        expiresAt: newExpiresAt,
      });
      this.locks$.next(locks);

      this.broadcast({
        type: 'acquired',
        resource,
        tabId: myTabId,
        priority: 0,
        timestamp: Date.now(),
        expiresAt: newExpiresAt,
      });
    }
  }

  /**
   * Actually acquire the lock
   */
  private acquireLock(resource: string, expiresAt: number): void {
    const myTabId = this.tabManager.getTabId();
    const now = Date.now();
    const locks = new Map<string, DistributedLock>(this.locks$.value);

    locks.set(resource, {
      resource,
      holderId: myTabId,
      acquiredAt: now,
      expiresAt,
    });
    this.locks$.next(locks);

    this.broadcast({
      type: 'acquired',
      resource,
      tabId: myTabId,
      priority: 0,
      timestamp: now,
      expiresAt,
    });

    this.emitEvent('lock-acquired', myTabId, { resource });
    this.log('Acquired lock', resource);
  }

  /**
   * Handle incoming message
   */
  private handleMessage(event: MessageEvent<LockMessage>): void {
    const message = event.data;
    const myTabId = this.tabManager.getTabId();

    if (!message || message.tabId === myTabId) return;

    switch (message.type) {
      case 'request': {
        const lock = this.locks$.value.get(message.resource);

        // If we hold it or have a pending request with higher priority
        if (lock?.holderId === myTabId && Date.now() < lock.expiresAt) {
          // Reject - we hold the lock
          this.broadcast({
            type: 'rejected',
            resource: message.resource,
            tabId: myTabId,
            priority: 0,
            timestamp: Date.now(),
          });
          return;
        }

        const pendingRequest = this.pendingRequests.get(message.resource);
        if (pendingRequest) {
          // We also want this lock, compare priority
          const myPriority = Number.MAX_SAFE_INTEGER - Date.now();
          if (myPriority > message.priority) {
            // We have higher priority, reject
            this.broadcast({
              type: 'rejected',
              resource: message.resource,
              tabId: myTabId,
              priority: myPriority,
              timestamp: Date.now(),
            });
            return;
          }
        }
        break;
      }

      case 'acquired': {
        // Update lock state
        const locks = new Map<string, DistributedLock>(this.locks$.value);
        locks.set(message.resource, {
          resource: message.resource,
          holderId: message.tabId,
          acquiredAt: message.timestamp,
          expiresAt: message.expiresAt ?? message.timestamp + this.config.lockExpiry,
        });
        this.locks$.next(locks);

        // Cancel our pending request if any
        const pendingRequest = this.pendingRequests.get(message.resource);
        if (pendingRequest) {
          clearTimeout(pendingRequest.timeout);
          this.pendingRequests.delete(message.resource);
          pendingRequest.resolve(false);
        }
        break;
      }

      case 'released': {
        const locks = new Map<string, DistributedLock>(this.locks$.value);
        const lock = locks.get(message.resource);

        if (lock?.holderId === message.tabId) {
          locks.delete(message.resource);
          this.locks$.next(locks);
        }

        // Check if we have a pending request
        const pendingRequest = this.pendingRequests.get(message.resource);
        if (pendingRequest) {
          // Try to acquire
          clearTimeout(pendingRequest.timeout);
          const expiresAt = Date.now() + this.config.lockExpiry;
          this.acquireLock(message.resource, expiresAt);
          this.pendingRequests.delete(message.resource);
          pendingRequest.resolve(true);
        }
        break;
      }

      case 'rejected': {
        // Another tab has higher priority or holds the lock
        const pendingRequest = this.pendingRequests.get(message.resource);
        if (pendingRequest) {
          // Wait for potential acquisition
          // Don't cancel yet, wait for timeout or acquired message
        }
        break;
      }
    }
  }

  /**
   * Clean up expired locks
   */
  private cleanupExpiredLocks(): void {
    const now = Date.now();
    const locks = new Map<string, DistributedLock>(this.locks$.value);
    let changed = false;

    for (const [resource, lock] of locks) {
      if (now > lock.expiresAt) {
        locks.delete(resource);
        changed = true;
        this.log('Lock expired', resource);
      }
    }

    if (changed) {
      this.locks$.next(locks);
    }
  }

  /**
   * Broadcast a message
   */
  private broadcast(message: LockMessage): void {
    if (!this.channel || this.destroyed) return;

    try {
      this.channel.postMessage(message);
    } catch (error) {
      this.log('Failed to broadcast', error);
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
      console.log('[DistributedLock]', ...args);
    }
  }
}

/**
 * Create a distributed lock manager
 */
export function createDistributedLockManager(
  tabManager: TabManager,
  config?: CrossTabConfig
): DistributedLockManager {
  return new DistributedLockManager(tabManager, config);
}
