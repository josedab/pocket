/**
 * CloudSync - One-line cloud sync integration for Pocket.
 *
 * Wraps the SyncEngine with cloud-specific configuration, automatic
 * endpoint discovery, API key authentication, and usage monitoring.
 *
 * @module cloud-sync
 */

import { ConnectionError, type Database } from '@pocket/core';
import { SyncEngine, type SyncConfig, type SyncStats, type SyncStatus } from '@pocket/sync';
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
  Subject,
  takeUntil,
  type Observable,
} from 'rxjs';
import { CloudClient } from './cloud-client.js';
import type {
  CloudConfig,
  CloudEndpoint,
  CloudStatus,
  CloudSyncOptions,
  UsageMetrics,
} from './types.js';
import { TIER_LIMITS } from './types.js';

/**
 * Combined status for cloud sync, including both sync engine and cloud service status.
 *
 * @see {@link CloudSync.getCombinedStatus}
 */
export interface CloudSyncStatus {
  /** Current sync engine status */
  syncStatus: SyncStatus;
  /** Current cloud service status */
  cloudStatus: CloudStatus;
  /** Current sync statistics */
  stats: SyncStats;
  /** Current usage metrics */
  usage: UsageMetrics;
}

/**
 * Managed cloud sync for Pocket databases.
 *
 * CloudSync wraps the SyncEngine with cloud-specific features:
 * - Automatic endpoint discovery from Pocket Cloud
 * - API key authentication
 * - Usage and quota monitoring
 * - Simple start/stop interface
 *
 * @example One-line cloud sync
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createCloudSync } from '@pocket/cloud';
 *
 * const db = await Database.create({ name: 'my-app', storage });
 *
 * const cloudSync = await createCloudSync({
 *   projectId: 'proj_abc123',
 *   apiKey: 'pk_test_YOUR_API_KEY',
 *   collections: ['todos', 'notes']
 * });
 *
 * // Connect to database and start syncing
 * await cloudSync.connect(db);
 * await cloudSync.start();
 *
 * // Monitor status
 * cloudSync.getCombinedStatus().subscribe(status => {
 *   console.log('Sync:', status.syncStatus, 'Cloud:', status.cloudStatus);
 * });
 *
 * // Stop syncing
 * await cloudSync.stop();
 * ```
 *
 * @example With full options
 * ```typescript
 * const cloudSync = await createCloudSync({
 *   projectId: 'proj_abc123',
 *   apiKey: 'pk_test_YOUR_API_KEY',
 *   region: 'eu-west-1',
 *   collections: ['todos'],
 *   conflictStrategy: 'last-write-wins',
 *   useWebSocket: true,
 *   monitorQuota: true
 * });
 * ```
 *
 * @see {@link createCloudSync}
 * @see {@link CloudConfig}
 * @see {@link CloudSyncOptions}
 */
export class CloudSync {
  private readonly options: CloudSyncOptions;
  private readonly client: CloudClient;
  private readonly destroy$ = new Subject<void>();
  private readonly cloudStatus$ = new BehaviorSubject<CloudStatus>('disconnected');
  private readonly usage$ = new BehaviorSubject<UsageMetrics>({
    sessionOperations: 0,
    sessionBytesTransferred: 0,
    quotaWarning: false,
    quotaExceeded: false,
    remainingOperations: null,
  });

  private syncEngine: SyncEngine | null = null;
  private endpoint: CloudEndpoint | null = null;
  private database: Database | null = null;
  private quotaCheckInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(options: CloudSyncOptions, client: CloudClient) {
    this.options = options;
    this.client = client;
  }

  /**
   * Initialize the cloud sync by discovering endpoints and validating credentials.
   *
   * This is called automatically by {@link createCloudSync}.
   *
   * @throws {ConnectionError} If API key validation or endpoint discovery fails
   *
   * @example
   * ```typescript
   * const cloudSync = new CloudSync(options, client);
   * await cloudSync.initialize();
   * ```
   */
  async initialize(): Promise<void> {
    this.cloudStatus$.next('connecting');

    try {
      // Validate API key
      const validation = await this.client.validateApiKey();
      if (!validation.valid) {
        throw new ConnectionError(
          'POCKET_C502',
          `Invalid API key: ${validation.error ?? 'Unknown error'}`,
          { projectId: this.options.projectId }
        );
      }

      // Discover endpoint
      this.endpoint = await this.client.getEndpoint();
      this.cloudStatus$.next('connected');
    } catch (error) {
      this.cloudStatus$.next('error');
      throw error;
    }
  }

  /**
   * Connect the cloud sync to a database.
   *
   * Creates the underlying SyncEngine with cloud-configured settings.
   * Must be called before {@link start}.
   *
   * @param database - The Pocket database to sync
   * @throws {ConnectionError} If endpoint has not been discovered yet
   *
   * @example
   * ```typescript
   * const db = await Database.create({ name: 'my-app', storage });
   * await cloudSync.connect(db);
   * ```
   */
  connect(database: Database): void {
    if (!this.endpoint) {
      throw new ConnectionError(
        'POCKET_C501',
        'Cloud sync not initialized. Call initialize() first or use createCloudSync().',
        { projectId: this.options.projectId }
      );
    }

    this.database = database;

    // Build SyncConfig from cloud options + discovered endpoint
    const syncConfig: SyncConfig = {
      serverUrl: this.options.useWebSocket === false
        ? this.endpoint.httpUrl
        : this.endpoint.websocketUrl,
      authToken: this.options.apiKey,
      collections: this.options.collections,
      direction: this.options.direction ?? 'both',
      conflictStrategy: this.options.conflictStrategy ?? 'last-write-wins',
      useWebSocket: this.options.useWebSocket ?? true,
      pullInterval: this.options.pullInterval ?? 30000,
      batchSize: this.options.batchSize ?? 100,
      autoRetry: this.options.autoRetry ?? true,
      maxRetryAttempts: this.options.maxRetryAttempts ?? 5,
      logger: false,
    };

    this.syncEngine = new SyncEngine(database, syncConfig);
  }

  /**
   * Start syncing with the cloud service.
   *
   * Starts the underlying SyncEngine and begins quota monitoring
   * if enabled.
   *
   * @throws {ConnectionError} If not connected to a database
   *
   * @example
   * ```typescript
   * await cloudSync.start();
   * console.log('Cloud sync started');
   * ```
   */
  async start(): Promise<void> {
    if (!this.syncEngine) {
      throw new ConnectionError(
        'POCKET_C501',
        'Cloud sync not connected to a database. Call connect() first.',
        { projectId: this.options.projectId }
      );
    }

    if (this.isRunning) {
      return;
    }

    // Start the sync engine
    await this.syncEngine.start();
    this.isRunning = true;
    this.cloudStatus$.next('connected');

    // Start usage monitoring
    this.startUsageTracking();

    // Start quota monitoring if enabled
    if (this.options.monitorQuota !== false) {
      this.startQuotaMonitoring();
    }
  }

  /**
   * Stop syncing with the cloud service.
   *
   * Stops the sync engine and all quota monitoring.
   *
   * @example
   * ```typescript
   * await cloudSync.stop();
   * console.log('Cloud sync stopped');
   * ```
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    // Stop quota monitoring
    if (this.quotaCheckInterval) {
      clearInterval(this.quotaCheckInterval);
      this.quotaCheckInterval = null;
    }

    // Stop the sync engine
    if (this.syncEngine) {
      await this.syncEngine.stop();
    }

    this.cloudStatus$.next('disconnected');
  }

  /**
   * Force an immediate sync with the cloud.
   *
   * @throws {ConnectionError} If sync engine is not running
   *
   * @example
   * ```typescript
   * await cloudSync.forceSync();
   * console.log('Forced sync complete');
   * ```
   */
  async forceSync(): Promise<void> {
    if (!this.syncEngine) {
      throw new ConnectionError(
        'POCKET_C501',
        'Cloud sync not connected. Call connect() and start() first.',
        { projectId: this.options.projectId }
      );
    }

    await this.syncEngine.forceSync();

    // Increment session operations
    const currentUsage = this.usage$.getValue();
    this.usage$.next({
      ...currentUsage,
      sessionOperations: currentUsage.sessionOperations + 1,
    });
  }

  /**
   * Get an observable of the sync engine status.
   *
   * @returns Observable of sync status
   *
   * @example
   * ```typescript
   * cloudSync.getSyncStatus().subscribe(status => {
   *   console.log('Sync status:', status);
   * });
   * ```
   */
  getSyncStatus(): Observable<SyncStatus> {
    if (!this.syncEngine) {
      return new BehaviorSubject<SyncStatus>('offline').asObservable();
    }
    return this.syncEngine.getStatus().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get an observable of the cloud service status.
   *
   * @returns Observable of cloud status
   *
   * @example
   * ```typescript
   * cloudSync.getCloudStatus().subscribe(status => {
   *   if (status === 'quota-exceeded') {
   *     console.warn('Cloud quota exceeded!');
   *   }
   * });
   * ```
   */
  getCloudStatus(): Observable<CloudStatus> {
    return this.cloudStatus$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get an observable of sync statistics.
   *
   * @returns Observable of sync stats
   *
   * @example
   * ```typescript
   * cloudSync.getSyncStats().subscribe(stats => {
   *   console.log(`Pushed: ${stats.pushCount}, Pulled: ${stats.pullCount}`);
   * });
   * ```
   */
  getSyncStats(): Observable<SyncStats> {
    if (!this.syncEngine) {
      return new BehaviorSubject<SyncStats>({
        pushCount: 0,
        pullCount: 0,
        conflictCount: 0,
        lastSyncAt: null,
        lastError: null,
      }).asObservable();
    }
    return this.syncEngine.getStats().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get an observable of usage metrics.
   *
   * @returns Observable of usage metrics
   *
   * @example
   * ```typescript
   * cloudSync.getUsageMetrics().subscribe(usage => {
   *   if (usage.quotaWarning) {
   *     console.warn('Approaching quota limit');
   *   }
   *   console.log('Session operations:', usage.sessionOperations);
   * });
   * ```
   */
  getUsageMetrics(): Observable<UsageMetrics> {
    return this.usage$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get a combined observable of all cloud sync status information.
   *
   * Combines sync status, cloud status, stats, and usage metrics
   * into a single observable for easy consumption.
   *
   * @returns Observable of combined cloud sync status
   *
   * @example
   * ```typescript
   * cloudSync.getCombinedStatus().subscribe(({ syncStatus, cloudStatus, stats, usage }) => {
   *   console.log(`Sync: ${syncStatus}, Cloud: ${cloudStatus}`);
   *   console.log(`Operations: ${stats.pushCount + stats.pullCount}`);
   *   console.log(`Quota warning: ${usage.quotaWarning}`);
   * });
   * ```
   */
  getCombinedStatus(): Observable<CloudSyncStatus> {
    return combineLatest([
      this.getSyncStatus(),
      this.getCloudStatus().pipe(distinctUntilChanged()),
      this.getSyncStats(),
      this.getUsageMetrics(),
    ]).pipe(
      map(([syncStatus, cloudStatus, stats, usage]) => ({
        syncStatus,
        cloudStatus,
        stats,
        usage,
      })),
      takeUntil(this.destroy$)
    );
  }

  /**
   * Get the discovered cloud endpoint.
   *
   * @returns The cloud endpoint or null if not yet discovered
   */
  getEndpoint(): CloudEndpoint | null {
    return this.endpoint;
  }

  /**
   * Get the underlying CloudClient instance.
   *
   * @returns The CloudClient
   */
  getClient(): CloudClient {
    return this.client;
  }

  /**
   * Get the underlying SyncEngine instance.
   *
   * @returns The SyncEngine or null if not connected
   */
  getSyncEngine(): SyncEngine | null {
    return this.syncEngine;
  }

  /**
   * Get the database that cloud sync is connected to.
   *
   * @returns The Database instance or null if not connected
   */
  getDatabase(): Database | null {
    return this.database;
  }

  /**
   * Whether the cloud sync is currently running.
   *
   * @returns True if started and syncing
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Permanently destroy the cloud sync and release all resources.
   *
   * After calling destroy(), the cloud sync cannot be restarted.
   *
   * @example
   * ```typescript
   * cloudSync.destroy();
   * ```
   */
  destroy(): void {
    void this.stop();

    if (this.syncEngine) {
      this.syncEngine.destroy();
      this.syncEngine = null;
    }

    this.client.destroy();
    this.destroy$.next();
    this.destroy$.complete();
    this.cloudStatus$.complete();
    this.usage$.complete();
    this.database = null;
    this.endpoint = null;
  }

  /**
   * Start tracking usage from sync stats.
   */
  private startUsageTracking(): void {
    if (!this.syncEngine) return;

    this.syncEngine
      .getStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe((stats) => {
        const currentUsage = this.usage$.getValue();
        const totalOps = stats.pushCount + stats.pullCount;

        this.usage$.next({
          ...currentUsage,
          sessionOperations: totalOps,
        });
      });
  }

  /**
   * Start periodic quota monitoring.
   */
  private startQuotaMonitoring(): void {
    // Check quota every 5 minutes
    const QUOTA_CHECK_INTERVAL = 5 * 60 * 1000;

    const checkQuota = async (): Promise<void> => {
      try {
        const stats = await this.client.getUsageStats();
        const tier = this.options.tier ?? 'free';
        const limits = TIER_LIMITS[tier];

        const remaining = limits.maxOperations === Infinity
          ? null
          : limits.maxOperations - stats.syncOperations;

        const quotaWarning = stats.syncQuotaUsedPercent >= 80;
        const quotaExceeded = stats.syncQuotaUsedPercent >= 100;

        const currentUsage = this.usage$.getValue();
        this.usage$.next({
          ...currentUsage,
          quotaWarning,
          quotaExceeded,
          remainingOperations: remaining,
        });

        if (quotaExceeded) {
          this.cloudStatus$.next('quota-exceeded');
        }
      } catch {
        // Silently ignore quota check failures
        // The sync will continue to work; we just lose quota visibility
      }
    };

    // Initial check
    void checkQuota();

    // Periodic checks
    this.quotaCheckInterval = setInterval(() => {
      void checkQuota();
    }, QUOTA_CHECK_INTERVAL);
  }
}

/**
 * Create a cloud-connected sync instance with one line of code.
 *
 * This factory function initializes the CloudClient, validates the
 * API key, discovers the best endpoint, and returns a ready-to-use
 * CloudSync instance.
 *
 * @param options - Cloud sync options including project ID and API key
 * @returns A CloudSync instance ready for connection to a database
 *
 * @example Minimal setup
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createCloudSync } from '@pocket/cloud';
 *
 * const db = await Database.create({ name: 'my-app', storage });
 *
 * const cloudSync = await createCloudSync({
 *   projectId: 'proj_abc123',
 *   apiKey: 'pk_test_YOUR_API_KEY'
 * });
 *
 * cloudSync.connect(db);
 * await cloudSync.start();
 * ```
 *
 * @example With sync options
 * ```typescript
 * const cloudSync = await createCloudSync({
 *   projectId: 'proj_abc123',
 *   apiKey: 'pk_test_YOUR_API_KEY',
 *   region: 'eu-west-1',
 *   collections: ['todos', 'notes'],
 *   conflictStrategy: 'server-wins',
 *   useWebSocket: true,
 *   monitorQuota: true
 * });
 *
 * cloudSync.connect(db);
 * await cloudSync.start();
 *
 * // Monitor combined status
 * cloudSync.getCombinedStatus().subscribe(status => {
 *   console.log('Status:', status);
 * });
 * ```
 *
 * @see {@link CloudSync}
 * @see {@link CloudSyncOptions}
 */
export async function createCloudSync(options: CloudSyncOptions): Promise<CloudSync> {
  const cloudConfig: CloudConfig = {
    projectId: options.projectId,
    apiKey: options.apiKey,
    region: options.region,
    endpoint: options.endpoint,
    tier: options.tier,
  };

  const client = new CloudClient(cloudConfig);
  const cloudSync = new CloudSync(options, client);

  await cloudSync.initialize();

  return cloudSync;
}
