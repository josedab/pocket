import type { ChangeEvent, Collection, Database, Document } from '@pocket/core';
import { BehaviorSubject, type Observable, Subject, type Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import type { CheckpointManager } from '../checkpoint.js';
import type { Logger } from '../logger.js';
import { createRecentDocumentsFilter, SyncFilterEvaluator } from './filter-evaluator.js';
import type {
  CollectionSyncConfig,
  FilteredCheckpoint,
  SelectivePullRequest,
  SelectivePushRequest,
  SelectiveSyncConfig,
  SyncFilter,
  SyncPolicy,
  SyncScope,
  TimeSyncFilter,
} from './types.js';

/**
 * Selective sync state
 */
export interface SelectiveSyncState {
  /** Active policies */
  activePolicies: string[];
  /** Collections being synced */
  syncedCollections: string[];
  /** Current filter hash */
  filterHash: string;
  /** Documents pending sync per collection */
  pendingByCollection: Record<string, number>;
  /** Last selective sync timestamp */
  lastSyncAt: number | null;
}

/**
 * Selective sync options
 */
export interface SelectiveSyncOptions {
  /** Enable automatic re-evaluation when documents change */
  autoReEvaluate?: boolean;
  /** Debounce time for re-evaluation (ms) */
  reEvaluateDebounce?: number;
  /** Cache evaluation results */
  cacheResults?: boolean;
  /** Cache TTL (ms) */
  cacheTtl?: number;
}

/**
 * Manager for selective/partial sync
 */
export class SelectiveSyncManager {
  private readonly database: Database;
  private readonly checkpointManager: CheckpointManager;
  private readonly logger: Logger;
  private readonly evaluator: SyncFilterEvaluator;
  private readonly options: Required<SelectiveSyncOptions>;

  private readonly state$ = new BehaviorSubject<SelectiveSyncState>({
    activePolicies: [],
    syncedCollections: [],
    filterHash: '',
    pendingByCollection: {},
    lastSyncAt: null,
  });

  private readonly destroy$ = new Subject<void>();
  private collectionSubscriptions = new Map<string, Subscription>();
  private evaluationCache = new Map<string, { result: boolean; expiresAt: number }>();
  private pendingChanges = new Map<string, ChangeEvent<Document>[]>();

  constructor(
    database: Database,
    checkpointManager: CheckpointManager,
    config: SelectiveSyncConfig,
    logger: Logger,
    options: SelectiveSyncOptions = {}
  ) {
    this.database = database;
    this.checkpointManager = checkpointManager;
    this.logger = logger;
    this.evaluator = new SyncFilterEvaluator(config);

    this.options = {
      autoReEvaluate: options.autoReEvaluate ?? true,
      reEvaluateDebounce: options.reEvaluateDebounce ?? 1000,
      cacheResults: options.cacheResults ?? true,
      cacheTtl: options.cacheTtl ?? 60000, // 1 minute
    };

    this.updateState({
      filterHash: this.evaluator.getFilterHash(),
      syncedCollections: this.evaluator.getCollectionsToSync(),
    });
  }

  /**
   * Get current state as observable
   */
  getState(): Observable<SelectiveSyncState> {
    return this.state$.asObservable();
  }

  /**
   * Get current state snapshot
   */
  getStateSnapshot(): SelectiveSyncState {
    return this.state$.getValue();
  }

  /**
   * Update selective sync configuration
   */
  updateConfig(config: Partial<SelectiveSyncConfig>): void {
    this.evaluator.updateConfig(config);
    this.clearCache();
    this.updateState({
      filterHash: this.evaluator.getFilterHash(),
      syncedCollections: this.evaluator.getCollectionsToSync(),
    });
    this.logger.info('Selective sync config updated', {
      filterHash: this.evaluator.getFilterHash(),
    });
  }

  /**
   * Add a collection-specific configuration
   */
  addCollectionConfig<T extends Document>(
    collection: string,
    config: Omit<CollectionSyncConfig<T>, 'name'>
  ): void {
    const currentConfig = this.evaluator.getConfig();
    this.evaluator.updateConfig({
      collections: {
        ...currentConfig.collections,
        [collection]: { ...config, name: collection } as CollectionSyncConfig,
      },
    });
    this.clearCollectionCache(collection);
    this.logger.info('Collection config added', { collection });
  }

  /**
   * Add a sync policy
   */
  addPolicy(policy: SyncPolicy): void {
    this.evaluator.addPolicy(policy);
    this.clearCache();
    this.updateState({
      activePolicies: [...this.state$.getValue().activePolicies, policy.name],
      filterHash: this.evaluator.getFilterHash(),
    });
    this.logger.info('Sync policy added', { policy: policy.name });
  }

  /**
   * Remove a sync policy
   */
  removePolicy(policyName: string): void {
    this.evaluator.removePolicy(policyName);
    this.clearCache();
    this.updateState({
      activePolicies: this.state$.getValue().activePolicies.filter((p) => p !== policyName),
      filterHash: this.evaluator.getFilterHash(),
    });
    this.logger.info('Sync policy removed', { policy: policyName });
  }

  /**
   * Start monitoring collections for changes
   */
  startMonitoring(): void {
    const collections = this.evaluator.getCollectionsToSync();

    for (const collection of collections) {
      this.monitorCollection(collection);
    }

    this.logger.info('Started selective sync monitoring', {
      collections: collections.length,
    });
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    for (const subscription of this.collectionSubscriptions.values()) {
      subscription.unsubscribe();
    }
    this.collectionSubscriptions.clear();
    this.logger.info('Stopped selective sync monitoring');
  }

  /**
   * Monitor a single collection
   */
  private monitorCollection(collectionName: string): void {
    if (this.collectionSubscriptions.has(collectionName)) {
      return; // Already monitoring
    }

    const collection = this.getCollection(collectionName);
    if (!collection) return;

    const subscription = collection
      .changes()
      .pipe(takeUntil(this.destroy$))
      .subscribe((change) => {
        this.handleChange(collectionName, change);
      });

    this.collectionSubscriptions.set(collectionName, subscription);
  }

  /**
   * Handle a document change
   */
  private handleChange(collection: string, change: ChangeEvent<Document>): void {
    const doc = change.document ?? change.previousDocument;
    if (!doc) return;

    const result = this.evaluator.evaluate(doc, collection);

    if (result.shouldSync) {
      // Add to pending changes
      const pending = this.pendingChanges.get(collection) ?? [];
      pending.push({
        ...change,
        document: result.filteredDocument ?? change.document,
      } as ChangeEvent<Document>);
      this.pendingChanges.set(collection, pending);

      // Update state
      const pendingByCollection = { ...this.state$.getValue().pendingByCollection };
      pendingByCollection[collection] = pending.length;
      this.updateState({ pendingByCollection });

      this.logger.debug('Change queued for sync', {
        collection,
        documentId: doc._id,
        operation: change.operation,
      });
    } else {
      this.logger.debug('Change filtered out', {
        collection,
        documentId: doc._id,
        reason: result.reason,
      });
    }
  }

  /**
   * Get pending changes for push
   */
  getPendingChanges(collection?: string): Map<string, ChangeEvent<Document>[]> {
    if (collection) {
      const changes = this.pendingChanges.get(collection);
      return changes ? new Map([[collection, changes]]) : new Map();
    }
    return new Map(this.pendingChanges);
  }

  /**
   * Clear pending changes after successful sync
   */
  clearPendingChanges(collection?: string, documentIds?: string[]): void {
    if (collection) {
      if (documentIds) {
        const pending = this.pendingChanges.get(collection) ?? [];
        const remaining = pending.filter((c) => !documentIds.includes(c.document?._id ?? ''));
        if (remaining.length > 0) {
          this.pendingChanges.set(collection, remaining);
        } else {
          this.pendingChanges.delete(collection);
        }
      } else {
        this.pendingChanges.delete(collection);
      }
    } else {
      this.pendingChanges.clear();
    }

    // Update state
    const pendingByCollection: Record<string, number> = {};
    for (const [col, changes] of this.pendingChanges) {
      pendingByCollection[col] = changes.length;
    }
    this.updateState({ pendingByCollection });
  }

  /**
   * Build a selective pull request
   */
  buildPullRequest(scope?: SyncScope): SelectivePullRequest {
    const collections = scope?.collections ?? this.evaluator.getCollectionsToSync();
    const filters: Record<string, SyncFilter> = {};
    const timeFilters: Record<string, TimeSyncFilter> = {};
    const projections: Record<string, { include?: string[]; exclude?: string[] }> = {};

    for (const collection of collections) {
      const config = this.evaluator.getCollectionConfig(collection);

      if (config.filter) {
        filters[collection] = config.filter;
      }

      // Merge global and collection time filters
      const timeFilter = {
        ...this.evaluator.getConfig().globalTimeFilter,
        ...config.timeFilter,
        ...scope?.timeRange,
      };
      if (Object.keys(timeFilter).length > 0) {
        timeFilters[collection] = timeFilter;
      }

      // Field projections
      if (config.includeFields || config.excludeFields) {
        projections[collection] = {
          include: config.includeFields,
          exclude: config.excludeFields,
        };
      }
    }

    // Apply scope-level ID filters
    if (scope?.includeIds) {
      for (const [collection, ids] of Object.entries(scope.includeIds)) {
        filters[collection] = {
          ...filters[collection],
          _id: { $in: ids },
        };
      }
    }

    const checkpoint = this.getFilteredCheckpoint();

    return {
      collections,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      timeFilters: Object.keys(timeFilters).length > 0 ? timeFilters : undefined,
      projections: Object.keys(projections).length > 0 ? projections : undefined,
      checkpoint,
    };
  }

  /**
   * Build a selective push request for a collection
   */
  buildPushRequest(collection: string): SelectivePushRequest | null {
    const changes = this.pendingChanges.get(collection);
    if (!changes || changes.length === 0) {
      return null;
    }

    return {
      collection,
      changes,
      filterContext: {
        filterHash: this.evaluator.getFilterHash(),
        appliedFilters: this.getAppliedFilterNames(collection),
      },
      checkpoint: this.getFilteredCheckpoint(),
    };
  }

  /**
   * Get filtered checkpoint
   */
  private getFilteredCheckpoint(): FilteredCheckpoint {
    const baseCheckpoint = this.checkpointManager.getCheckpoint();

    return {
      checkpointId: baseCheckpoint.id,
      sequences: baseCheckpoint.sequences,
      filterHash: this.evaluator.getFilterHash(),
      timestamp: Date.now(),
      nodeId: baseCheckpoint.nodeId,
    };
  }

  /**
   * Get applied filter names for a collection
   */
  private getAppliedFilterNames(collection: string): string[] {
    const names: string[] = [];
    const config = this.evaluator.getCollectionConfig(collection);

    if (config.filter) {
      names.push('collection-filter');
    }
    if (config.timeFilter) {
      names.push('time-filter');
    }

    // Add policy names
    const state = this.state$.getValue();
    names.push(...state.activePolicies);

    return names;
  }

  /**
   * Evaluate a document for sync eligibility
   */
  shouldSyncDocument(document: Document, collection: string): boolean {
    // Check cache first
    if (this.options.cacheResults) {
      const cacheKey = `${collection}:${document._id}:${document._rev ?? ''}`;
      const cached = this.evaluationCache.get(cacheKey);

      if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
      }
    }

    const result = this.evaluator.evaluate(document, collection);

    // Cache result
    if (this.options.cacheResults) {
      const cacheKey = `${collection}:${document._id}:${document._rev ?? ''}`;
      this.evaluationCache.set(cacheKey, {
        result: result.shouldSync,
        expiresAt: Date.now() + this.options.cacheTtl,
      });
    }

    return result.shouldSync;
  }

  /**
   * Filter documents for sync
   */
  filterDocumentsForSync(
    documents: Document[],
    collection: string
  ): { toSync: Document[]; excluded: Document[] } {
    const { filtered, excluded } = this.evaluator.filterBatch(documents, collection);
    return { toSync: filtered, excluded };
  }

  /**
   * Create a sync scope for recent documents
   */
  createRecentDocumentsScope(collections: string[], durationMs: number): SyncScope {
    return {
      collections,
      timeRange: createRecentDocumentsFilter(durationMs),
    };
  }

  /**
   * Create a sync scope for specific document IDs
   */
  createIdBasedScope(documentIds: Record<string, string[]>): SyncScope {
    return {
      collections: Object.keys(documentIds),
      includeIds: documentIds,
    };
  }

  /**
   * Get sync statistics
   */
  getSyncStats(): {
    totalPending: number;
    pendingByCollection: Record<string, number>;
    filteredCount: number;
    cacheSize: number;
    cacheHitRate: number;
  } {
    let totalPending = 0;
    const pendingByCollection: Record<string, number> = {};

    for (const [collection, changes] of this.pendingChanges) {
      pendingByCollection[collection] = changes.length;
      totalPending += changes.length;
    }

    return {
      totalPending,
      pendingByCollection,
      filteredCount: 0, // Would need tracking
      cacheSize: this.evaluationCache.size,
      cacheHitRate: 0, // Would need tracking
    };
  }

  /**
   * Clear evaluation cache
   */
  clearCache(): void {
    this.evaluationCache.clear();
  }

  /**
   * Clear cache for a specific collection
   */
  private clearCollectionCache(collection: string): void {
    for (const key of this.evaluationCache.keys()) {
      if (key.startsWith(`${collection}:`)) {
        this.evaluationCache.delete(key);
      }
    }
  }

  /**
   * Update internal state
   */
  private updateState(partial: Partial<SelectiveSyncState>): void {
    this.state$.next({
      ...this.state$.getValue(),
      ...partial,
    });
  }

  /**
   * Get a collection
   */
  private getCollection(collectionName: string): Collection | null {
    try {
      return this.database.collection(collectionName);
    } catch {
      this.logger.warn('Failed to get collection', { collection: collectionName });
      return null;
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopMonitoring();
    this.clearCache();
    this.pendingChanges.clear();
  }
}

/**
 * Create a selective sync manager
 */
export function createSelectiveSyncManager(
  database: Database,
  checkpointManager: CheckpointManager,
  config: SelectiveSyncConfig,
  logger: Logger,
  options?: SelectiveSyncOptions
): SelectiveSyncManager {
  return new SelectiveSyncManager(database, checkpointManager, config, logger, options);
}
