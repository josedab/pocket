/**
 * SharedWorkerHost — Database engine that runs inside a SharedWorker.
 *
 * This is the server-side counterpart to WorkerDBProxy. It maintains
 * a single database instance shared across all connected tabs, handling
 * query execution, change notification broadcasting, and tab lifecycle.
 *
 * @example
 * ```typescript
 * // In shared-worker.ts (runs inside SharedWorker context)
 * import { SharedWorkerHost } from '@pocket/shared-worker';
 *
 * const host = new SharedWorkerHost({
 *   databaseFactory: async (name) => {
 *     const { createDatabase } = await import('@pocket/core');
 *     const { createMemoryStorage } = await import('@pocket/storage-memory');
 *     return createDatabase({ name, storage: createMemoryStorage() });
 *   },
 * });
 *
 * // Handle new tab connections
 * self.onconnect = (event) => {
 *   const port = event.ports[0];
 *   host.addConnection(port);
 * };
 * ```
 */

import type { WorkerMessage, WorkerResponse } from './worker-db-proxy.js';

// ── Types ─────────────────────────────────────────────────

export interface SharedWorkerHostConfig {
  /** Factory to create database instances on demand */
  databaseFactory: (name: string) => Promise<HostedDatabase>;
  /** Max concurrent queries across all tabs (default: 50) */
  maxConcurrentQueries?: number;
  /** Heartbeat interval in ms for tab liveness detection (default: 5000) */
  heartbeatIntervalMs?: number;
  /** Tab timeout — consider disconnected after this many ms (default: 15000) */
  tabTimeoutMs?: number;
}

/** Minimal database interface the host coordinates */
export interface HostedDatabase {
  name: string;
  close(): Promise<void>;
  /** Get a collection by name for CRUD operations */
  collection<T extends Record<string, unknown>>(name: string): HostedCollection<T>;
}

/** Minimal collection interface for SharedWorker CRUD dispatch */
export interface HostedCollection<T extends Record<string, unknown> = Record<string, unknown>> {
  find(filter?: Record<string, unknown>): { exec(): Promise<T[]> };
  get?(id: string): Promise<T | null>;
  insert?(doc: Partial<T>): Promise<T>;
  update?(id: string, changes: Partial<T>): Promise<T | null>;
  delete?(id: string): Promise<boolean>;
  count?(): Promise<number>;
}

export interface TabConnection {
  tabId: string;
  port: MessagePortLike;
  lastHeartbeat: number;
  connectedAt: number;
  queryCount: number;
}

export interface SharedWorkerHostStats {
  connectedTabs: number;
  totalQueries: number;
  activeQueries: number;
  databases: string[];
  uptime: number;
}

/** Minimal MessagePort interface for testability */
export interface MessagePortLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close?(): void;
}

// ── SharedWorkerHost ──────────────────────────────────────

export class SharedWorkerHost {
  private readonly config: Required<SharedWorkerHostConfig>;
  private readonly tabs = new Map<string, TabConnection>();
  private readonly databases = new Map<string, HostedDatabase>();
  private readonly queryQueue = new Map<string, Promise<unknown>>();

  private totalQueries = 0;
  private activeQueries = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();
  private destroyed = false;

  constructor(config: SharedWorkerHostConfig) {
    this.config = {
      databaseFactory: config.databaseFactory,
      maxConcurrentQueries: config.maxConcurrentQueries ?? 50,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 5000,
      tabTimeoutMs: config.tabTimeoutMs ?? 15000,
    };

    this.startHeartbeatCheck();
  }

  /**
   * Register a new tab connection.
   * Called from SharedWorker's `onconnect` event.
   */
  addConnection(port: MessagePortLike): void {
    if (this.destroyed) return;

    const tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const connection: TabConnection = {
      tabId,
      port,
      lastHeartbeat: Date.now(),
      connectedAt: Date.now(),
      queryCount: 0,
    };

    this.tabs.set(tabId, connection);

    port.onmessage = (event: { data: unknown }) => {
      const message = event.data as WorkerMessage;
      this.handleMessage(connection, message);
    };

    // Send welcome message with assigned tabId
    this.sendResponse(port, {
      id: 'welcome',
      success: true,
      data: { tabId, connectedTabs: this.tabs.size },
      timestamp: Date.now(),
    });
  }

  /**
   * Remove a tab connection.
   */
  removeConnection(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.port.close?.();
      this.tabs.delete(tabId);
      this.broadcastToAll(
        {
          id: `system_${Date.now()}`,
          type: 'disconnect',
          payload: { tabId, connectedTabs: this.tabs.size },
          tabId: 'host',
          timestamp: Date.now(),
        },
        tabId
      );
    }
  }

  /**
   * Get current host statistics.
   */
  getStats(): SharedWorkerHostStats {
    return {
      connectedTabs: this.tabs.size,
      totalQueries: this.totalQueries,
      activeQueries: this.activeQueries,
      databases: [...this.databases.keys()],
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Destroy the host and close all connections.
   */
  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    for (const tab of this.tabs.values()) {
      tab.port.close?.();
    }
    this.tabs.clear();

    for (const db of this.databases.values()) {
      await db.close();
    }
    this.databases.clear();
    this.queryQueue.clear();
  }

  // ── Message Handling ────────────────────────────────────

  private handleMessage(connection: TabConnection, message: WorkerMessage): void {
    connection.lastHeartbeat = Date.now();

    switch (message.type) {
      case 'ping':
        this.sendResponse(connection.port, {
          id: message.id,
          success: true,
          data: 'pong',
          timestamp: Date.now(),
        });
        break;

      case 'connect':
        void this.handleConnect(connection, message);
        break;

      case 'query':
        void this.handleQuery(connection, message);
        break;

      case 'insert':
      case 'update':
      case 'delete':
        void this.handleMutation(connection, message);
        break;

      case 'subscribe':
        this.handleSubscribe(connection, message);
        break;

      case 'unsubscribe':
        this.handleUnsubscribe(connection, message);
        break;

      case 'stats':
        this.sendResponse(connection.port, {
          id: message.id,
          success: true,
          data: this.getStats(),
          timestamp: Date.now(),
        });
        break;

      case 'disconnect':
        this.removeConnection(connection.tabId);
        break;

      default:
        this.sendResponse(connection.port, {
          id: message.id,
          success: false,
          error: `Unknown message type: ${message.type}`,
          timestamp: Date.now(),
        });
    }
  }

  private async handleConnect(connection: TabConnection, message: WorkerMessage): Promise<void> {
    const { databaseName } = message.payload as { databaseName: string };

    try {
      if (!this.databases.has(databaseName)) {
        const db = await this.config.databaseFactory(databaseName);
        this.databases.set(databaseName, db);
      }

      this.sendResponse(connection.port, {
        id: message.id,
        success: true,
        data: { databaseName, connectedTabs: this.tabs.size },
        timestamp: Date.now(),
      });
    } catch (error) {
      this.sendResponse(connection.port, {
        id: message.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
    }
  }

  private async handleQuery(connection: TabConnection, message: WorkerMessage): Promise<void> {
    if (this.activeQueries >= this.config.maxConcurrentQueries) {
      this.sendResponse(connection.port, {
        id: message.id,
        success: false,
        error: 'Query limit exceeded. Too many concurrent queries.',
        timestamp: Date.now(),
      });
      return;
    }

    this.totalQueries++;
    this.activeQueries++;
    connection.queryCount++;

    // Query deduplication: if same query is in-flight, share the result
    const queryKey = JSON.stringify(message.payload);
    const inflight = this.queryQueue.get(queryKey);

    if (inflight) {
      try {
        const data = await inflight;
        this.sendResponse(connection.port, {
          id: message.id,
          success: true,
          data,
          timestamp: Date.now(),
        });
      } catch (error) {
        this.sendResponse(connection.port, {
          id: message.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        });
      } finally {
        this.activeQueries--;
      }
      return;
    }

    const queryPromise = this.executeQuery(message.payload);
    this.queryQueue.set(queryKey, queryPromise);

    try {
      const data = await queryPromise;
      this.sendResponse(connection.port, {
        id: message.id,
        success: true,
        data,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.sendResponse(connection.port, {
        id: message.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
    } finally {
      this.activeQueries--;
      this.queryQueue.delete(queryKey);
    }
  }

  private async handleMutation(connection: TabConnection, message: WorkerMessage): Promise<void> {
    try {
      // Execute mutation (placeholder — real impl delegates to database)
      const data = await this.executeMutation(message.type, message.payload);

      this.sendResponse(connection.port, {
        id: message.id,
        success: true,
        data,
        timestamp: Date.now(),
      });

      // Broadcast change to all other tabs
      this.broadcastToAll(
        {
          id: `change_${Date.now()}`,
          type: 'change-notification',
          payload: {
            operation: message.type,
            ...((message.payload as Record<string, unknown>) ?? {}),
            sourceTabId: connection.tabId,
          },
          tabId: 'host',
          timestamp: Date.now(),
        },
        connection.tabId
      );
    } catch (error) {
      this.sendResponse(connection.port, {
        id: message.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
    }
  }

  private handleSubscribe(connection: TabConnection, message: WorkerMessage): void {
    // Acknowledge subscription — real impl would track subscriptions
    this.sendResponse(connection.port, {
      id: message.id,
      success: true,
      data: { subscribed: true },
      timestamp: Date.now(),
    });
  }

  private handleUnsubscribe(connection: TabConnection, message: WorkerMessage): void {
    this.sendResponse(connection.port, {
      id: message.id,
      success: true,
      data: { unsubscribed: true },
      timestamp: Date.now(),
    });
  }

  // ── Query Execution ─────────────────────────────────────

  private async executeQuery(payload: unknown): Promise<unknown> {
    const { databaseName, collection, filter } = payload as {
      databaseName?: string;
      collection?: string;
      filter?: Record<string, unknown>;
    };

    if (!collection) {
      return { results: [], executedAt: Date.now() };
    }

    const dbName = databaseName ?? this.databases.keys().next().value;
    const db = dbName ? this.databases.get(dbName) : undefined;

    if (!db) {
      return { results: [], executedAt: Date.now() };
    }

    const col = db.collection(collection);
    const results = await col.find(filter).exec();
    return { results, executedAt: Date.now(), count: results.length };
  }

  private async executeMutation(type: string, payload: unknown): Promise<unknown> {
    const { databaseName, collection, documentId, document } = payload as {
      databaseName?: string;
      collection?: string;
      documentId?: string;
      document?: Record<string, unknown>;
    };

    if (!collection) {
      throw new Error('Collection name is required for mutations');
    }

    const dbName = databaseName ?? this.databases.keys().next().value;
    const db = dbName ? this.databases.get(dbName) : undefined;

    if (!db) {
      throw new Error(`Database "${databaseName ?? 'default'}" not found`);
    }

    const col = db.collection(collection);

    switch (type) {
      case 'insert': {
        if (!document) throw new Error('Document is required for insert');
        if (col.insert) {
          const result = await col.insert(document);
          return { document: result, timestamp: Date.now() };
        }
        return { mutated: true, timestamp: Date.now() };
      }

      case 'update': {
        if (!documentId) throw new Error('documentId is required for update');
        if (col.update && document) {
          const result = await col.update(documentId, document);
          return { document: result, timestamp: Date.now() };
        }
        return { mutated: true, timestamp: Date.now() };
      }

      case 'delete': {
        if (!documentId) throw new Error('documentId is required for delete');
        if (col.delete) {
          const deleted = await col.delete(documentId);
          return { deleted, timestamp: Date.now() };
        }
        return { mutated: true, timestamp: Date.now() };
      }

      default:
        throw new Error(`Unknown mutation type: ${type}`);
    }
  }

  // ── Communication ───────────────────────────────────────

  private sendResponse(port: MessagePortLike, response: WorkerResponse): void {
    port.postMessage(response);
  }

  private broadcastToAll(message: WorkerMessage, excludeTabId?: string): void {
    for (const [tabId, tab] of this.tabs) {
      if (tabId !== excludeTabId) {
        tab.port.postMessage(message);
      }
    }
  }

  // ── Lifecycle ───────────────────────────────────────────

  private startHeartbeatCheck(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [tabId, tab] of this.tabs) {
        if (now - tab.lastHeartbeat > this.config.tabTimeoutMs) {
          this.removeConnection(tabId);
        }
      }
    }, this.config.heartbeatIntervalMs);
  }
}

/**
 * Create a SharedWorkerHost instance.
 */
export function createSharedWorkerHost(config: SharedWorkerHostConfig): SharedWorkerHost {
  return new SharedWorkerHost(config);
}
