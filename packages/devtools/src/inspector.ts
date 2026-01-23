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
 * Default configuration
 */
const DEFAULT_CONFIG: Required<DevToolsConfig> = {
  maxOperations: 1000,
  maxChanges: 500,
  trackPerformance: true,
  explainQueries: true,
  autoConnect: true,
};

/**
 * Database inspector for DevTools
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

  constructor(config: DevToolsConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a database for inspection
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
   * Unregister a database
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
   * Get all registered databases info
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
   * Get collection info
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
   * Get documents from a collection
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
   * Get a single document
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
   * Get database stats
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
   * Execute a query with timing
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
   * Create a time snapshot
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
   * Restore from a snapshot
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
   * Get snapshots
   */
  getSnapshots(): TimeSnapshot[] {
    return [...this.snapshots.values()];
  }

  /**
   * Delete a snapshot
   */
  deleteSnapshot(snapshotId: string): boolean {
    return this.snapshots.delete(snapshotId);
  }

  /**
   * Get operations history
   */
  getOperations(): Observable<OperationRecord[]> {
    return this.operations$.asObservable();
  }

  /**
   * Get changes stream
   */
  getChanges(): Observable<ChangeEvent<Document>> {
    return this.changes$.asObservable();
  }

  /**
   * Get performance metrics stream
   */
  getMetrics(): Observable<PerformanceMetric> {
    return this.metrics$.asObservable();
  }

  /**
   * Clear operations history
   */
  clearOperations(): void {
    this.operations$.next([]);
  }

  /**
   * Destroy the inspector
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
   * Subscribe to changes from database
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
   * Record an operation
   */
  private recordOperation(operation: OperationRecord): void {
    const current = this.operations$.getValue();
    const updated = [operation, ...current].slice(0, this.config.maxOperations);
    this.operations$.next(updated);
  }

  /**
   * Generate operation ID
   */
  private generateOperationId(): string {
    return `op_${++this.operationCounter}_${Date.now()}`;
  }

  /**
   * Create document preview
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
 * Create a database inspector
 */
export function createInspector(config?: DevToolsConfig): DatabaseInspector {
  return new DatabaseInspector(config);
}
