import type { ChangeEvent, Database, Document } from '@pocket/core';
import { BehaviorSubject, Subject, takeUntil, type Observable, type Subscription } from 'rxjs';
import { CheckpointManager } from './checkpoint.js';
import { ConflictResolver, detectConflict, type ConflictStrategy } from './conflict.js';
import { createLogger, noopLogger, type Logger, type LoggerOptions } from './logger.js';
import { OptimisticUpdateManager } from './optimistic.js';
import { createHttpTransport } from './transport/http.js';
import type {
  PullMessage,
  PullResponseMessage,
  PushMessage,
  PushResponseMessage,
  SyncTransport,
  TransportConfig,
} from './transport/types.js';
import { generateMessageId } from './transport/types.js';
import { createWebSocketTransport } from './transport/websocket.js';

/**
 * Sync status
 */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

/**
 * Sync statistics
 */
export interface SyncStats {
  pushCount: number;
  pullCount: number;
  conflictCount: number;
  lastSyncAt: number | null;
  lastError: Error | null;
}

/**
 * Sync configuration
 */
export interface SyncConfig {
  /** Server URL */
  serverUrl: string;
  /** Authentication token */
  authToken?: string;
  /** Collections to sync (empty = all) */
  collections?: string[];
  /** Sync direction */
  direction?: 'push' | 'pull' | 'both';
  /** Conflict resolution strategy */
  conflictStrategy?: ConflictStrategy;
  /** Auto retry on failure */
  autoRetry?: boolean;
  /** Retry delay in ms */
  retryDelay?: number;
  /** Max retry attempts */
  maxRetryAttempts?: number;
  /** Use WebSocket (true) or HTTP (false) */
  useWebSocket?: boolean;
  /** Poll interval for pull (ms, 0 to disable) */
  pullInterval?: number;
  /** Batch size for push/pull */
  batchSize?: number;
  /** Logger options for structured logging */
  logger?: LoggerOptions | Logger | false;
}

/**
 * Main sync engine
 */
export class SyncEngine {
  private readonly database: Database;
  private readonly config: Required<Omit<SyncConfig, 'logger'>>;
  private readonly transport: SyncTransport;
  private readonly checkpointManager: CheckpointManager;
  private readonly conflictResolver: ConflictResolver<Document>;
  private readonly optimisticManager: OptimisticUpdateManager;
  private readonly logger: Logger;

  private readonly status$ = new BehaviorSubject<SyncStatus>('idle');
  private readonly stats$ = new BehaviorSubject<SyncStats>({
    pushCount: 0,
    pullCount: 0,
    conflictCount: 0,
    lastSyncAt: null,
    lastError: null,
  });

  private readonly destroy$ = new Subject<void>();
  private changeSubscriptions = new Map<string, Subscription>();
  private pullIntervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(database: Database, config: SyncConfig) {
    this.database = database;
    this.config = {
      serverUrl: config.serverUrl,
      authToken: config.authToken ?? '',
      collections: config.collections ?? [],
      direction: config.direction ?? 'both',
      conflictStrategy: config.conflictStrategy ?? 'last-write-wins',
      autoRetry: config.autoRetry ?? true,
      retryDelay: config.retryDelay ?? 1000,
      maxRetryAttempts: config.maxRetryAttempts ?? 5,
      useWebSocket: config.useWebSocket ?? true,
      pullInterval: config.pullInterval ?? 30000,
      batchSize: config.batchSize ?? 100,
    };

    // Initialize logger
    if (config.logger === false) {
      this.logger = noopLogger;
    } else if (config.logger && 'debug' in config.logger && 'info' in config.logger) {
      // Custom logger provided
      this.logger = config.logger;
    } else {
      // Create logger from options
      this.logger = createLogger({
        ...config.logger!,
        context: 'SyncEngine',
      });
    }

    // Initialize transport
    const transportConfig: TransportConfig = {
      serverUrl: config.serverUrl,
      authToken: config.authToken,
      autoReconnect: config.autoRetry,
    };

    this.transport = this.config.useWebSocket
      ? createWebSocketTransport(transportConfig)
      : createHttpTransport(transportConfig);

    // Initialize managers
    this.checkpointManager = new CheckpointManager(database.nodeId);
    this.conflictResolver = new ConflictResolver(this.config.conflictStrategy);
    this.optimisticManager = new OptimisticUpdateManager();

    // Set up transport handlers
    this.setupTransportHandlers();

    this.logger.debug('SyncEngine initialized', {
      serverUrl: config.serverUrl,
      direction: this.config.direction,
      useWebSocket: this.config.useWebSocket,
    });
  }

  /**
   * Start syncing
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Start called but already running');
      return;
    }

    this.logger.info('Starting sync engine');

    try {
      // Connect to server
      await this.transport.connect();
      this.isRunning = true;
      this.status$.next('idle');
      this.logger.info('Connected to sync server');

      // Subscribe to collection changes for push
      if (this.config.direction !== 'pull') {
        await this.subscribeToChanges();
        this.logger.debug('Subscribed to collection changes');
      }

      // Start pull interval if configured
      if (this.config.direction !== 'push' && this.config.pullInterval > 0) {
        this.startPullInterval();
        this.logger.debug('Started pull interval', { interval: this.config.pullInterval });
      }

      // Initial sync
      await this.forceSync();
      this.logger.info('Sync engine started successfully');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to start sync engine', err);
      this.status$.next('error');
      this.updateStats({ lastError: err });
      throw error;
    }
  }

  /**
   * Stop syncing
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping sync engine');
    this.isRunning = false;

    // Stop pull interval
    if (this.pullIntervalId) {
      clearInterval(this.pullIntervalId);
      this.pullIntervalId = null;
      this.logger.debug('Stopped pull interval');
    }

    // Unsubscribe from changes
    for (const sub of this.changeSubscriptions.values()) {
      sub.unsubscribe();
    }
    this.changeSubscriptions.clear();
    this.logger.debug('Unsubscribed from collection changes');

    // Disconnect transport
    await this.transport.disconnect();
    this.status$.next('idle');
    this.logger.info('Sync engine stopped');
  }

  /**
   * Force immediate sync
   */
  async forceSync(): Promise<void> {
    if (this.status$.getValue() === 'syncing') {
      this.logger.debug('Force sync called but already syncing');
      return;
    }

    this.logger.info('Starting force sync');
    this.status$.next('syncing');

    try {
      // Push first, then pull
      if (this.config.direction !== 'pull') {
        await this.push();
      }

      if (this.config.direction !== 'push') {
        await this.pull();
      }

      const syncTime = Date.now();
      this.updateStats({ lastSyncAt: syncTime, lastError: null });
      this.status$.next('idle');
      this.logger.info('Force sync completed', {
        lastSyncAt: syncTime,
        pushCount: this.stats$.getValue().pushCount,
        pullCount: this.stats$.getValue().pullCount,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Force sync failed', err);
      this.status$.next('error');
      this.updateStats({ lastError: err });
      throw error;
    }
  }

  /**
   * Push local changes to server
   */
  async push(): Promise<void> {
    const collections = this.getCollectionsToSync();

    for (const collectionName of collections) {
      await this.pushCollection(collectionName);
    }
  }

  /**
   * Pull remote changes from server
   */
  async pull(): Promise<void> {
    const collections = this.getCollectionsToSync();

    const message: PullMessage = {
      type: 'pull',
      id: generateMessageId(),
      timestamp: Date.now(),
      collections,
      checkpoint: this.checkpointManager.getCheckpoint(),
      limit: this.config.batchSize,
    };

    const response = await this.transport.send<PullResponseMessage>(message);

    if (response.type === 'pull-response') {
      await this.applyPulledChanges(response);

      // Continue pulling if there's more
      if (response.hasMore) {
        await this.pull();
      }
    }
  }

  /**
   * Get sync status observable
   */
  getStatus(): Observable<SyncStatus> {
    return this.status$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get sync stats observable
   */
  getStats(): Observable<SyncStats> {
    return this.stats$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Destroy the sync engine
   */
  destroy(): void {
    void this.stop();
    this.destroy$.next();
    this.destroy$.complete();
    this.status$.complete();
    this.stats$.complete();
  }

  /**
   * Get collections to sync
   */
  private getCollectionsToSync(): string[] {
    if (this.config.collections.length > 0) {
      return this.config.collections;
    }
    // Sync all collections with pending changes
    const pending = this.optimisticManager.getAll();
    return [...new Set(pending.map((u) => u.collection))];
  }

  /**
   * Subscribe to collection changes
   */
  private async subscribeToChanges(): Promise<void> {
    const collections = await this.database.listCollections();

    for (const name of collections) {
      if (this.config.collections.length > 0 && !this.config.collections.includes(name)) {
        continue;
      }

      const collection = this.database.collection(name);
      const subscription = collection.changes().subscribe((event) => {
        if (!event.isFromSync) {
          void this.handleLocalChange(name, event);
        }
      });

      this.changeSubscriptions.set(name, subscription);
    }
  }

  /**
   * Handle a local change
   */
  private async handleLocalChange(
    collectionName: string,
    event: ChangeEvent<Document>
  ): Promise<void> {
    // Store as optimistic update
    const previousDoc = event.previousDocument ?? null;
    this.optimisticManager.add(collectionName, event, previousDoc);

    // Try to push immediately if connected
    if (this.transport.isConnected() && this.status$.getValue() !== 'syncing') {
      try {
        await this.pushCollection(collectionName);
      } catch (error) {
        // Will retry later
        this.logger.warn('Failed to push local change, will retry', {
          collection: collectionName,
          documentId: event.documentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Push changes for a single collection
   */
  private async pushCollection(collectionName: string): Promise<void> {
    const updates = this.optimisticManager.getPendingSync();
    const collectionUpdates = updates.filter((u) => u.collection === collectionName);

    if (collectionUpdates.length === 0) return;

    const changes = collectionUpdates.map((u) => u.change);

    const message: PushMessage = {
      type: 'push',
      id: generateMessageId(),
      timestamp: Date.now(),
      collection: collectionName,
      changes,
      checkpoint: this.checkpointManager.getCheckpoint(),
    };

    const response = await this.transport.send<PushResponseMessage>(message);

    if (response.type === 'push-response') {
      if (response.success) {
        // Mark all as synced
        for (const update of collectionUpdates) {
          this.optimisticManager.markSynced(update.id);
        }
        this.updateStats({ pushCount: this.stats$.getValue().pushCount + changes.length });
      } else if (response.conflicts) {
        // Handle conflicts
        await this.handleConflicts(collectionName, response.conflicts);
      }

      // Update checkpoint
      this.checkpointManager.updateFromServer(response.checkpoint);
    }
  }

  /**
   * Apply pulled changes
   */
  private async applyPulledChanges(response: PullResponseMessage): Promise<void> {
    let pullCount = 0;

    for (const [collectionName, changes] of Object.entries(response.changes)) {
      const collection = this.database.collection(collectionName);

      for (const change of changes) {
        // Check for conflicts with local changes
        const localUpdates = this.optimisticManager.getForDocument(
          collectionName,
          change.documentId
        );

        if (localUpdates.length > 0 && change.document) {
          const localDoc = await collection.get(change.documentId);
          if (localDoc && detectConflict(localDoc, change.document)) {
            // Resolve conflict
            const resolution = this.conflictResolver.resolve({
              documentId: change.documentId,
              localDocument: localDoc,
              remoteDocument: change.document,
              timestamp: Date.now(),
            });

            change.document = resolution.document;
            this.updateStats({
              conflictCount: this.stats$.getValue().conflictCount + 1,
            });
          }
        }

        // Apply the change
        await collection.applyRemoteChange(change);
        pullCount++;
      }

      // Update checkpoint for this collection
      const lastChange = changes[changes.length - 1];
      if (lastChange) {
        this.checkpointManager.updateSequence(collectionName, lastChange.sequence);
      }
    }

    this.updateStats({ pullCount: this.stats$.getValue().pullCount + pullCount });
    this.checkpointManager.updateFromServer(response.checkpoint);
  }

  /**
   * Handle conflicts from push response
   */
  private async handleConflicts(
    collectionName: string,
    conflicts: { documentId: string; serverDocument: Document }[]
  ): Promise<void> {
    const collection = this.database.collection(collectionName);

    for (const conflict of conflicts) {
      const localDoc = await collection.get(conflict.documentId);
      if (!localDoc) continue;

      const resolution = this.conflictResolver.resolve({
        documentId: conflict.documentId,
        localDocument: localDoc,
        remoteDocument: conflict.serverDocument,
        timestamp: Date.now(),
      });

      // Apply resolved document
      await collection.applyRemoteChange({
        operation: 'update',
        documentId: conflict.documentId,
        document: resolution.document,
        isFromSync: true,
        timestamp: Date.now(),
        sequence: 0,
      });

      // Clear pending updates for this document
      const updates = this.optimisticManager.getForDocument(collectionName, conflict.documentId);
      for (const update of updates) {
        this.optimisticManager.markSynced(update.id);
      }

      this.updateStats({
        conflictCount: this.stats$.getValue().conflictCount + 1,
      });
    }
  }

  /**
   * Start pull interval
   */
  private startPullInterval(): void {
    if (this.pullIntervalId) return;

    this.pullIntervalId = setInterval(() => {
      if (this.transport.isConnected() && this.status$.getValue() === 'idle') {
        this.pull().catch((error: unknown) => {
          // Will retry next interval
          this.logger.warn('Pull interval failed, will retry', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }, this.config.pullInterval);
  }

  /**
   * Set up transport event handlers
   */
  private setupTransportHandlers(): void {
    this.transport.onError((error) => {
      this.logger.error('Transport error', error);
      this.status$.next('error');
      this.updateStats({ lastError: error });
    });

    this.transport.onDisconnect(() => {
      this.logger.warn('Disconnected from sync server');
      this.status$.next('offline');
    });

    this.transport.onReconnect(() => {
      this.logger.info('Reconnected to sync server');
      this.status$.next('idle');
      // Sync on reconnect
      if (this.isRunning) {
        this.forceSync().catch((error: unknown) => {
          this.logger.warn('Sync on reconnect failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    });
  }

  /**
   * Update stats
   */
  private updateStats(partial: Partial<SyncStats>): void {
    this.stats$.next({
      ...this.stats$.getValue(),
      ...partial,
    });
  }
}

/**
 * Create a sync engine
 */
export function createSyncEngine(database: Database, config: SyncConfig): SyncEngine {
  return new SyncEngine(database, config);
}
