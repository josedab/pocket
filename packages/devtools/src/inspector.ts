import type { ChangeEvent, Database, Document } from '@pocket/core';
import { BehaviorSubject, Subject, type Observable, type Subscription } from 'rxjs';
import type {
  CollectionInfo,
  CollectionStats,
  DatabaseInfo,
  DatabaseStats,
  DevToolsConfig,
  DocumentInfo,
  OperationRecord,
  PerformanceMetric,
  TimeSnapshot,
} from './types.js';

/**
 * Default configuration values.
 * @internal
 */
const DEFAULT_CONFIG: Required<DevToolsConfig> = {
  maxOperations: 1000,
  maxChanges: 500,
  trackPerformance: true,
  explainQueries: true,
  autoConnect: true,
};

/**
 * Database Inspector for DevTools introspection.
 *
 * The inspector provides APIs for examining database state,
 * executing queries with timing, tracking operations, and
 * creating point-in-time snapshots for debugging.
 *
 * Key features:
 * - Browse databases, collections, and documents
 * - Execute queries with performance metrics
 * - Track operation history
 * - Create and restore time-travel snapshots
 * - Subscribe to real-time changes
 *
 * @example Basic inspection
 * ```typescript
 * const inspector = createInspector();
 * inspector.register(myDatabase);
 *
 * // Get all databases
 * const dbs = await inspector.getDatabases();
 *
 * // Get collection info
 * const info = await inspector.getCollectionInfo('mydb', 'users');
 * console.log(`Users: ${info.documentCount} documents`);
 *
 * // Browse documents
 * const { documents, total } = await inspector.getDocuments('mydb', 'users', {
 *   offset: 0,
 *   limit: 20,
 * });
 * ```
 *
 * @example Performance monitoring
 * ```typescript
 * // Subscribe to performance metrics
 * inspector.getMetrics().subscribe(metric => {
 *   console.log(`${metric.operation} on ${metric.collection}: ${metric.durationMs}ms`);
 * });
 *
 * // Execute query with timing
 * const { results, executionTimeMs } = await inspector.executeQuery(
 *   'mydb',
 *   'users',
 *   { filter: { active: true } }
 * );
 * ```
 *
 * @example Time-travel debugging
 * ```typescript
 * // Create snapshot before changes
 * const snapshot = await inspector.createSnapshot('mydb', 'users', 'Before update');
 *
 * // Make changes...
 *
 * // Restore if needed
 * await inspector.restoreSnapshot(snapshot.id);
 * ```
 *
 * @see {@link createInspector} - Factory function
 * @see {@link DevToolsBridge} - Communication bridge
 */
export class DatabaseInspector {
  private readonly databases = new Map<string, Database>();
  private readonly config: Required<DevToolsConfig>;

  private readonly operations$ = new BehaviorSubject<OperationRecord[]>([]);
  private readonly changes$ = new Subject<ChangeEvent<Document>>();
  private readonly metrics$ = new Subject<PerformanceMetric>();
  private readonly snapshots = new Map<string, TimeSnapshot>();

  private changeSubscriptions = new Map<string, Subscription>();
  private operationCounter = 0;

  /**
   * Create a new DatabaseInspector.
   *
   * @param config - DevTools configuration options
   */
  constructor(config: DevToolsConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a database for inspection.
   *
   * Subscribes to all collection changes for real-time monitoring.
   *
   * @param database - Database to register
   */
  register(database: Database): void {
    const name = database.name;

    if (this.databases.has(name)) {
      this.unregister(name);
    }

    this.databases.set(name, database);

    // Subscribe to changes from all collections
    void this.subscribeToChanges(database);
  }

  /**
   * Unregister a database from inspection.
   *
   * @param name - Name of the database to unregister
   */
  unregister(name: string): void {
    this.databases.delete(name);

    // Unsubscribe from changes
    const sub = this.changeSubscriptions.get(name);
    if (sub) {
      sub.unsubscribe();
      this.changeSubscriptions.delete(name);
    }
  }

  /**
   * Get information about all registered databases.
   *
   * @returns Array of database information
   */
  async getDatabases(): Promise<DatabaseInfo[]> {
    const infos: DatabaseInfo[] = [];

    for (const [name, db] of this.databases) {
      const collections = await db.listCollections();
      infos.push({
        name,
        version: db.version,
        nodeId: db.nodeId,
        collections,
        isOpen: db.isOpen,
      });
    }

    return infos;
  }

  /**
   * Get detailed information about a collection.
   *
   * @param databaseName - Name of the database
   * @param collectionName - Name of the collection
   * @returns Collection info, or null if not found
   */
  async getCollectionInfo(
    databaseName: string,
    collectionName: string
  ): Promise<CollectionInfo | null> {
    const db = this.databases.get(databaseName);
    if (!db) return null;

    const collection = db.collection(collectionName);
    const count = await collection.count();
    const indexes = await collection.getIndexes();

    return {
      name: collectionName,
      documentCount: count,
      indexes: indexes.map((idx) => ({
        name: idx.name,
        fields: idx.fields.map((f) => f.field),
        unique: idx.unique,
      })),
      schema: collection.schema
        ? {
            version: collection.schema.version,
            fields: Object.fromEntries(
              Object.entries(collection.schema.definition.properties).map(([key, def]) => [
                key,
                {
                  type: Array.isArray(def.type) ? def.type.join(' | ') : def.type,
                  required: def.required,
                  default: def.default,
                },
              ])
            ),
          }
        : undefined,
    };
  }

  /**
   * Get documents from a collection with pagination.
   *
   * @param databaseName - Name of the database
   * @param collectionName - Name of the collection
   * @param options - Pagination and filter options
   * @returns Paginated document list with total count
   *
   * @example
   * ```typescript
   * const { documents, total } = await inspector.getDocuments(
   *   'mydb',
   *   'users',
   *   { offset: 20, limit: 10, filter: { active: true } }
   * );
   * ```
   */
  async getDocuments(
    databaseName: string,
    collectionName: string,
    options: { offset?: number; limit?: number; filter?: Record<string, unknown> } = {}
  ): Promise<{ documents: DocumentInfo[]; total: number }> {
    const db = this.databases.get(databaseName);
    if (!db) return { documents: [], total: 0 };

    const { offset = 0, limit = 50, filter } = options;
    const collection = db.collection(collectionName);

    const total = await collection.count(filter);
    const docs = await collection.find(filter).skip(offset).limit(limit).exec();

    const documents: DocumentInfo[] = docs.map((doc) => ({
      _id: doc._id,
      _rev: doc._rev,
      _updatedAt: doc._updatedAt,
      _deleted: doc._deleted,
      preview: this.createPreview(doc),
    }));

    return { documents, total };
  }

  /**
   * Get a single document by ID.
   *
   * @param databaseName - Name of the database
   * @param collectionName - Name of the collection
   * @param documentId - Document ID
   * @returns The document, or null if not found
   */
  async getDocument(
    databaseName: string,
    collectionName: string,
    documentId: string
  ): Promise<Document | null> {
    const db = this.databases.get(databaseName);
    if (!db) return null;

    const collection = db.collection(collectionName);
    return collection.get(documentId);
  }

  /**
   * Get statistics for a database.
   *
   * @param databaseName - Name of the database
   * @returns Database statistics, or null if not found
   */
  async getStats(databaseName: string): Promise<DatabaseStats | null> {
    const db = this.databases.get(databaseName);
    if (!db) return null;

    const dbStats = await db.getStats();
    const collectionNames = await db.listCollections();

    const collections: Record<string, CollectionStats> = {};

    for (const name of collectionNames) {
      const collection = db.collection(name);
      const count = await collection.count();
      const indexes = await collection.getIndexes();

      collections[name] = {
        documentCount: count,
        avgDocumentSize: 0, // Would need to calculate
        indexCount: indexes.length,
      };
    }

    return {
      documentCount: dbStats.documentCount,
      storageSize: dbStats.storageSize,
      collectionCount: dbStats.collectionCount,
      indexCount: dbStats.indexCount,
      collections,
    };
  }

  /**
   * Execute a query with performance timing.
   *
   * Records the operation in history and emits performance metrics
   * if tracking is enabled.
   *
   * @typeParam T - Document type
   * @param databaseName - Name of the database
   * @param collectionName - Name of the collection
   * @param spec - Query specification
   * @returns Query results and execution time
   *
   * @example
   * ```typescript
   * const { results, executionTimeMs } = await inspector.executeQuery(
   *   'mydb',
   *   'products',
   *   {
   *     filter: { category: 'electronics' },
   *     sort: { price: 'asc' },
   *     limit: 10,
   *   }
   * );
   * console.log(`Found ${results.length} products in ${executionTimeMs}ms`);
   * ```
   */
  async executeQuery<T extends Document>(
    databaseName: string,
    collectionName: string,
    spec: {
      filter?: Partial<T>;
      sort?: Record<string, 'asc' | 'desc'>;
      limit?: number;
      skip?: number;
    }
  ): Promise<{ results: T[]; executionTimeMs: number }> {
    const db = this.databases.get(databaseName);
    if (!db) return { results: [], executionTimeMs: 0 };

    const collection = db.collection<T>(collectionName);
    const startTime = performance.now();

    let queryBuilder = collection.find(spec.filter);

    if (spec.sort) {
      for (const [field, direction] of Object.entries(spec.sort)) {
        queryBuilder = queryBuilder.sort(field as keyof T & string, direction);
      }
    }

    if (spec.skip) {
      queryBuilder = queryBuilder.skip(spec.skip);
    }

    if (spec.limit) {
      queryBuilder = queryBuilder.limit(spec.limit);
    }

    const results = await queryBuilder.exec();
    const executionTimeMs = performance.now() - startTime;

    // Record operation
    this.recordOperation({
      id: this.generateOperationId(),
      type: 'query',
      collection: collectionName,
      timestamp: Date.now(),
      durationMs: executionTimeMs,
      success: true,
      details: { spec, resultCount: results.length },
    });

    // Record metric
    if (this.config.trackPerformance) {
      this.metrics$.next({
        operation: 'query',
        collection: collectionName,
        durationMs: executionTimeMs,
        timestamp: Date.now(),
      });
    }

    return { results, executionTimeMs };
  }

  /**
   * Create a point-in-time snapshot for time-travel debugging.
   *
   * Captures all documents in a collection for later restoration.
   *
   * @param databaseName - Name of the database
   * @param collectionName - Name of the collection
   * @param label - Optional descriptive label
   * @returns The created snapshot
   * @throws Error if database not found
   *
   * @example
   * ```typescript
   * // Create snapshot before risky operation
   * const snapshot = await inspector.createSnapshot(
   *   'mydb',
   *   'users',
   *   'Before bulk update'
   * );
   * console.log(`Snapshot ${snapshot.id} created`);
   * ```
   */
  async createSnapshot(
    databaseName: string,
    collectionName: string,
    label?: string
  ): Promise<TimeSnapshot> {
    const db = this.databases.get(databaseName);
    if (!db) throw new Error(`Database ${databaseName} not found`);

    const collection = db.collection(collectionName);
    const documents = await collection.getAll();

    const snapshot: TimeSnapshot = {
      id: `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      timestamp: Date.now(),
      database: databaseName,
      collection: collectionName,
      documents,
      label,
    };

    this.snapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  /**
   * Restore a collection from a snapshot.
   *
   * **Warning**: This clears the collection and replaces all documents
   * with the snapshot data. Use with caution.
   *
   * @param snapshotId - ID of the snapshot to restore
   * @throws Error if snapshot or database not found
   *
   * @example
   * ```typescript
   * try {
   *   await inspector.restoreSnapshot(snapshot.id);
   *   console.log('Restored successfully');
   * } catch (error) {
   *   console.error('Restore failed:', error);
   * }
   * ```
   */
  async restoreSnapshot(snapshotId: string): Promise<void> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found`);

    const db = this.databases.get(snapshot.database);
    if (!db) throw new Error(`Database ${snapshot.database} not found`);

    const collection = db.collection(snapshot.collection);

    // Clear and restore
    await collection.clear();
    for (const doc of snapshot.documents) {
      await collection.insert(doc as Parameters<typeof collection.insert>[0]);
    }
  }

  /**
   * Get all stored snapshots.
   *
   * @returns Array of all snapshots
   */
  getSnapshots(): TimeSnapshot[] {
    return [...this.snapshots.values()];
  }

  /**
   * Delete a snapshot.
   *
   * @param snapshotId - ID of the snapshot to delete
   * @returns True if deleted, false if not found
   */
  deleteSnapshot(snapshotId: string): boolean {
    return this.snapshots.delete(snapshotId);
  }

  /**
   * Get an observable of the operations history.
   *
   * @returns Observable of operation records
   */
  getOperations(): Observable<OperationRecord[]> {
    return this.operations$.asObservable();
  }

  /**
   * Get an observable of real-time changes.
   *
   * @returns Observable of change events from all registered databases
   */
  getChanges(): Observable<ChangeEvent<Document>> {
    return this.changes$.asObservable();
  }

  /**
   * Get an observable of performance metrics.
   *
   * Only emits if `trackPerformance` is enabled in config.
   *
   * @returns Observable of performance metrics
   */
  getMetrics(): Observable<PerformanceMetric> {
    return this.metrics$.asObservable();
  }

  /**
   * Clear the operations history.
   */
  clearOperations(): void {
    this.operations$.next([]);
  }

  /**
   * Destroy the inspector and clean up resources.
   *
   * Unsubscribes from all changes, clears databases and snapshots,
   * and completes all observables.
   */
  destroy(): void {
    for (const sub of this.changeSubscriptions.values()) {
      sub.unsubscribe();
    }
    this.changeSubscriptions.clear();
    this.databases.clear();
    this.snapshots.clear();
    this.operations$.complete();
    this.changes$.complete();
    this.metrics$.complete();
  }

  /**
   * Subscribe to changes from a database's collections.
   * @internal
   */
  private async subscribeToChanges(database: Database): Promise<void> {
    const collections = await database.listCollections();

    for (const name of collections) {
      const collection = database.collection(name);
      const sub = collection.changes().subscribe((event) => {
        this.changes$.next(event);

        // Record operation
        this.recordOperation({
          id: this.generateOperationId(),
          type: event.operation,
          collection: name,
          documentId: event.documentId,
          timestamp: event.timestamp,
          durationMs: 0,
          success: true,
          details: {
            isFromSync: event.isFromSync,
            hasDocument: !!event.document,
          },
        });
      });

      this.changeSubscriptions.set(`${database.name}:${name}`, sub);
    }
  }

  /**
   * Record an operation to history.
   * @internal
   */
  private recordOperation(operation: OperationRecord): void {
    const current = this.operations$.getValue();
    const updated = [operation, ...current].slice(0, this.config.maxOperations);
    this.operations$.next(updated);
  }

  /**
   * Generate a unique operation ID.
   * @internal
   */
  private generateOperationId(): string {
    return `op_${++this.operationCounter}_${Date.now()}`;
  }

  /**
   * Create a truncated preview of a document for list display.
   * @internal
   */
  private createPreview(doc: Document, maxFields = 5): Record<string, unknown> {
    const preview: Record<string, unknown> = {};
    let count = 0;

    for (const [key, value] of Object.entries(doc)) {
      if (key.startsWith('_')) continue;
      if (count >= maxFields) break;

      if (typeof value === 'string' && value.length > 100) {
        preview[key] = value.substring(0, 100) + '...';
      } else if (typeof value === 'object' && value !== null) {
        preview[key] = '[Object]';
      } else {
        preview[key] = value;
      }

      count++;
    }

    return preview;
  }
}

/**
 * Create a new Database Inspector.
 *
 * @param config - DevTools configuration options
 * @returns A new DatabaseInspector instance
 *
 * @example
 * ```typescript
 * const inspector = createInspector({
 *   maxOperations: 500,
 *   trackPerformance: true,
 * });
 *
 * inspector.register(myDatabase);
 * ```
 *
 * @see {@link DatabaseInspector}
 */
export function createInspector(config?: DevToolsConfig): DatabaseInspector {
  return new DatabaseInspector(config);
}
